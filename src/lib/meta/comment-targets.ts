import type {
  CommentExternalObjectType,
  CommentPlatform,
  CommentSyncTarget,
  CommentTargetType,
} from "@/lib/meta/comment-types";

type PublishedPost = {
  id: string;
  influencer_id: string;
  platform: string;
  social_account_id: string | null;
  external_post_id: string | null;
  published_at: string | null;
  status: string;
  media_type: "image" | "video" | null;
};

type PublishedDestination = {
  id: string;
  post_id: string;
  platform: string;
  social_account_id: string;
  external_post_id: string | null;
  published_at: string | null;
  status: string;
};

export type ResolvedCommentTarget = {
  targetType: CommentTargetType;
  targetId: string;
  influencerId: string;
  socialAccountId: string;
  platform: CommentPlatform;
  postId: string;
  destinationId: string | null;
  externalObjectType: CommentExternalObjectType;
  externalObjectId: string;
  publishedAt: string;
};

export function inferCommentExternalObjectType(
  platform: CommentPlatform,
  mediaType: "image" | "video" | null,
  externalPostId: string
): CommentExternalObjectType {
  if (platform === "instagram") {
    return "instagram_media";
  }

  if (externalPostId.includes("_")) {
    return "facebook_page_post";
  }

  return mediaType === "video" ? "facebook_video" : "facebook_photo";
}

function isCommentPlatform(value: string): value is CommentPlatform {
  return value === "instagram" || value === "facebook";
}

export function resolvePublishedCommentTargets(
  posts: PublishedPost[],
  destinations: PublishedDestination[]
) {
  const postById = new Map(posts.map((post) => [post.id, post]));
  const resolved: ResolvedCommentTarget[] = [];
  const destinationInstagramPostIds = new Set<string>();
  const destinationInstagramExternalIds = new Set<string>();
  const seenObjects = new Set<string>();

  for (const destination of destinations) {
    const post = postById.get(destination.post_id);

    if (
      !post ||
      destination.status !== "published" ||
      !isCommentPlatform(destination.platform) ||
      !destination.external_post_id
    ) {
      continue;
    }

    const publishedAt = destination.published_at ?? post.published_at;

    if (!publishedAt) {
      continue;
    }

    const objectKey = [
      destination.platform,
      destination.social_account_id,
      destination.external_post_id,
    ].join(":");

    if (seenObjects.has(objectKey)) {
      continue;
    }

    seenObjects.add(objectKey);

    if (destination.platform === "instagram") {
      destinationInstagramPostIds.add(post.id);
      destinationInstagramExternalIds.add(destination.external_post_id);
    }

    resolved.push({
      targetType: "destination",
      targetId: destination.id,
      influencerId: post.influencer_id,
      socialAccountId: destination.social_account_id,
      platform: destination.platform,
      postId: post.id,
      destinationId: destination.id,
      externalObjectType: inferCommentExternalObjectType(
        destination.platform,
        post.media_type,
        destination.external_post_id
      ),
      externalObjectId: destination.external_post_id,
      publishedAt,
    });
  }

  for (const post of posts) {
    if (
      post.platform !== "instagram" ||
      post.status !== "published" ||
      !post.social_account_id ||
      !post.external_post_id ||
      !post.published_at ||
      destinationInstagramPostIds.has(post.id) ||
      destinationInstagramExternalIds.has(post.external_post_id)
    ) {
      continue;
    }

    const objectKey = ["instagram", post.social_account_id, post.external_post_id].join(
      ":"
    );

    if (seenObjects.has(objectKey)) {
      continue;
    }

    seenObjects.add(objectKey);
    resolved.push({
      targetType: "legacy_instagram",
      targetId: post.id,
      influencerId: post.influencer_id,
      socialAccountId: post.social_account_id,
      platform: "instagram",
      postId: post.id,
      destinationId: null,
      externalObjectType: "instagram_media",
      externalObjectId: post.external_post_id,
      publishedAt: post.published_at,
    });
  }

  return resolved;
}

export function describeCommentTarget(target: CommentSyncTarget) {
  return {
    id: target.id,
    targetType: target.target_type,
    targetId: target.target_id,
    influencerId: target.influencer_id,
    socialAccountId: target.social_account_id,
    platform: target.platform,
    postId: target.post_id,
    destinationId: target.destination_id,
    externalObjectType: target.external_object_type,
    externalObjectId: target.external_object_id,
    publishedAt: target.published_at,
    nextSyncAt: target.next_sync_at,
    lastSyncedAt: target.last_synced_at,
    lastCommentActivityAt: target.last_comment_activity_at,
    errorCount: target.sync_error_count,
  };
}
