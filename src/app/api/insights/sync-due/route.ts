import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import {
  calculateNextSuccessfulSyncAt,
  calculateRetryAt,
  type SyncFailureKind,
} from "@/lib/insights-sync-schedule";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const DEFAULT_BATCH_SIZE = 10;
const MAX_BATCH_SIZE = 25;
const CANDIDATE_MULTIPLIER = 4;
const STALE_CLAIM_MS = 15 * 60 * 1000;
const META_TIMEOUT_MS = 20 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

type Platform = "instagram" | "facebook";
type PlatformFilter = Platform | "all";
type TargetPool = "live_due" | "historical_bootstrap";
type TargetKind = "legacy_instagram" | "destination";
type MediaType = "image" | "video";

type DueTarget = {
  kind: TargetKind;
  id: string;
  post_id: string;
  influencer_id: string | null;
  platform: Platform;
  social_account_id: string | null;
  external_post_id: string;
  published_at: string | null;
  next_sync_at: string | null;
  sync_count: number | null;
  sync_error_count: number | null;
  sync_claimed_at: string | null;
  sync_claim_token: string | null;
};

type SocialAccount = {
  id: string;
  influencer_id: string;
  platform: string;
  access_token: string | null;
};

type MetricUpdates = Partial<
  Record<
    | "likes"
    | "reactions"
    | "comments"
    | "saves"
    | "shares"
    | "clicks"
    | "reach"
    | "views",
    number
  >
>;

type MetaErrorPayload = {
  message: string;
  code: number | null;
  subcode: number | null;
  type: string | null;
};

type FacebookMetricWarning = {
  metric: string;
  failureKind: SyncFailureKind | "metric_unavailable";
  error: string;
};

type FacebookMetricResult = {
  updates: MetricUpdates;
  warnings: FacebookMetricWarning[];
  criticalError: SyncJobError | null;
  strategy: "page_post" | "photo_object" | "video_object";
};

class SyncJobError extends Error {
  failureKind: SyncFailureKind;
  retryAfterMs: number | null;

