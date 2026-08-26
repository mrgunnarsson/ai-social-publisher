import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

type SocialAccount = {
  id: string;
  influencer_id: string;
  platform: "instagram" | "facebook";
};

function getStockholmDate() {
  const parts =
    new Intl.DateTimeFormat(
      "sv-SE",
      {
        timeZone:
          "Europe/Stockholm",
        year:
          "numeric",
        month:
          "2-digit",
        day:
          "2-digit",
      }
    ).formatToParts(
      new Date()
    );

  const getPart = (
    type: string
  ) =>
    parts.find(
      (part) =>
        part.type === type
    )?.value ?? "";

  return (
    `${getPart("year")}-` +
    `${getPart("month")}-` +
    `${getPart("day")}`
  );
}

function isSameStockholmDate(
  value: string | null,
  date: string
) {
  if (!value) {
    return false;
  }

  const parts =
    new Intl.DateTimeFormat(
      "sv-SE",
      {
        timeZone:
          "Europe/Stockholm",
        year:
          "numeric",
        month:
          "2-digit",
        day:
          "2-digit",
      }
    ).formatToParts(
      new Date(value)
    );

  const getPart = (
    type: string
  ) =>
    parts.find(
      (part) =>
        part.type === type
    )?.value ?? "";

  const valueDate =
    `${getPart("year")}-` +
    `${getPart("month")}-` +
    `${getPart("day")}`;

  return valueDate === date;
}

async function createInstagramSnapshot(
  account: SocialAccount,
  statDate: string
) {
  /*
    Legacy Instagram-poster.
  */
  const {
    data:
      legacyPosts,
    error:
      legacyError,
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
      "social_account_id",
      account.id
    )
    .eq(
      "platform",
      "instagram"
    )
    .eq(
      "status",
      "published"
    );

  if (legacyError) {
    throw new Error(
      legacyError.message
    );
  }

  /*
    Multi-platform-poster där
    Instagram-destinationen är
    publicerad.
  */
  const {
    data:
      destinations,
    error:
      destinationsError,
  } = await supabase
    .from(
      "post_destinations"
    )
    .select(
      `
      post_id,
      published_at
      `
    )
    .eq(
      "social_account_id",
      account.id
    )
    .eq(
      "platform",
      "instagram"
    )
    .eq(
      "status",
      "published"
    );

  if (
    destinationsError
  ) {
    throw new Error(
      destinationsError.message
    );
  }

  const postIds =
    [
      ...new Set(
        (
          destinations ??
          []
        ).map(
          (item) =>
            item.post_id
        )
      ),
    ];

  let multiPosts:
    {
      id: string;
      likes: number;
      comments: number;
      saves: number;
      shares: number;
      reach: number;
      views: number;
    }[] =
    [];

  if (
    postIds.length >
    0
  ) {
    const {
      data,
      error,
    } = await supabase
      .from("posts")
      .select(
        `
        id,
        likes,
        comments,
        saves,
        shares,
        reach,
        views
        `
      )
      .in(
        "id",
        postIds
      );

    if (error) {
      throw new Error(
        error.message
      );
    }

    multiPosts =
      data ?? [];
  }

  const allPosts =
    [
      ...(legacyPosts ??
        []),
      ...multiPosts,
    ];

  const uniquePosts =
    Array.from(
      new Map(
        allPosts.map(
          (post) => [
            post.id,
            post,
          ]
        )
      ).values()
    );

  const destinationPublishedToday =
    (
      destinations ??
      []
    ).filter(
      (item) =>
        isSameStockholmDate(
          item.published_at,
          statDate
        )
    ).length;

  const legacyPublishedToday =
    (
      legacyPosts ??
      []
    ).filter(
      (post) =>
        isSameStockholmDate(
          post.published_at,
          statDate
        )
    ).length;

  const totals =
    uniquePosts.reduce(
      (
        sum,
        post
      ) => ({
        likes:
          sum.likes +
          (post.likes ??
            0),

        comments:
          sum.comments +
          (post.comments ??
            0),

        saves:
          sum.saves +
          (post.saves ??
            0),

        shares:
          sum.shares +
          (post.shares ??
            0),

        reach:
          sum.reach +
          (post.reach ??
            0),

        views:
          sum.views +
          (post.views ??
            0),
      }),
      {
        likes: 0,
        comments: 0,
        saves: 0,
        shares: 0,
        reach: 0,
        views: 0,
      }
    );

  return {
    influencer_id:
      account.influencer_id,

    social_account_id:
      account.id,

    platform:
      "instagram",

    stat_date:
      statDate,

    followers:
      null,

    reach:
      totals.reach,

    impressions:
      null,

    views:
      totals.views,

    likes:
      totals.likes,

    comments:
      totals.comments,

    shares:
      totals.shares,

    saves:
      totals.saves,

    posts_published:
      destinationPublishedToday +
      legacyPublishedToday,

    updated_at:
      new Date()
        .toISOString(),
  };
}

