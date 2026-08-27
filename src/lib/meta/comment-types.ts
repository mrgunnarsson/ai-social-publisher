export const META_GRAPH_VERSION = "v26.0";

export type CommentPlatform = "instagram" | "facebook";

export type CommentPlatformFilter = CommentPlatform | "all";

export type CommentTargetType = "legacy_instagram" | "destination";

export type CommentExternalObjectType =
  | "instagram_media"
  | "facebook_page_post"
  | "facebook_photo"
  | "facebook_video";

export type NormalizedCommentSource = {
  platform: CommentPlatform;
  objectType: CommentExternalObjectType;
  raw: Record<string, unknown>;
};

export type NormalizedComment = {
  externalCommentId: string;
  parentExternalCommentId: string | null;
  threadRootExternalCommentId: string;
  authorExternalId: string | null;
  authorUsername: string | null;
  authorName: string | null;
  message: string | null;
  createdAt: string;
  likeCount: number | null;
  isFromOurAccount: boolean;
  isHidden: boolean | null;
  isDeleted: boolean;
  source: NormalizedCommentSource;
};

export type CommentReadLimits = {
  maxPages: number;
  maxComments: number;
  pageSize: number;
  maxReplyPagesPerComment: number;
};

export type CommentReadResult = {
  comments: NormalizedComment[];
  pagesFetched: number;
  truncated: boolean;
  optionalFieldsSupported: boolean;
  warnings: string[];
};

export type CommentSyncTarget = {
  id: string;
  target_type: CommentTargetType;
  target_id: string;
  influencer_id: string;
  social_account_id: string;
  platform: CommentPlatform;
  post_id: string;
  destination_id: string | null;
  external_object_type: CommentExternalObjectType;
  external_object_id: string;
  published_at: string;
  next_sync_at: string;
  last_synced_at: string | null;
  last_comment_activity_at: string | null;
  sync_count: number;
  sync_claim_token: string | null;
  sync_claimed_at: string | null;
  sync_error_count: number;
  last_sync_error: string | null;
  last_sync_error_at: string | null;
  created_at: string;
  updated_at: string;
};

export const DEFAULT_COMMENT_READ_LIMITS: CommentReadLimits = {
  maxPages: 20,
  maxComments: 1000,
  pageSize: 100,
  maxReplyPagesPerComment: 5,
};

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

export function readNonNegativeNumber(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : Number(value);

  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

export function readBoolean(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

export function sanitizeSourceRecord(
  value: Record<string, unknown>,
  allowedFields: readonly string[]
) {
  return Object.fromEntries(
    allowedFields
      .filter((field) => value[field] !== undefined)
      .map((field) => [field, value[field]])
  );
}

export function deduplicateNormalizedComments(comments: NormalizedComment[]) {
  const commentsById = new Map<string, NormalizedComment>();

  for (const comment of comments) {
    commentsById.set(comment.externalCommentId, comment);
  }

  return [...commentsById.values()].sort((left, right) => {
    const timeDifference =
      new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime();

    return timeDifference || left.externalCommentId.localeCompare(right.externalCommentId);
  });
}
