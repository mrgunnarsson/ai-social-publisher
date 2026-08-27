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
  type CommentExternalObjectType,
  type CommentReadLimits,
  type CommentReadResult,
  type NormalizedComment,
} from "@/lib/meta/comment-types";

const FACEBOOK_GRAPH_ORIGIN = "https://graph.facebook.com";
const OPTIONAL_ERROR_PATTERN =
  /field|nonexisting|does not exist|unsupported|get request/i;

type MetaPage = {
  data: Record<string, unknown>[];
  next: string | null;
};

class FacebookCommentReadError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "FacebookCommentReadError";
    this.status = status;
  }
}

function buildFacebookCommentsUrl(objectId: string) {
  return new URL(
    `${FACEBOOK_GRAPH_ORIGIN}/${META_GRAPH_VERSION}/${encodeURIComponent(
      objectId
    )}/comments`
  );
}

function sanitizeNextUrl(value: unknown) {
  if (typeof value !== "string" || !value) {
    return null;
  }

  const url = new URL(value);

  if (url.protocol !== "https:" || url.origin !== FACEBOOK_GRAPH_ORIGIN) {
    throw new FacebookCommentReadError(
      "Facebook returned an invalid pagination URL.",
      502
    );
  }

  url.searchParams.delete("access_token");
  return url.toString();
}