  constructor(
    message: string,
    failureKind: SyncFailureKind,
    retryAfterMs: number | null = null
  ) {
    super(message);
    this.name = "SyncJobError";
    this.failureKind = failureKind;
    this.retryAfterMs = retryAfterMs;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isPlatformFilter(value: unknown): value is PlatformFilter {
  return value === "all" || value === "instagram" || value === "facebook";
}

function readMetricValue(value: unknown) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const metricValue = Number(value);

  return Number.isFinite(metricValue) && metricValue >= 0
    ? metricValue
    : null;
}

function sanitizeError(value: unknown) {
  const message =
    value instanceof Error
      ? value.message
      : typeof value === "string"
        ? value
        : "Unknown sync error.";

  return message
    .replace(/access_token=([^&\s]+)/gi, "access_token=[redacted]")
    .replace(/bearer\s+[^\s]+/gi, "Bearer [redacted]")
    .replace(/[A-Za-z0-9_-]{80,}/g, "[redacted]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 500);
}

function getMetaErrorPayload(data: unknown): MetaErrorPayload {
  const error = isRecord(data) && isRecord(data.error) ? data.error : null;
  const rawCode = error?.code;
  const rawSubcode = error?.error_subcode;
  const code =
    typeof rawCode === "number" && Number.isFinite(rawCode)
      ? rawCode
      : typeof rawCode === "string" && Number.isFinite(Number(rawCode))
        ? Number(rawCode)
        : null;
  const subcode =
    typeof rawSubcode === "number" && Number.isFinite(rawSubcode)
      ? rawSubcode
      : typeof rawSubcode === "string" &&
          Number.isFinite(Number(rawSubcode))
        ? Number(rawSubcode)
        : null;

  return {
    message:
      typeof error?.message === "string"
        ? error.message
        : "Meta returned an error.",
    code,
    subcode,
    type: typeof error?.type === "string" ? error.type : null,
  };
}

function getRetryAfterMs(response: Response) {
  const rawValue = response.headers.get("retry-after");

  if (!rawValue) {
    return null;
  }

  const seconds = Number(rawValue);

  if (Number.isFinite(seconds) && seconds >= 0) {
    return seconds * 1000;
  }

  const retryDate = new Date(rawValue).getTime();

  return Number.isFinite(retryDate)
    ? Math.max(0, retryDate - Date.now())
    : null;
}

function createMetaError(response: Response, data: unknown, label: string) {
  const metaError = getMetaErrorPayload(data);
  const status = response.status;
  const normalizedMessage = metaError.message.toLowerCase();
  const unavailableObject =
    status === 404 ||
    metaError.subcode === 33 ||
    (metaError.code === 100 &&
      normalizedMessage.includes("unsupported get request")) ||
    normalizedMessage.includes("object does not exist");
  let failureKind: SyncFailureKind = "query";

  if (
    status === 401 ||
    status === 403 ||
    metaError.code === 190 ||
    normalizedMessage.includes("access token")
  ) {
    failureKind = "authentication";
  } else if (
    status === 429 ||
    metaError.code === 4 ||
    metaError.code === 17 ||
    metaError.code === 32 ||
    metaError.code === 613
  ) {
    failureKind = "rate_limit";
  } else if (status >= 500 || status === 408) {
    failureKind = "temporary";
  } else if (unavailableObject) {
    failureKind = "content_unavailable";
  } else if (
    metaError.code === 200 ||
    normalizedMessage.includes("permission")
  ) {
    failureKind = "authentication";
  }

  return new SyncJobError(
    `${label} failed (HTTP ${status}${
      metaError.code === null ? "" : `, Meta ${metaError.code}`
    }${metaError.subcode === null ? "" : `/${metaError.subcode}`}${
      metaError.type === null ? "" : `, ${metaError.type}`
    }): ${metaError.message}`,
    failureKind,
    getRetryAfterMs(response)
  );
}

async function fetchMetaJson(url: URL, label: string) {
  let response: Response;

  try {
    response = await fetch(url, {
      cache: "no-store",
      signal: AbortSignal.timeout(META_TIMEOUT_MS),
    });
  } catch (error) {
    throw new SyncJobError(
      `${label} could not reach Meta: ${sanitizeError(error)}`,
      "temporary"
    );
  }

  let data: unknown = null;

  try {
    data = await response.json();
  } catch {
    if (response.ok) {
      throw new SyncJobError(
        `${label} returned invalid JSON.`,
        "temporary"
      );
    }
  }

  if (!response.ok) {
    throw createMetaError(response, data, label);
  }

  return data;
}

function addUrlParameters(
  url: URL,
  parameters: Record<string, string>
) {
  for (const [key, value] of Object.entries(parameters)) {
    url.searchParams.set(key, value);
  }

  return url;
}

function readRawInsightValue(metric: unknown) {
  if (!isRecord(metric)) {
    return null;
  }

  if (metric.value !== undefined) {
    return metric.value;
  }

  if (!Array.isArray(metric.values) || metric.values.length === 0) {
    return null;
  }

  const latestValue = metric.values[metric.values.length - 1];

  return isRecord(latestValue) ? latestValue.value : null;
}

function readInsightValue(metric: unknown) {
  return readMetricValue(readRawInsightValue(metric));
}

function readReactionInsightValue(metric: unknown) {
  const value = readRawInsightValue(metric);
  const directValue = readMetricValue(value);

  if (directValue !== null) {
    return directValue;
  }

  if (!isRecord(value)) {
    return null;
  }

  let total = 0;
  let foundValue = false;

  for (const reactionCount of Object.values(value)) {
    const parsedCount = readMetricValue(reactionCount);

    if (parsedCount !== null) {
      total += parsedCount;
      foundValue = true;
    }
  }

  return foundValue ? total : null;
}

async function fetchInstagramMetrics(
  externalPostId: string,
  accessToken: string
): Promise<MetricUpdates> {
  const mediaUrl = addUrlParameters(
    new URL(
      `https://graph.instagram.com/${encodeURIComponent(externalPostId)}`
    ),
    {
      fields: "id,like_count,comments_count",
      access_token: accessToken,
    }
  );
  const mediaData = await fetchMetaJson(mediaUrl, "Instagram media request");

  if (!isRecord(mediaData)) {
    throw new SyncJobError(
      "Instagram media request returned an invalid response.",
      "temporary"
    );
  }

  const updates: MetricUpdates = {};
  const likes = readMetricValue(mediaData.like_count);
  const comments = readMetricValue(mediaData.comments_count);

  if (likes !== null) {
    updates.likes = likes;
  }

  if (comments !== null) {
    updates.comments = comments;
  }

  const insightsUrl = addUrlParameters(
    new URL(
      `https://graph.instagram.com/${encodeURIComponent(
        externalPostId
      )}/insights`
    ),
    {
      metric: "reach,saved,shares,views",
      access_token: accessToken,
    }
  );
  const insightsData = await fetchMetaJson(
    insightsUrl,
    "Instagram insights request"
  );

  if (!isRecord(insightsData) || !Array.isArray(insightsData.data)) {
    throw new SyncJobError(
      "Instagram insights request returned an invalid response.",
      "temporary"
    );
  }

  for (const metric of insightsData.data) {
    if (!isRecord(metric) || typeof metric.name !== "string") {
      continue;
    }

    const value = readInsightValue(metric);

    if (value === null) {
      continue;
    }

    switch (metric.name) {
      case "reach":
        updates.reach = value;
        break;
      case "saved":
        updates.saves = value;
        break;
      case "shares":
        updates.shares = value;
        break;
      case "views":
        updates.views = value;
        break;
    }
  }

  return updates;
}

async function fetchFacebookMetrics(
  externalPostId: string,
  accessToken: string,
  mediaType: MediaType | null
): Promise<FacebookMetricResult> {
  const objectUrl = addUrlParameters(
    new URL(
      `https://graph.facebook.com/v26.0/${encodeURIComponent(externalPostId)}`
    ),
    {
      fields: "id",
      access_token: accessToken,
    }
  );
  const objectData = await fetchMetaJson(
    objectUrl,
    "Facebook object request"
  );

  if (!isRecord(objectData) || typeof objectData.id !== "string") {
    throw new SyncJobError(
      "Facebook object request returned an invalid response.",
      "temporary"
    );
  }

  const updates: MetricUpdates = {};
  const warnings: FacebookMetricWarning[] = [];
  const isPagePost = externalPostId.includes("_");
  const strategy = isPagePost
    ? "page_post"
    : mediaType === "video"
      ? "video_object"
      : "photo_object";
  const loadObjectField = async (
    field: string,
    readValue: (data: Record<string, unknown>) => number | null
  ) => {
    const url = addUrlParameters(
      new URL(
        `https://graph.facebook.com/v26.0/${encodeURIComponent(externalPostId)}`
      ),
      {
        fields: field,
        access_token: accessToken,
      }
    );
    const data = await fetchMetaJson(url, `Facebook ${field} request`);

    if (!isRecord(data)) {
      throw new SyncJobError(
        `Facebook ${field} request returned an invalid response.`,
        "temporary"
      );
    }

    return readValue(data);
  };
  const loadInsightMetric = async (
    metricName: string,
    readValue: (metric: unknown) => number | null = readInsightValue,
    edge = "insights"
  ) => {
    const url = addUrlParameters(
      new URL(
        `https://graph.facebook.com/v26.0/${encodeURIComponent(
          externalPostId
        )}/${edge}`
      ),
      {
        metric: metricName,
        access_token: accessToken,
      }
    );
    const data = await fetchMetaJson(
      url,
      `Facebook ${metricName} insight request`
    );

    if (!isRecord(data) || !Array.isArray(data.data)) {
      throw new SyncJobError(
        `Facebook ${metricName} insight request returned an invalid response.`,
        "temporary"
      );
    }

    return data.data.length > 0 ? readValue(data.data[0]) : null;
  };
  const commonLoaders: Array<{
    metric: string;
    column: keyof MetricUpdates;
    load: () => Promise<number | null>;
  }> = [
    {
      metric: "comments",
      column: "comments",
      load: () =>
        loadObjectField("comments.limit(0).summary(true)", (data) => {
          const comments = isRecord(data.comments) ? data.comments : null;
          const summary = comments && isRecord(comments.summary)
            ? comments.summary
            : null;
          return readMetricValue(summary?.total_count);
        }),
    },
    {
      metric: "shares",
      column: "shares",
      load: () =>
        loadObjectField("shares", (data) => {
          const shares = isRecord(data.shares) ? data.shares : null;
          return readMetricValue(shares?.count);
        }),
    },
  ];
  const pagePostLoaders = [
    {
      metric: "post_reactions_by_type_total",
      column: "reactions" as const,
      load: () =>
        loadInsightMetric(
          "post_reactions_by_type_total",
          readReactionInsightValue
        ),
    },
    {
      metric: "post_clicks",
      column: "clicks" as const,
      load: () => loadInsightMetric("post_clicks"),
    },
    {
      metric: "post_impressions_unique",
      column: "reach" as const,
      load: () => loadInsightMetric("post_impressions_unique"),
    },
  ];
  const pagePostVideoLoaders = [
    {
      metric: "post_video_views",
      column: "views" as const,
      load: () => loadInsightMetric("post_video_views"),
    },
  ];
  const mediaObjectLoaders = [
    {
      metric: "likes",
      column: "reactions" as const,
      load: () =>
        loadObjectField("likes.limit(0).summary(true)", (data) => {
          const likes = isRecord(data.likes) ? data.likes : null;
          const summary = likes && isRecord(likes.summary)
            ? likes.summary
            : null;
          return readMetricValue(summary?.total_count);
        }),
    },
  ];
  const videoObjectLoaders = [
    {
      metric: "total_video_views",
      column: "views" as const,
      load: () =>
        loadInsightMetric(
          "total_video_views",
          readInsightValue,
          "video_insights"
        ),
    },
    {
      metric: "total_video_impressions_unique",
      column: "reach" as const,
      load: () =>
        loadInsightMetric(
          "total_video_impressions_unique",
          readInsightValue,
          "video_insights"
        ),
    },
  ];
  const loaders = [
    ...commonLoaders,
    ...(strategy === "page_post" ? pagePostLoaders : mediaObjectLoaders),
    ...(strategy === "page_post" && mediaType === "video"
      ? pagePostVideoLoaders
      : []),
    ...(strategy === "video_object" ? videoObjectLoaders : []),
  ];
  let criticalError: SyncJobError | null = null;

  for (const loader of loaders) {
    try {
      const value = await loader.load();

      if (value === null) {
        warnings.push({
          metric: loader.metric,
          failureKind: "metric_unavailable",
          error: "Meta returned no valid value for this metric.",
        });
      } else {
        updates[loader.column] = value;
      }
    } catch (error) {
      const syncError =
        error instanceof SyncJobError
          ? error
          : new SyncJobError(sanitizeError(error), "temporary");

      warnings.push({
        metric: loader.metric,
        failureKind: syncError.failureKind,
        error: sanitizeError(syncError),
      });

      if (
        syncError.failureKind === "authentication" ||
        syncError.failureKind === "rate_limit" ||
        syncError.failureKind === "temporary"
      ) {
        criticalError = syncError;
        break;
      }
    }
  }

  return {
    updates,
    warnings,
    criticalError,
    strategy,
  };
}

function getTargetTable(target: DueTarget) {
  return target.kind === "legacy_instagram" ? "posts" : "post_destinations";
}

function getTargetLabel(target: DueTarget) {
  return `${target.kind}:${target.id}`;
}

function getTargetPriority(target: DueTarget, now: Date) {
  const publishedAt = target.published_at
    ? new Date(target.published_at).getTime()
    : Number.NaN;
  const ageMs = Number.isFinite(publishedAt)
    ? Math.max(0, now.getTime() - publishedAt)
    : Number.POSITIVE_INFINITY;

  if (ageMs <= DAY_MS) {
    return {
      rank: 0,
      code: "A",
      label: "published_within_24_hours",
      ageMs,
    };
  }

  if (ageMs <= 7 * DAY_MS) {
    return {
      rank: 1,
      code: "B",
      label: "published_1_to_7_days_ago",
      ageMs,
    };
  }

  if (ageMs < 30 * DAY_MS) {
    return {
      rank: 2,
      code: "C",
      label: "published_7_to_30_days_ago",
      ageMs,
    };
  }

  if (ageMs < 90 * DAY_MS) {
    return {
      rank: 3,
      code: "D",
      label: "published_30_to_90_days_ago",
      ageMs,
    };
  }

  return {
    rank: 4,
    code: "E",
    label: "published_90_or_more_days_ago",
    ageMs,
  };
}

function compareDueTargets(left: DueTarget, right: DueTarget, now: Date) {
  const leftPriority = getTargetPriority(left, now);
  const rightPriority = getTargetPriority(right, now);

  if (leftPriority.rank !== rightPriority.rank) {
    return leftPriority.rank - rightPriority.rank;
  }

  const leftIsBootstrap = left.next_sync_at === null;
  const rightIsBootstrap = right.next_sync_at === null;

  if (leftIsBootstrap !== rightIsBootstrap) {
    return leftIsBootstrap ? 1 : -1;
  }

  if (!leftIsBootstrap && !rightIsBootstrap) {
    const dueComparison = left.next_sync_at!.localeCompare(right.next_sync_at!);

    if (dueComparison !== 0) {
      return dueComparison;
    }
  } else {
    const publicationComparison = (right.published_at ?? "").localeCompare(
      left.published_at ?? ""
    );

    if (publicationComparison !== 0) {
      return publicationComparison;
    }
  }

  return getTargetLabel(left).localeCompare(getTargetLabel(right));
}

function getTargetPool(target: DueTarget, now: Date): TargetPool {
  if (target.next_sync_at !== null) {
    return "live_due";
  }

  return getTargetPriority(target, now).ageMs <= 7 * DAY_MS
    ? "live_due"
    : "historical_bootstrap";
}

function selectDueTargets(
  candidates: DueTarget[],
  batchSize: number,
  priorityTime: Date
) {
  const liveDue = candidates
    .filter((target) => getTargetPool(target, priorityTime) === "live_due")
    .sort((left, right) => compareDueTargets(left, right, priorityTime));
  const historicalBootstrap = candidates
    .filter(
      (target) =>
        getTargetPool(target, priorityTime) === "historical_bootstrap"
    )
    .sort((left, right) => compareDueTargets(left, right, priorityTime));
  const liveDueReserved = Math.max(1, Math.floor(batchSize * 0.8));
  const historicalBootstrapReserved = batchSize - liveDueReserved;
  let liveDueSelected = Math.min(liveDueReserved, liveDue.length);
  let historicalBootstrapSelected = Math.min(
    historicalBootstrapReserved,
    historicalBootstrap.length
  );
  let remaining =
    batchSize - liveDueSelected - historicalBootstrapSelected;

  if (remaining > 0 && liveDueSelected < liveDueReserved) {
    const additionalHistorical = Math.min(
      remaining,
      historicalBootstrap.length - historicalBootstrapSelected
    );
    historicalBootstrapSelected += additionalHistorical;
    remaining -= additionalHistorical;
  }

  if (
    remaining > 0 &&
    historicalBootstrapSelected < historicalBootstrapReserved
  ) {
    const additionalLiveDue = Math.min(
      remaining,
      liveDue.length - liveDueSelected
    );
    liveDueSelected += additionalLiveDue;
    remaining -= additionalLiveDue;
  }

  if (remaining > 0) {
    const additionalLiveDue = Math.min(
      remaining,
      liveDue.length - liveDueSelected
    );
    liveDueSelected += additionalLiveDue;
    remaining -= additionalLiveDue;
  }

  if (remaining > 0) {
    historicalBootstrapSelected += Math.min(
      remaining,
      historicalBootstrap.length - historicalBootstrapSelected
    );
  }

  return {
    targets: [
      ...liveDue.slice(0, liveDueSelected),
      ...historicalBootstrap.slice(0, historicalBootstrapSelected),
    ],
    selection: {
      requestedBatchSize: batchSize,
      liveDueSelected,
      historicalBootstrapSelected,
      liveDueAvailable: liveDue.length,
      historicalBootstrapAvailable: historicalBootstrap.length,
    },
  };
}

async function loadDueTargets(
  batchSize: number,
  now: string,
  staleBefore: string,
  platform: PlatformFilter
) {
  const dueFilter = `next_sync_at.is.null,next_sync_at.lte.${now}`;
  const claimFilter = `sync_claimed_at.is.null,sync_claimed_at.lte.${staleBefore}`;
  const candidateLimit = Math.min(
    MAX_BATCH_SIZE * CANDIDATE_MULTIPLIER,
    batchSize * CANDIDATE_MULTIPLIER
  );

  const postsPromise =
    platform === "facebook"
      ? Promise.resolve({ data: [], error: null })
      : supabase
          .from("posts")
          .select(
            `
            id,
            influencer_id,
            social_account_id,
            external_post_id,
            published_at,
            next_sync_at,
            sync_count,
            sync_error_count,
            sync_claimed_at,
            sync_claim_token
            `
          )
          .eq("status", "published")
          .eq("platform", "instagram")
          .not("external_post_id", "is", null)
          .or(dueFilter)
          .or(claimFilter)
          .order("published_at", { ascending: false, nullsFirst: false })
          .limit(candidateLimit);
  let destinationsQuery = supabase
    .from("post_destinations")
    .select(
      `
      id,
      post_id,
      platform,
      social_account_id,
      external_post_id,
      published_at,
      next_sync_at,
      sync_count,
      sync_error_count,
      sync_claimed_at,
      sync_claim_token
      `
    )
    .eq("status", "published");

  destinationsQuery =
    platform === "all"
      ? destinationsQuery.in("platform", ["instagram", "facebook"])
      : destinationsQuery.eq("platform", platform);

  const [postsResult, destinationsResult] = await Promise.all([
    postsPromise,
    destinationsQuery
      .not("external_post_id", "is", null)
      .or(dueFilter)
      .or(claimFilter)
      .order("published_at", { ascending: false, nullsFirst: false })
      .limit(candidateLimit),
  ]);

  if (postsResult.error) {
    throw new Error(`Could not load due Instagram posts: ${postsResult.error.message}`);
  }

  if (destinationsResult.error) {
    throw new Error(
      `Could not load due destinations: ${destinationsResult.error.message}`
    );
  }

  const postTargets: DueTarget[] = (postsResult.data ?? []).map((post) => ({
    kind: "legacy_instagram",
    id: post.id,
    post_id: post.id,
    influencer_id: post.influencer_id,
    platform: "instagram",
    social_account_id: post.social_account_id,
    external_post_id: post.external_post_id,
    published_at: post.published_at,
    next_sync_at: post.next_sync_at,
    sync_count: post.sync_count,
    sync_error_count: post.sync_error_count,
    sync_claimed_at: post.sync_claimed_at,
    sync_claim_token: post.sync_claim_token,
  }));
  const destinationTargets: DueTarget[] = (destinationsResult.data ?? []).map(
    (destination) => ({
      kind: "destination",
      id: destination.id,
      post_id: destination.post_id,
      influencer_id: null,
      platform: destination.platform as Platform,
      social_account_id: destination.social_account_id,
      external_post_id: destination.external_post_id,
      published_at: destination.published_at,
      next_sync_at: destination.next_sync_at,
      sync_count: destination.sync_count,
      sync_error_count: destination.sync_error_count,
      sync_claimed_at: destination.sync_claimed_at,
      sync_claim_token: destination.sync_claim_token,
    })
  );

  const priorityTime = new Date(now);

  return selectDueTargets(
    [...postTargets, ...destinationTargets],
    batchSize,
    priorityTime
  );
}

async function claimTarget(target: DueTarget, now: string) {
  const claimToken = randomUUID();
  let claimQuery = supabase
    .from(getTargetTable(target))
    .update({
      sync_claimed_at: now,
      sync_claim_token: claimToken,
    })
    .eq("id", target.id)
    .eq("status", "published")
    .eq("platform", target.platform)
    .eq("external_post_id", target.external_post_id)
    .not("external_post_id", "is", null)
    .or(`next_sync_at.is.null,next_sync_at.lte.${now}`);

  claimQuery =
    target.social_account_id === null
      ? claimQuery.is("social_account_id", null)
      : claimQuery.eq("social_account_id", target.social_account_id);

  if (target.kind === "legacy_instagram") {
    claimQuery =
      target.influencer_id === null
        ? claimQuery.is("influencer_id", null)
        : claimQuery.eq("influencer_id", target.influencer_id);
  } else {
    claimQuery = claimQuery.eq("post_id", target.post_id);
  }

  claimQuery =
    target.sync_claimed_at === null
      ? claimQuery.is("sync_claimed_at", null)
      : claimQuery.eq("sync_claimed_at", target.sync_claimed_at);
  claimQuery =
    target.sync_claim_token === null
      ? claimQuery.is("sync_claim_token", null)
      : claimQuery.eq("sync_claim_token", target.sync_claim_token);

  const { data, error } = await claimQuery.select("id").maybeSingle();

  if (error) {
    throw new Error(`Could not claim target: ${error.message}`);
  }

  return data ? claimToken : null;
}

async function loadVerifiedAccount(target: DueTarget) {
  let influencerId = target.influencer_id;
  let mediaType: MediaType | null = null;

  if (target.kind === "destination") {
    const { data: parentPost, error: parentError } = await supabase
      .from("posts")
      .select("id, influencer_id, platform, media_type")
      .eq("id", target.post_id)
      .maybeSingle();

    if (parentError) {
      throw new SyncJobError(
        `Could not load parent post: ${parentError.message}`,
        "temporary"
      );
    }

    if (!parentPost) {
      throw new SyncJobError("Parent post does not exist.", "configuration");
    }

    if (
      (target.platform === "instagram" && parentPost.platform !== "multi") ||
      (target.platform === "facebook" &&
        parentPost.platform !== "multi" &&
        parentPost.platform !== "facebook")
    ) {
      throw new SyncJobError(
        "Destination platform is incompatible with its parent post.",
        "configuration"
      );
    }

    influencerId = parentPost.influencer_id;
    mediaType =
      parentPost.media_type === "image" || parentPost.media_type === "video"
        ? parentPost.media_type
        : null;
  }

  if (!influencerId) {
    throw new SyncJobError("Target influencer_id is missing.", "configuration");
  }

  if (!target.social_account_id) {
    throw new SyncJobError(
      "Target social_account_id is missing.",
      "configuration"
    );
  }

  const { data: account, error: accountError } = await supabase
    .from("social_accounts")
    .select("id, influencer_id, platform, access_token")
    .eq("id", target.social_account_id)
    .maybeSingle();

  if (accountError) {
    throw new SyncJobError(
      `Could not load social account: ${accountError.message}`,
      "temporary"
    );
  }

  if (!account) {
    throw new SyncJobError("Social account does not exist.", "configuration");
  }

  const socialAccount = account as SocialAccount;

  if (socialAccount.influencer_id !== influencerId) {
    throw new SyncJobError(
      "Social account does not belong to the target influencer.",
      "configuration"
    );
  }

  if (socialAccount.platform !== target.platform) {
    throw new SyncJobError(
      "Social account platform does not match the target platform.",
      "configuration"
    );
  }

  if (!socialAccount.access_token?.trim()) {
    throw new SyncJobError(
      "Social account access token is missing.",
      "authentication"
    );
  }

  return {
    socialAccount,
    mediaType,
  };
}

async function finalizeSuccess(
  target: DueTarget,
  claimToken: string,
  metrics: MetricUpdates,
  attemptedAt: string
) {
  if (!target.published_at) {
    throw new SyncJobError("Target published_at is missing.", "configuration");
  }

  const completedAt = new Date();
  const nextSyncAt = calculateNextSuccessfulSyncAt({
    publishedAt: target.published_at,
    from: completedAt,
    jitterKey: `${getTargetLabel(target)}:success`,
  });
  const { data, error } = await supabase
    .from(getTargetTable(target))
    .update({
      ...metrics,
      last_synced_at: completedAt.toISOString(),
      last_sync_attempt_at: attemptedAt,
      sync_count: (target.sync_count ?? 0) + 1,
      sync_error_count: 0,
      last_sync_error: null,
      last_sync_error_at: null,
      next_sync_at: nextSyncAt,
      sync_claimed_at: null,
      sync_claim_token: null,
    })
    .eq("id", target.id)
    .eq("sync_claim_token", claimToken)
    .select("id")
    .maybeSingle();

  if (error) {
    throw new Error(`Could not save successful sync: ${error.message}`);
  }

  if (!data) {
    throw new Error("Sync claim was lost before the successful update.");
  }

  return {
    syncedAt: completedAt.toISOString(),
    nextSyncAt,
  };
}

async function recordFailure(
  target: DueTarget,
  claimToken: string,
  attemptedAt: string,
  error: unknown,
  metricUpdates: MetricUpdates = {}
) {
  const syncError =
    error instanceof SyncJobError
      ? error
      : new SyncJobError(sanitizeError(error), "temporary");
  const errorCount = (target.sync_error_count ?? 0) + 1;
  const sanitizedError = sanitizeError(
    `[${syncError.failureKind}] ${syncError.message}`
  );
  const failedAt = new Date();
  const nextSyncAt = calculateRetryAt({
    failureKind: syncError.failureKind,
    errorCount,
    from: failedAt,
    jitterKey: `${getTargetLabel(target)}:failure:${errorCount}`,
    retryAfterMs: syncError.retryAfterMs,
  });
  const { data, error: updateError } = await supabase
    .from(getTargetTable(target))
    .update({
      ...metricUpdates,
      last_sync_attempt_at: attemptedAt,
      sync_error_count: errorCount,
      last_sync_error: sanitizedError,
      last_sync_error_at: failedAt.toISOString(),
      next_sync_at: nextSyncAt,
      sync_claimed_at: null,
      sync_claim_token: null,
    })
    .eq("id", target.id)
    .eq("sync_claim_token", claimToken)
    .select("id")
    .maybeSingle();

  return {
    failureKind: syncError.failureKind,
    error: sanitizedError,
    errorCount,
    nextSyncAt,
    failureSaved: !updateError && Boolean(data),
    persistenceError: updateError?.message ?? (!data ? "Sync claim was lost." : null),
  };
}

async function processTarget(target: DueTarget) {
  const claimStartedAt = new Date().toISOString();
  let claimToken: string | null;

  try {
    claimToken = await claimTarget(target, claimStartedAt);
  } catch (error) {
    return {
      target: getTargetLabel(target),
      platform: target.platform,
      externalPostId: target.external_post_id,
      ok: false,
      skipped: true,
      reason: sanitizeError(error),
    };
  }

  if (!claimToken) {
    return {
      target: getTargetLabel(target),
      platform: target.platform,
      externalPostId: target.external_post_id,
      ok: false,
      skipped: true,
      reason: "Target was already claimed or is no longer due.",
    };
  }

  const attemptedAt = new Date().toISOString();
  let partialMetrics: MetricUpdates = {};
  let metricWarnings: FacebookMetricWarning[] = [];
  let facebookStrategy: FacebookMetricResult["strategy"] | null = null;

  try {
    if (!target.published_at) {
      throw new SyncJobError(
        "Target published_at is missing.",
        "configuration"
      );
    }

    const { socialAccount, mediaType } = await loadVerifiedAccount(target);
    let metrics: MetricUpdates;

    if (target.platform === "instagram") {
      metrics = await fetchInstagramMetrics(
        target.external_post_id,
        socialAccount.access_token!
      );
    } else {
      const facebookResult = await fetchFacebookMetrics(
        target.external_post_id,
        socialAccount.access_token!,
        mediaType
      );

      metrics = facebookResult.updates;
      partialMetrics = facebookResult.updates;
      metricWarnings = facebookResult.warnings;
      facebookStrategy = facebookResult.strategy;

      if (facebookResult.criticalError) {
        throw facebookResult.criticalError;
      }
    }

    const finalized = await finalizeSuccess(
      target,
      claimToken,
      metrics,
      attemptedAt
    );

    return {
      target: getTargetLabel(target),
      platform: target.platform,
      externalPostId: target.external_post_id,
      ok: true,
      updatedMetrics: metrics,
      partial: metricWarnings.length > 0,
      metricWarnings,
      facebookStrategy,
      ...finalized,
    };
  } catch (error) {
    const failure = await recordFailure(
      target,
      claimToken,
      attemptedAt,
      error,
      partialMetrics
    );

    return {
      target: getTargetLabel(target),
      platform: target.platform,
      externalPostId: target.external_post_id,
      ok: false,
      skipped: false,
      updatedMetrics: partialMetrics,
      metricWarnings,
      facebookStrategy,
      ...failure,
    };
  }
}

function describeDryRunTarget(
  target: DueTarget,
  staleBefore: string,
  priorityTime: Date,
  selectionIndex: number
) {
  const staleClaim =
    target.sync_claimed_at !== null && target.sync_claimed_at <= staleBefore;
  const priority = getTargetPriority(target, priorityTime);
  const bootstrap = target.next_sync_at === null;

  return {
    selectionOrder: selectionIndex + 1,
    target: getTargetLabel(target),
    kind: target.kind,
    id: target.id,
    postId: target.post_id,
    platform: target.platform,
    socialAccountId: target.social_account_id,
    externalPostId: target.external_post_id,
    publishedAt: target.published_at,
    nextSyncAt: target.next_sync_at,
    pool: getTargetPool(target, priorityTime),
    bootstrap,
    scheduleType: bootstrap ? "bootstrap" : "explicit_due",
    priority: priority.code,
    priorityGroup: priority.label,
    publicationAgeHours: Number.isFinite(priority.ageMs)
      ? Math.round((priority.ageMs / (60 * 60 * 1000)) * 10) / 10
      : null,
    claimState: staleClaim ? "stale" : "unclaimed",
  };
}

export async function POST(request: Request) {
  try {
    const expectedSecret = process.env.CRON_SECRET;

    if (!expectedSecret) {
      return NextResponse.json(
        { ok: false, error: "CRON_SECRET is missing." },
        { status: 500 }
      );
    }

    if (request.headers.get("authorization") !== `Bearer ${expectedSecret}`) {
      return NextResponse.json(
        { ok: false, error: "Unauthorized." },
        { status: 401 }
      );
    }

    let dryRun = false;
    let batchSize = DEFAULT_BATCH_SIZE;
    let platform: PlatformFilter = "all";
    const rawBody = await request.text();

    if (rawBody.trim()) {
      let body: unknown;

      try {
        body = JSON.parse(rawBody);
      } catch {
        return NextResponse.json(
          { ok: false, error: "Invalid JSON body." },
          { status: 400 }
        );
      }

      if (!isRecord(body)) {
        return NextResponse.json(
          { ok: false, error: "Request body must be a JSON object." },
          { status: 400 }
        );
      }

      if (body.dryRun !== undefined && typeof body.dryRun !== "boolean") {
        return NextResponse.json(
          { ok: false, error: "dryRun must be a boolean." },
          { status: 400 }
        );
      }

      if (body.platform !== undefined && !isPlatformFilter(body.platform)) {
        return NextResponse.json(
          {
            ok: false,
            error: 'platform must be "all", "instagram", or "facebook".',
          },
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
          {
            ok: false,
            error: `batchSize must be an integer from 1 to ${MAX_BATCH_SIZE}.`,
          },
          { status: 400 }
        );
      }

      dryRun = body.dryRun === true;
      batchSize =
        body.batchSize === undefined ? DEFAULT_BATCH_SIZE : Number(body.batchSize);
      platform = body.platform ?? "all";
    }

    const startedAt = new Date();
    const now = startedAt.toISOString();
    const staleBefore = new Date(
      startedAt.getTime() - STALE_CLAIM_MS
    ).toISOString();
    const dueSelection = await loadDueTargets(
      batchSize,
      now,
      staleBefore,
      platform
    );
    const { targets, selection } = dueSelection;

    if (dryRun) {
      return NextResponse.json({
        ok: true,
        dryRun: true,
        batchSize,
        platform,
        due: targets.length,
        selection,
        staleClaimThresholdMinutes: STALE_CLAIM_MS / 60_000,
        targets: targets.map((target, index) =>
          describeDryRunTarget(target, staleBefore, startedAt, index)
        ),
      });
    }

    const results = [];

    for (const target of targets) {
      results.push(await processTarget(target));
    }

    return NextResponse.json({
      ok: true,
      dryRun: false,
      batchSize,
      platform,
      due: targets.length,
      processed: results.length,
      succeeded: results.filter((result) => result.ok).length,
      failed: results.filter((result) => !result.ok && !result.skipped).length,
      skipped: results.filter((result) => result.skipped).length,
      results,
    });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: sanitizeError(error) },
      { status: 500 }
    );
  }
}
