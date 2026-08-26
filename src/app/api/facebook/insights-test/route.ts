import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

type FacebookPost = {
  id: string;
  message?: string;
  created_time?: string;
  permalink_url?: string;

  reactions?: {
    summary?: {
      total_count?: number;
    };
  };

  comments?: {
    summary?: {
      total_count?: number;
    };
  };

  shares?: {
    count?: number;
  };
};

type InsightResult = {
  metric: string;
  ok: boolean;
  value?: unknown;
  error?: string;
};

type FacebookInsightPostResult = {
  id: string;
  message: string | null;
  createdAt: string | null;
  permalink: string | null;
  reactions: number;
  comments: number;
  shares: number;
  insights: InsightResult[];
  successfulMetrics: string[];

  failedMetrics: {
    metric: string;
    error?: string;
  }[];
};

const metricsToTest = [
  "post_impressions",
  "post_impressions_unique",
  "post_engaged_users",
  "post_clicks",
  "post_reactions_by_type_total",
  "post_video_views",
];

async function loadInsightMetric(
  postId: string,
  metric: string,
  accessToken: string
): Promise<InsightResult> {
  try {
    const insightsUrl =
      new URL(
        `https://graph.facebook.com/v26.0/${postId}/insights`
      );

    insightsUrl.searchParams.set(
      "metric",
      metric
    );

    insightsUrl.searchParams.set(
      "access_token",
      accessToken
    );

    const response =
      await fetch(
        insightsUrl.toString(),
        {
          cache:
            "no-store",
        }
      );

    const data =
      await response.json();

    if (!response.ok) {
      return {
        metric,
        ok:
          false,

        error:
          data?.error?.message ??
          "Metric request failed.",
      };
    }

    const insight =
      Array.isArray(
        data.data
      )
        ? data.data[0]
        : null;

    if (!insight) {
      return {
        metric,
        ok:
          false,

        error:
          "Meta returned no data for this metric.",
      };
    }

    /*
      Facebook Insights kan svara
      med antingen:

      value

      eller:

      values: [
        {
          value: ...
        }
      ]
    */
    const value =
      insight.value ??
      insight.values?.[
        insight.values.length -
          1
      ]?.value ??
      null;

    return {
      metric,
      ok:
        true,
      value,
    };
  } catch (error) {
    return {
      metric,
      ok:
        false,

      error:
        error instanceof Error
          ? error.message
          : "Unknown error",
    };
  }
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
      );

    if (!influencerId) {
      return NextResponse.json(
        {
          ok:
            false,

          error:
            "influencerId is required.",
        },
        {
          status:
            400,
        }
      );
    }

    /*
      1. Hämta Facebook-kontot.
    */
    const {
      data:
        account,

      error:
        accountError,
    } = await supabase
      .from(
        "social_accounts"
      )
      .select(
        `
        id,
        username,
        external_account_id,
        access_token
        `
      )
      .eq(
        "influencer_id",
        influencerId
      )
      .eq(
        "platform",
        "facebook"
      )
      .maybeSingle();

    if (accountError) {
      return NextResponse.json(
        {
          ok:
            false,

          step:
            "load_account",

          error:
            accountError.message,
        },
        {
          status:
            500,
        }
      );
    }

    if (
      !account ||
      !account.access_token ||
      !account.external_account_id
    ) {
      return NextResponse.json(
        {
          ok:
            false,

          step:
            "load_account",

          error:
            "Facebook account is not connected.",
        },
        {
          status:
            404,
        }
      );
    }

    /*
      2. Hämta senaste poster.

      Vi tar fem stycken i testet
      eftersom vi sedan gör flera
      Insights-anrop per post.
    */
    const postsUrl =
      new URL(
        `https://graph.facebook.com/v26.0/${account.external_account_id}/posts`
      );

    postsUrl.searchParams.set(
      "fields",
      [
        "id",
        "message",
        "created_time",
        "permalink_url",
        "reactions.limit(0).summary(true)",
        "comments.limit(0).summary(true)",
        "shares",
      ].join(",")
    );

    postsUrl.searchParams.set(
      "limit",
      "5"
    );

    postsUrl.searchParams.set(
      "access_token",
      account.access_token
    );

    const postsResponse =
      await fetch(
        postsUrl.toString(),
        {
          cache:
            "no-store",
        }
      );

    const postsData =
      await postsResponse.json();

    if (
      !postsResponse.ok
    ) {
      return NextResponse.json(
        {
          ok:
            false,

          step:
            "load_posts",

          error:
            postsData,
        },
        {
          status:
            postsResponse.status,
        }
      );
    }

    const posts:
      FacebookPost[] =
      Array.isArray(
        postsData.data
      )
        ? postsData.data
        : [];

    /*
      3. Testa varje Insights-metric
      separat.

      Det gör att en gammal/
      unsupported metric inte förstör
      resten av testet.
    */
    const results:
      FacebookInsightPostResult[] =
      [];

    for (
      const post of
        posts
    ) {
      const insights:
        InsightResult[] =
        [];

      for (
        const metric of
          metricsToTest
      ) {
        const result =
          await loadInsightMetric(
            post.id,
            metric,
            account.access_token
          );

        insights.push(
          result
        );
      }

      const successfulMetrics =
        insights.filter(
          (item) =>
            item.ok
        );

      const failedMetrics =
        insights.filter(
          (item) =>
            !item.ok
        );

      results.push({
        id:
          post.id,

        message:
          post.message ??
          null,

        createdAt:
          post.created_time ??
          null,

        permalink:
          post.permalink_url ??
          null,

        reactions:
          post.reactions
            ?.summary
            ?.total_count ??
          0,

        comments:
          post.comments
            ?.summary
            ?.total_count ??
          0,

        shares:
          post.shares
            ?.count ??
          0,

        insights,

        successfulMetrics:
          successfulMetrics.map(
            (item) =>
              item.metric
          ),

        failedMetrics:
          failedMetrics.map(
            (item) => ({
              metric:
                item.metric,

              error:
                item.error,
            })
          ),
      });
    }

    /*
      4. Sammanställ vilka metrics
      som fungerade någonstans.
    */
    const supportedMetrics =
      metricsToTest.filter(
        (metric) =>
          results.some(
            (post) =>
              post.insights.some(
                (
                  insight
                ) =>
                  insight.metric ===
                    metric &&
                  insight.ok
              )
          )
      );

    const unsupportedMetrics =
      metricsToTest.filter(
        (metric) =>
          !supportedMetrics.includes(
            metric
          )
      );

    return NextResponse.json({
      ok:
        true,

      page: {
        id:
          account.external_account_id,

        name:
          account.username,
      },

      count:
        results.length,

      metricTest: {
        tested:
          metricsToTest,

        supported:
          supportedMetrics,

        unsupported:
          unsupportedMetrics,
      },

      posts:
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