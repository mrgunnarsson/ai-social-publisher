import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const PAGE_SIZE = 1000;
const ACTIVE_CLAIM_MS = 15 * 60 * 1000;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type Platform = "instagram" | "facebook";
type PlatformFilter = Platform | "all";
type BaselineType =
  | "previous_daily_snapshot"
  | "tracking_started_today";
type TodayCalculationType =
  | "post_metric_history"
  | "legacy_aggregate_baseline";

type SyncFields = {
  last_synced_at: string | null;
  next_sync_at: string | null;
  sync_claimed_at: string | null;
  sync_error_count: number | null;
};

type LegacyInstagramRow = SyncFields & {
  id: string;
  external_post_id: string;
  views: number | null;
  likes: number | null;
  comments: number | null;
  saves: number | null;
  shares: number | null;
  reach: number | null;
};

type DestinationRow = SyncFields & {
  post_id: string;
  platform: Platform;
  external_post_id: string;
  views: number | null;
  likes: number | null;
  reactions: number | null;
  comments: number | null;
  saves: number | null;
  shares: number | null;
  reach: number | null;
  clicks: number | null;
};

type SyncTarget = SyncFields;

type BaselineRow = {
  stat_date: string;
  updated_at: string | null;
  platform: Platform;
  views: number | null;
  likes: number | null;
  comments: number | null;
  saves: number | null;
  shares: number | null;
  reach: number | null;
};

type InitialBaselineRow = {
  baseline_date: string;
  baseline_at: string;
  views: number | null;
  likes: number | null;
  comments: number | null;
  saves: number | null;
  shares: number | null;
  reach: number | null;
  clicks: number | null;
};

type Totals = {
  views: number;
  likes: number;
  comments: number;
  saves: number;
  shares: number;
  reach: number;
  clicks: number;
};

type NullableTotals = {
  [Name in keyof Totals]: number | null;
};

type PostMetricTodayRow = {
  period_start: string;
  observed_targets: number | string;
  first_captured_at: string | null;
  views: number | string;
  likes: number | string;
  comments: number | string;
  saves: number | string;
  shares: number | string;
  reach: number | string;
  clicks: number | string;
};

function emptyTotals(): Totals {
  return {
    views: 0,
    likes: 0,
    comments: 0,
    saves: 0,
    shares: 0,
    reach: 0,
    clicks: 0,
  };
}

function metric(value: number | null) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function isPlatformFilter(value: unknown): value is PlatformFilter {
  return value === "all" || value === "instagram" || value === "facebook";
}

function stockholmDateString(date: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Stockholm",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const values = Object.fromEntries(
    parts.map((part) => [part.type, part.value])
  );

  return `${values.year}-${values.month}-${values.day}`;
}

async function loadBaselineRows(
  influencerId: string,
  platform: PlatformFilter,
  today: string
) {
  let latestDateQuery = supabase
    .from("social_daily_stats")
    .select("stat_date")
    .eq("influencer_id", influencerId)
    .lt("stat_date", today)
    .order("stat_date", { ascending: false })
    .limit(1);

  if (platform !== "all") {
    latestDateQuery = latestDateQuery.eq("platform", platform);
  }

  const { data: latestRows, error: latestDateError } = await latestDateQuery;

  if (latestDateError) {
    throw new Error(
      `Could not load the latest analytics baseline: ${latestDateError.message}`
    );
  }

  const baselineDate = latestRows?.[0]?.stat_date ?? null;

  if (!baselineDate) {
    return {
      baselineDate: null,
      baselineAt: null,
      rows: [] as BaselineRow[],
    };
  }

  let baselineQuery = supabase
    .from("social_daily_stats")
    .select(
      `
      stat_date,
      updated_at,
      platform,
      views,
      likes,
      comments,
      saves,
      shares,
      reach
      `
    )
    .eq("influencer_id", influencerId)
    .eq("stat_date", baselineDate);

  if (platform !== "all") {
    baselineQuery = baselineQuery.eq("platform", platform);
  }

  const { data, error } = await baselineQuery;

  if (error) {
    throw new Error(`Could not load analytics baseline rows: ${error.message}`);
  }

  return {
    baselineDate,
    baselineAt: (data ?? []).reduce<string | null>((latest, row) => {
      if (!row.updated_at || (latest !== null && row.updated_at <= latest)) {
        return latest;
      }

      return row.updated_at;
    }, null),
    rows: (data ?? []) as BaselineRow[],
  };
}

