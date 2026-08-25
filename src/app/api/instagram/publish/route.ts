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
    const body = await request.json();

    const influencerId = body.influencerId;
    const imageUrl = body.imageUrl;
    const caption = body.caption ?? "";

    if (!influencerId) {
      return NextResponse.json(
        {
          ok: false,
          error: "influencerId is required.",
        },
        { status: 400 }
      );
    }

    if (!imageUrl) {
      return NextResponse.json(
        {
          ok: false,
          error: "imageUrl is required.",
        },
        { status: 400 }
      );
    }

    // --------------------------------------------------
    // 1. Hämta Instagramkontot för influencern
    // --------------------------------------------------

    const {
      data: socialAccount,
      error: accountError,
    } = await supabase
      .from("social_accounts")
      .select(
        "id, external_account_id, access_token, username"
      )
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

    const instagramUserId =
      socialAccount.external_account_id;

    const accessToken =
      socialAccount.access_token;

    // Vi sparar tiden innan publiceringen.
    // Den använder vi senare för att hitta rätt media.
    const publishingStartedAt =
      new Date();

    // --------------------------------------------------
    // 2. Skapa Instagram media-container
    // --------------------------------------------------

    const createResponse = await fetch(
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
          access_token: accessToken,
        }),
      }
    );

    const createData =
      await createResponse.json();

    if (!createResponse.ok) {
      return NextResponse.json(
        {
          ok: false,
          step: "create_container",
          error: createData,
        },
        {
          status: createResponse.status,
        }
      );
    }

    const creationId =
      createData.id;

    // --------------------------------------------------
    // 3. Vänta tills Instagram processat bilden
    // --------------------------------------------------

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

      lastStatus = statusData;

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
        return NextResponse.json(
          {
            ok: false,
            step: "processing",
            error: statusData,
          },
          { status: 400 }
        );
      }
    }

    if (!ready) {
      return NextResponse.json(
        {
          ok: false,
          step: "processing_timeout",
          error: lastStatus,
        },
        { status: 408 }
      );
    }

    // --------------------------------------------------
    // 4. Publicera containern
    // --------------------------------------------------

    const publishResponse = await fetch(
      `https://graph.instagram.com/${instagramUserId}/media_publish`,
      {
        method: "POST",
        headers: {
          "Content-Type":
            "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          creation_id: creationId,
          access_token: accessToken,
        }),
      }
    );

    const publishData =
      await publishResponse.json();

    if (!publishResponse.ok) {
      return NextResponse.json(
        {
          ok: false,
          step: "publish",
          error: publishData,
        },
        {
          status:
            publishResponse.status,
        }
      );
    }

    const publishedAt =
      new Date();

    // --------------------------------------------------
    // 5. Hämta det riktiga Instagram Media ID:t
    // --------------------------------------------------

    let actualMediaId:
      string | null = null;

    let permalink:
      string | null = null;

    let matchedMedia:
      Record<string, unknown> | null =
      null;

    /*
      Instagram kan behöva någon sekund innan
      den publicerade posten dyker upp i /media.

      Därför provar vi flera gånger.
    */

    for (
      let attempt = 0;
      attempt < 8;
      attempt++
    ) {
      await sleep(2000);

      const mediaResponse =
        await fetch(
          `https://graph.instagram.com/${instagramUserId}/media` +
            `?fields=id,caption,timestamp,media_type,permalink` +
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
        !Array.isArray(mediaData.data)
      ) {
        continue;
      }

      /*
        För varje media kontrollerar vi:

        1. Tiden ligger nära publiceringen.
        2. Caption matchar.

        Detta gör att vi inte bara råkar
        ta "senaste posten".
      */

      const possibleMedia =
        mediaData.data.find(
          (media: {
            id?: string;
            caption?: string;
            timestamp?: string;
            permalink?: string;
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

            const startedTime =
              publishingStartedAt.getTime();

            const finishedTime =
              publishedAt.getTime();

            /*
              Acceptera media som skapats
              högst 60 sekunder före vårt
              publiceringsanrop och upp till
              två minuter efter.
            */

            const timeMatches =
              mediaTime >=
                startedTime -
                  60_000 &&
              mediaTime <=
                finishedTime +
                  120_000;

            const mediaCaption =
              media.caption ?? "";

            const captionMatches =
              mediaCaption.trim() ===
              caption.trim();

            return (
              timeMatches &&
              captionMatches
            );
          }
        );

      if (possibleMedia) {
        actualMediaId =
          possibleMedia.id;

        permalink =
          possibleMedia.permalink ??
          null;

        matchedMedia =
          possibleMedia;

        break;
      }
    }

    // --------------------------------------------------
    // 6. Spara publiceringen i Supabase
    // --------------------------------------------------

    const {
      error: savePostError,
    } = await supabase
      .from("posts")
      .insert({
        influencer_id:
          influencerId,

        platform:
          "instagram",

        social_account_id:
          socialAccount.id,

        caption,

        media_url:
          imageUrl,

        /*
          Viktigt:
          Spara det riktiga media-ID:t.

          Om Instagram ännu inte hunnit
          exponera posten sparar vi null
          istället för ett felaktigt ID.
        */

        external_post_id:
          actualMediaId,

        status:
          "published",

        published_at:
          publishedAt.toISOString(),
      });

    if (savePostError) {
      console.error(
        "Could not save published post:",
        savePostError
      );
    }

    // --------------------------------------------------
    // 7. Returnera resultat
    // --------------------------------------------------

    return NextResponse.json({
      ok: true,

      username:
        socialAccount.username,

      containerId:
        creationId,

      publishResultId:
        publishData.id,

      mediaId:
        actualMediaId,

      permalink,

      analyticsReady:
        actualMediaId !== null,

      matchedMedia,

      publishedAt:
        publishedAt.toISOString(),
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