import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

type SocialAccount = {
  id: string;
  influencer_id: string;
  access_token: string;
  username: string;
};

type Post = {
  id: string;
  external_post_id: string;
  published_at: string;
  last_synced_at: string | null;
  sync_count: number | null;
};

function shouldSyncPost(
  publishedAt: string,
  lastSyncedAt: string | null,
  syncCount: number
) {
  const now = Date.now();
  const published =
    new Date(publishedAt).getTime();

  const hour =
    60 * 60 * 1000;

  const ageMs =
    now - published;

  /*
    Första sync:
    vänta minst 1 timme efter publicering.
  */
  if (!lastSyncedAt) {
    return ageMs >= hour;
  }

  const lastSync =
    new Date(lastSyncedAt).getTime();

  const sinceLastSync =
    now - lastSync;

  /*
    Därefter:
    sync #1 -> vänta 5 timmar
    sync #2 -> vänta 18 timmar
    sync #3 -> vänta 48 timmar
    senare -> en gång per vecka

    Det ger ungefär:
    +1h
    +6h
    +24h
    +72h
    därefter veckovis.
  */

  if (syncCount <= 1) {
    return (
      sinceLastSync >=
      5 * hour
    );
  }

  if (syncCount === 2) {
    return (
      sinceLastSync >=
      18 * hour
    );
  }

  if (syncCount === 3) {
    return (
      sinceLastSync >=
      48 * hour
    );
  }

  return (
    sinceLastSync >=
    7 * 24 * hour
  );
}

async function syncAccount(
  socialAccount: SocialAccount
) {
  const influencerId =
    socialAccount.influencer_id;

  const accessToken =
    socialAccount.access_token;

  const {
    data: posts,
    error: postsError,
  } = await supabase
    .from("posts")
    .select(
      `
      id,
      external_post_id,
      published_at,
      last_synced_at,
      sync_count
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
      "external_post_id",
      "is",
      null
    )
    .not(
      "published_at",
      "is",
      null
    )
    .order(
      "published_at",
      {
        ascending: false,
      }
    );

  if (postsError) {
    return {
      username:
        socialAccount.username,

      influencerId,

      ok: false,

      step:
        "load_posts",

      error:
        postsError.message,
    };
  }

  const duePosts =
    ((posts ?? []) as Post[])
      .filter((post) =>
        shouldSyncPost(
          post.published_at,
          post.last_synced_at,
          post.sync_count ?? 0
        )
      );

  const results = [];

  for (const post of duePosts) {
    const mediaId =
      post.external_post_id;

    try {
      /*
        Grunddata:
        likes + comments
      */

      const mediaResponse =
        await fetch(
          `https://graph.instagram.com/${mediaId}` +
            `?fields=id,like_count,comments_count` +
            `&access_token=${accessToken}`,
          {
            cache: "no-store",
          }
        );

      const mediaData =
        await mediaResponse.json();

      if (!mediaResponse.ok) {
        results.push({
          postId:
            post.id,

          mediaId,

          ok:
            false,

          step:
            "media",

          error:
            mediaData,
        });

        continue;
      }

      const likes =
        Number(
          mediaData.like_count ??
            0
        );

      const comments =
        Number(
          mediaData.comments_count ??
            0
        );

      /*
        Insights
      */

      const insightsResponse =
        await fetch(
          `https://graph.instagram.com/${mediaId}/insights` +
            `?metric=reach,saved,shares,views` +
            `&access_token=${accessToken}`,
          {
            cache: "no-store",
          }
        );

      const insightsData =
        await insightsResponse.json();

      let reach = 0;
      let saves = 0;
      let shares = 0;
      let views = 0;

      let insightsError:
        unknown = null;

      if (
        insightsResponse.ok &&
        Array.isArray(
          insightsData.data
        )
      ) {
        for (
          const metric of
          insightsData.data
        ) {
          const value =
            metric.values?.[0]
              ?.value ??
            metric.value ??
            0;

          switch (
            metric.name
          ) {
            case "reach":
              reach =
                Number(value);
              break;

            case "saved":
              saves =
                Number(value);
              break;

            case "shares":
              shares =
                Number(value);
              break;

            case "views":
              views =
                Number(value);
              break;
          }
        }
      } else {
        insightsError =
          insightsData;
      }

      const syncedAt =
        new Date()
          .toISOString();

      const nextSyncCount =
        (post.sync_count ??
          0) + 1;

      const {
        error:
          updateError,
      } = await supabase
        .from("posts")
        .update({
          likes,
          comments,
          saves,
          shares,
          reach,
          views,

          last_synced_at:
            syncedAt,

          sync_count:
            nextSyncCount,
        })
        .eq(
          "id",
          post.id
        );

      if (updateError) {
        results.push({
          postId:
            post.id,

          mediaId,

          ok:
            false,

          step:
            "update_database",

          error:
            updateError.message,
        });

        continue;
      }

      results.push({
        postId:
          post.id,

        mediaId,

        ok:
          true,

        likes,
        comments,
        saves,
        shares,
        reach,
        views,

        syncCount:
          nextSyncCount,

        syncedAt,

        insightsError,
      });
    } catch (error) {
      results.push({
        postId:
          post.id,

        mediaId,

        ok:
          false,

        error:
          error instanceof Error
            ? error.message
            : "Unknown error",
      });
    }
  }

  return {
    username:
      socialAccount.username,

    influencerId,

    ok:
      true,

    due:
      duePosts.length,

    processed:
      results.length,

    results,
  };
}