async function loadInitialBaseline(
  influencerId: string,
  platform: PlatformFilter,
  today: string
) {
  const { data, error } = await supabase
    .from("analytics_daily_baselines")
    .select(
      `
      baseline_date,
      baseline_at,
      views,
      likes,
      comments,
      saves,
      shares,
      reach,
      clicks
      `
    )
    .eq("influencer_id", influencerId)
    .eq("platform", platform)
    .eq("baseline_date", today)
    .maybeSingle();

  if (error) {
    throw new Error(`Could not load today's initial baseline: ${error.message}`);
  }

  return (data as InitialBaselineRow | null) ?? null;
}

function initialBaselineTotals(row: InitialBaselineRow): NullableTotals {
  return {
    views: row.views,
    likes: row.likes,
    comments: row.comments,
    saves: row.saves,
    shares: row.shares,
    reach: row.reach,
    clicks: row.clicks,
  };
}

function aggregateBaseline(rows: BaselineRow[]): NullableTotals {
  const totals: NullableTotals = {
    views: null,
    likes: null,
    comments: null,
    saves: null,
    shares: null,
    reach: null,
    clicks: null,
  };

  for (const row of rows) {
    for (const name of [
      "views",
      "likes",
      "comments",
      "saves",
      "shares",
      "reach",
    ] as const) {
      const value = row[name];

      if (value !== null) {
        totals[name] = (totals[name] ?? 0) + value;
      }
    }
  }

  return totals;
}

function calculateTodayDelta(
  totals: Totals,
  baseline: NullableTotals
): NullableTotals {
  const delta: NullableTotals = {
    views: null,
    likes: null,
    comments: null,
    saves: null,
    shares: null,
    reach: null,
    clicks: null,
  };

  for (const name of Object.keys(delta) as Array<keyof Totals>) {
    const baselineValue = baseline[name];

    if (baselineValue !== null) {
      delta[name] = totals[name] - baselineValue;
    }
  }

  return delta;
}

function historyMetric(value: number | string) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function isHistorySchemaUnavailable(code: string | undefined) {
  return (
    code === "42P01" ||
    code === "42883" ||
    code === "PGRST202" ||
    code === "PGRST205"
  );
}

async function loadPostMetricToday(
  influencerId: string,
  platform: PlatformFilter,
  stockholmDay: string,
  now: Date
) {
  const { data, error } = await supabase.rpc("get_post_metric_today", {
    p_influencer_id: influencerId,
    p_platform: platform,
    p_day: stockholmDay,
    p_end_at: now.toISOString(),
  });

  if (error) {
    if (isHistorySchemaUnavailable(error.code)) {
      return null;
    }

    throw new Error(`Could not load post metric history: ${error.message}`);
  }

  const row = (Array.isArray(data) ? data[0] : data) as PostMetricTodayRow | null;

  if (!row || historyMetric(row.observed_targets) === 0) {
    return null;
  }

  return {
    calculationType: "post_metric_history" as TodayCalculationType,
    periodStart: row.period_start,
    firstCapturedAt: row.first_captured_at,
    observedTargets: historyMetric(row.observed_targets),
    totals: {
      views: historyMetric(row.views),
      likes: historyMetric(row.likes),
      comments: historyMetric(row.comments),
      saves: historyMetric(row.saves),
      shares: historyMetric(row.shares),
      reach: historyMetric(row.reach),
      clicks: historyMetric(row.clicks),
    } satisfies Totals,
  };
}

async function loadLegacyInstagramRows(influencerId: string) {
  const rows: LegacyInstagramRow[] = [];

  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await supabase
      .from("posts")
      .select(
        `
        id,
        external_post_id,
        views,
        likes,
        comments,
        saves,
        shares,
        reach,
        last_synced_at,
        next_sync_at,
        sync_claimed_at,
        sync_error_count
        `
      )
      .eq("influencer_id", influencerId)
      .eq("platform", "instagram")
      .eq("status", "published")
      .not("external_post_id", "is", null)
      .order("id", { ascending: true })
      .range(from, from + PAGE_SIZE - 1);

    if (error) {
      throw new Error(`Could not load legacy Instagram posts: ${error.message}`);
    }

    const page = (data ?? []) as LegacyInstagramRow[];
    rows.push(...page);

    if (page.length < PAGE_SIZE) {
      return rows;
    }
  }
}

