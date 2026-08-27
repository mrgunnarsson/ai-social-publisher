import { NextResponse } from "next/server";

import { authenticateSupabaseRequest, createSupabaseAdminClient } from "@/lib/server/supabase-admin";

const DEFAULT_LIMIT = 30;
const MAX_LIMIT = 100;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type InboxStatus = "all" | "needs_reply" | "replied" | "ignored";
type PlatformFilter = "all" | "instagram" | "facebook";

type CursorValue = {
  activityAt: string;
  rootCommentId: string;
};

type ThreadRow = {
  root_comment_id: string;
  influencer_id: string;
  platform: "instagram" | "facebook";
  social_account_id: string;
  post_id: string;
  destination_id: string | null;
  workflow_status: "active" | "ignored";
  needs_reply: boolean;
  latest_inbound_at: string | null;
  latest_own_reply_at: string | null;
  last_activity_at: string;
};

type CommentRow = {
  id: string;
  thread_root_comment_id: string;
  parent_comment_id: string | null;
  author_external_id: string | null;
  author_username: string | null;
  author_name: string | null;
  message: string | null;
  comment_created_at: string;
  like_count: number | null;
  is_from_our_account: boolean;
  is_hidden: boolean | null;
  is_deleted: boolean;
};

function isPlatformFilter(value: string | null): value is PlatformFilter {
  return value === "all" || value === "instagram" || value === "facebook";
}

function isInboxStatus(value: string | null): value is InboxStatus {
  return (
    value === "all" ||
    value === "needs_reply" ||
    value === "replied" ||
    value === "ignored"
  );
}

