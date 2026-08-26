import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

type Platform =
  | "instagram"
  | "facebook";

type DailyStatRow = {
  stat_date: string;

  influencer_id: string;

  social_account_id: string;

  platform: Platform;

  followers: number | null;

  reach: number | null;

  impressions: number | null;

  views: number | null;

  likes: number | null;

  comments: number | null;

  shares: number | null;

  saves: number | null;

  posts_published: number;
};

type MetricName =
  | "followers"
  | "reach"
  | "impressions"
  | "views"
  | "likes"
  | "comments"
  | "shares"
  | "saves";

const cumulativeMetrics:
  MetricName[] = [
    "followers",
    "reach",
    "impressions",
    "views",
    "likes",
    "comments",
    "shares",
    "saves",
  ];

function subtractMetric(
  current: number | null,
  previous: number | null
) {
  /*
    Om Meta inte erbjuder värdet
    vill vi behålla null.

    0 ska alltså inte betyda
    "metric saknas".
  */
  if (
    current === null ||
    previous === null
  ) {
    return null;
  }

  return (
    current -
    previous
  );
}

function addNullable(
  current: number | null,
  value: number | null
) {
  if (
    value === null
  ) {
    return current;
  }

  if (
    current === null
  ) {
    return value;
  }

  return (
    current +
    value
  );
}