async function loadDestinationRows(
  influencerId: string,
  platform: PlatformFilter
) {
  const rows: DestinationRow[] = [];

  for (let from = 0; ; from += PAGE_SIZE) {
    let query = supabase
      .from("post_destinations")
      .select(
        `
        post_id,
        platform,
        external_post_id,
        views,
        likes,
        reactions,
        comments,
        saves,
        shares,
        reach,
        clicks,
        last_synced_at,
        next_sync_at,
        sync_claimed_at,
        sync_error_count,
        posts!inner (
          influencer_id
        )
        `
      )
      .eq("posts.influencer_id", influencerId)
      .eq("status", "published")
      .not("external_post_id", "is", null)
      .order("id", { ascending: true })
      .range(from, from + PAGE_SIZE - 1);

    query =
      platform === "all"
        ? query.in("platform", ["instagram", "facebook"])
        : query.eq("platform", platform);

    const { data, error } = await query;

    if (error) {
      throw new Error(`Could not load post destinations: ${error.message}`);
    }

    const page = (data ?? []) as unknown as DestinationRow[];
    rows.push(...page);

    if (page.length < PAGE_SIZE) {
      return rows;
    }
  }
}

function addInstagramMetrics(
  totals: Totals,
  row: LegacyInstagramRow | DestinationRow
) {
  totals.views += metric(row.views);
  totals.likes += metric(row.likes);
  totals.comments += metric(row.comments);
  totals.saves += metric(row.saves);
  totals.shares += metric(row.shares);
  totals.reach += metric(row.reach);
}

function addFacebookMetrics(totals: Totals, row: DestinationRow) {
  totals.views += metric(row.views);
  totals.likes += metric(row.reactions);
  totals.comments += metric(row.comments);
  totals.shares += metric(row.shares);
  totals.reach += metric(row.reach);
  totals.clicks += metric(row.clicks);
}

function newestSync(targets: SyncTarget[]) {
  let newest: string | null = null;

  for (const target of targets) {
    if (
      target.last_synced_at &&
      (newest === null || target.last_synced_at > newest)
    ) {
      newest = target.last_synced_at;
    }
  }

  return newest;
}

async function loadCurrentAnalytics(
  influencerId: string,
  platform: PlatformFilter,
  now: Date
) {
    const shouldLoadInstagram = platform !== "facebook";
    const [legacyRows, destinationRows] = await Promise.all([
      shouldLoadInstagram
        ? loadLegacyInstagramRows(influencerId)
        : Promise.resolve([] as LegacyInstagramRow[]),
      loadDestinationRows(influencerId, platform),
    ]);

    const instagramDestinationPostIds = new Set(
      destinationRows
        .filter((row) => row.platform === "instagram")
        .map((row) => row.post_id)
    );
    const instagramDestinationExternalIds = new Set(
      destinationRows
        .filter((row) => row.platform === "instagram")
        .map((row) => row.external_post_id)
    );
    const deduplicatedLegacyRows = legacyRows.filter(
      (row) =>
        !instagramDestinationPostIds.has(row.id) &&
        !instagramDestinationExternalIds.has(row.external_post_id)
    );

    const instagram = emptyTotals();
    const facebook = emptyTotals();

    for (const row of deduplicatedLegacyRows) {
      addInstagramMetrics(instagram, row);
    }

    for (const row of destinationRows) {
      if (row.platform === "instagram") {
        addInstagramMetrics(instagram, row);
      } else {
        addFacebookMetrics(facebook, row);
      }
    }

    const totals = emptyTotals();
    const includedPlatformTotals =
      platform === "all"
        ? [instagram, facebook]
        : platform === "instagram"
          ? [instagram]
          : [facebook];

    for (const platformTotals of includedPlatformTotals) {
      for (const name of Object.keys(totals) as Array<keyof Totals>) {
        totals[name] += platformTotals[name];
      }
    }

    const syncTargets: SyncTarget[] = [
      ...deduplicatedLegacyRows,
      ...destinationRows,
    ];
    const nowTime = now.getTime();
    const activeClaimAfter = nowTime - ACTIVE_CLAIM_MS;
    const dueTargets = syncTargets.filter(
      (target) =>
        target.next_sync_at === null ||
        new Date(target.next_sync_at).getTime() <= nowTime
    ).length;
    const syncingTargets = syncTargets.filter((target) => {
      if (!target.sync_claimed_at) {
        return false;
      }

      const claimedAt = new Date(target.sync_claimed_at).getTime();
      return Number.isFinite(claimedAt) && claimedAt > activeClaimAfter;
    }).length;
    const errorTargets = syncTargets.filter(
      (target) => (target.sync_error_count ?? 0) > 0
    ).length;

    return {
      totals,
      platforms: {
        instagram: {
          views: instagram.views,
          likes: instagram.likes,
          comments: instagram.comments,
          saves: instagram.saves,
          shares: instagram.shares,
          reach: instagram.reach,
        },
        facebook: {
          views: facebook.views,
          likes: facebook.likes,
          comments: facebook.comments,
          shares: facebook.shares,
          reach: facebook.reach,
          clicks: facebook.clicks,
        },
      },
      sync: {
        lastUpdatedAt: newestSync(syncTargets),
        targetCount: syncTargets.length,
        syncingTargets,
        dueTargets,
        errorTargets,
      },
    };
}

