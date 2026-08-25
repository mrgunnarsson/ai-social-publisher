import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(request: Request) {
  try {
    const authHeader =
      request.headers.get("authorization");

    const expectedSecret =
      process.env.CRON_SECRET;

    if (!expectedSecret) {
      return NextResponse.json(
        {
          ok: false,
          error: "CRON_SECRET is missing.",
        },
        { status: 500 }
      );
    }

    if (
      authHeader !==
      `Bearer ${expectedSecret}`
    ) {
      return NextResponse.json(
        {
          ok: false,
          error: "Unauthorized.",
        },
        { status: 401 }
      );
    }

    const now = new Date().toISOString();

    const {
      data: duePosts,
      error: postsError,
    } = await supabase
      .from("posts")
      .select(
        `
        id,
        influencer_id,
        social_account_id,
        caption,
        media_url,
        scheduled_at
        `
      )
      .eq("platform", "instagram")
      .eq("status", "scheduled")
      .lte("scheduled_at", now)
      .order("scheduled_at", {
        ascending: true,
      });

    if (postsError) {
      return NextResponse.json(
        {
          ok: false,
          step: "load_due_posts",
          error: postsError.message,
        },
        { status: 500 }
      );
    }

    const results = [];

    for (const post of duePosts ?? []) {
      try {
        const {
          data: socialAccount,
          error: accountError,
        } = await supabase
          .from("social_accounts")
          .select(
            `
            id,
            username,
            external_account_id,
            access_token
            `
          )
          .eq("id", post.social_account_id)
          .single();

        if (accountError || !socialAccount) {
          await supabase
            .from("posts")
            .update({
              status: "failed",
            })
            .eq("id", post.id);

          results.push({
            postId: post.id,
            ok: false,
            step: "load_account",
            error:
              accountError?.message ??
              "Social account not found.",
          });

          continue;
        }

        const instagramUserId =
          socialAccount.external_account_id;

        const accessToken =
          socialAccount.access_token;

        const caption =
          post.caption ?? "";

        const imageUrl =
          post.media_url;

        if (!imageUrl) {
          await supabase
            .from("posts")
            .update({
              status: "failed",
            })
            .eq("id", post.id);

          results.push({
            postId: post.id,
            ok: false,
            step: "missing_media",
            error: "media_url is missing.",
          });

          continue;
        }

        const publishingStartedAt =
          new Date();

        // 1. Skapa media-container
        const createResponse =
          await fetch(
            `https://graph.instagram.com/${instagramUserId}/media`,
            {
              method: "POST",
              headers: {
                "Content-Type":
                  "application/x-www-form-urlencoded",
              },
              body: new URLSearchParams({
                image_url: imageUrl,
                caption,
                access_token:
                  accessToken,
              }),
            }
          );

        const createData =
          await createResponse.json();

        if (!createResponse.ok) {
          await supabase
            .from("posts")
            .update({
              status: "failed",
            })
            .eq("id", post.id);

          results.push({
            postId: post.id,
            ok: false,
            step:
              "create_container",
            error: createData,
          });

          continue;
        }

        const creationId =
          createData.id;

        // 2. Vänta tills media är klar
        let ready = false;
        let lastStatus = null;

        for (
          let attempt = 0;
          attempt < 10;
          attempt++
        ) {
          await sleep(2000);

          const statusResponse =
            await fetch(
              `https://graph.instagram.com/${creationId}` +
                `?fields=status_code,status` +
                `&access_token=${accessToken}`,
              {
                cache: "no-store",
              }
            );

          const statusData =
            await statusResponse.json();

          lastStatus =
            statusData;

          if (
            statusData.status_code ===
            "FINISHED"
          ) {
            ready = true;
            break;
          }

          if (
            statusData.status_code ===
            "ERROR"
          ) {
            break;
          }
        }

        if (!ready) {
          await supabase
            .from("posts")
            .update({
              status: "failed",
            })
            .eq("id", post.id);

          results.push({
            postId: post.id,
            ok: false,
            step:
              "processing",
            error:
              lastStatus,
          });

          continue;
        }

        // 3. Publicera
        const publishResponse =
          await fetch(
            `https://graph.instagram.com/${instagramUserId}/media_publish`,
            {
              method: "POST",
              headers: {
                "Content-Type":
                  "application/x-www-form-urlencoded",
              },
              body: new URLSearchParams({
                creation_id:
                  creationId,
                access_token:
                  accessToken,
              }),
            }
          );

        const publishData =
          await publishResponse.json();

        if (!publishResponse.ok) {
          await supabase
            .from("posts")
            .update({
              status: "failed",
            })
            .eq("id", post.id);

          results.push({
            postId: post.id,
            ok: false,
            step: "publish",
            error: publishData,
          });

          continue;
        }

        const publishedAt =
          new Date();

        // 4. Hitta riktigt media-ID
        let actualMediaId:
          string | null = null;

        for (
          let attempt = 0;
          attempt < 8;
          attempt++
        ) {
          await sleep(2000);

          const mediaResponse =
            await fetch(
              `https://graph.instagram.com/${instagramUserId}/media` +
                `?fields=id,caption,timestamp` +
                `&limit=10` +
                `&access_token=${accessToken}`,
              {
                cache: "no-store",
              }
            );

          const mediaData =
            await mediaResponse.json();

          if (
            !mediaResponse.ok ||
            !Array.isArray(
              mediaData.data
            )
          ) {
            continue;
          }

          const matched =
            mediaData.data.find(
              (media: {
                id?: string;
                caption?: string;
                timestamp?: string;
              }) => {
                if (
                  !media.id ||
                  !media.timestamp
                ) {
                  return false;
                }

                const mediaTime =
                  new Date(
                    media.timestamp
                  ).getTime();

                const startTime =
                  publishingStartedAt.getTime();

                const endTime =
                  publishedAt.getTime();

                const timeMatches =
                  mediaTime >=
                    startTime -
                      60_000 &&
                  mediaTime <=
                    endTime +
                      120_000;

                const captionMatches =
                  (media.caption ?? "")
                    .trim() ===
                  caption.trim();

                return (
                  timeMatches &&
                  captionMatches
                );
              }
            );

          if (matched) {
            actualMediaId =
              matched.id;
            break;
          }
        }

        // 5. Uppdatera scheduled-posten
        const {
          error: updateError,
        } = await supabase
          .from("posts")
          .update({
            status: "published",
            published_at:
              publishedAt.toISOString(),
            external_post_id:
              actualMediaId,
            last_synced_at:
              null,
            sync_count: 0,
          })
          .eq("id", post.id);

        if (updateError) {
          results.push({
            postId: post.id,
            ok: false,
            step:
              "update_post",
            error:
              updateError.message,
          });

          continue;
        }

        results.push({
          postId: post.id,
          ok: true,
          username:
            socialAccount.username,
          mediaId:
            actualMediaId,
          publishedAt:
            publishedAt.toISOString(),
        });
      } catch (error) {
        await supabase
          .from("posts")
          .update({
            status: "failed",
          })
          .eq("id", post.id);

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
      due: duePosts?.length ?? 0,
      processed: results.length,
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