import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function GET(
  request: Request
) {
  try {
    const url =
      new URL(request.url);

    const code =
      url.searchParams.get("code");

    const state =
      url.searchParams.get("state");

    const error =
      url.searchParams.get("error");

    /*
      Om användaren avbryter
      Facebook-inloggningen.
    */
    if (error) {
      return NextResponse.redirect(
        new URL(
          "/?facebook_error=access_denied",
          url.origin
        )
      );
    }

    if (!code) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "Missing OAuth code.",
        },
        {
          status: 400,
        }
      );
    }

    if (!state) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "Missing OAuth state.",
        },
        {
          status: 400,
        }
      );
    }

    /*
      Läs influencerId från state.
    */
    let influencerId:
      string;

    try {
      const decoded =
        JSON.parse(
          Buffer.from(
            state,
            "base64url"
          ).toString(
            "utf8"
          )
        );

      influencerId =
        decoded.influencerId;
    } catch {
      return NextResponse.json(
        {
          ok: false,
          error:
            "Invalid OAuth state.",
        },
        {
          status: 400,
        }
      );
    }

    if (!influencerId) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "influencerId missing from OAuth state.",
        },
        {
          status: 400,
        }
      );
    }

    /*
      Meta App credentials.
    */
    const appId =
      process.env.META_APP_ID;

    const appSecret =
      process.env.META_APP_SECRET;

    if (
      !appId ||
      !appSecret
    ) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "Meta app credentials are missing.",
        },
        {
          status: 500,
        }
      );
    }

    const redirectUri =
      `${url.origin}/api/facebook/oauth/callback`;

    /*
      1.
      OAuth code
      ->
      short-lived User Access Token
    */
    const tokenUrl =
      new URL(
        "https://graph.facebook.com/v26.0/oauth/access_token"
      );

    tokenUrl.searchParams.set(
      "client_id",
      appId
    );

    tokenUrl.searchParams.set(
      "client_secret",
      appSecret
    );

    tokenUrl.searchParams.set(
      "redirect_uri",
      redirectUri
    );

    tokenUrl.searchParams.set(
      "code",
      code
    );

    const tokenResponse =
      await fetch(
        tokenUrl.toString(),
        {
          cache:
            "no-store",
        }
      );

    const tokenData =
      await tokenResponse.json();

    if (
      !tokenResponse.ok
    ) {
      return NextResponse.json(
        {
          ok: false,
          step:
            "exchange_code",
          error:
            tokenData,
        },
        {
          status:
            tokenResponse.status,
        }
      );
    }

    const shortUserToken =
      tokenData.access_token;

    if (!shortUserToken) {
      return NextResponse.json(
        {
          ok: false,
          step:
            "exchange_code",
          error:
            "Meta did not return a user access token.",
        },
        {
          status: 500,
        }
      );
    }

    /*
      2.
      Short-lived User Token
      ->
      Long-lived User Token
    */
    const exchangeUrl =
      new URL(
        "https://graph.facebook.com/v26.0/oauth/access_token"
      );

    exchangeUrl.searchParams.set(
      "grant_type",
      "fb_exchange_token"
    );

    exchangeUrl.searchParams.set(
      "client_id",
      appId
    );

    exchangeUrl.searchParams.set(
      "client_secret",
      appSecret
    );

    exchangeUrl.searchParams.set(
      "fb_exchange_token",
      shortUserToken
    );

    const exchangeResponse =
      await fetch(
        exchangeUrl.toString(),
        {
          cache:
            "no-store",
        }
      );

    const exchangeData =
      await exchangeResponse.json();

    if (
      !exchangeResponse.ok
    ) {
      return NextResponse.json(
        {
          ok: false,
          step:
            "exchange_long_lived",
          error:
            exchangeData,
        },
        {
          status:
            exchangeResponse.status,
        }
      );
    }

    const longUserToken =
      exchangeData.access_token;

    if (!longUserToken) {
      return NextResponse.json(
        {
          ok: false,
          step:
            "exchange_long_lived",
          error:
            "Meta did not return a long-lived user token.",
        },
        {
          status: 500,
        }
      );
    }

    /*
      3.
      Kontrollera tokenen via
      Meta debug_token.

      Därifrån får vi bland annat
      faktisk expires_at.
    */
    const appAccessToken =
      `${appId}|${appSecret}`;

    const debugUrl =
      new URL(
        "https://graph.facebook.com/v26.0/debug_token"
      );

    debugUrl.searchParams.set(
      "input_token",
      longUserToken
    );

    debugUrl.searchParams.set(
      "access_token",
      appAccessToken
    );

    const debugResponse =
      await fetch(
        debugUrl.toString(),
        {
          cache:
            "no-store",
        }
      );

    const debugData =
      await debugResponse.json();

    if (
      !debugResponse.ok
    ) {
      return NextResponse.json(
        {
          ok: false,
          step:
            "debug_token",
          error:
            debugData,
        },
        {
          status:
            debugResponse.status,
        }
      );
    }

    const tokenInfo =
      debugData.data;

    if (
      !tokenInfo ||
      tokenInfo.is_valid !==
        true
    ) {
      return NextResponse.json(
        {
          ok: false,
          step:
            "debug_token",
          error:
            "Meta reports that the user access token is invalid.",
        },
        {
          status: 400,
        }
      );
    }

    /*
      Meta returnerar expires_at
      som Unix timestamp i sekunder.
    */
