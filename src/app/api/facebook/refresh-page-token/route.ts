import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(
  request: Request
) {
  try {
    const body =
      await request.json();

    const {
      influencerId,
      userAccessToken,
    } = body;

    if (!influencerId) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "influencerId is required.",
        },
        { status: 400 }
      );
    }

    if (!userAccessToken) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "userAccessToken is required.",
        },
        { status: 400 }
      );
    }

    // 1. Hämta Facebook-användaren
    const meResponse =
      await fetch(
        "https://graph.facebook.com/v26.0/me" +
          `?fields=id,name` +
          `&access_token=${encodeURIComponent(
            userAccessToken
          )}`,
        {
          cache: "no-store",
        }
      );

    const meData =
      await meResponse.json();

    if (!meResponse.ok) {
      return NextResponse.json(
        {
          ok: false,
          step: "load_user",
          error: meData,
        },
        {
          status:
            meResponse.status,
        }
      );
    }

    const facebookUserId =
      meData.id;

    // 2. Hämta användarens Pages
    const accountsResponse =
      await fetch(
        "https://graph.facebook.com/v26.0/me/accounts" +
          `?fields=id,name,access_token,tasks` +
          `&access_token=${encodeURIComponent(
            userAccessToken
          )}`,
        {
          cache: "no-store",
        }
      );

    const accountsData =
      await accountsResponse.json();

    if (!accountsResponse.ok) {
      return NextResponse.json(
        {
          ok: false,
          step: "load_pages",
          error: accountsData,
        },
        {
          status:
            accountsResponse.status,
        }
      );
    }

    const pages =
      Array.isArray(
        accountsData.data
      )
        ? accountsData.data
        : [];

    // 3. Hämta influencerns Facebookkonto
    const {
      data: socialAccount,
      error: socialAccountError,
    } = await supabase
      .from("social_accounts")
      .select(
        `
        id,
        external_account_id,
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
      socialAccountError ||
      !socialAccount
    ) {
      return NextResponse.json(
        {
          ok: false,
          step: "load_social_account",
          error:
            socialAccountError?.message ??
            "Facebook social account not found.",
        },
        { status: 404 }
      );
    }

    // 4. Matcha rätt Page via Page ID
    const page =
      pages.find(
        (item: {
          id?: string;
        }) =>
          item.id ===
          socialAccount.external_account_id
      );

    if (!page) {
      return NextResponse.json(
        {
          ok: false,
          step: "match_page",
          error:
            `Facebook Page ${socialAccount.external_account_id} was not found for this user.`,
        },
        { status: 404 }
      );
    }

    if (!page.access_token) {
      return NextResponse.json(
        {
          ok: false,
          step: "page_token",
          error:
            "Page access token is missing.",
        },
        { status: 500 }
      );
    }

    // 5. Spara/uppdatera long-lived user token
    const expiresAt =
      new Date(
        Date.now() +
          60 *
            24 *
            60 *
            60 *
            1000
      ).toISOString();

    const {
      error: userTokenError,
    } = await supabase
      .from("meta_user_tokens")
      .upsert(
        {
          facebook_user_id:
            facebookUserId,
          access_token:
            userAccessToken,
          expires_at:
            expiresAt,
          updated_at:
            new Date().toISOString(),
        },
        {
          onConflict:
            "facebook_user_id",
        }
      );

    if (userTokenError) {
      return NextResponse.json(
        {
          ok: false,
          step: "save_user_token",
          error:
            userTokenError.message,
        },
        { status: 500 }
      );
    }

    // 6. Uppdatera Page token i social_accounts
    const {
      error: pageTokenError,
    } = await supabase
      .from("social_accounts")
      .update({
        access_token:
          page.access_token,
      })
      .eq(
        "id",
        socialAccount.id
      );

    if (pageTokenError) {
      return NextResponse.json(
        {
          ok: false,
          step: "save_page_token",
          error:
            pageTokenError.message,
        },
        { status: 500 }
      );
    }

    return NextResponse.json({
      ok: true,
      facebookUser: {
        id:
          facebookUserId,
        name:
          meData.name,
      },
      page: {
        id:
          page.id,
        name:
          page.name,
      },
      pageTokenUpdated:
        true,
      userTokenStored:
        true,
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