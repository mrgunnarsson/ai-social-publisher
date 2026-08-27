import { createHmac, timingSafeEqual } from "node:crypto";

import { NextResponse } from "next/server";

import { isRecord, readString } from "@/lib/meta/comment-types";
import { createSupabaseAdminClient } from "@/lib/server/supabase-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_WEBHOOK_BODY_BYTES = 256 * 1024;
const CONTROL_INFLUENCER_ID = "0fb3f4fe-89ae-42d1-b77f-03fe700f6954";
const CONTROL_SOCIAL_ACCOUNT_ID = "1bc5a490-9c75-4dde-aa02-773df6bc3378";
const CONTROL_INSTAGRAM_ACCOUNT_ID = "28437061092599539";
const CONTROL_MEDIA_ID = "18021987887913714";

type InstagramCommentEvent = {
  accountId: string;
  mediaId: string;
  commentId: string;
  parentCommentId: string | null;
  authorId: string | null;
  authorUsername: string | null;
  text: string | null;
  mediaProductType: string | null;
  occurredAt: string;
  timestampSource: "comment" | "entry" | "received_at";
};

type CommentTarget = {
  id: string;
  influencer_id: string;
  social_account_id: string;
  post_id: string;
  destination_id: string | null;
  external_object_type: "instagram_media";
  external_object_id: string;
};

function noStoreHeaders(contentType?: string) {
  return {
    "Cache-Control": "no-store",
    ...(contentType ? { "Content-Type": contentType } : {}),
  };
}

