import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

type Post = {
  id: string;
  published_at: string;
  likes: number | null;
  comments: number | null;
  saves: number | null;
  shares: number | null;
  reach: number | null;
  views: number | null;
};

type RawSlot = {
  weekday: number;
  hour: number;
  scores: number[];
};

type RankedSlot = {
  weekday: number;
  hour: number;
  sampleSize: number;
  averageScore: number;
  medianScore: number;
  rankingScore: number;
  confidence: "high" | "medium" | "low";
};

function calculatePostScore(post: Post) {
  const likes = Number(post.likes ?? 0);
  const comments = Number(post.comments ?? 0);
  const saves = Number(post.saves ?? 0);
  const shares = Number(post.shares ?? 0);
  const reach = Number(post.reach ?? 0);

  const engagement =
    likes +
    comments * 3 +
    saves * 4 +
    shares * 4;

  /*
    Om reach finns använder vi en hybrid:

    - 70 % engagement rate
    - 30 % raw engagement

    Då belönar vi inte bara stora poster.
  */

  if (reach > 0) {
    const engagementRate =
      engagement / reach;

    return (
      engagementRate * 1000 * 0.7 +
      engagement * 0.3
    );
  }

  return engagement;
}

function median(values: number[]) {
  if (values.length === 0) {
    return 0;
  }

  const sorted = [...values].sort(
    (a, b) => a - b
  );

  const middle =
    Math.floor(sorted.length / 2);

  if (sorted.length % 2 === 0) {
    return (
      (sorted[middle - 1] +
        sorted[middle]) /
      2
    );
  }

  return sorted[middle];
}

function trimmedAverage(
  values: number[]
) {
  if (values.length === 0) {
    return 0;
  }

  if (values.length < 4) {
    return (
      values.reduce(
        (sum, value) =>
          sum + value,
        0
      ) / values.length
    );
  }

  const sorted = [...values].sort(
    (a, b) => a - b
  );

  /*
    Vid minst fyra datapunkter tar vi
    bort högsta och lägsta värdet.

    Det gör att ett viralt inlägg inte
    kan dominera hela tids-slotten.
  */

  const trimmed =
    sorted.slice(1, -1);

  return (
    trimmed.reduce(
      (sum, value) =>
        sum + value,
      0
    ) / trimmed.length
  );
}

function getConfidence(
  sampleSize: number
): "high" | "medium" | "low" {
  if (sampleSize >= 5) {
    return "high";
  }

  if (sampleSize >= 3) {
    return "medium";
  }

  return "low";
}

