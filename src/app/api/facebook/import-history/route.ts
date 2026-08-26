import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

function normalizeCaption(
  value: string | null | undefined
) {
  return (value ?? "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function captionSimilarity(
  a: string | null | undefined,
  b: string | null | undefined
) {
  const normalizeToWords = (
    value: string | null | undefined
  ) =>
    normalizeCaption(value)
      .replace(/[^\p{L}\p{N}#]+/gu, " ")
      .split(" ")
      .filter(Boolean);

  const aWords = new Set(
    normalizeToWords(a)
  );

  const bWords = new Set(
    normalizeToWords(b)
  );

  if (
    aWords.size === 0 ||
    bWords.size === 0
  ) {
    return 0;
  }

  const intersection =
    [...aWords].filter(
      (word) =>
        bWords.has(word)
    ).length;

  const union =
    new Set([
      ...aWords,
      ...bWords,
    ]).size;

  return intersection / union;
}

function getTimeDifferenceMinutes(
  a: string,
  b: string
) {
  const aTime =
    new Date(a).getTime();

  const bTime =
    new Date(b).getTime();

  return Math.abs(
    aTime - bTime
  ) / 1000 / 60;
}

export async function POST(
  request: Request
) {
  try {
    const body =
      await request.json();

    const influencerId =
      body.influencerId;

    const limit =
      Number(
        body.limit ?? 50
      );

    if (!influencerId) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "influencerId is required.",
        },
        {
          status: 400,
        }
      );
    }

    /*
     * 1. Hämta Facebook-kontot
     */
    const {
      data: facebookAccount,
      error: accountError,
    } = await supabase
      .from("social_accounts")
      .select(
        `
        id,
        external_account_id,
        access_token,
        username
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
      .single();

    if (
      accountError ||
      !facebookAccount
    ) {
      return NextResponse.json(
        {
          ok: false,
          step:
            "load_facebook_account",
          error:
            accountError?.message ??
            "Facebook account not found.",
        },
        {
          status: 404,
        }
      );
    }

    const pageId =
      facebookAccount.external_account_id;

    const accessToken =
      facebookAccount.access_token;

    /*
     * 2. Hämta Facebook-historiken
     */
    const fields = [
      "id",
      "message",
      "created_time",
      "full_picture",
      "permalink_url",
    ].join(",");

    const facebookResponse =
      await fetch(
        `https://graph.facebook.com/${pageId}/feed` +
          `?fields=${fields}` +
          `&limit=${limit}` +
          `&access_token=${encodeURIComponent(
            accessToken
          )}`,
        {
          cache: "no-store",
        }
      );

    const facebookData =
      await facebookResponse.json();

    if (
      !facebookResponse.ok
    ) {
      return NextResponse.json(
        {
          ok: false,
          step:
            "load_facebook_posts",
          error:
            facebookData,
        },
        {
          status:
            facebookResponse.status,
        }
      );
    }

    const facebookPosts =
      Array.isArray(
        facebookData.data
      )
        ? facebookData.data
        : [];

    /*
     * 3. Hämta befintliga poster
     *
     * Dessa används när vi försöker
     * matcha Facebook mot Instagram.
     */
    const {
      data: existingPosts,
      error: postsError,
    } = await supabase
      .from("posts")
      .select(
        `
        id,
        platform,
        social_account_id,
        caption,
        media_url,
        external_post_id,
        published_at,
        status
        `
      )
      .eq(
        "influencer_id",
        influencerId
      )
      .eq(
        "status",
        "published"
      );

    if (postsError) {
      return NextResponse.json(
        {
          ok: false,
          step:
            "load_existing_posts",
          error:
            postsError.message,
        },
        {
          status: 500,
        }
      );
    }

    const posts =
      existingPosts ?? [];

    /*
     * 4. Hämta Instagram-kontot
     *
     * Behövs om en historisk
     * Instagram-post ska konverteras
     * till en gemensam multi-post.
     */
    const {
      data: instagramAccount,
    } = await supabase
      .from("social_accounts")
      .select("id")
      .eq(
        "influencer_id",
        influencerId
      )
      .eq(
        "platform",
        "instagram"
      )
      .maybeSingle();

    const results = [];

    /*
     * 5. Bearbeta varje Facebook-post
     */
    for (
      const facebookPost
      of facebookPosts
    ) {
      try {
        const externalPostId =
          facebookPost.id;

        const caption =
          facebookPost.message ??
          "";

        const publishedAt =
          facebookPost.created_time;

        const mediaUrl =
          facebookPost.full_picture ??
          null;

        const permalink =
          facebookPost.permalink_url ??
          null;

        /*
         * Kontrollera först om
         * Facebook-destinationen
         * redan finns.
         */
        const {
          data:
            existingDestination,
          error:
            existingDestinationError,
        } = await supabase
          .from(
            "post_destinations"
          )
          .select(
            "id, post_id"
          )
          .eq(
            "platform",
            "facebook"
          )
          .eq(
            "external_post_id",
            externalPostId
          )
          .maybeSingle();

        if (
          existingDestinationError
        ) {
          results.push({
            externalPostId,
            ok: false,
            step:
              "check_existing_destination",
            error:
              existingDestinationError.message,
          });

          continue;
        }

        if (
          existingDestination
        ) {
          results.push({
            externalPostId,
            ok: true,
            status:
              "already_exists",
            postId:
              existingDestination.post_id,
          });

          continue;
        }

        /*
         * 6. Försök hitta motsvarande
         * Instagram-post.
         *
         * Regler:
         * - samma normaliserade caption
         * - max 15 minuters skillnad
         */
        const normalizedFacebookCaption =
          normalizeCaption(
            caption
          );

        const matchingPost =
          posts.find(
            (post) => {
              if (
                !post.published_at
              ) {
                return false;
              }

              const isInstagram =
                post.platform ===
                  "instagram" ||
                post.platform ===
                  "multi";

              if (!isInstagram) {
                return false;
              }

              const normalizedInstagramCaption =
                normalizeCaption(
                  post.caption
                );

             const difference =
  getTimeDifferenceMinutes(
    post.published_at,
    publishedAt
  );

const exactCaptionMatch =
  normalizedInstagramCaption ===
  normalizedFacebookCaption;

const similarity =
  captionSimilarity(
    post.caption,
    caption
  );

if (
  exactCaptionMatch &&
  difference <= 15
) {
  return true;
}

if (
  similarity >= 0.5 &&
  difference <= 2
) {
  return true;
}

return false;
            }
          );

        /*
         * 7A. Match hittad
         */
        if (matchingPost) {
          /*
           * Om posten fortfarande är
           * Instagram-only gör vi den
           * till multi.
           */
          if (
            matchingPost.platform ===
            "instagram"
          ) {
            /*
             * Skapa först Instagram-
             * destinationen så vi får
             * samma moderna struktur.
             */
            if (
              instagramAccount &&
              matchingPost.external_post_id
            ) {
              const {
                data:
                  existingInstagramDestination,
              } = await supabase
                .from(
                  "post_destinations"
                )
                .select("id")
                .eq(
                  "post_id",
                  matchingPost.id
                )
                .eq(
                  "platform",
                  "instagram"
                )
                .eq(
                  "social_account_id",
                  instagramAccount.id
                )
                .maybeSingle();

              if (
                !existingInstagramDestination
              ) {
                const {
                  error:
                    instagramDestinationError,
                } = await supabase
                  .from(
                    "post_destinations"
                  )
                  .insert({
                    post_id:
                      matchingPost.id,

                    platform:
                      "instagram",

                    social_account_id:
                      instagramAccount.id,

                    status:
                      "published",

                    external_post_id:
                      matchingPost.external_post_id,

                    published_at:
                      matchingPost.published_at,
                  });

                if (
                  instagramDestinationError
                ) {
                  results.push({
                    externalPostId,
                    ok: false,
                    step:
                      "create_instagram_destination",
                    error:
                      instagramDestinationError.message,
                  });

                  continue;
                }
              }
            }

            const {
              error:
                updatePostError,
            } = await supabase
              .from("posts")
              .update({
                platform:
                  "multi",
              })
              .eq(
                "id",
                matchingPost.id
              );

            if (
              updatePostError
            ) {
              results.push({
                externalPostId,
                ok: false,
                step:
                  "convert_post_to_multi",
                error:
                  updatePostError.message,
              });

              continue;
            }
          }

          /*
           * Lägg till Facebook som
           * destination på samma post.
           */
          const {
            error:
              destinationInsertError,
          } = await supabase
            .from(
              "post_destinations"
            )
            .insert({
              post_id:
                matchingPost.id,

              platform:
                "facebook",

              social_account_id:
                facebookAccount.id,

              status:
                "published",

              external_post_id:
                externalPostId,

              published_at:
                publishedAt,

              reactions: 0,
              comments: 0,
              shares: 0,
              clicks: 0,
              views: 0,
            });

          if (
            destinationInsertError
          ) {
            results.push({
              externalPostId,
              ok: false,
              step:
                "insert_matched_destination",
              error:
                destinationInsertError.message,
            });

            continue;
          }

          results.push({
            externalPostId,
            ok: true,
            status:
              "matched_instagram",
            postId:
              matchingPost.id,
            caption,
            publishedAt,
            permalink,
          });

          continue;
        }

        /*
         * 7B. Ingen match hittad.
         *
         * Skapa en separat Facebook-
         * masterpost.
         */
        const {
          data: newPost,
          error:
            insertPostError,
        } = await supabase
          .from("posts")
          .insert({
            influencer_id:
              influencerId,

            platform:
              "facebook",

            social_account_id:
              facebookAccount.id,

            caption,

            media_url:
              mediaUrl,

            external_post_id:
              null,

            status:
              "published",

            published_at:
              publishedAt,

            likes: 0,
            comments: 0,
            saves: 0,
            shares: 0,
            reach: 0,
            views: 0,
          })
          .select("id")
          .single();

        if (
          insertPostError ||
          !newPost
        ) {
          results.push({
            externalPostId,
            ok: false,
            step:
              "insert_facebook_post",
            error:
              insertPostError?.message ??
              "Could not create post.",
          });

          continue;
        }

        /*
         * Skapa Facebook-
         * destinationen.
         */
        const {
          error:
            insertDestinationError,
        } = await supabase
          .from(
            "post_destinations"
          )
          .insert({
            post_id:
              newPost.id,

            platform:
              "facebook",

            social_account_id:
              facebookAccount.id,

            status:
              "published",

            external_post_id:
              externalPostId,

            published_at:
              publishedAt,

            reactions: 0,
            comments: 0,
            shares: 0,
            clicks: 0,
            views: 0,
          });

        if (
          insertDestinationError
        ) {
          results.push({
            externalPostId,
            ok: false,
            step:
              "insert_facebook_destination",
            error:
              insertDestinationError.message,
          });

          continue;
        }

        /*
         * Lägg även posten i vår
         * lokala array så nästa
         * Facebook-post kan matcha
         * mot den om det behövs.
         */
        posts.push({
          id: newPost.id,
          platform:
            "facebook",
          social_account_id:
            facebookAccount.id,
          caption,
          media_url:
            mediaUrl,
          external_post_id:
            null,
          published_at:
            publishedAt,
          status:
            "published",
        });

        results.push({
          externalPostId,
          ok: true,
          status:
            "facebook_only",
          postId:
            newPost.id,
          caption,
          publishedAt,
          permalink,
        });
      } catch (error) {
        results.push({
          externalPostId:
            facebookPost?.id ??
            null,

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
        facebookAccount.username,

      found:
        facebookPosts.length,

      matched:
        results.filter(
          (item) =>
            item.status ===
            "matched_instagram"
        ).length,

      facebookOnly:
        results.filter(
          (item) =>
            item.status ===
            "facebook_only"
        ).length,

      existing:
        results.filter(
          (item) =>
            item.status ===
            "already_exists"
        ).length,

      failed:
        results.filter(
          (item) =>
            item.ok === false
        ).length,

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
      {
        status: 500,
      }
    );
  }
}