const debugExpiresAt =
  Number(
    tokenInfo.expires_at ??
      0
  );

const exchangeExpiresIn =
  Number(
    exchangeData.expires_in ??
      0
  );

let expiresAt:
  string | null =
  null;

if (
  debugExpiresAt > 0
) {
  expiresAt =
    new Date(
      debugExpiresAt *
        1000
    ).toISOString();
} else if (
  exchangeExpiresIn > 0
) {
  expiresAt =
    new Date(
      Date.now() +
        exchangeExpiresIn *
          1000
    ).toISOString();
}

    /*
      4.
      Hämta Facebook-användaren.
    */
    const meUrl =
      new URL(
        "https://graph.facebook.com/v26.0/me"
      );

    meUrl.searchParams.set(
      "fields",
      "id,name"
    );

    meUrl.searchParams.set(
      "access_token",
      longUserToken
    );

    const meResponse =
      await fetch(
        meUrl.toString(),
        {
          cache:
            "no-store",
        }
      );

    const meData =
      await meResponse.json();

    if (
      !meResponse.ok
    ) {
      return NextResponse.json(
        {
          ok: false,
          step:
            "load_user",
          error:
            meData,
        },
        {
          status:
            meResponse.status,
        }
      );
    }

    /*
      5.
      Hämta Facebook Pages
      inklusive Page Access Tokens.
    */
    const accountsUrl =
      new URL(
        "https://graph.facebook.com/v26.0/me/accounts"
      );

    accountsUrl.searchParams.set(
      "fields",
      "id,name,access_token,tasks"
    );

    accountsUrl.searchParams.set(
      "access_token",
      longUserToken
    );

    const accountsResponse =
      await fetch(
        accountsUrl.toString(),
        {
          cache:
            "no-store",
        }
      );

    const accountsData =
      await accountsResponse.json();

    if (
      !accountsResponse.ok
    ) {
      return NextResponse.json(
        {
          ok: false,
          step:
            "load_pages",
          error:
            accountsData,
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

    /*
      6.
      Hämta Facebook-kontot
      som hör till influencern.
    */
    const {
      data:
        socialAccount,
      error:
        socialAccountError,
    } = await supabase
      .from(
        "social_accounts"
      )
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
          step:
            "load_social_account",
          error:
            socialAccountError?.message ??
            "Facebook account not found for influencer.",
        },
        {
          status: 404,
        }
      );
    }

    /*
      7.
      Matcha influencerns sparade
      Page ID mot Pages från Meta.
    */
    const page =
      pages.find(
        (
          item: {
            id?: string;
            name?: string;
            access_token?: string;
            tasks?: string[];
          }
        ) =>
          item.id ===
          socialAccount.external_account_id
      );

    if (!page) {
      return NextResponse.json(
        {
          ok: false,
          step:
            "match_page",
          error:
            `Page ${socialAccount.external_account_id} was not returned by Meta.`,
        },
        {
          status: 404,
        }
      );
    }

    if (
      !page.access_token
    ) {
      return NextResponse.json(
        {
          ok: false,
          step:
            "page_token",
          error:
            "Page access token is missing.",
        },
        {
          status: 500,
        }
      );
    }

    /*
      8.
      Spara / uppdatera
      long-lived User Token.
    */
    const {
      error:
        userTokenError,
    } = await supabase
      .from(
        "meta_user_tokens"
      )
      .upsert(
        {
          facebook_user_id:
            meData.id,

          access_token:
            longUserToken,

          expires_at:
            expiresAt,

          updated_at:
            new Date()
              .toISOString(),
        },
        {
          onConflict:
            "facebook_user_id",
        }
      );

    if (
      userTokenError
    ) {
      return NextResponse.json(
        {
          ok: false,
          step:
            "save_user_token",
          error:
            userTokenError.message,
        },
        {
          status: 500,
        }
      );
    }

    /*
      9.
      Uppdatera influencerns
      Facebook Page Access Token.
    */
    const {
      error:
        pageTokenError,
    } = await supabase
      .from(
        "social_accounts"
      )
      .update({
        access_token:
          page.access_token,
      })
      .eq(
        "id",
        socialAccount.id
      );

    if (
      pageTokenError
    ) {
      return NextResponse.json(
        {
          ok: false,
          step:
            "save_page_token",
          error:
            pageTokenError.message,
        },
        {
          status: 500,
        }
      );
    }

    /*
      10.
      OAuth klart.

      Skicka tillbaka användaren
      till influencerns sida.
    */
    return NextResponse.redirect(
      new URL(
        `/influencers/${influencerId}?facebook_connected=1`,
        url.origin
      )
    );
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