export async function POST(
  request: Request
) {
  try {
    const body =
      await request.json();

    const influencerId =
      body.influencerId;

    if (!influencerId) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "influencerId is required.",
        },
        { status: 400 }
      );
    }

    const {
      data: posts,
      error,
    } = await supabase
      .from("posts")
      .select(
        `
        id,
        published_at,
        likes,
        comments,
        saves,
        shares,
        reach,
        views
        `
      )
      .eq(
        "influencer_id",
        influencerId
      )
      .eq(
        "platform",
        "instagram"
      )
      .eq(
        "status",
        "published"
      )
      .not(
        "published_at",
        "is",
        null
      );

    if (error) {
      return NextResponse.json(
        {
          ok: false,
          step:
            "load_posts",
          error:
            error.message,
        },
        { status: 500 }
      );
    }

    const usablePosts =
      (posts ?? []).filter(
        (post) => {
          const engagement =
            Number(
              post.likes ?? 0
            ) +
            Number(
              post.comments ?? 0
            ) +
            Number(
              post.saves ?? 0
            ) +
            Number(
              post.shares ?? 0
            );

          return engagement > 0;
        }
      ) as Post[];

    if (
      usablePosts.length === 0
    ) {
      return NextResponse.json({
        ok: true,
        postsUsed: 0,
        reliableRecommendations:
          [],
        potentialRecommendations:
          [],
        message:
          "Not enough historical engagement data yet.",
      });
    }

    const slotMap =
      new Map<
        string,
        RawSlot
      >();

    const weekdayMap: Record<
      string,
      number
    > = {
      mån: 1,
      tis: 2,
      ons: 3,
      tor: 4,
      fre: 5,
      lör: 6,
      sön: 0,
    };

    for (
      const post of
      usablePosts
    ) {
      const publishedAt =
        new Date(
          post.published_at
        );

      const parts =
        new Intl.DateTimeFormat(
          "sv-SE",
          {
            timeZone:
              "Europe/Stockholm",
            weekday:
              "short",
            hour:
              "2-digit",
            hour12:
              false,
          }
        ).formatToParts(
          publishedAt
        );

      const weekdayText =
        parts
          .find(
            (part) =>
              part.type ===
              "weekday"
          )
          ?.value.toLowerCase()
          .replace(".", "") ??
        "";

      const hourText =
        parts.find(
          (part) =>
            part.type ===
            "hour"
        )?.value ?? "0";

      const weekday =
        weekdayMap[
          weekdayText
        ];

      const hour =
        Number(hourText);

      if (
        weekday === undefined ||
        Number.isNaN(hour)
      ) {
        continue;
      }

      const score =
        calculatePostScore(
          post
        );

      const key =
        `${weekday}-${hour}`;

      const slot =
        slotMap.get(key) ?? {
          weekday,
          hour,
          scores: [],
        };

      slot.scores.push(score);

      slotMap.set(
        key,
        slot
      );
    }

    const rankedSlots: RankedSlot[] =
      Array.from(
        slotMap.values()
      ).map((slot) => {
        const sampleSize =
          slot.scores.length;

        const averageScore =
          trimmedAverage(
            slot.scores
          );

        const medianScore =
          median(
            slot.scores
          );

        /*
          Vi använder både median
          och trimmed average.

          Median gör resultatet mindre
          känsligt för extrema poster.
        */

        const baseScore =
          averageScore * 0.6 +
          medianScore * 0.4;

        /*
          Confidence-vikt.

          1 post får en tydlig penalty.
          3+ börjar bli användbart.
          5+ räknas som starkt underlag.
        */

        let confidenceMultiplier =
          0.55;

        if (
          sampleSize >= 5
        ) {
          confidenceMultiplier =
            1;
        } else if (
          sampleSize >= 3
        ) {
          confidenceMultiplier =
            0.9;
        } else if (
          sampleSize === 2
        ) {
          confidenceMultiplier =
            0.72;
        }

        const rankingScore =
          baseScore *
          confidenceMultiplier;

        return {
          weekday:
            slot.weekday,
          hour:
            slot.hour,
          sampleSize,
          averageScore,
          medianScore,
          rankingScore,
          confidence:
            getConfidence(
              sampleSize
            ),
        };
      });

    const weekdayNames = [
      "Söndag",
      "Måndag",
      "Tisdag",
      "Onsdag",
      "Torsdag",
      "Fredag",
      "Lördag",
    ];

    const formatSlot = (
      slot: RankedSlot,
      rank: number
    ) => ({
      rank,

      weekday:
        slot.weekday,

      weekdayName:
        weekdayNames[
          slot.weekday
        ],

      hour:
        slot.hour,

      time:
        `${String(
          slot.hour
        ).padStart(
          2,
          "0"
        )}:00`,

      averageScore:
        Number(
          slot.averageScore.toFixed(
            2
          )
        ),

      medianScore:
        Number(
          slot.medianScore.toFixed(
            2
          )
        ),

      rankingScore:
        Number(
          slot.rankingScore.toFixed(
            2
          )
        ),

      sampleSize:
        slot.sampleSize,

      confidence:
        slot.confidence,
    });

    /*
      Reliable:
      minst 3 poster i slotten.
    */

    const reliable =
      rankedSlots
        .filter(
          (slot) =>
            slot.sampleSize >=
            3
        )
        .sort(
          (a, b) =>
            b.rankingScore -
            a.rankingScore
        )
        .slice(0, 5)
        .map(
          (slot, index) =>
            formatSlot(
              slot,
              index + 1
            )
        );

    /*
      Potential:
      endast 1–2 poster,
      men ändå stark historik.
    */

    const potential =
      rankedSlots
        .filter(
          (slot) =>
            slot.sampleSize <
            3
        )
        .sort(
          (a, b) =>
            b.rankingScore -
            a.rankingScore
        )
        .slice(0, 5)
        .map(
          (slot, index) =>
            formatSlot(
              slot,
              index + 1
            )
        );

    return NextResponse.json({
      ok: true,

      postsUsed:
        usablePosts.length,

      reliableRecommendations:
        reliable,

      potentialRecommendations:
        potential,

      bestReliableTime:
        reliable[0] ??
        null,

      bestPotentialTime:
        potential[0] ??
        null,

      scoring: {
        like:
          1,
        comment:
          3,
        save:
          4,
        share:
          4,

        reachNormalization:
          true,

        minimumReliableSamples:
          3,
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,

        error:
          error instanceof Error
            ? error.message
            : "Unknown error",
      },
      { status: 500 }
    );
  }
}