"use client";

import Link from "next/link";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

type Influencer = {
  id: string;
  name: string;
};

type DailyRow = {
  date: string;

  followers:
    number | null;

  reach:
    number | null;

  impressions:
    number | null;

  views:
    number | null;

  likes:
    number | null;

  comments:
    number | null;

  shares:
    number | null;

  saves:
    number | null;

  postsPublished:
    number;

  accounts:
    number;

  accountsWithBaseline:
    number;
};

type Totals = {
  followers:
    number | null;

  reach:
    number | null;

  impressions:
    number | null;

  views:
    number | null;

  likes:
    number | null;

  comments:
    number | null;

  shares:
    number | null;

  saves:
    number | null;
};

type AnalyticsResponse = {
  ok: boolean;

  filters?: {
    influencerId:
      string;

    platform:
      string;

    days:
      number;
  };

  currentTotals?:
    Totals;

  today?:
    DailyRow | null;

  daily?:
    DailyRow[];

  influencers?:
    Influencer[];

  error?:
    string;
};

type CurrentTotals = {
  views: number | null;
  likes: number | null;
  comments: number | null;
  saves: number | null;
  shares: number | null;
  reach: number | null;
  clicks: number | null;
};

type CurrentSync = {
  lastUpdatedAt: string | null;
  syncingTargets: number;
  dueTargets: number;
  errorTargets: number;
};

type CurrentToday = CurrentTotals & {
  available: boolean;
  baselineType:
    | "previous_daily_snapshot"
    | "tracking_started_today"
    | null;
  baselineDate: string | null;
  baselineAt: string | null;
  baselineTotals: CurrentTotals | null;
};

type CurrentAnalyticsResponse = {
  ok: boolean;
  totals?: CurrentTotals;
  today?: CurrentToday;
  sync?: CurrentSync;
  error?: string;
};

type PlatformFilter =
  | "all"
  | "instagram"
  | "facebook";

function formatNumber(
  value:
    number | null | undefined
) {
  if (
    value === null ||
    value === undefined
  ) {
    return "—";
  }

  return new Intl.NumberFormat(
    "sv-SE"
  ).format(
    value
  );
}

function formatCompactNumber(
  value:
    number | null | undefined
) {
  if (
    value === null ||
    value === undefined
  ) {
    return "—";
  }

  return new Intl.NumberFormat(
    "sv-SE",
    {
      notation:
        "compact",

      maximumFractionDigits:
        1,
    }
  ).format(
    value
  );
}

function formatDate(
  value: string
) {
  return new Intl.DateTimeFormat(
    "sv-SE",
    {
      day:
        "numeric",

      month:
        "short",
    }
  ).format(
    new Date(
      `${value}T12:00:00`
    )
  );
}

function formatFreshness(seconds: number) {
  if (seconds < 5) {
    return "just nu";
  }

  if (seconds < 60) {
    return `${seconds}s sedan`;
  }

  const minutes = Math.floor(seconds / 60);

  if (minutes < 60) {
    return `${minutes} min sedan`;
  }

  const hours = Math.floor(minutes / 60);
  return `${hours} h sedan`;
}

