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

type MediaType =
  | "image"
  | "video";

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
  media_type: MediaType;
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

/*
  INSTAGRAM IMAGE
*/
async function publishInstagramImage(
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

  /*
    1. Skapa image container
  */
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

  if (!creationId) {
    throw new Error(
      "Instagram creation_id is missing."
    );
  }

  /*
    2. Vänta på processing
  */
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

  /*
    3. Publicera
  */
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

  /*
    4. Hitta riktigt media-ID

    Vi behåller samma metod som
    tidigare för att inte ändra den
    fungerande bildpubliceringen.
  */
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

  /*
    Om media_publish returnerade
    ett id använder vi det som
    fallback.
  */
  if (
    !actualMediaId &&
    publishData.id
  ) {
    actualMediaId =
      publishData.id;
  }

  return {
    username:
      socialAccount.username,

    mediaId:
      actualMediaId,

    publishedAt:
      publishedAt.toISOString(),

    mediaType:
      "image" as const,
  };
}

/*
  INSTAGRAM REEL
*/
async function publishInstagramReel(
  post: ScheduledPost,
  socialAccount: SocialAccount
) {
  const instagramUserId =
    socialAccount.external_account_id;

  const accessToken =
    socialAccount.access_token;

  const caption =
    post.caption ?? "";

  const videoUrl =
    post.media_url;

  if (!videoUrl) {
    throw new Error(
      "media_url is missing."
    );
  }

  /*
    1. Skapa Reel-container
  */
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
            media_type:
              "REELS",

            video_url:
              videoUrl,

            caption,

            /*
              Reelen visas även i
              användarens feed.
            */
            share_to_feed:
              "true",

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
      `Instagram Reel container failed: ${JSON.stringify(
        createData
      )}`
    );
  }

  const creationId =
    createData.id;

  if (!creationId) {
    throw new Error(
      "Instagram Reel creation_id is missing."
    );
  }

  /*
    Video tar betydligt längre tid
    att behandla än en bild.

    Max:
    30 försök × 3 sekunder
    ≈ 90 sekunder.
  */
  let ready =
    false;

  let lastStatus:
    unknown = null;

  for (
    let attempt = 0;
    attempt < 30;
    attempt++
  ) {
    await sleep(3000);

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
        "ERROR" ||
      statusData.status_code ===
        "EXPIRED"
    ) {
      break;
    }
  }

  if (!ready) {
    throw new Error(
      `Instagram Reel processing failed: ${JSON.stringify(
        lastStatus
      )}`
    );
  }

  /*
    3. Publicera Reel
  */
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
      `Instagram Reel publish failed: ${JSON.stringify(
        publishData
      )}`
    );
  }

  return {
    username:
      socialAccount.username,

    mediaId:
      publishData.id ??
      null,

    publishedAt:
      new Date()
        .toISOString(),

    mediaType:
      "video" as const,
  };
}

/*
  INSTAGRAM

  Väljer automatiskt bild eller Reel.
*/
async function publishInstagram(
  post: ScheduledPost,
  socialAccount: SocialAccount
) {
  if (
    post.media_type ===
    "video"
  ) {
    return publishInstagramReel(
      post,
      socialAccount
    );
  }

  return publishInstagramImage(
    post,
    socialAccount
  );
}

/*
  FACEBOOK IMAGE

  Detta är exakt samma princip
  som den befintliga fungerande
  Facebook-publiceringen.
*/
async function publishFacebookImage(
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

    mediaType:
      "image" as const,
  };
}