function encodeCursor(value: CursorValue) {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function decodeCursor(value: string | null): CursorValue | null {
  if (!value) {
    return null;
  }

  try {
    const decoded: unknown = JSON.parse(
      Buffer.from(value, "base64url").toString("utf8")
    );

    if (
      typeof decoded !== "object" ||
      decoded === null ||
      !("activityAt" in decoded) ||
      !("rootCommentId" in decoded) ||
      typeof decoded.activityAt !== "string" ||
      Number.isNaN(new Date(decoded.activityAt).getTime()) ||
      typeof decoded.rootCommentId !== "string" ||
      !UUID_PATTERN.test(decoded.rootCommentId)
    ) {
      return null;
    }

    return {
      activityAt: new Date(decoded.activityAt).toISOString(),
      rootCommentId: decoded.rootCommentId,
    };
  } catch {
    return null;
  }
}

function threadStatus(thread: ThreadRow) {
  if (thread.workflow_status === "ignored") {
    return "ignored" as const;
  }

  return thread.needs_reply ? ("needs_reply" as const) : ("replied" as const);
}

export async function GET(request: Request) {
  const supabase = createSupabaseAdminClient();

  try {
    const authentication = await authenticateSupabaseRequest(request, supabase);

    if (!authentication.user) {
      return NextResponse.json(
        { ok: false, error: authentication.error },
        { status: 401 }
      );
    }

    const url = new URL(request.url);
    const influencerId = url.searchParams.get("influencerId");
    const platformValue = url.searchParams.get("platform") ?? "all";
    const statusValue = url.searchParams.get("status") ?? "all";
    const limitValue = Number(url.searchParams.get("limit") ?? DEFAULT_LIMIT);
    const rawCursor = url.searchParams.get("cursor");
    const cursor = decodeCursor(rawCursor);

    if (influencerId && !UUID_PATTERN.test(influencerId)) {
      return NextResponse.json({ ok: false, error: "Invalid influencerId." }, { status: 400 });
    }

    if (!isPlatformFilter(platformValue)) {
      return NextResponse.json({ ok: false, error: "Invalid platform filter." }, { status: 400 });
    }

    if (!isInboxStatus(statusValue)) {
      return NextResponse.json({ ok: false, error: "Invalid status filter." }, { status: 400 });
    }

    if (!Number.isInteger(limitValue) || limitValue < 1 || limitValue > MAX_LIMIT) {
      return NextResponse.json(
        { ok: false, error: `limit must be between 1 and ${MAX_LIMIT}.` },
        { status: 400 }
      );
    }

    if (rawCursor && !cursor) {
      return NextResponse.json({ ok: false, error: "Invalid cursor." }, { status: 400 });
    }

    const influencerQuery = supabase
      .from("influencers")
      .select("id, name, avatar_url")
      .eq("user_id", authentication.user.id)
      .order("name");

    const { data: influencerRows, error: influencerError } = await influencerQuery;

    if (influencerError) {
      throw new Error(`Could not load influencers: ${influencerError.message}`);
    }

    const influencers = influencerRows ?? [];
    const ownedInfluencerIds = influencers.map((influencer) => influencer.id);

    if (influencerId && !ownedInfluencerIds.includes(influencerId)) {
      return NextResponse.json({ ok: false, error: "Influencer not found." }, { status: 404 });
    }

    if (ownedInfluencerIds.length === 0) {
      return NextResponse.json({
        ok: true,
        filters: { influencerId, platform: platformValue, status: statusValue },
        influencers: [],
        threads: [],
        nextCursor: null,
      });
    }

    const threadInfluencerIds = influencerId ? [influencerId] : ownedInfluencerIds;
    let threadQuery = supabase
      .from("social_comment_threads")
      .select(
        "root_comment_id, influencer_id, platform, social_account_id, post_id, destination_id, workflow_status, needs_reply, latest_inbound_at, latest_own_reply_at, last_activity_at"
      )
      .in("influencer_id", threadInfluencerIds)
      .order("last_activity_at", { ascending: false })
      .order("root_comment_id", { ascending: false })
      .limit(limitValue + 1);

    if (platformValue !== "all") {
      threadQuery = threadQuery.eq("platform", platformValue);
    }

    if (statusValue === "ignored") {
      threadQuery = threadQuery.eq("workflow_status", "ignored");
    } else if (statusValue === "needs_reply") {
      threadQuery = threadQuery.eq("workflow_status", "active").eq("needs_reply", true);
    } else if (statusValue === "replied") {
      threadQuery = threadQuery.eq("workflow_status", "active").eq("needs_reply", false);
    }

    if (cursor) {
      threadQuery = threadQuery.or(
        `last_activity_at.lt.${cursor.activityAt},and(last_activity_at.eq.${cursor.activityAt},root_comment_id.lt.${cursor.rootCommentId})`
      );
    }

    const { data: rawThreads, error: threadError } = await threadQuery;

    if (threadError) {
      throw new Error(`Could not load comment threads: ${threadError.message}`);
    }

    const hasNextPage = (rawThreads?.length ?? 0) > limitValue;
    const threads = (rawThreads ?? []).slice(0, limitValue) as ThreadRow[];
    const rootIds = threads.map((thread) => thread.root_comment_id);

    if (rootIds.length === 0) {
      return NextResponse.json({
        ok: true,
        filters: { influencerId, platform: platformValue, status: statusValue },
        influencers,
        threads: [],
        nextCursor: null,
      });
    }

    const postIds = [...new Set(threads.map((thread) => thread.post_id))];
    const [{ data: commentRows, error: commentError }, { data: postRows, error: postError }] =
      await Promise.all([
        supabase
          .from("social_comments")
          .select(
            "id, thread_root_comment_id, parent_comment_id, author_external_id, author_username, author_name, message, comment_created_at, like_count, is_from_our_account, is_hidden, is_deleted"
          )
          .in("thread_root_comment_id", rootIds)
          .order("comment_created_at", { ascending: true })
          .order("id", { ascending: true }),
        supabase
          .from("posts")
          .select("id, caption, media_url, media_type, published_at")
          .in("id", postIds),
      ]);

    if (commentError || postError) {
      throw new Error(
        `Could not load inbox details: ${commentError?.message ?? postError?.message}`
      );
    }

    const commentsByRoot = new Map<string, CommentRow[]>();

    for (const comment of (commentRows ?? []) as CommentRow[]) {
      const existing = commentsByRoot.get(comment.thread_root_comment_id) ?? [];
      existing.push(comment);
      commentsByRoot.set(comment.thread_root_comment_id, existing);
    }

    const influencerById = new Map(influencers.map((item) => [item.id, item]));
    const postById = new Map((postRows ?? []).map((post) => [post.id, post]));
    const responseThreads = threads.map((thread) => {
      const comments = commentsByRoot.get(thread.root_comment_id) ?? [];
      const rootComment = comments.find((comment) => comment.id === thread.root_comment_id);

      return {
        id: thread.root_comment_id,
        platform: thread.platform,
        status: threadStatus(thread),
        needsReply: thread.workflow_status === "active" && thread.needs_reply,
        lastActivityAt: thread.last_activity_at,
        latestInboundAt: thread.latest_inbound_at,
        latestOwnReplyAt: thread.latest_own_reply_at,
        influencer: influencerById.get(thread.influencer_id) ?? null,
        post: postById.get(thread.post_id) ?? null,
        rootComment: rootComment
          ? {
              id: rootComment.id,
              authorUsername: rootComment.author_username,
              authorName: rootComment.author_name,
              message: rootComment.message,
              createdAt: rootComment.comment_created_at,
              likeCount: rootComment.like_count,
              isHidden: rootComment.is_hidden,
            }
          : null,
        comments: comments.map((comment) => ({
          id: comment.id,
          parentId: comment.parent_comment_id,
          authorUsername: comment.author_username,
          authorName: comment.author_name,
          message: comment.message,
          createdAt: comment.comment_created_at,
          likeCount: comment.like_count,
          isFromOurAccount: comment.is_from_our_account,
          isHidden: comment.is_hidden,
          isDeleted: comment.is_deleted,
        })),
      };
    });
    const lastThread = threads.at(-1);

    return NextResponse.json({
      ok: true,
      filters: { influencerId, platform: platformValue, status: statusValue },
      influencers,
      threads: responseThreads,
      nextCursor:
        hasNextPage && lastThread
          ? encodeCursor({
              activityAt: lastThread.last_activity_at,
              rootCommentId: lastThread.root_comment_id,
            })
          : null,
    });
  } catch (error) {
    console.error("Comment inbox read failed", error);
    return NextResponse.json(
      {
        ok: false,
        error: "Could not load comments.",
      },
      { status: 500 }
    );
  }
}
