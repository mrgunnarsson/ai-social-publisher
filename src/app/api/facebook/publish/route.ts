import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(request: Request) {
  try {
    const body = await request.json();

    const {
      influencerId,
      message,
      imageUrl,
    } = body;

    if (!influencerId) {
      return NextResponse.json(
        {
          ok: false,
          error: "influencerId is required.",
        },
        { status: 400 }
      );
    }

    if (!message && !imageUrl) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "message or imageUrl is required.",
        },
        { status: 400 }
      );
    }

    // Hämta rätt Facebook-sida
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
      !socialAccount
    ) {
      return NextResponse.json(
        {
          ok: false,
          step: "load_account",
          error:
            accountError?.message ??
            "Facebook account not found.",
        },
        { status: 404 }
      );
    }

    const pageId =
      socialAccount.external_account_id;

    const pageAccessToken =
      socialAccount.access_token;

    let facebookPostId:
      string | null = null;

    /*
      Om imageUrl finns:
      skapa ett foto-inlägg.

      Annars:
      skapa ett vanligt textinlägg.
    */

    if (imageUrl) {
      const photoResponse =
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
                url: imageUrl,
                caption:
                  message ?? "",
                access_token:
                  pageAccessToken,
              }),
          }
        );

      const photoData =
        await photoResponse.json();

      if (!photoResponse.ok) {
        return NextResponse.json(
          {
            ok: false,
            step: "facebook_photo",
            error: photoData,
          },
          {
            status:
              photoResponse.status,
          }
        );
      }

      facebookPostId =
        photoData.post_id ??
        photoData.id ??
        null;
    } else {
      const feedResponse =
        await fetch(
          `https://graph.facebook.com/v26.0/${pageId}/feed`,
          {
            method: "POST",

            headers: {
              "Content-Type":
                "application/x-www-form-urlencoded",
            },

            body:
              new URLSearchParams({
                message:
                  message ?? "",
                access_token:
                  pageAccessToken,
              }),
          }
        );

      const feedData =
        await feedResponse.json();

      if (!feedResponse.ok) {
        return NextResponse.json(
          {
            ok: false,
            step: "facebook_feed",
            error: feedData,
          },
          {
            status:
              feedResponse.status,
          }
        );
      }

      facebookPostId =
        feedData.id ??
        null;
    }

    return NextResponse.json({
      ok: true,
      username:
        socialAccount.username,
      pageId,
      postId:
        facebookPostId,
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