/*
  FACEBOOK REEL
*/
async function publishFacebookReel(
  post: ScheduledPost,
  socialAccount: SocialAccount
) {
  const pageId =
    socialAccount.external_account_id;

  const accessToken =
    socialAccount.access_token;

  const caption =
    post.caption ?? "";

  const videoUrl =
    post.media_url;

  if (!videoUrl) {
    throw new Error(
      "media_url is missing."
    );
  }

  /*
    1. STARTA REEL-UPLOAD
  */
  const startResponse =
    await fetch(
      `https://graph.facebook.com/v26.0/${pageId}/video_reels`,
      {
        method: "POST",

        headers: {
          "Content-Type":
            "application/x-www-form-urlencoded",
        },

        body:
          new URLSearchParams({
            upload_phase:
              "start",

            access_token:
              accessToken,
          }),
      }
    );

  const startData =
    await startResponse.json();

  if (!startResponse.ok) {
    throw new Error(
      `Facebook Reel START failed: ${JSON.stringify(
        startData
      )}`
    );
  }

  const videoId =
    startData.video_id;

  const uploadUrl =
    startData.upload_url;

  if (
    !videoId ||
    !uploadUrl
  ) {
    throw new Error(
      `Facebook Reel START returned incomplete data: ${JSON.stringify(
        startData
      )}`
    );
  }

  /*
    2. LADDA UPP DEN HOSTADE VIDEON

    Facebook hämtar vår färdiga
    MP4 direkt från Supabase.
  */
  const uploadResponse =
    await fetch(
      uploadUrl,
      {
        method: "POST",

        headers: {
          Authorization:
            `OAuth ${accessToken}`,

          file_url:
            videoUrl,
        },
      }
    );

  const uploadData =
    await uploadResponse.json();

  if (!uploadResponse.ok) {
    throw new Error(
      `Facebook Reel upload failed: ${JSON.stringify(
        uploadData
      )}`
    );
  }

  /*
    3. PUBLICERA REEL
  */
  const finishResponse =
    await fetch(
      `https://graph.facebook.com/v26.0/${pageId}/video_reels`,
      {
        method: "POST",

        headers: {
          "Content-Type":
            "application/x-www-form-urlencoded",
        },

        body:
          new URLSearchParams({
            upload_phase:
              "finish",

            video_id:
              videoId,

            video_state:
              "PUBLISHED",

            description:
              caption,

            access_token:
              accessToken,
          }),
      }
    );

  const finishData =
    await finishResponse.json();

  if (!finishResponse.ok) {
    throw new Error(
      `Facebook Reel FINISH failed: ${JSON.stringify(
        finishData
      )}`
    );
  }

  return {
    username:
      socialAccount.username,

    mediaId:
      videoId,

    publishedAt:
      new Date()
        .toISOString(),

    mediaType:
      "video" as const,
  };
}


/*
  FACEBOOK

  Bild fungerar som tidigare.

  Video/Reels aktiverar vi först
  när Facebook Reel-flödet är
  implementerat och testat.
*/
async function publishFacebook(
  post: ScheduledPost,
  socialAccount: SocialAccount
) {
  if (
    post.media_type ===
    "video"
  ) {
    return publishFacebookReel(
      post,
      socialAccount
    );
  }

  return publishFacebookImage(
    post,
    socialAccount
  );
}

/*
  LEGACY INSTAGRAM
*/
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

    mediaType:
      post.media_type,

    ok:
      true,

    ...result,
  };
}

/*
  MULTI-PLATFORM
*/
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

        mediaType:
          post.media_type,

        mediaId:
          result.mediaId,

        publishedAt:
          result.publishedAt,

        ok:
          true,
      });
    } catch (error) {
      /*
        Destinationen ligger kvar som
        scheduled så Cron kan göra
        ett nytt försök senare.

        Detta är särskilt viktigt när
        en multi-post lyckas på en
        plattform men inte den andra.
      */
      destinationResults.push({
        destinationId:
          destination.id,

        platform:
          destination.platform,

        mediaType:
          post.media_type,

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
    Finns några destinationer kvar?
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
    Endast när ALLA destinationer
    är publicerade sätter vi parent
    till published.
  */
  if (
    (remainingCount ?? 0) ===
    0
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

    mediaType:
      post.media_type,

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

    const now =
      new Date()
        .toISOString();

    /*
      Här är den viktiga ändringen:
      media_type hämtas tillsammans
      med resten av posten.
    */
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
        media_type,
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

    if (
      postsError
    ) {
      return NextResponse.json(
        {
          ok: false,

          step:
            "load_due_posts",

          error:
            postsError.message,
        },
        {
          status: 500,
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
          Legacy Instagram behåller
          tidigare fail-beteende.

          Multi ligger kvar som
          scheduled om någon
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

          mediaType:
            post.media_type,

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
        status: 500,
      }
    );
  }
}