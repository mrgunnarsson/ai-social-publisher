import "server-only";

import {
  DEFAULT_COMMENT_READ_LIMITS,
  META_GRAPH_VERSION,
  deduplicateNormalizedComments,
  isRecord,
  readBoolean,
  readNonNegativeNumber,
  readString,
  sanitizeSourceRecord,
  type CommentReadLimits,
  type CommentReadResult,
  type NormalizedComment,
} from "@/lib/meta/comment-types";

const INSTAGRAM_GRAPH_ORIGIN = "https://graph.instagram.com";
const OPTIONAL_ERROR_PATTERN =
  /field|nonexisting|does not exist|unsupported|get request/i;

type MetaPage = {
  data: Record<string, unknown>[];
  next: string | null;
};

class InstagramCommentReadError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "InstagramCommentReadError";
    this.status = status;
  }
}

function buildInstagramUrl(objectId: string, edge: "comments" | "replies") {
  return new URL(
    `${INSTAGRAM_GRAPH_ORIGIN}/${META_GRAPH_VERSION}/${encodeURIComponent(
      objectId
    )}/${edge}`
  );
}

function sanitizeNextUrl(value: unknown) {
  if (typeof value !== "string" || !value) {
    return null;
  }

  const url = new URL(value);

  if (url.protocol !== "https:" || url.origin !== INSTAGRAM_GRAPH_ORIGIN) {
    throw new InstagramCommentReadError(
      "Instagram returned an invalid pagination URL.",
      502
    );
  }

  url.searchParams.delete("access_token");
  return url.toString();
}

async function fetchInstagramPage(
  url: URL | string,
  accessToken: string
): Promise<MetaPage> {
  const requestUrl = new URL(url);
  requestUrl.searchParams.delete("access_token");

  const response = await fetch(requestUrl, {
    cache: "no-store",
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });
  const payload: unknown = await response.json();

  if (!response.ok) {
    const error = isRecord(payload) && isRecord(payload.error) ? payload.error : null;
    const message = readString(error?.message) ?? "Instagram comment request failed.";
    throw new InstagramCommentReadError(message, response.status);
  }

  if (!isRecord(payload) || !Array.isArray(payload.data)) {
    throw new InstagramCommentReadError(
      "Instagram returned an invalid comment page.",
      502
    );
  }

  const paging = isRecord(payload.paging) ? payload.paging : null;

  return {
    data: payload.data.filter(isRecord),
    next: sanitizeNextUrl(paging?.next),
  };
}

