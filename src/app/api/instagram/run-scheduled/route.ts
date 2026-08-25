import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

function sleep(ms: number) {
  return new Promise((resolve) =>
    setTimeout(resolve, ms)
  );
}

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

type SocialAccount = {
  id: string;
  username: string;
  external_account_id: string;
  access_token: string;
  platform?: string;
};

type ScheduledPost = {
  id: string;
  influencer_id: string;
  platform: string;
  social_account_id: string | null;
  caption: string | null;
  media_url: string | null;
  scheduled_at: string | null;
};

type Destination = {
  id: string;
  post_id: string;
  platform: string;
  social_account_id: string;
  status: string;
};

async function loadSocialAccount(
  socialAccountId: string
) {
  const {
    data,
    error,
  } = await supabase
    .from("social_accounts")
    .select(
      `
      id,
      username,
      platform,
      external_account_id,
      access_token
      `
    )
    .eq(
      "id",
      socialAccountId
    )
    .single();

  if (
    error ||
    !data
  ) {
    throw new Error(
      error?.message ??
        "Social account not found."
    );
  }

  return data as SocialAccount;
}

async function publishInstagram(
  post: ScheduledPost,
  socialAccount: SocialAccount
) {
  const instagramUserId =
    socialAccount.external_account_id;

  const accessToken =
    socialAccount.access_token;

  const caption =
    post.caption ?? "";

  const imageUrl =
    post.media_url;

  if (!imageUrl) {
    throw new Error(
      "media_url is missing."
    );
  }

  const publishingStartedAt =
    new Date();

  // 1. Skapa container
  const createResponse =
    await fetch(
      `https://graph.instagram.com/${instagramUserId}/media`,
      {
        method: "POST",

        headers: {
          "Content-Type":
            "application/x-www-form-urlencoded",
        },

        body:
          new URLSearchParams({
            image_url:
              imageUrl,
            caption,
            access_token:
              accessToken,
          }),
      }
    );

  const createData =
    await createResponse.json();

  if (
    !createResponse.ok
  ) {
    throw new Error(
      JSON.stringify(
        createData
      )
    );
  }

  const creationId =
    createData.id;

  // 2. Vänta på processing
  let ready =
    false;

  let lastStatus:
    unknown = null;

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
          cache:
            "no-store",
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
      ready =
        true;

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
    throw new Error(
      `Instagram processing failed: ${JSON.stringify(
        lastStatus
      )}`
    );
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

        body:
          new URLSearchParams({
            creation_id:
              creationId,
            access_token:
              accessToken,
          }),
      }
    );

  const publishData =
    await publishResponse.json();

  if (
    !publishResponse.ok
  ) {
    throw new Error(
      JSON.stringify(
        publishData
      )
    );
  }

  const publishedAt =
    new Date();

  // 4. Hitta riktigt media-ID
  let actualMediaId:
    string | null =
    null;

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
          cache:
            "no-store",
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
            (
              media.caption ??
              ""
            ).trim() ===
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

  return {
    username:
      socialAccount.username,

    mediaId:
      actualMediaId,

    publishedAt:
      publishedAt.toISOString(),
  };
}

async function publishFacebook(
  post: ScheduledPost,
  socialAccount: SocialAccount
) {
  const pageId =
    socialAccount.external_account_id;

  const accessToken =
    socialAccount.access_token;

  const caption =
    post.caption ?? "";

  const imageUrl =
    post.media_url;

  if (!imageUrl) {
    throw new Error(
      "media_url is missing."
    );
  }

  const response =
    await fetch(
      `https://graph.facebook.com/v26.0/${pageId}/photos`,
      {
        method: "POST",

        headers: {
          "Content-Type":
            "application/x-www-form-urlencoded",
        },

        body:
          new URLSearchParams({
            url:
              imageUrl,
            caption,
            access_token:
              accessToken,
          }),
      }
    );

  const data =
    await response.json();

  if (!response.ok) {
    throw new Error(
      JSON.stringify(
        data
      )
    );
  }

  return {
    username:
      socialAccount.username,

    mediaId:
      data.post_id ??
      data.id ??
      null,

    publishedAt:
      new Date()
        .toISOString(),
  };
}

async function processLegacyInstagramPost(
  post: ScheduledPost
) {
  if (
    !post.social_account_id
  ) {
    throw new Error(
      "social_account_id is missing."
    );
  }

  const socialAccount =
    await loadSocialAccount(
      post.social_account_id
    );

  const result =
    await publishInstagram(
      post,
      socialAccount
    );

  const {
    error:
      updateError,
  } = await supabase
    .from("posts")
    .update({
      status:
        "published",

      published_at:
        result.publishedAt,

      external_post_id:
        result.mediaId,

      last_synced_at:
        null,

      sync_count:
        0,
    })
    .eq(
      "id",
      post.id
    );

  if (updateError) {
    throw new Error(
      updateError.message
    );
  }

  return {
    postId:
      post.id,

    platform:
      "instagram",

    ok:
      true,

    ...result,
  };
}

