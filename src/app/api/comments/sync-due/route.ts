import { NextResponse } from "next/server";

import { readFacebookComments } from "@/lib/meta/facebook-comments";
import { readInstagramComments } from "@/lib/meta/instagram-comments";
import {
  isRecord,
  type CommentPlatformFilter,
  type CommentSyncTarget,
  type NormalizedComment,
} from "@/lib/meta/comment-types";
import { describeCommentTarget } from "@/lib/meta/comment-targets";
import { createSupabaseAdminClient } from "@/lib/server/supabase-admin";

const DEFAULT_BATCH_SIZE = 10;
const MAX_BATCH_SIZE = 50;
const STALE_CLAIM_MS = 15 * 60 * 1000;
const COMMENT_READ_LIMITS = {
  maxPages: 20,
  maxComments: 1000,
  pageSize: 100,
  maxReplyPagesPerComment: 5,
};

type SocialAccount = {
  id: string;
  external_account_id: string;
  access_token: string;
};

function isPlatformFilter(value: unknown): value is CommentPlatformFilter {
  return value === "all" || value === "instagram" || value === "facebook";
}

function deterministicRatio(value: string) {
  let hash = 2166136261;

  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return (hash >>> 0) / 0xffffffff;
}

function addDeterministicJitter(milliseconds: number, key: string) {
  const jitter = (deterministicRatio(key) * 0.2 - 0.1) * milliseconds;
  return Math.max(60_000, Math.round(milliseconds + jitter));
}

function scheduleIntervalMs(target: CommentSyncTarget, now: Date) {
  const publishedAt = new Date(target.published_at).getTime();
  const activityAt = target.last_comment_activity_at
    ? new Date(target.last_comment_activity_at).getTime()
    : Number.NEGATIVE_INFINITY;
  const activeSince = Math.max(publishedAt, activityAt);
  const age = Math.max(0, now.getTime() - activeSince);
  const hour = 60 * 60 * 1000;
  const day = 24 * hour;

  if (age < hour) return 3 * 60 * 1000;
  if (age < 6 * hour) return 7 * 60 * 1000;
  if (age < day) return 20 * 60 * 1000;
  if (age < 7 * day) return 2 * hour;
  if (age < 30 * day) return 12 * hour;
  if (age < 180 * day) return day;
  return 7 * day;
}

function nextSuccessSyncAt(target: CommentSyncTarget, now: Date, truncated: boolean) {
  const normalInterval = addDeterministicJitter(
    scheduleIntervalMs(target, now),
    target.id
  );
  const interval = truncated ? Math.min(normalInterval, 10 * 60 * 1000) : normalInterval;
  return new Date(now.getTime() + interval).toISOString();
}

function nextFailureSyncAt(target: CommentSyncTarget, now: Date) {
  const exponent = Math.min(Math.max(target.sync_error_count, 0), 8);
  const interval = Math.min(24 * 60 * 60 * 1000, 5 * 60 * 1000 * 2 ** exponent);
  return new Date(
    now.getTime() + addDeterministicJitter(interval, `${target.id}:error`)
  ).toISOString();
}

function sanitizeError(value: unknown) {
  const message = value instanceof Error ? value.message : String(value);

  return message
    .replace(/access_token=[^&\s]+/gi, "access_token=[redacted]")
    .replace(/Bearer\s+[^\s]+/gi, "Bearer [redacted]")
    .slice(0, 1000);
}

async function loadAccount(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  target: CommentSyncTarget
) {
  const { data, error } = await supabase
    .from("social_accounts")
    .select("id, external_account_id, access_token")
    .eq("id", target.social_account_id)
    .eq("influencer_id", target.influencer_id)
    .eq("platform", target.platform)
    .single();

  if (error || !data?.external_account_id || !data.access_token) {
    throw new Error(error?.message ?? "The comment target account is incomplete.");
  }

  return data as SocialAccount;
}