async function influencerExists(influencerId: string) {
  const { data, error } = await supabase
    .from("influencers")
    .select("id")
    .eq("id", influencerId)
    .maybeSingle();

  if (error) {
    throw new Error(`Could not verify influencer: ${error.message}`);
  }

  return Boolean(data);
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const influencerId = url.searchParams.get("influencerId");
    const platformParam = url.searchParams.get("platform") ?? "all";

    if (!influencerId || !UUID_PATTERN.test(influencerId)) {
      return NextResponse.json(
        { ok: false, error: "A valid influencerId is required." },
        { status: 400 }
      );
    }

    if (!isPlatformFilter(platformParam)) {
      return NextResponse.json(
        { ok: false, error: "Invalid platform." },
        { status: 400 }
      );
    }

    const platform = platformParam;
    const now = new Date();
    const todayInStockholm = stockholmDateString(now);
    const [current, previousBaseline, postMetricToday] = await Promise.all([
      loadCurrentAnalytics(influencerId, platform, now),
      loadBaselineRows(influencerId, platform, todayInStockholm),
      loadPostMetricToday(influencerId, platform, todayInStockholm, now),
    ]);
    let baselineType: BaselineType | null = null;
    let baselineDate: string | null = null;
    let baselineAt: string | null = null;
    let baselineTotals: NullableTotals | null = null;

    if (
      previousBaseline.baselineDate !== null &&
      previousBaseline.rows.length > 0
    ) {
      baselineType = "previous_daily_snapshot";
      baselineDate = previousBaseline.baselineDate;
      baselineAt = previousBaseline.baselineAt;
      baselineTotals = aggregateBaseline(previousBaseline.rows);
    } else {
      const initialBaseline = await loadInitialBaseline(
        influencerId,
        platform,
        todayInStockholm
      );

      if (initialBaseline) {
        baselineType = "tracking_started_today";
        baselineDate = initialBaseline.baseline_date;
        baselineAt = initialBaseline.baseline_at;
        baselineTotals = initialBaselineTotals(initialBaseline);
      }
    }

    const historyReady = Boolean(
      postMetricToday &&
        postMetricToday.observedTargets >= current.sync.targetCount
    );
    const legacyTodayDelta = baselineTotals
      ? calculateTodayDelta(current.totals, baselineTotals)
      : null;
    const todayDelta = historyReady ? postMetricToday!.totals : legacyTodayDelta;
    const calculationType: TodayCalculationType = historyReady
      ? "post_metric_history"
      : "legacy_aggregate_baseline";

    return NextResponse.json(
      {
        ok: true,
        influencerId,
        platform,
        generatedAt: now.toISOString(),
        totals: current.totals,
        today: {
          available: todayDelta !== null,
          calculationType,
          periodStart: historyReady ? postMetricToday!.periodStart : null,
          observedTargets: postMetricToday?.observedTargets ?? null,
          requiredTargets: current.sync.targetCount,
          historyReady,
          firstCapturedAt: postMetricToday?.firstCapturedAt ?? null,
          baselineType: historyReady ? null : baselineType,
          baselineDate: historyReady ? todayInStockholm : baselineDate,
          baselineAt: historyReady ? postMetricToday!.periodStart : baselineAt,
          baselineTotals: historyReady ? null : baselineTotals,
          views: todayDelta?.views ?? null,
          likes: todayDelta?.likes ?? null,
          comments: todayDelta?.comments ?? null,
          saves: todayDelta?.saves ?? null,
          shares: todayDelta?.shares ?? null,
          reach: todayDelta?.reach ?? null,
          clicks: todayDelta?.clicks ?? null,
        },
        platforms: current.platforms,
        sync: current.sync,
      },
      {
        headers: {
          "Cache-Control": "no-store",
        },
      }
    );
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Unknown error.",
      },
      { status: 500 }
    );
  }
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

    let body: unknown;

    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { ok: false, error: "A valid JSON body is required." },
        { status: 400 }
      );
    }

    if (typeof body !== "object" || body === null || Array.isArray(body)) {
      return NextResponse.json(
        { ok: false, error: "Request body must be a JSON object." },
        { status: 400 }
      );
    }

    const requestBody = body as {
      influencerId?: unknown;
      platform?: unknown;
    };
    const influencerId = requestBody.influencerId;
    const platform = requestBody.platform ?? "all";

    if (typeof influencerId !== "string" || !UUID_PATTERN.test(influencerId)) {
      return NextResponse.json(
        { ok: false, error: "A valid influencerId is required." },
        { status: 400 }
      );
    }

    if (!isPlatformFilter(platform)) {
      return NextResponse.json(
        {
          ok: false,
          error: 'platform must be "all", "instagram", or "facebook".',
        },
        { status: 400 }
      );
    }

    if (!(await influencerExists(influencerId))) {
      return NextResponse.json(
        { ok: false, error: "Influencer does not exist." },
        { status: 404 }
      );
    }

    const startedAt = new Date();
    const baselineDate = stockholmDateString(startedAt);
    const previousBaseline = await loadBaselineRows(
      influencerId,
      platform,
      baselineDate
    );

    if (
      previousBaseline.baselineDate !== null &&
      previousBaseline.rows.length > 0
    ) {
      return NextResponse.json(
        {
          ok: false,
          error: "A previous daily snapshot already provides the baseline.",
          baselineType: "previous_daily_snapshot",
          baselineDate: previousBaseline.baselineDate,
        },
        { status: 409 }
      );
    }

    const existingBaseline = await loadInitialBaseline(
      influencerId,
      platform,
      baselineDate
    );

    if (existingBaseline) {
      return NextResponse.json(
        {
          ok: false,
          error: "Today's initial baseline already exists and was not changed.",
          baselineType: "tracking_started_today",
          baselineDate: existingBaseline.baseline_date,
          baselineAt: existingBaseline.baseline_at,
        },
        { status: 409 }
      );
    }

    const current = await loadCurrentAnalytics(influencerId, platform, startedAt);
    const baselineAt = new Date().toISOString();
    const { data, error } = await supabase
      .from("analytics_daily_baselines")
      .insert({
        influencer_id: influencerId,
        platform,
        baseline_date: baselineDate,
        baseline_at: baselineAt,
        ...current.totals,
      })
      .select(
        `
        id,
        influencer_id,
        platform,
        baseline_date,
        baseline_at,
        views,
        likes,
        comments,
        saves,
        shares,
        reach,
        clicks
        `
      )
      .single();

    if (error) {
      if (error.code === "23505") {
        return NextResponse.json(
          {
            ok: false,
            error: "Today's initial baseline already exists and was not changed.",
          },
          { status: 409 }
        );
      }

      throw new Error(`Could not create initial baseline: ${error.message}`);
    }

    return NextResponse.json(
      {
        ok: true,
        baselineType: "tracking_started_today",
        baseline: data,
      },
      { status: 201 }
    );
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Unknown error.",
      },
      { status: 500 }
    );
  }
}