async function processMultiPost(
  post: ScheduledPost
) {
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
      id,
      post_id,
      platform,
      social_account_id,
      status
      `
    )
    .eq(
      "post_id",
      post.id
    )
    .eq(
      "status",
      "scheduled"
    );

  if (
    destinationsError
  ) {
    throw new Error(
      destinationsError.message
    );
  }

  const destinationResults =
    [];

  for (
    const destination of
      (destinations ??
        []) as Destination[]
  ) {
    try {
      const socialAccount =
        await loadSocialAccount(
          destination.social_account_id
        );

      let result;

      if (
        destination.platform ===
        "instagram"
      ) {
        result =
          await publishInstagram(
            post,
            socialAccount
          );
      } else if (
        destination.platform ===
        "facebook"
      ) {
        result =
          await publishFacebook(
            post,
            socialAccount
          );
      } else {
        throw new Error(
          `Unsupported platform: ${destination.platform}`
        );
      }

      const {
        error:
          updateDestinationError,
      } = await supabase
        .from(
          "post_destinations"
        )
        .update({
          status:
            "published",

          external_post_id:
            result.mediaId,

          published_at:
            result.publishedAt,

          last_synced_at:
            null,
        })
        .eq(
          "id",
          destination.id
        );

      if (
        updateDestinationError
      ) {
        throw new Error(
          updateDestinationError.message
        );
      }

      destinationResults.push({
        destinationId:
          destination.id,

        platform:
          destination.platform,

        username:
          result.username,

        mediaId:
          result.mediaId,

        publishedAt:
          result.publishedAt,

        ok:
          true,
      });
    } catch (error) {
      /*
        Låt destinationen fortsätta vara
        "scheduled".

        Då kan Cron försöka igen nästa
        gång utan att återpublicera de
        destinationer som redan lyckades.
      */

      destinationResults.push({
        destinationId:
          destination.id,

        platform:
          destination.platform,

        ok:
          false,

        error:
          error instanceof Error
            ? error.message
            : "Unknown error",
      });
    }
  }

  /*
    Kontrollera om några destinationer
    fortfarande återstår.
  */

  const {
    count:
      remainingCount,

    error:
      remainingError,
  } = await supabase
    .from(
      "post_destinations"
    )
    .select(
      "id",
      {
        count:
          "exact",

        head:
          true,
      }
    )
    .eq(
      "post_id",
      post.id
    )
    .eq(
      "status",
      "scheduled"
    );

  if (remainingError) {
    throw new Error(
      remainingError.message
    );
  }

  /*
    När ALLA destinationer är klara
    markerar vi parent-posten som
    published.
  */

  if (
    (remainingCount ??
      0) === 0
  ) {
    const publishedAt =
      new Date()
        .toISOString();

    const {
      error:
        postUpdateError,
    } = await supabase
      .from("posts")
      .update({
        status:
          "published",

        published_at:
          publishedAt,
      })
      .eq(
        "id",
        post.id
      );

    if (
      postUpdateError
    ) {
      throw new Error(
        postUpdateError.message
      );
    }
  }

  return {
    postId:
      post.id,

    platform:
      "multi",

    ok:
      destinationResults.every(
        (item) =>
          item.ok
      ),

    destinations:
      destinationResults,

    remaining:
      remainingCount ??
      0,
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

    if (!expectedSecret) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "CRON_SECRET is missing.",
        },
        {
          status:
            500,
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
          status:
            401,
        }
      );
    }

    const now =
      new Date()
        .toISOString();

    const {
      data:
        duePosts,

      error:
        postsError,
    } = await supabase
      .from("posts")
      .select(
        `
        id,
        influencer_id,
        platform,
        social_account_id,
        caption,
        media_url,
        scheduled_at
        `
      )
      .in(
        "platform",
        [
          "instagram",
          "multi",
        ]
      )
      .eq(
        "status",
        "scheduled"
      )
      .lte(
        "scheduled_at",
        now
      )
      .order(
        "scheduled_at",
        {
          ascending:
            true,
        }
      );

    if (postsError) {
      return NextResponse.json(
        {
          ok: false,

          step:
            "load_due_posts",

          error:
            postsError.message,
        },
        {
          status:
            500,
        }
      );
    }

    const results =
      [];

    for (
      const post of
        (duePosts ??
          []) as ScheduledPost[]
    ) {
      try {
        if (
          post.platform ===
          "multi"
        ) {
          const result =
            await processMultiPost(
              post
            );

          results.push(
            result
          );

          continue;
        }

        const result =
          await processLegacyInstagramPost(
            post
          );

        results.push(
          result
        );
      } catch (error) {
        /*
          För gamla Instagram-poster
          behåller vi tidigare beteende.

          Multi-poster ska däremot ligga
          kvar som scheduled om någon
          destination behöver retry.
        */

        if (
          post.platform ===
          "instagram"
        ) {
          await supabase
            .from("posts")
            .update({
              status:
                "failed",
            })
            .eq(
              "id",
              post.id
            );
        }

        results.push({
          postId:
            post.id,

          platform:
            post.platform,

          ok:
            false,

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

      due:
        duePosts?.length ??
        0,

      processed:
        results.length,

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