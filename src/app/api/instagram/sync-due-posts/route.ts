import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

function shouldSyncPost(
  publishedAt: string,
  lastSyncedAt: string | null,
  syncCount: number
) {
  const now = Date.now();
  const published = new Date(publishedAt).getTime();

  const ageMs = now - published;
  const hour = 60 * 60 * 1000;

  if (!lastSyncedAt) {
    return ageMs >= hour;
  }

  const lastSync = new Date(lastSyncedAt).getTime();
  const sinceLastSync = now - lastSync;

  if (syncCount === 0) {
    return ageMs >= 1 * hour;
  }

  if (syncCount === 1) {
    return ageMs >= 6 * hour;
  }

  if (syncCount === 2) {
    return ageMs >= 24 * hour;
  }

  if (syncCount === 3) {
    return ageMs >= 72 * hour;
  }

  return sinceLastSync >= 7 * 24 * hour;
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

    const {
      data: socialAccount,
      error: accountError,
    } = await supabase
      .from("social_accounts")
      .select("access_token, username")
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

    const {
      data: posts,
      error: postsError,
    } = await supabase
      .from("posts")
      .select(
        "id, external_post_id, published_at, last_synced_at, sync_count"
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

    const duePosts =
      (posts ?? []).filter((post) =>
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
          Array.isArray(insightsData.data)
        ) {
          for (
            const metric of insightsData.data
          ) {
            const value =
              metric.values?.[0]?.value ??
              metric.value ??
              0;

            switch (metric.name) {
              case "reach":
                reach = Number(value);
                break;

              case "saved":
                saves = Number(value);
                break;

              case "shares":
                shares = Number(value);
                break;

              case "views":
                views = Number(value);
                break;
            }
          }
        }

        const syncedAt =
          new Date().toISOString();

        const nextSyncCount =
          (post.sync_count ?? 0) + 1;

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
            last_synced_at:
              syncedAt,
            sync_count:
              nextSyncCount,
          })
          .eq("id", post.id);

        if (updateError) {
          results.push({
            postId: post.id,
            ok: false,
            step: "update_database",
            error:
              updateError.message,
          });

          continue;
        }

        results.push({
          postId: post.id,
          ok: true,
          likes,
          comments,
          saves,
          shares,
          reach,
          views,
          syncCount:
            nextSyncCount,
          syncedAt,
        });
      } catch (error) {
        results.push({
          postId: post.id,
          ok: false,
          error:
            error instanceof Error
              ? error.message
              : "Unknown error",
        });
      }
    }

    return NextResponse.json({
      ok: true,
      username:
        socialAccount.username,
      due:
        duePosts.length,
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