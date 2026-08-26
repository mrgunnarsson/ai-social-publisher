import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

type MetricName =
  | "likes"
  | "comments"
  | "saves"
  | "shares"
  | "reach"
  | "views";

type MetricUpdates =
  Partial<
    Record<
      MetricName,
      number
    >
  >;

function readMetricValue(
  value: unknown
) {
  if (
    value === null ||
    value === undefined ||
    value === ""
  ) {
    return null;
  }

  const metricValue =
    Number(value);

  return Number.isFinite(
    metricValue
  ) && metricValue >= 0
    ? metricValue
    : null;
}

export async function POST(request: Request) {
  try {
    const body = await request.json();

    const influencerId = body.influencerId;

    if (!influencerId) {
      return NextResponse.json(
        {
          ok: false,
          error: "influencerId is required.",
        },
        { status: 400 }
      );
    }

    // 1. Hämta rätt Instagramkonto
    const {
      data: socialAccount,
      error: accountError,
    } = await supabase
      .from("social_accounts")
      .select("id, access_token, username")
      .eq("influencer_id", influencerId)
      .eq("platform", "instagram")
      .single();

    if (accountError || !socialAccount) {
      return NextResponse.json(
        {
          ok: false,
          step: "load_account",
          error:
            accountError?.message ??
            "Instagram account not found.",
        },
        { status: 404 }
      );
    }

    const accessToken =
      socialAccount.access_token;

    // 2. Hämta publicerade poster med Instagram Media ID
    const {
      data: posts,
      error: postsError,
    } = await supabase
      .from("posts")
      .select(
        "id, external_post_id, caption, published_at"
      )
      .eq("influencer_id", influencerId)
      .eq("platform", "instagram")
      .eq("status", "published")
      .not("external_post_id", "is", null)
      .order("published_at", {
        ascending: false,
      });

    if (postsError) {
      return NextResponse.json(
        {
          ok: false,
          step: "load_posts",
          error: postsError.message,
        },
        { status: 500 }
      );
    }

    const results = [];

    // 3. Gå igenom alla publicerade poster
    for (const post of posts ?? []) {
      try {
        const mediaId =
          post.external_post_id;

        // ---------------------------------------------
        // A. Hämta likes + comments
        // ---------------------------------------------

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
            postId: post.id,
            mediaId,
            ok: false,
            step: "media",
            error: mediaData,
          });

          continue;
        }

        const metricUpdates:
          MetricUpdates = {};
        const unavailableMetrics:
          MetricName[] = [];

        const likes =
          readMetricValue(
            mediaData.like_count
          );

        if (likes === null) {
          unavailableMetrics.push(
            "likes"
          );
        } else {
          metricUpdates.likes =
            likes;
        }

        const comments =
          readMetricValue(
            mediaData.comments_count
          );

        if (comments === null) {
          unavailableMetrics.push(
            "comments"
          );
        } else {
          metricUpdates.comments =
            comments;
        }

        // ---------------------------------------------
        // B. Hämta Instagram Insights
        // ---------------------------------------------

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

        const returnedInsightMetrics =
          new Set<MetricName>();

        const requestedInsightMetrics:
          MetricName[] = [
            "reach",
            "saves",
            "shares",
            "views",
          ];

        let insightsSucceeded =
          false;

        if (
          insightsResponse.ok &&
          Array.isArray(
            insightsData.data
          )
        ) {
          insightsSucceeded =
            true;

          for (
            const metric of
              insightsData.data
          ) {
            const value =
              metric.values?.[0]
                ?.value ??
              metric.value;

            const parsedValue =
              readMetricValue(
                value
              );

            switch (metric.name) {
              case "reach":
                returnedInsightMetrics.add(
                  "reach"
                );
                if (
                  parsedValue !==
                  null
                ) {
                  metricUpdates.reach =
                    parsedValue;
                }
                break;

              case "saved":
                returnedInsightMetrics.add(
                  "saves"
                );
                if (
                  parsedValue !==
                  null
                ) {
                  metricUpdates.saves =
                    parsedValue;
                }
                break;

              case "shares":
                returnedInsightMetrics.add(
                  "shares"
                );
                if (
                  parsedValue !==
                  null
                ) {
                  metricUpdates.shares =
                    parsedValue;
                }
                break;

              case "views":
                returnedInsightMetrics.add(
                  "views"
                );
                if (
                  parsedValue !==
                  null
                ) {
                  metricUpdates.views =
                    parsedValue;
                }
                break;
            }
          }
        }

        for (
          const metricName of
            requestedInsightMetrics
        ) {
          if (
            !returnedInsightMetrics.has(
              metricName
            ) ||
            metricUpdates[
              metricName
            ] === undefined
          ) {
            unavailableMetrics.push(
              metricName
            );
          }
        }

        // Om Insights-anropet misslyckas vill vi
        // fortfarande kunna spara likes/comments.
        // Vi returnerar dock felet för felsökning.

        const insightsError =
          !insightsSucceeded
            ? {
                message:
                  "Instagram insights request failed or returned an invalid response.",
                details:
                  insightsData,
              }
            : null;

        // ---------------------------------------------
        // C. Uppdatera posten i Supabase
        // ---------------------------------------------

        let updateError:
          { message: string } | null =
            null;

        if (
          Object.keys(
            metricUpdates
          ).length > 0
        ) {
          const updateResult =
            await supabase
              .from("posts")
              .update(
                metricUpdates
              )
              .eq(
                "id",
                post.id
              );

          updateError =
            updateResult.error;
        }

        if (updateError) {
          results.push({
            postId: post.id,
            mediaId,
            ok: false,
            step:
              "update_database",
            error:
              updateError.message,
          });

          continue;
        }

        // ---------------------------------------------
        // D. Lägg resultatet i svaret
        // ---------------------------------------------

        results.push({
          postId: post.id,
          mediaId,
          ok:
            insightsSucceeded,
          step:
            insightsSucceeded
              ? null
              : "insights",
          partial:
            !insightsSucceeded ||
            unavailableMetrics.length >
              0,
          updatedMetrics:
            metricUpdates,
          unavailableMetrics:
            [
              ...new Set(
                unavailableMetrics
              ),
            ],
          insightsError,
        });
      } catch (error) {
        results.push({
          postId: post.id,
          mediaId:
            post.external_post_id,
          ok: false,
          error:
            error instanceof Error
              ? error.message
              : "Unknown error",
        });
      }
    }

    // 4. Returnera sammanställningen
    return NextResponse.json({
      ok: true,
      username:
        socialAccount.username,
      processed:
        results.length,
      results,
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