export async function GET(
  request: Request
) {
  try {
    const url =
      new URL(
        request.url
      );

    const influencerId =
      url.searchParams.get(
        "influencerId"
      ) ?? "all";

    const platformParam =
      url.searchParams.get(
        "platform"
      ) ?? "all";

    const daysParam =
      Number(
        url.searchParams.get(
          "days"
        ) ?? 30
      );

    const days =
      Math.min(
        365,
        Math.max(
          2,
          Number.isFinite(
            daysParam
          )
            ? daysParam
            : 30
        )
      );

    if (
      ![
        "all",
        "instagram",
        "facebook",
      ].includes(
        platformParam
      )
    ) {
      return NextResponse.json(
        {
          ok: false,

          error:
            "Invalid platform.",
        },
        {
          status: 400,
        }
      );
    }

    /*
      Vi hämtar en extra dag.

      För att kunna räkna ut
      exempelvis statistik för
      26 augusti behöver vi även
      snapshoten från 25 augusti.
    */
    const startDate =
      new Date();

    startDate.setUTCDate(
      startDate.getUTCDate() -
        days
    );

    const startDateString =
      startDate
        .toISOString()
        .slice(
          0,
          10
        );

    let query =
      supabase
        .from(
          "social_daily_stats"
        )
        .select(
          `
          stat_date,
          influencer_id,
          social_account_id,
          platform,
          followers,
          reach,
          impressions,
          views,
          likes,
          comments,
          shares,
          saves,
          posts_published
          `
        )
        .gte(
          "stat_date",
          startDateString
        )
        .order(
          "stat_date",
          {
            ascending:
              true,
          }
        );

    if (
      influencerId !==
      "all"
    ) {
      query =
        query.eq(
          "influencer_id",
          influencerId
        );
    }

    if (
      platformParam !==
      "all"
    ) {
      query =
        query.eq(
          "platform",
          platformParam
        );
    }

    const {
      data,
      error,
    } =
      await query;

    if (error) {
      return NextResponse.json(
        {
          ok: false,

          step:
            "load_daily_stats",

          error:
            error.message,
        },
        {
          status: 500,
        }
      );
    }

    const rows =
      (
        data ??
        []
      ) as DailyStatRow[];

    /*
      Gruppera först per socialt
      konto.

      Det är viktigt eftersom varje
      konto måste jämföras med sin
      egen föregående snapshot.
    */
    const rowsByAccount =
      new Map<
        string,
        DailyStatRow[]
      >();

    for (
      const row of rows
    ) {
      const existing =
        rowsByAccount.get(
          row.social_account_id
        ) ?? [];

      existing.push(
        row
      );

      rowsByAccount.set(
        row.social_account_id,
        existing
      );
    }

    /*
      Dagliga deltas per konto.
    */
    const accountDeltas:
      Array<{
        stat_date: string;

        influencer_id: string;

        social_account_id: string;

        platform: Platform;

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

        posts_published:
          number;

        has_baseline:
          boolean;
      }> = [];

    for (
      const accountRows of
        rowsByAccount.values()
    ) {
      accountRows.sort(
        (
          a,
          b
        ) =>
          a.stat_date.localeCompare(
            b.stat_date
          )
      );

      for (
        let index = 0;
        index <
        accountRows.length;
        index++
      ) {
        const current =
          accountRows[
            index
          ];

        const previous =
          index > 0
            ? accountRows[
                index - 1
              ]
            : null;

        const delta = {
          stat_date:
            current.stat_date,

          influencer_id:
            current.influencer_id,

          social_account_id:
            current.social_account_id,

          platform:
            current.platform,

          followers:
            previous
              ? subtractMetric(
                  current.followers,
                  previous.followers
                )
              : null,

          reach:
            previous
              ? subtractMetric(
                  current.reach,
                  previous.reach
                )
              : null,

          impressions:
            previous
              ? subtractMetric(
                  current.impressions,
                  previous.impressions
                )
              : null,

          views:
            previous
              ? subtractMetric(
                  current.views,
                  previous.views
                )
              : null,

          likes:
            previous
              ? subtractMetric(
                  current.likes,
                  previous.likes
                )
              : null,

          comments:
            previous
              ? subtractMetric(
                  current.comments,
                  previous.comments
                )
              : null,

          shares:
            previous
              ? subtractMetric(
                  current.shares,
                  previous.shares
                )
              : null,

          saves:
            previous
              ? subtractMetric(
                  current.saves,
                  previous.saves
                )
              : null,

          /*
            Detta är redan ett
            dagsvärde och ska inte
            subtraheras.
          */
          posts_published:
            current.posts_published,

          has_baseline:
            Boolean(
              previous
            ),
        };

        accountDeltas.push(
          delta
        );
      }
    }

    /*
      Summera alla matchande konton
      per datum.

      Här uppstår vår "All
      influencers"-vy automatiskt.
    */
    const dailyMap =
      new Map<
        string,
        {
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
        }
      >();

    for (
      const row of
        accountDeltas
    ) {
      let day =
        dailyMap.get(
          row.stat_date
        );

      if (!day) {
        day = {
          date:
            row.stat_date,

          followers:
            null,

          reach:
            null,

          impressions:
            null,

          views:
            null,

          likes:
            null,

          comments:
            null,

          shares:
            null,

          saves:
            null,

          postsPublished:
            0,

          accounts:
            0,

          accountsWithBaseline:
            0,
        };

        dailyMap.set(
          row.stat_date,
          day
        );
      }

      day.accounts +=
        1;

      if (
        row.has_baseline
      ) {
        day.accountsWithBaseline +=
          1;
      }

      day.postsPublished +=
        row.posts_published;

      for (
        const metric of
          cumulativeMetrics
      ) {
        day[
          metric
        ] =
          addNullable(
            day[
              metric
            ],
            row[
              metric
            ]
          );
      }
    }

    /*
      Ta bort den extra första
      baseline-dagen.

      Returnera max antal dagar
      användaren efterfrågade.
    */
    const daily =
      Array.from(
        dailyMap.values()
      )
        .sort(
          (
            a,
            b
          ) =>
            a.date.localeCompare(
              b.date
            )
        )
        .slice(
          -days
        );

    /*
      Senaste snapshots används för
      "Current totals".

      Det är INTE samma sak som
      dagens förändring.
    */
    const latestByAccount =
      new Map<
        string,
        DailyStatRow
      >();

    for (
      const row of rows
    ) {
      const previous =
        latestByAccount.get(
          row.social_account_id
        );

      if (
        !previous ||
        row.stat_date >
          previous.stat_date
      ) {
        latestByAccount.set(
          row.social_account_id,
          row
        );
      }
    }

    const currentTotals = {
      followers:
        null as
          number | null,

      reach:
        null as
          number | null,

      impressions:
        null as
          number | null,

      views:
        null as
          number | null,

      likes:
        null as
          number | null,

      comments:
        null as
          number | null,

      shares:
        null as
          number | null,

      saves:
        null as
          number | null,
    };

    for (
      const latest of
        latestByAccount.values()
    ) {
      for (
        const metric of
          cumulativeMetrics
      ) {
        currentTotals[
          metric
        ] =
          addNullable(
            currentTotals[
              metric
            ],
            latest[
              metric
            ]
          );
      }
    }

    /*
      Dagens förändring =
      senaste dagen i daily.
    */
    const today =
      daily.length > 0
        ? daily[
            daily.length -
              1
          ]
        : null;

    /*
      Lista influencers till
      dropdownen i frontend.
    */
    const {
      data:
        influencers,
      error:
        influencersError,
    } = await supabase
      .from(
        "influencers"
      )
      .select(
        `
        id,
        name
        `
      )
      .order(
        "name",
        {
          ascending:
            true,
        }
      );

    if (
      influencersError
    ) {
      return NextResponse.json(
        {
          ok: false,

          step:
            "load_influencers",

          error:
            influencersError.message,
        },
        {
          status: 500,
        }
      );
    }

    return NextResponse.json({
      ok:
        true,

      filters: {
        influencerId,

        platform:
          platformParam,

        days,
      },

      currentTotals,

      today,

      daily,

      influencers:
        influencers ??
        [],

      meta: {
        snapshotRows:
          rows.length,

        accounts:
          latestByAccount.size,
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok:
          false,

        error:
          error instanceof Error
            ? error.message
            : "Unknown error",
      },
      {
        status:
          500,
      }
    );
  }
}