export async function POST(
  request: Request
) {
  try {
    /*
      Skydda endpointen med samma
      CRON_SECRET som run-scheduled.
    */

    const authHeader =
      request.headers.get(
        "authorization"
      );

    const expectedSecret =
      process.env.CRON_SECRET;

    if (!expectedSecret) {
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

    /*
      influencerId är frivilligt.

      Om det skickas:
      synca bara den influencern.

      Om det saknas:
      synca samtliga Instagramkonton.
    */

    let influencerId:
      string | null = null;

    try {
      const body =
        await request.json();

      influencerId =
        body?.influencerId ??
        null;
    } catch {
      /*
        Tom body är helt OK
        när Cron kör jobbet.
      */
    }

    let query =
      supabase
        .from(
          "social_accounts"
        )
        .select(
          `
          id,
          influencer_id,
          access_token,
          username
          `
        )
        .eq(
          "platform",
          "instagram"
        );

    if (influencerId) {
      query =
        query.eq(
          "influencer_id",
          influencerId
        );
    }

    const {
      data:
        socialAccounts,

      error:
        accountsError,
    } =
      await query;

    if (accountsError) {
      return NextResponse.json(
        {
          ok: false,

          step:
            "load_accounts",

          error:
            accountsError.message,
        },
        {
          status: 500,
        }
      );
    }

    const accounts =
      (socialAccounts ??
        []) as SocialAccount[];

    if (
      accounts.length === 0
    ) {
      return NextResponse.json(
        {
          ok: false,

          error:
            influencerId
              ? "Instagram account not found."
              : "No Instagram accounts found.",
        },
        {
          status: 404,
        }
      );
    }

    const accountResults =
      [];

    for (
      const account of
      accounts
    ) {
      const result =
        await syncAccount(
          account
        );

      accountResults.push(
        result
      );
    }

    const totalDue =
      accountResults.reduce(
        (
          sum,
          account:
            any
        ) =>
          sum +
          Number(
            account.due ??
              0
          ),
        0
      );

    const totalProcessed =
      accountResults.reduce(
        (
          sum,
          account:
            any
        ) =>
          sum +
          Number(
            account.processed ??
              0
          ),
        0
      );

    return NextResponse.json({
      ok: true,

      accounts:
        accountResults.length,

      due:
        totalDue,

      processed:
        totalProcessed,

      results:
        accountResults,
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
      {
        status: 500,
      }
    );
  }
}