function normalizeTimestamp(value: unknown) {
  const raw = readString(value);

  if (!raw) {
    return null;
  }

  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function normalizeInstagramComment(
  raw: Record<string, unknown>,
  ownAccountExternalId: string,
  parentExternalCommentId: string | null,
  threadRootExternalCommentId: string | null
): NormalizedComment | null {
  const externalCommentId = readString(raw.id);
  const createdAt = normalizeTimestamp(raw.timestamp);

  if (!externalCommentId || !createdAt) {
    return null;
  }

  const from = isRecord(raw.from) ? raw.from : null;
  const authorExternalId = readString(from?.id);
  const explicitParentId = readString(raw.parent_id);
  const parentId = explicitParentId ?? parentExternalCommentId;
  const rootId = threadRootExternalCommentId ?? parentId ?? externalCommentId;

  return {
    externalCommentId,
    parentExternalCommentId: parentId,
    threadRootExternalCommentId: rootId,
    authorExternalId,
    authorUsername: readString(from?.username),
    authorName: null,
    message: typeof raw.text === "string" ? raw.text : null,
    createdAt,
    likeCount: readNonNegativeNumber(raw.like_count),
    isFromOurAccount:
      authorExternalId !== null && authorExternalId === ownAccountExternalId,
    isHidden: readBoolean(raw.hidden),
    isDeleted: false,
    source: {
      platform: "instagram",
      objectType: "instagram_media",
      raw: sanitizeSourceRecord(raw, [
        "id",
        "text",
        "timestamp",
        "from",
        "like_count",
        "parent_id",
        "hidden",
      ]),
    },
  };
}

function readEmbeddedReplies(raw: Record<string, unknown>) {
  const replies = isRecord(raw.replies) ? raw.replies : null;

  return Array.isArray(replies?.data) ? replies.data.filter(isRecord) : [];
}

function isOptionalFieldError(error: unknown) {
  return (
    error instanceof InstagramCommentReadError &&
    error.status === 400 &&
    OPTIONAL_ERROR_PATTERN.test(error.message)
  );
}

export async function readInstagramComments(options: {
  mediaId: string;
  accessToken: string;
  ownAccountExternalId: string;
  limits?: Partial<CommentReadLimits>;
}): Promise<CommentReadResult> {
  const limits = { ...DEFAULT_COMMENT_READ_LIMITS, ...options.limits };
  const warnings: string[] = [];
  const comments: NormalizedComment[] = [];
  const topLevelComments: NormalizedComment[] = [];
  let pagesFetched = 0;
  let truncated = false;
  let optionalFieldsSupported = true;

  const optionalFields = [
    "id",
    "text",
    "timestamp",
    "from",
    "like_count",
    "parent_id",
    `replies.limit(${limits.pageSize}){id,text,timestamp,from,like_count,parent_id}`,
  ].join(",");
  const conservativeFields = "id,text,timestamp,from";
  let nextUrl: URL | null = buildInstagramUrl(options.mediaId, "comments");
  nextUrl.searchParams.set("fields", optionalFields);
  nextUrl.searchParams.set("limit", String(limits.pageSize));

  while (nextUrl && pagesFetched < limits.maxPages) {
    let page: MetaPage;

    try {
      page = await fetchInstagramPage(nextUrl, options.accessToken);
    } catch (error) {
      if (pagesFetched === 0 && optionalFieldsSupported && isOptionalFieldError(error)) {
        optionalFieldsSupported = false;
        warnings.push("Instagram optional comment fields were unavailable; conservative fields were used.");
        nextUrl = buildInstagramUrl(options.mediaId, "comments");
        nextUrl.searchParams.set("fields", conservativeFields);
        nextUrl.searchParams.set("limit", String(limits.pageSize));
        continue;
      }

      throw error;
    }

    pagesFetched += 1;

    for (const raw of page.data) {
      const normalized = normalizeInstagramComment(
        raw,
        options.ownAccountExternalId,
        null,
        null
      );

      if (!normalized) {
        warnings.push("Instagram returned a comment without a usable ID or timestamp.");
        continue;
      }

      comments.push(normalized);
      topLevelComments.push(normalized);

      for (const embeddedReply of readEmbeddedReplies(raw)) {
        const reply = normalizeInstagramComment(
          embeddedReply,
          options.ownAccountExternalId,
          normalized.externalCommentId,
          normalized.externalCommentId
        );

        if (reply) {
          comments.push(reply);
        }
      }

      if (comments.length >= limits.maxComments) {
        truncated = true;
        break;
      }
    }

    if (truncated) {
      break;
    }

    nextUrl = page.next ? new URL(page.next) : null;
  }

  if (nextUrl) {
    truncated = true;
  }

  for (const root of topLevelComments) {
    if (comments.length >= limits.maxComments || pagesFetched >= limits.maxPages) {
      truncated = true;
      break;
    }

    let replyUrl: URL | null = buildInstagramUrl(root.externalCommentId, "replies");
    replyUrl.searchParams.set(
      "fields",
      optionalFieldsSupported
        ? "id,text,timestamp,from,like_count,parent_id"
        : conservativeFields
    );
    replyUrl.searchParams.set("limit", String(limits.pageSize));
    let replyPages = 0;
    let replyUsesOptionalFields = optionalFieldsSupported;

    while (
      replyUrl &&
      replyPages < limits.maxReplyPagesPerComment &&
      pagesFetched < limits.maxPages &&
      comments.length < limits.maxComments
    ) {
      let page: MetaPage;

      try {
        page = await fetchInstagramPage(replyUrl, options.accessToken);
      } catch (error) {
        if (isOptionalFieldError(error) && replyUsesOptionalFields) {
          replyUsesOptionalFields = false;
          replyUrl = buildInstagramUrl(root.externalCommentId, "replies");
          replyUrl.searchParams.set("fields", conservativeFields);
          replyUrl.searchParams.set("limit", String(limits.pageSize));
          continue;
        }

        if (isOptionalFieldError(error)) {
          warnings.push(
            `Instagram replies could not be expanded for comment ${root.externalCommentId}.`
          );
          break;
        }

        throw error;
      }

      replyPages += 1;
      pagesFetched += 1;

      for (const rawReply of page.data) {
        const reply = normalizeInstagramComment(
          rawReply,
          options.ownAccountExternalId,
          root.externalCommentId,
          root.externalCommentId
        );

        if (reply) {
          comments.push(reply);
        }
      }

      replyUrl = page.next ? new URL(page.next) : null;
    }

    if (replyUrl) {
      truncated = true;
    }
  }

  return {
    comments: deduplicateNormalizedComments(comments).slice(0, limits.maxComments),
    pagesFetched,
    truncated,
    optionalFieldsSupported,
    warnings: [...new Set(warnings)],
  };
}