function formatStockholmTime(value: string) {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Europe/Stockholm",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

export default function AnalyticsPage() {
  const [
    influencerId,
    setInfluencerId,
  ] =
    useState(
      "all"
    );

  const [
    platform,
    setPlatform,
  ] =
    useState<PlatformFilter>(
      "all"
    );

  const [
    days,
    setDays,
  ] =
    useState(
      30
    );

  const [
    influencers,
    setInfluencers,
  ] =
    useState<Influencer[]>(
      []
    );

  const [
    liveTotals,
    setLiveTotals,
  ] = useState<CurrentTotals | null>(
    null
  );

  const [
    liveSync,
    setLiveSync,
  ] = useState<CurrentSync | null>(
    null
  );

  const [
    liveToday,
    setLiveToday,
  ] = useState<CurrentToday | null>(
    null
  );

  const [
    liveRefreshing,
    setLiveRefreshing,
  ] = useState(false);

  const [
    liveError,
    setLiveError,
  ] = useState("");

  const [
    freshnessClock,
    setFreshnessClock,
  ] = useState(() => Date.now());

  const [
    today,
    setToday,
  ] =
    useState<DailyRow | null>(
      null
    );

  const [
    daily,
    setDaily,
  ] =
    useState<DailyRow[]>(
      []
    );

  const [
    loading,
    setLoading,
  ] =
    useState(
      true
    );

  const [
    error,
    setError,
  ] =
    useState("");

  useEffect(() => {
    async function loadAnalytics() {
      try {
        setLoading(
          true
        );

        setError("");

        const params =
          new URLSearchParams({
            influencerId,
            platform,
            days:
              String(
                days
              ),
          });

        const response =
          await fetch(
            `/api/analytics/daily?${params.toString()}`,
            {
              cache:
                "no-store",
            }
          );

        const data:
          AnalyticsResponse =
          await response.json();

        if (
          !response.ok ||
          !data.ok
        ) {
          throw new Error(
            data.error ??
              "Kunde inte hämta statistik."
          );
        }

        setInfluencers(
          data.influencers ??
            []
        );

        setToday(
          data.today ??
            null
        );

        setDaily(
          data.daily ??
            []
        );
      } catch (error) {
        setError(
          error instanceof Error
            ? error.message
            : "Något gick fel."
        );
      } finally {
        setLoading(
          false
        );
      }
    }

    loadAnalytics();
  }, [
    influencerId,
    platform,
    days,
  ]);

  useEffect(() => {
    const timer = window.setInterval(
      () => setFreshnessClock(Date.now()),
      1000
    );

    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    let stopped = false;
    let inFlight = false;
    let controller: AbortController | null = null;
    let refreshTimer: number | null = null;

    if (influencerId === "all") {
      return;
    }

    const clearRefreshTimer = () => {
      if (refreshTimer !== null) {
        window.clearTimeout(refreshTimer);
        refreshTimer = null;
      }
    };

    const scheduleRefresh = (delay = 20_000) => {
      clearRefreshTimer();

      if (!stopped && document.visibilityState === "visible") {
        refreshTimer = window.setTimeout(loadCurrentAnalytics, delay);
      }
    };

    async function loadCurrentAnalytics() {
      if (
        stopped ||
        inFlight ||
        document.visibilityState !== "visible"
      ) {
        return;
      }

      inFlight = true;
      const requestStartedAt = Date.now();
      const requestController = new AbortController();
      controller = requestController;
      setLiveRefreshing(true);

      try {
        const params = new URLSearchParams({
          influencerId,
          platform,
        });
        const response = await fetch(
          `/api/analytics/current?${params.toString()}`,
          {
            cache: "no-store",
            signal: requestController.signal,
          }
        );
        const data: CurrentAnalyticsResponse = await response.json();

        if (
          !response.ok ||
          !data.ok ||
          !data.totals ||
          !data.today ||
          !data.sync
        ) {
          throw new Error(
            data.error ?? "Kunde inte hämta aktuell statistik."
          );
        }

        if (!stopped) {
          setLiveTotals(data.totals);
          setLiveToday(data.today);
          setLiveSync(data.sync);
          setLiveError("");
          setFreshnessClock(Date.now());
        }
      } catch (error) {
        if (
          !stopped &&
          !(error instanceof DOMException && error.name === "AbortError")
        ) {
          setLiveError(
            error instanceof Error
              ? error.message
              : "Kunde inte hämta aktuell statistik."
          );
        }
      } finally {
        if (controller === requestController) {
          controller = null;
        }

        inFlight = false;

        if (!stopped) {
          setLiveRefreshing(false);
          scheduleRefresh(
            Math.max(0, 20_000 - (Date.now() - requestStartedAt))
          );
        }
      }
    }

    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        clearRefreshTimer();
      } else {
        void loadCurrentAnalytics();
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    void loadCurrentAnalytics();

    return () => {
      stopped = true;
      clearRefreshTimer();
      controller?.abort();
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [influencerId, platform]);

  const currentTotals = liveTotals;
  const hasSelectedInfluencer = influencerId !== "all";
  const todayValues = hasSelectedInfluencer
    ? liveToday?.available
      ? liveToday
      : null
    : today;
  const todayDescription = hasSelectedInfluencer
    ? liveToday?.available &&
      liveToday.baselineType === "tracking_started_today" &&
      liveToday.baselineAt
      ? `Since tracking started today at ${formatStockholmTime(liveToday.baselineAt)}.`
      : liveToday?.available &&
          liveToday.baselineType === "previous_daily_snapshot" &&
          liveToday.baselineDate
        ? `Since snapshot ${formatDate(liveToday.baselineDate)}.`
        : "Today's change will be available after the first baseline is created."
    : "Förändring sedan föregående snapshot.";

  let liveStatus = "Välj en influencer för liveuppdatering.";
  let liveStatusTone = "text-zinc-500";

  if (influencerId !== "all") {
    if (liveError) {
      liveStatus = "Live-data kunde inte uppdateras. Visar senast hämtade värden.";
      liveStatusTone = "text-amber-300";
    } else if (liveSync?.syncingTargets) {
      liveStatus = "Uppdaterar…";
      liveStatusTone = "text-emerald-300";
    } else if (liveSync?.lastUpdatedAt) {
      const updatedAt = new Date(liveSync.lastUpdatedAt).getTime();
      const ageSeconds = Number.isFinite(updatedAt)
        ? Math.max(0, Math.floor((freshnessClock - updatedAt) / 1000))
        : 0;
      const stale = ageSeconds > 60 * 60;

      liveStatus = `${stale ? "Live · Data kan vara inaktuell" : "Live"} · Uppdaterad ${formatFreshness(ageSeconds)}`;
      liveStatusTone = stale
        ? "text-amber-300"
        : "text-emerald-300";
    } else if (liveRefreshing) {
      liveStatus = "Hämtar live-data…";
      liveStatusTone = "text-zinc-400";
    } else if (liveSync) {
      liveStatus = liveSync.syncingTargets
        ? "Uppdaterar…"
        : "Live · Väntar på första synk.";
      liveStatusTone = "text-zinc-400";
    }
  }

  const selectedInfluencerName =
    useMemo(() => {
      if (
        influencerId ===
        "all"
      ) {
        return "Alla influencers";
      }

      return (
        influencers.find(
          (
            influencer
          ) =>
            influencer.id ===
            influencerId
        )?.name ??
        "Influencer"
      );
    }, [
      influencerId,
      influencers,
    ]);

  const resetLiveAnalytics = () => {
    setLiveTotals(null);
    setLiveToday(null);
    setLiveSync(null);
    setLiveError("");
    setLiveRefreshing(false);
  };

  const changePlatform = (nextPlatform: PlatformFilter) => {
    if (nextPlatform !== platform) {
      resetLiveAnalytics();
      setPlatform(nextPlatform);
    }
  };

  return (
    <main className="min-h-screen bg-zinc-950 px-6 py-10 text-white">

      <div className="mx-auto max-w-6xl">

        <Link
          href="/"
          className="text-sm text-zinc-400 transition hover:text-white"
        >
          ← Back
        </Link>

        <div className="mt-8">

          <p className="text-sm font-medium uppercase tracking-wider text-zinc-500">
            Analytics
          </p>

          <div className="mt-2 flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">

            <div>

              <h1 className="text-4xl font-bold">
                Statistik
              </h1>

              <p className="mt-2 text-zinc-400">
                Daglig statistik för alla eller enskilda influencers.
              </p>

            </div>

            <div className="flex flex-col gap-3 sm:flex-row">

              <select
                value={
                  influencerId
                }
                onChange={(
                  event
                ) => {
                  resetLiveAnalytics();
                  setInfluencerId(
                    event.target.value
                  );
                }}
                className="rounded-xl border border-zinc-700 bg-zinc-900 px-4 py-3 text-sm outline-none"
              >

                <option value="all">
                  Alla influencers
                </option>

                {influencers.map(
                  (
                    influencer
                  ) => (
                    <option
                      key={
                        influencer.id
                      }
                      value={
                        influencer.id
                      }
                    >
                      {
                        influencer.name
                      }
                    </option>
                  )
                )}

              </select>

              <select
                value={
                  days
                }
                onChange={(
                  event
                ) =>
                  setDays(
                    Number(
                      event.target.value
                    )
                  )
                }
                className="rounded-xl border border-zinc-700 bg-zinc-900 px-4 py-3 text-sm outline-none"
              >
                <option value="7">
                  7 dagar
                </option>

                <option value="30">
                  30 dagar
                </option>

                <option value="90">
                  90 dagar
                </option>
              </select>

            </div>

          </div>

        </div>

        <div className="mt-8 flex flex-wrap gap-2">

          <FilterButton
            label="Alla"
            active={
              platform ===
              "all"
            }
            onClick={() => changePlatform("all")}
          />

          <FilterButton
            label="Instagram"
            active={
              platform ===
              "instagram"
            }
            onClick={() => changePlatform("instagram")}
          />

          <FilterButton
            label="Facebook"
            active={
              platform ===
              "facebook"
            }
            onClick={() => changePlatform("facebook")}
          />

        </div>

        <div className="mt-4 text-sm text-zinc-500">
          Visar:{" "}
          <span className="text-zinc-300">
            {
              selectedInfluencerName
            }
          </span>
        </div>

        {loading ? (
          <div className="mt-10 text-zinc-500">
            Hämtar statistik...
          </div>
        ) : error ? (
          <div className="mt-10 rounded-2xl border border-red-900/40 bg-red-950/30 p-5 text-red-300">
            {error}
          </div>
        ) : (
          <>

            {/* TODAY */}

            <section className="mt-8">

              <div className="mb-4">

                <h2 className="text-lg font-semibold">
                  Idag
                </h2>

                <p className="mt-1 text-sm text-zinc-500">
                  {todayDescription}
                </p>

              </div>

              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">

                <StatCard
                  key={`today-views-${influencerId}-${platform}`}
                  label="Views"
                  value={
                    todayValues?.views
                  }
                />

                <StatCard
                  key={`today-likes-${influencerId}-${platform}`}
                  label="Likes / reactions"
                  value={
                    todayValues?.likes
                  }
                />

                <StatCard
                  key={`today-comments-${influencerId}-${platform}`}
                  label="Comments"
                  value={
                    todayValues?.comments
                  }
                />

                <StatCard
                  key={`today-shares-${influencerId}-${platform}`}
                  label="Shares"
                  value={
                    todayValues?.shares
                  }
                />

                <StatCard
                  key={`today-reach-${influencerId}-${platform}`}
                  label="Reach"
                  value={
                    todayValues?.reach
                  }
                />

                {platform !== "facebook" ? (
                  <StatCard
                    key={`today-saves-${influencerId}-${platform}`}
                    label="Saves"
                    value={
                      todayValues?.saves
                    }
                  />
                ) : null}

                {hasSelectedInfluencer && platform !== "instagram" ? (
                  <StatCard
                    key={`today-clicks-${influencerId}-${platform}`}
                    label="Clicks"
                    value={
                      liveToday?.available
                        ? liveToday.clicks
                        : null
                    }
                  />
                ) : null}

                {!hasSelectedInfluencer ? (
                  <StatCard
                    label="Posts published"
                    value={
                      today?.postsPublished
                    }
                  />
                ) : null}

              </div>

            </section>

            {/* CURRENT TOTALS */}

            <section className="mt-10">

              <div className="mb-4">

                <h2 className="text-lg font-semibold">
                  Current totals
                </h2>

                <p className="mt-1 text-sm text-zinc-500">
                  {influencerId === "all"
                    ? "Välj en influencer för aktuella värden."
                    : "Aktuella publicerade inlägg från databasen."}
                </p>

                <p
                  className={`mt-2 text-xs ${liveStatusTone}`}
                  aria-live="polite"
                >
                  {liveStatus}
                </p>

                {influencerId !== "all" && liveSync ? (
                  <div className="mt-3 inline-flex items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-900/70 px-3 py-2 text-xs text-zinc-500">
                    <span className="font-medium text-zinc-400">
                      Sync status
                    </span>
                    <span aria-live="polite">
                      {liveSync.dueTargets} waiting · {liveSync.errorTargets} errors
                    </span>
                  </div>
                ) : null}

              </div>

              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">

                <TotalCard
                  key={`views-${influencerId}-${platform}`}
                  label="Views"
                  value={
                    currentTotals?.views
                  }
                />

                <TotalCard
                  key={`likes-${influencerId}-${platform}`}
                  label={platform === "facebook" ? "Reactions" : "Likes / reactions"}
                  value={
                    currentTotals?.likes
                  }
                />

                <TotalCard
                  key={`comments-${influencerId}-${platform}`}
                  label="Comments"
                  value={
                    currentTotals?.comments
                  }
                />

                <TotalCard
                  key={`shares-${influencerId}-${platform}`}
                  label="Shares"
                  value={
                    currentTotals?.shares
                  }
                />

                <TotalCard
                  key={`reach-${influencerId}-${platform}`}
                  label="Reach"
                  value={
                    currentTotals?.reach
                  }
                />

                {platform !== "facebook" ? (
                  <TotalCard
                    key={`saves-${influencerId}-${platform}`}
                    label="Saves"
                    value={
                      currentTotals?.saves
                    }
                  />
                ) : null}

                {platform !== "instagram" ? (
                  <TotalCard
                    key={`clicks-${influencerId}-${platform}`}
                    label="Clicks"
                    value={
                      currentTotals?.clicks
                    }
                  />
                ) : null}

              </div>

            </section>

            {/* DAILY TABLE */}

            <section className="mt-10">

              <div>

                <h2 className="text-lg font-semibold">
                  Dag för dag
                </h2>

                <p className="mt-1 text-sm text-zinc-500">
                  Första dagen kan sakna förändringsdata eftersom den används som baseline.
                </p>

              </div>

              <div className="mt-4 overflow-hidden rounded-2xl border border-zinc-800">

                <div className="overflow-x-auto">

                  <table className="min-w-full text-sm">

                    <thead className="bg-zinc-900 text-left text-xs uppercase tracking-wider text-zinc-500">

                      <tr>

                        <th className="px-4 py-3">
                          Datum
                        </th>

                        <th className="px-4 py-3 text-right">
                          Posts
                        </th>

                        <th className="px-4 py-3 text-right">
                          Views
                        </th>

                        <th className="px-4 py-3 text-right">
                          Likes
                        </th>

                        <th className="px-4 py-3 text-right">
                          Comments
                        </th>

                        <th className="px-4 py-3 text-right">
                          Shares
                        </th>

                        <th className="px-4 py-3 text-right">
                          Reach
                        </th>

                        <th className="px-4 py-3 text-right">
                          Saves
                        </th>

                      </tr>

                    </thead>

                    <tbody className="divide-y divide-zinc-800 bg-zinc-950">

                      {daily.length ===
                      0 ? (
                        <tr>
                          <td
                            colSpan={
                              8
                            }
                            className="px-4 py-10 text-center text-zinc-500"
                          >
                            Ingen daglig statistik ännu.
                          </td>
                        </tr>
                      ) : (
                        [...daily]
                          .reverse()
                          .map(
                            (
                              row
                            ) => (
                              <tr
                                key={
                                  row.date
                                }
                                className="text-zinc-300"
                              >

                                <td className="whitespace-nowrap px-4 py-3 font-medium text-white">
                                  {formatDate(
                                    row.date
                                  )}
                                </td>

                                <td className="px-4 py-3 text-right">
                                  {
                                    row.postsPublished
                                  }
                                </td>

                                <td className="px-4 py-3 text-right">
                                  {formatNumber(
                                    row.views
                                  )}
                                </td>

                                <td className="px-4 py-3 text-right">
                                  {formatNumber(
                                    row.likes
                                  )}
                                </td>

                                <td className="px-4 py-3 text-right">
                                  {formatNumber(
                                    row.comments
                                  )}
                                </td>

                                <td className="px-4 py-3 text-right">
                                  {formatNumber(
                                    row.shares
                                  )}
                                </td>

                                <td className="px-4 py-3 text-right">
                                  {formatNumber(
                                    row.reach
                                  )}
                                </td>

                                <td className="px-4 py-3 text-right">
                                  {formatNumber(
                                    row.saves
                                  )}
                                </td>

                              </tr>
                            )
                          )
                      )}

                    </tbody>

                  </table>

                </div>

              </div>

            </section>

          </>
        )}

      </div>

    </main>
  );
}

function FilterButton({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={
        onClick
      }
      className={`rounded-xl border px-4 py-2 text-sm font-medium transition ${
        active
          ? "border-white bg-white text-black"
          : "border-zinc-700 bg-zinc-900 text-zinc-400 hover:text-white"
      }`}
    >
      {label}
    </button>
  );
}

function StatCard({
  label,
  value,
}: {
  label: string;
  value:
    number | null | undefined;
}) {
  return (
    <div className="rounded-2xl border border-zinc-800 bg-zinc-900 p-5">

      <p className="text-sm text-zinc-500">
        {label}
      </p>

      <p className="mt-2 text-3xl font-bold">
        <AnimatedCompactNumber value={value} showPositiveSign />
      </p>

    </div>
  );
}

function TotalCard({
  label,
  value,
}: {
  label: string;
  value:
    number | null | undefined;
}) {
  return (
    <div className="rounded-2xl border border-zinc-800 bg-zinc-900 p-5">

      <p className="text-sm text-zinc-500">
        {label}
      </p>

      <p className="mt-2 text-3xl font-bold">
        <AnimatedCompactNumber value={value} />
      </p>

    </div>
  );
}

function AnimatedCompactNumber({
  value,
  showPositiveSign = false,
}: {
  value: number | null | undefined;
  showPositiveSign?: boolean;
}) {
  const [displayValue, setDisplayValue] = useState(value);
  const previousValue = useRef<number | null | undefined>(undefined);

  useEffect(() => {
    const previous = previousValue.current;
    previousValue.current = value;

    if (
      value === null ||
      value === undefined ||
      previous === null ||
      previous === undefined ||
      previous === value ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      setDisplayValue(value);
      return;
    }

    const startedAt = performance.now();
    const duration = 550;
    let animationFrame = 0;

    const animate = (timestamp: number) => {
      const progress = Math.min(1, (timestamp - startedAt) / duration);
      const easedProgress = 1 - Math.pow(1 - progress, 3);

      setDisplayValue(
        Math.round(previous + (value - previous) * easedProgress)
      );

      if (progress < 1) {
        animationFrame = window.requestAnimationFrame(animate);
      }
    };

    animationFrame = window.requestAnimationFrame(animate);

    return () => window.cancelAnimationFrame(animationFrame);
  }, [value]);

  const formattedValue = formatCompactNumber(displayValue);

  return showPositiveSign && typeof displayValue === "number" && displayValue > 0
    ? `+${formattedValue}`
    : formattedValue;
}
