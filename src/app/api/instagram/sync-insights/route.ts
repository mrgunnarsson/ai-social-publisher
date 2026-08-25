import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

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

        const likes =
          Number(
            mediaData.like_count ?? 0
          );

        const comments =
          Number(
            mediaData.comments_count ?? 0
          );

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

        let reach = 0;
        let saves = 0;
        let shares = 0;
        let views = 0;

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

            switch (metric.name) {
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
        }

        // Om Insights-anropet misslyckas vill vi
        // fortfarande kunna spara likes/comments.
        // Vi returnerar dock felet för felsökning.

        const insightsError =
          !insightsResponse.ok
            ? insightsData
            : null;

        // ---------------------------------------------
        // C. Uppdatera posten i Supabase
        // ---------------------------------------------

        const {
          error: updateError,
        } = await supabase
          .from("posts")
          .update({
            likes,
            comments,
            saves,
            shares,
            reach,
            views,
          })
          .eq("id", post.id);

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
          ok: true,
          likes,
          comments,
          saves,
          shares,
          reach,
          views,
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