async function readTargetComments(
  target: CommentSyncTarget,
  account: SocialAccount
) {
  if (target.platform === "instagram") {
    if (target.external_object_type !== "instagram_media") {
      throw new Error("Instagram comment target has an invalid object type.");
    }

    return readInstagramComments({
      mediaId: target.external_object_id,
      accessToken: account.access_token,
      ownAccountExternalId: account.external_account_id,
      limits: COMMENT_READ_LIMITS,
    });
  }

  if (target.external_object_type === "instagram_media") {
    throw new Error("Facebook comment target has an invalid object type.");
  }

  return readFacebookComments({
    objectId: target.external_object_id,
    objectType: target.external_object_type,
    accessToken: account.access_token,
    ownAccountExternalId: account.external_account_id,
    limits: COMMENT_READ_LIMITS,
  });
}

function serializeComments(comments: NormalizedComment[]) {
  return comments.map((comment) => ({
    externalCommentId: comment.externalCommentId,
    parentExternalCommentId: comment.parentExternalCommentId,
    threadRootExternalCommentId: comment.threadRootExternalCommentId,
    authorExternalId: comment.authorExternalId,
    authorUsername: comment.authorUsername,
    authorName: comment.authorName,
    message: comment.message,
    createdAt: comment.createdAt,
    likeCount: comment.likeCount,
    isFromOurAccount: comment.isFromOurAccount,
    isHidden: comment.isHidden,
    isDeleted: comment.isDeleted,
    source: comment.source,
  }));
}