function secretsMatch(suppliedValue: string | null, expectedValue: string) {
  if (!suppliedValue) {
    return false;
  }

  const supplied = Buffer.from(suppliedValue, "utf8");
  const expected = Buffer.from(expectedValue, "utf8");

  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

function verifySignature(rawBody: Buffer, signature: string | null, appSecret: string) {
  const match = signature?.match(/^sha256=([a-f0-9]{64})$/i);

  if (!match) {
    return false;
  }

  const suppliedDigest = Buffer.from(match[1], "hex");
  const expectedDigest = createHmac("sha256", appSecret).update(rawBody).digest();

  return (
    suppliedDigest.length === expectedDigest.length &&
    timingSafeEqual(suppliedDigest, expectedDigest)
  );
}

function normalizeTimestamp(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    const milliseconds = value < 10_000_000_000 ? value * 1000 : value;
    const parsed = new Date(milliseconds);
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
  }

  const text = readString(value);

  if (!text) {
    return null;
  }

  if (/^\d+$/.test(text)) {
    return normalizeTimestamp(Number(text));
  }

  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function normalizeCommentEvent(
  accountId: string,
  entryTime: unknown,
  value: unknown,
  receivedAt: string
): InstagramCommentEvent | null {
  if (!isRecord(value)) {
    return null;
  }

  const media = isRecord(value.media) ? value.media : null;
  const author = isRecord(value.from) ? value.from : null;
  const commentId = readString(value.id);
  const mediaId = media ? readString(media.id) : null;

  if (!commentId || !mediaId) {
    return null;
  }

  const commentTimestamp = normalizeTimestamp(value.timestamp);
  const notificationTimestamp = normalizeTimestamp(entryTime);

  return {
    accountId,
    mediaId,
    commentId,
    parentCommentId: readString(value.parent_id),
    authorId: author ? readString(author.id) : null,
    authorUsername: author ? readString(author.username) : null,
    text: typeof value.text === "string" ? value.text : null,
    mediaProductType: media ? readString(media.media_product_type) : null,
    occurredAt: commentTimestamp ?? notificationTimestamp ?? receivedAt,
    timestampSource: commentTimestamp
      ? "comment"
      : notificationTimestamp
        ? "entry"
        : "received_at",
  };
}

function extractCommentEvents(payload: unknown, receivedAt: string) {
  if (!isRecord(payload) || payload.object !== "instagram" || !Array.isArray(payload.entry)) {
    return [];
  }

  const events: InstagramCommentEvent[] = [];

  for (const rawEntry of payload.entry) {
    if (!isRecord(rawEntry)) {
      continue;
    }

    const accountId = readString(rawEntry.id);

    if (!accountId) {
      continue;
    }

    const changes = Array.isArray(rawEntry.changes)
      ? rawEntry.changes
      : [{ field: rawEntry.field, value: rawEntry.value }];

    for (const rawChange of changes) {
      if (!isRecord(rawChange) || rawChange.field !== "comments") {
        continue;
      }

      const event = normalizeCommentEvent(
        accountId,
        rawEntry.time,
        rawChange.value,
        receivedAt
      );

      if (event) {
        events.push(event);
      }
    }
  }

  return events;
}

async function loadControlTarget(
  supabase: ReturnType<typeof createSupabaseAdminClient>
) {
  const { data: account, error: accountError } = await supabase
    .from("social_accounts")
    .select("id, influencer_id, platform, external_account_id")
    .eq("id", CONTROL_SOCIAL_ACCOUNT_ID)
    .eq("influencer_id", CONTROL_INFLUENCER_ID)
    .eq("platform", "instagram")
    .eq("external_account_id", CONTROL_INSTAGRAM_ACCOUNT_ID)
    .maybeSingle();

  if (accountError) {
    throw new Error("The control Instagram account lookup failed.");
  }

  if (!account) {
    return null;
  }

  const { data: targets, error: targetError } = await supabase
    .from("comment_sync_targets")
    .select(
      "id, influencer_id, social_account_id, post_id, destination_id, external_object_type, external_object_id"
    )
    .eq("influencer_id", CONTROL_INFLUENCER_ID)
    .eq("social_account_id", CONTROL_SOCIAL_ACCOUNT_ID)
    .eq("platform", "instagram")
    .eq("external_object_type", "instagram_media")
    .eq("external_object_id", CONTROL_MEDIA_ID)
    .limit(2);

  if (targetError) {
    throw new Error("The control comment target lookup failed.");
  }

  if (!targets || targets.length !== 1) {
    return null;
  }

  return targets[0] as CommentTarget;
}

async function storeCommentEvent(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  target: CommentTarget,
  event: InstagramCommentEvent,
  receivedAt: string
) {
  const { data, error } = await supabase
    .from("social_comments")
    .upsert(
      {
        sync_target_id: target.id,
        influencer_id: target.influencer_id,
        platform: "instagram",
        social_account_id: target.social_account_id,
        post_id: target.post_id,
        destination_id: target.destination_id,
        external_object_type: target.external_object_type,
        external_post_id: target.external_object_id,
        external_comment_id: event.commentId,
        parent_external_comment_id: event.parentCommentId,
        thread_root_external_comment_id: event.parentCommentId ?? event.commentId,
        author_external_id: event.authorId,
        author_username: event.authorUsername,
        author_name: null,
        message: event.text,
        comment_created_at: event.occurredAt,
        like_count: null,
        is_from_our_account: event.authorId === event.accountId,
        is_hidden: null,
        is_deleted: false,
        source_data: {
          platform: "instagram",
          objectType: "instagram_media",
          delivery: "webhook",
          event: {
            accountId: event.accountId,
            mediaId: event.mediaId,
            commentId: event.commentId,
            parentCommentId: event.parentCommentId,
            authorId: event.authorId,
            authorUsername: event.authorUsername,
            text: event.text,
            mediaProductType: event.mediaProductType,
            timestamp: event.occurredAt,
            timestampSource: event.timestampSource,
          },
        },
        first_seen_at: receivedAt,
        last_seen_at: receivedAt,
        last_synced_at: receivedAt,
        created_at: receivedAt,
        updated_at: receivedAt,
      },
      {
        onConflict: "platform,social_account_id,external_comment_id",
        ignoreDuplicates: true,
      }
    )
    .select("id");

  if (error) {
    throw new Error("The webhook comment could not be stored.");
  }

  return (data?.length ?? 0) === 1 ? "inserted" : "duplicate";
}

export async function GET(request: Request) {
  const verifyToken = process.env.INSTAGRAM_WEBHOOK_VERIFY_TOKEN;

  if (!verifyToken) {
    return NextResponse.json(
      { ok: false, error: "Instagram webhook verification is not configured." },
      { status: 500, headers: noStoreHeaders() }
    );
  }

  const url = new URL(request.url);
  const mode = url.searchParams.get("hub.mode");
  const suppliedToken = url.searchParams.get("hub.verify_token");
  const challenge = url.searchParams.get("hub.challenge");

  if (
    mode !== "subscribe" ||
    !secretsMatch(suppliedToken, verifyToken) ||
    challenge === null
  ) {
    return NextResponse.json(
      { ok: false, error: "Webhook verification failed." },
      { status: 403, headers: noStoreHeaders() }
    );
  }

  return new Response(challenge, {
    status: 200,
    headers: noStoreHeaders("text/plain; charset=utf-8"),
  });
}

export async function POST(request: Request) {
  const appSecret = process.env.INSTAGRAM_APP_SECRET;

  if (!appSecret) {
    return NextResponse.json(
      { ok: false, error: "Instagram webhook signing is not configured." },
      { status: 500, headers: noStoreHeaders() }
    );
  }

  const contentLength = Number(request.headers.get("content-length"));

  if (Number.isFinite(contentLength) && contentLength > MAX_WEBHOOK_BODY_BYTES) {
    return NextResponse.json(
      { ok: false, error: "Webhook payload is too large." },
      { status: 413, headers: noStoreHeaders() }
    );
  }

  const rawBody = Buffer.from(await request.arrayBuffer());

  if (rawBody.byteLength > MAX_WEBHOOK_BODY_BYTES) {
    return NextResponse.json(
      { ok: false, error: "Webhook payload is too large." },
      { status: 413, headers: noStoreHeaders() }
    );
  }

  if (!verifySignature(rawBody, request.headers.get("x-hub-signature-256"), appSecret)) {
    return NextResponse.json(
      { ok: false, error: "Invalid webhook signature." },
      { status: 401, headers: noStoreHeaders() }
    );
  }

  let payload: unknown;

  try {
    payload = JSON.parse(rawBody.toString("utf8"));
  } catch {
    return NextResponse.json(
      { ok: false, error: "Invalid JSON payload." },
      { status: 400, headers: noStoreHeaders() }
    );
  }

  const receivedAt = new Date().toISOString();
  const events = extractCommentEvents(payload, receivedAt);
  const controlEvents = events.filter(
    (event) =>
      event.accountId === CONTROL_INSTAGRAM_ACCOUNT_ID &&
      event.mediaId === CONTROL_MEDIA_ID
  );

  if (controlEvents.length === 0) {
    return NextResponse.json(
      {
        ok: true,
        received: events.length,
        accepted: 0,
        inserted: 0,
        duplicates: 0,
        ignored: events.length,
      },
      { headers: noStoreHeaders() }
    );
  }

  try {
    const supabase = createSupabaseAdminClient();
    const target = await loadControlTarget(supabase);

    if (!target) {
      return NextResponse.json(
        {
          ok: false,
          error: "The Veya control media does not have one unambiguous sync target.",
        },
        { status: 500, headers: noStoreHeaders() }
      );
    }

    let inserted = 0;
    let duplicates = 0;

    for (const event of controlEvents) {
      const result = await storeCommentEvent(supabase, target, event, receivedAt);

      if (result === "inserted") {
        inserted += 1;
      } else {
        duplicates += 1;
      }

      console.info("Instagram comment webhook processed.", {
        accountId: event.accountId,
        mediaId: event.mediaId,
        commentId: event.commentId,
        result,
      });
    }

    return NextResponse.json(
      {
        ok: true,
        received: events.length,
        accepted: controlEvents.length,
        inserted,
        duplicates,
        ignored: events.length - controlEvents.length,
      },
      { headers: noStoreHeaders() }
    );
  } catch (error) {
    console.error(
      "Instagram comment webhook processing failed.",
      error instanceof Error ? error.message : "Unknown processing error."
    );

    return NextResponse.json(
      { ok: false, error: "Webhook processing failed." },
      { status: 500, headers: noStoreHeaders() }
    );
  }
}