async function fetchFacebookPage(
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
    const message = readString(error?.message) ?? "Facebook comment request failed.";
    throw new FacebookCommentReadError(message, response.status);
  }

  if (!isRecord(payload) || !Array.isArray(payload.data)) {
    throw new FacebookCommentReadError(
      "Facebook returned an invalid comment page.",
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

function normalizeFacebookComment(
  raw: Record<string, unknown>,
  ownAccountExternalId: string,
  objectType: Exclude<CommentExternalObjectType, "instagram_media">,
  fallbackParentExternalCommentId: string | null,
  threadRootExternalCommentId: string | null
): NormalizedComment | null {
  const externalCommentId = readString(raw.id);
  const createdAt = normalizeTimestamp(raw.created_time);

  if (!externalCommentId || !createdAt) {
    return null;
  }

  const from = isRecord(raw.from) ? raw.from : null;
  const parent = isRecord(raw.parent) ? raw.parent : null;
  const authorExternalId = readString(from?.id);
  const parentExternalCommentId =
    readString(parent?.id) ?? fallbackParentExternalCommentId;

  return {
    externalCommentId,
    parentExternalCommentId,
    threadRootExternalCommentId:
      threadRootExternalCommentId ?? parentExternalCommentId ?? externalCommentId,
    authorExternalId,
    authorUsername: null,
    authorName: readString(from?.name),
    message: typeof raw.message === "string" ? raw.message : null,
    createdAt,
    likeCount: readNonNegativeNumber(raw.like_count),
    isFromOurAccount:
      authorExternalId !== null && authorExternalId === ownAccountExternalId,
    isHidden: readBoolean(raw.is_hidden),
    isDeleted: false,
    source: {
      platform: "facebook",
      objectType,
      raw: sanitizeSourceRecord(raw, [
        "id",
        "message",
        "created_time",
        "from",
        "like_count",
        "comment_count",
        "parent",
        "is_hidden",
        "permalink_url",
      ]),
    },
  };
}

function isOptionalFieldError(error: unknown) {
  return (
    error instanceof FacebookCommentReadError &&
    error.status === 400 &&
    OPTIONAL_ERROR_PATTERN.test(error.message)
  );
}

export async function readFacebookComments(options: {
  objectId: string;
  objectType: Exclude<CommentExternalObjectType, "instagram_media">;
  accessToken: string;
  ownAccountExternalId: string;
  limits?: Partial<CommentReadLimits>;
}): Promise<CommentReadResult> {
  const limits = { ...DEFAULT_COMMENT_READ_LIMITS, ...options.limits };
  const warnings: string[] = [];
  const comments: NormalizedComment[] = [];
  const topLevel: Array<{ comment: NormalizedComment; childCount: number | null }> = [];
  let pagesFetched = 0;
  let truncated = false;
  let optionalFieldsSupported = true;

  const optionalFields = [
    "id",
    "message",
    "created_time",
    "from",
    "like_count",
    "comment_count",
    "parent",
    "is_hidden",
    "permalink_url",
  ].join(",");
  const conservativeFields = "id,message,created_time,from";
  let nextUrl: URL | null = buildFacebookCommentsUrl(options.objectId);
  nextUrl.searchParams.set("fields", optionalFields);
  nextUrl.searchParams.set("filter", "toplevel");
  nextUrl.searchParams.set("order", "reverse_chronological");
  nextUrl.searchParams.set("limit", String(limits.pageSize));

  while (nextUrl && pagesFetched < limits.maxPages) {
    let page: MetaPage;

    try {
      page = await fetchFacebookPage(nextUrl, options.accessToken);
    } catch (error) {
      if (pagesFetched === 0 && optionalFieldsSupported && isOptionalFieldError(error)) {
        optionalFieldsSupported = false;
        warnings.push("Facebook optional comment fields were unavailable; conservative fields were used.");
        nextUrl = buildFacebookCommentsUrl(options.objectId);
        nextUrl.searchParams.set("fields", conservativeFields);
        nextUrl.searchParams.set("filter", "toplevel");
        nextUrl.searchParams.set("order", "reverse_chronological");
        nextUrl.searchParams.set("limit", String(limits.pageSize));
        continue;
      }

      throw error;
    }

    pagesFetched += 1;

    for (const raw of page.data) {
      const normalized = normalizeFacebookComment(
        raw,
        options.ownAccountExternalId,
        options.objectType,
        null,
        null
      );

      if (!normalized) {
        warnings.push("Facebook returned a comment without a usable ID or timestamp.");
        continue;
      }

      comments.push(normalized);
      topLevel.push({
        comment: normalized,
        childCount: readNonNegativeNumber(raw.comment_count),
      });

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

  for (const root of topLevel) {
    if (root.childCount === 0) {
      continue;
    }

    if (comments.length >= limits.maxComments || pagesFetched >= limits.maxPages) {
      truncated = true;
      break;
    }

    let childUrl: URL | null = buildFacebookCommentsUrl(
      root.comment.externalCommentId
    );
    childUrl.searchParams.set(
      "fields",
      optionalFieldsSupported ? optionalFields : conservativeFields
    );
    childUrl.searchParams.set("order", "chronological");
    childUrl.searchParams.set("limit", String(limits.pageSize));
    let childPages = 0;
    let childUsesOptionalFields = optionalFieldsSupported;

    while (
      childUrl &&
      childPages < limits.maxReplyPagesPerComment &&
      pagesFetched < limits.maxPages &&
      comments.length < limits.maxComments
    ) {
      let page: MetaPage;

      try {
        page = await fetchFacebookPage(childUrl, options.accessToken);
      } catch (error) {
        if (isOptionalFieldError(error) && childUsesOptionalFields) {
          childUsesOptionalFields = false;
          childUrl = buildFacebookCommentsUrl(root.comment.externalCommentId);
          childUrl.searchParams.set("fields", conservativeFields);
          childUrl.searchParams.set("order", "chronological");
          childUrl.searchParams.set("limit", String(limits.pageSize));
          continue;
        }

        if (isOptionalFieldError(error)) {
          warnings.push(
            `Facebook replies could not be expanded for comment ${root.comment.externalCommentId}.`
          );
          break;
        }

        throw error;
      }

      childPages += 1;
      pagesFetched += 1;

      for (const rawReply of page.data) {
        const reply = normalizeFacebookComment(
          rawReply,
          options.ownAccountExternalId,
          options.objectType,
          root.comment.externalCommentId,
          root.comment.externalCommentId
        );

        if (reply) {
          comments.push(reply);
        }
      }

      childUrl = page.next ? new URL(page.next) : null;
    }

    if (childUrl) {
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