export async function POST(request: Request) {
  const supabase = createSupabaseAdminClient();

  try {
    const expectedSecret = process.env.CRON_SECRET;

    if (!expectedSecret) {
      return NextResponse.json(
        { ok: false, error: "CRON_SECRET is missing." },
        { status: 500 }
      );
    }

    if (request.headers.get("authorization") !== `Bearer ${expectedSecret}`) {
      return NextResponse.json({ ok: false, error: "Unauthorized." }, { status: 401 });
    }

    let dryRun = false;
    let batchSize = DEFAULT_BATCH_SIZE;
    let platform: CommentPlatformFilter = "all";
    const rawBody = await request.text();

    if (rawBody.trim()) {
      let body: unknown;

      try {
        body = JSON.parse(rawBody);
      } catch {
        return NextResponse.json({ ok: false, error: "Invalid JSON body." }, { status: 400 });
      }

      if (!isRecord(body)) {
        return NextResponse.json(
          { ok: false, error: "Request body must be a JSON object." },
          { status: 400 }
        );
      }

      if (body.dryRun !== undefined && typeof body.dryRun !== "boolean") {
        return NextResponse.json({ ok: false, error: "dryRun must be a boolean." }, { status: 400 });
      }

      if (body.platform !== undefined && !isPlatformFilter(body.platform)) {
        return NextResponse.json(
          { ok: false, error: 'platform must be "all", "instagram", or "facebook".' },
          { status: 400 }
        );
      }

      if (
        body.batchSize !== undefined &&
        (!Number.isInteger(body.batchSize) ||
          Number(body.batchSize) < 1 ||
          Number(body.batchSize) > MAX_BATCH_SIZE)
      ) {
        return NextResponse.json(
          { ok: false, error: `batchSize must be between 1 and ${MAX_BATCH_SIZE}.` },
          { status: 400 }
        );
      }

      dryRun = body.dryRun === true;
      batchSize = body.batchSize === undefined ? DEFAULT_BATCH_SIZE : Number(body.batchSize);
      platform = body.platform ?? "all";
    }

    const startedAt = new Date();
    const now = startedAt.toISOString();
    const staleBefore = new Date(startedAt.getTime() - STALE_CLAIM_MS).toISOString();
    const bootstrapLimit = Math.min(100, Math.max(batchSize * 3, 25));

    if (dryRun) {
      let dueQuery = supabase
        .from("comment_sync_targets")
        .select("*")
        .lte("next_sync_at", now)
        .or(`sync_claim_token.is.null,sync_claimed_at.is.null,sync_claimed_at.lt.${staleBefore}`)
        .order("next_sync_at", { ascending: true })
        .order("published_at", { ascending: false })
        .limit(batchSize);

      if (platform !== "all") {
        dueQuery = dueQuery.eq("platform", platform);
      }

      const [{ data: due, error: dueError }, { data: bootstrap, error: bootstrapError }] =
        await Promise.all([
          dueQuery,
          supabase.rpc("preview_comment_sync_target_bootstrap", {
            p_limit: bootstrapLimit,
            p_platform: platform,
            p_now: now,
          }),
        ]);

      if (dueError || bootstrapError) {
        throw new Error(dueError?.message ?? bootstrapError?.message);
      }

      return NextResponse.json({
        ok: true,
        dryRun: true,
        databaseOnly: true,
        batchSize,
        platform,
        due: (due ?? []).map((target) => describeCommentTarget(target as CommentSyncTarget)),
        bootstrapCandidates: bootstrap ?? [],
        staleClaimThresholdMinutes: STALE_CLAIM_MS / 60_000,
      });
    }

    const { data: bootstrapped, error: bootstrapError } = await supabase.rpc(
      "bootstrap_comment_sync_targets",
      {
        p_limit: bootstrapLimit,
        p_platform: platform,
        p_now: now,
      }
    );

    if (bootstrapError) {
      throw new Error(`Could not bootstrap comment targets: ${bootstrapError.message}`);
    }

    const claimToken = crypto.randomUUID();
    const { data: claimedRows, error: claimError } = await supabase.rpc(
      "claim_due_comment_sync_targets",
      {
        p_limit: batchSize,
        p_platform: platform,
        p_now: now,
        p_stale_before: staleBefore,
        p_claim_token: claimToken,
      }
    );

    if (claimError) {
      throw new Error(`Could not claim comment targets: ${claimError.message}`);
    }

    const targets = (claimedRows ?? []) as CommentSyncTarget[];
    const results = [];

    for (const target of targets) {
      try {
        const account = await loadAccount(supabase, target);
        const readResult = await readTargetComments(target, account);
        const observedAt = new Date();
        const { data: completed, error: completeError } = await supabase.rpc(
          "complete_comment_sync",
          {
            p_target_id: target.id,
            p_claim_token: claimToken,
            p_observed_at: observedAt.toISOString(),
            p_next_sync_at: nextSuccessSyncAt(
              target,
              observedAt,
              readResult.truncated
            ),
            p_comments: serializeComments(readResult.comments),
          }
        );

        if (completeError) {
          throw new Error(`Could not persist comments: ${completeError.message}`);
        }

        results.push({
          ok: true,
          target: describeCommentTarget(target),
          pagesFetched: readResult.pagesFetched,
          truncated: readResult.truncated,
          optionalFieldsSupported: readResult.optionalFieldsSupported,
          warnings: readResult.warnings,
          persistence: completed?.[0] ?? null,
        });
      } catch (error) {
        const failedAt = new Date();
        const sanitizedError = sanitizeError(error);
        const { error: failureError } = await supabase.rpc("fail_comment_sync", {
          p_target_id: target.id,
          p_claim_token: claimToken,
          p_failed_at: failedAt.toISOString(),
          p_next_sync_at: nextFailureSyncAt(target, failedAt),
          p_error_message: sanitizedError,
        });

        results.push({
          ok: false,
          target: describeCommentTarget(target),
          error: sanitizedError,
          claimReleaseError: failureError?.message ?? null,
        });
      }
    }

    return NextResponse.json({
      ok: true,
      dryRun: false,
      batchSize,
      platform,
      bootstrapped: Number(bootstrapped ?? 0),
      claimed: targets.length,
      succeeded: results.filter((result) => result.ok).length,
      failed: results.filter((result) => !result.ok).length,
      results,
    });
  } catch (error) {
    return NextResponse.json({ ok: false, error: sanitizeError(error) }, { status: 500 });
  }
}