async function createFacebookSnapshot(
  account: SocialAccount,
  statDate: string
) {
  const {
    data:
      destinations,
    error,
  } = await supabase
    .from(
      "post_destinations"
    )
    .select(
      `
      id,
      published_at,
      reactions,
      comments,
      shares,
      views
      `
    )
    .eq(
      "social_account_id",
      account.id
    )
    .eq(
      "platform",
      "facebook"
    )
    .eq(
      "status",
      "published"
    );

  if (error) {
    throw new Error(
      error.message
    );
  }

  const rows =
    destinations ??
    [];

  const totals =
    rows.reduce(
      (
        sum,
        item
      ) => ({
        likes:
          sum.likes +
          (item.reactions ??
            0),

        comments:
          sum.comments +
          (item.comments ??
            0),

        shares:
          sum.shares +
          (item.shares ??
            0),

        views:
          sum.views +
          (item.views ??
            0),
      }),
      {
        likes: 0,
        comments: 0,
        shares: 0,
        views: 0,
      }
    );

  const postsPublished =
    rows.filter(
      (item) =>
        isSameStockholmDate(
          item.published_at,
          statDate
        )
    ).length;

  return {
    influencer_id:
      account.influencer_id,

    social_account_id:
      account.id,

    platform:
      "facebook",

    stat_date:
      statDate,

    followers:
      null,

    reach:
      null,

    impressions:
      null,

    views:
      totals.views,

    likes:
      totals.likes,

    comments:
      totals.comments,

    shares:
      totals.shares,

    saves:
      null,

    posts_published:
      postsPublished,

    updated_at:
      new Date()
        .toISOString(),
  };
}

export async function POST(
  request: Request
) {
  try {
    const authHeader =
      request.headers.get(
        "authorization"
      );

    const expectedSecret =
      process.env.CRON_SECRET;

    if (
      !expectedSecret
    ) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "CRON_SECRET is missing.",
        },
        {
          status: 500,
        }
      );
    }

    if (
      authHeader !==
      `Bearer ${expectedSecret}`
    ) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "Unauthorized.",
        },
        {
          status: 401,
        }
      );
    }

    let influencerId:
      string | null = null;
    let platform:
      "instagram" |
      "facebook" |
      "all" = "all";

    const rawBody =
      await request.text();

    if (rawBody.trim()) {
      let body:
        unknown;

      try {
        body =
          JSON.parse(rawBody);
      } catch {
        return NextResponse.json(
          {
            ok: false,
            error:
              "Invalid JSON body.",
          },
          { status: 400 }
        );
      }

      if (
        typeof body !==
          "object" ||
        body === null ||
        Array.isArray(body)
      ) {
        return NextResponse.json(
          {
            ok: false,
            error:
              "Request body must be a JSON object.",
          },
          { status: 400 }
        );
      }

      const requestBody =
        body as {
          influencerId?: unknown;
          platform?: unknown;
        };

      if (
        requestBody.influencerId !==
        undefined
      ) {
        if (
          typeof requestBody.influencerId !==
            "string" ||
          !requestBody.influencerId.trim()
        ) {
          return NextResponse.json(
            {
              ok: false,
              error:
                "influencerId must be a non-empty string.",
            },
            { status: 400 }
          );
        }

        influencerId =
          requestBody.influencerId.trim();
      }

      if (
        requestBody.platform !==
        undefined
      ) {
        if (
          requestBody.platform !==
            "instagram" &&
          requestBody.platform !==
            "facebook" &&
          requestBody.platform !==
            "all"
        ) {
          return NextResponse.json(
            {
              ok: false,
              error:
                'platform must be "instagram", "facebook", or "all".',
            },
            { status: 400 }
          );
        }

        platform =
          requestBody.platform;
      }
    }

    const statDate =
      getStockholmDate();

    let accountsQuery =
      supabase
        .from(
          "social_accounts"
        )
        .select(
          `
          id,
          influencer_id,
          platform
          `
        )
        .in(
          "platform",
          [
            "instagram",
            "facebook",
          ]
        );

    if (influencerId) {
      accountsQuery =
        accountsQuery.eq(
          "influencer_id",
          influencerId
        );
    }

    if (
      platform !== "all"
    ) {
      accountsQuery =
        accountsQuery.eq(
          "platform",
          platform
        );
    }

    const {
      data:
        accounts,
      error:
        accountsError,
    } = await accountsQuery;

    if (
      accountsError
    ) {
      throw new Error(
        accountsError.message
      );
    }

    const results =
      [];

    for (
      const account of
        (
          accounts ??
          []
        ) as SocialAccount[]
    ) {
      try {
        const snapshot =
          account.platform ===
          "instagram"
            ? await createInstagramSnapshot(
                account,
                statDate
              )
            : await createFacebookSnapshot(
                account,
                statDate
              );

        const {
          error:
            upsertError,
        } = await supabase
          .from(
            "social_daily_stats"
          )
          .upsert(
            snapshot,
            {
              onConflict:
                "social_account_id,stat_date",
            }
          );

        if (
          upsertError
        ) {
          throw new Error(
            upsertError.message
          );
        }

        results.push({
          ok:
            true,

          socialAccountId:
            account.id,

          platform:
            account.platform,
        });
      } catch (error) {
        results.push({
          ok:
            false,

          socialAccountId:
            account.id,

          platform:
            account.platform,

          error:
            error instanceof Error
              ? error.message
              : "Unknown error",
        });
      }
    }

    return NextResponse.json({
      ok:
        true,

      statDate,

      filters: {
        influencerId:
          influencerId ??
          "all",
        platform,
      },

      processed:
        results.length,

      succeeded:
        results.filter(
          (item) =>
            item.ok
        ).length,

      failed:
        results.filter(
          (item) =>
            !item.ok
        ).length,

      results,
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
