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
      url.searchParams.get(
        "code"
      );

    const state =
      url.searchParams.get(
        "state"
      );

    const oauthError =
      url.searchParams.get(
        "error"
      );

    if (oauthError) {
      return NextResponse.redirect(
        new URL(
          "/?instagram_error=access_denied",
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
      Hämta influencerId
      från OAuth state.
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

const appId =
  process.env.INSTAGRAM_APP_ID;

const appSecret =
  process.env.INSTAGRAM_APP_SECRET;

    if (
      !appId ||
      !appSecret
    ) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "Instagram app credentials are missing.",
        },
        {
          status: 500,
        }
      );
    }

  const redirectUri =
  process.env.INSTAGRAM_REDIRECT_URI;

if (!redirectUri) {
  return NextResponse.json(
    {
      ok: false,
      error:
        "INSTAGRAM_REDIRECT_URI is missing.",
    },
    {
      status: 500,
    }
  );
}

    /*
      1.
      Authorization code
      ->
      short-lived Instagram token.
    */
    const tokenBody =
      new URLSearchParams({
        client_id:
          appId,

        client_secret:
          appSecret,

        grant_type:
          "authorization_code",

        redirect_uri:
          redirectUri,

        code,
      });

    const tokenResponse =
      await fetch(
        "https://api.instagram.com/oauth/access_token",
        {
          method: "POST",

          headers: {
            "Content-Type":
              "application/x-www-form-urlencoded",
          },

          body:
            tokenBody,
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

    const shortToken =
      tokenData.access_token;

    if (!shortToken) {
      return NextResponse.json(
        {
          ok: false,
          step:
            "exchange_code",
          error:
            "Instagram did not return an access token.",
        },
        {
          status: 500,
        }
      );
    }

    /*
      2.
      Short-lived Instagram token
      ->
      long-lived Instagram token.
    */
    const exchangeUrl =
      new URL(
        "https://graph.instagram.com/access_token"
      );

    exchangeUrl.searchParams.set(
      "grant_type",
      "ig_exchange_token"
    );

    exchangeUrl.searchParams.set(
      "client_secret",
      appSecret
    );

    exchangeUrl.searchParams.set(
      "access_token",
      shortToken
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

    const longToken =
      exchangeData.access_token;

    if (!longToken) {
      return NextResponse.json(
        {
          ok: false,
          step:
            "exchange_long_lived",
          error:
            "Instagram did not return a long-lived access token.",
        },
        {
          status: 500,
        }
      );
    }

    /*
      3.
      Hämta Instagram-kontot
      direkt från graph.instagram.com.
    */
    const profileUrl =
      new URL(
        "https://graph.instagram.com/me"
      );

    profileUrl.searchParams.set(
      "fields",
      "id,username"
    );

    profileUrl.searchParams.set(
      "access_token",
      longToken
    );

    const profileResponse =
      await fetch(
        profileUrl.toString(),
        {
          cache:
            "no-store",
        }
      );

    const profileData =
      await profileResponse.json();

    if (
      !profileResponse.ok
    ) {
      return NextResponse.json(
        {
          ok: false,
          step:
            "load_instagram_profile",
          error:
            profileData,
        },
        {
          status:
            profileResponse.status,
        }
      );
    }

    const instagramId =
      profileData.id;

    const instagramUsername =
      profileData.username;

    if (
      !instagramId ||
      !instagramUsername
    ) {
      return NextResponse.json(
        {
          ok: false,
          step:
            "load_instagram_profile",
          error:
            "Instagram profile did not contain id and username.",
        },
        {
          status: 500,
        }
      );
    }

    /*
      4.
      Hämta befintligt
      Instagramkonto för influencern.
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
        username,
        external_account_id
        `
      )
      .eq(
        "influencer_id",
        influencerId
      )
      .eq(
        "platform",
        "instagram"
      )
      .maybeSingle();

    if (
      socialAccountError
    ) {
      return NextResponse.json(
        {
          ok: false,
          step:
            "load_social_account",
          error:
            socialAccountError.message,
        },
        {
          status: 500,
        }
      );
    }

    /*
      Säkerhetskontroll.

      Om det redan finns ett konto
      måste username stämma.

      Vi använder username eftersom vi
      redan sett att Meta kan exponera
      olika ID-typer för samma konto.
    */
    if (socialAccount) {
      const storedUsername =
        String(
          socialAccount.username ??
            ""
        ).toLowerCase();

      const returnedUsername =
        String(
          instagramUsername
        ).toLowerCase();

      if (
        storedUsername &&
        storedUsername !==
          returnedUsername
      ) {
        return NextResponse.json(
          {
            ok: false,
            step:
              "account_mismatch",
            error:
              `Connected Instagram account @${instagramUsername} does not match @${socialAccount.username}.`,
          },
          {
            status: 400,
          }
        );
      }
    }

    /*
      5.
      Spara Instagram-token
      och kontoinformation.
    */
    if (socialAccount) {
      const {
        error:
          updateError,
      } = await supabase
        .from(
          "social_accounts"
        )
        .update({
          username:
            instagramUsername,

          external_account_id:
            instagramId,

          access_token:
            longToken,
        })
        .eq(
          "id",
          socialAccount.id
        );

      if (updateError) {
        return NextResponse.json(
          {
            ok: false,
            step:
              "save_instagram_account",
            error:
              updateError.message,
          },
          {
            status: 500,
          }
        );
      }
    } else {
      const {
        error:
          insertError,
      } = await supabase
        .from(
          "social_accounts"
        )
        .insert({
          influencer_id:
            influencerId,

          platform:
            "instagram",

          username:
            instagramUsername,

          external_account_id:
            instagramId,

          access_token:
            longToken,
        });

      if (insertError) {
        return NextResponse.json(
          {
            ok: false,
            step:
              "create_instagram_account",
            error:
              insertError.message,
          },
          {
            status: 500,
          }
        );
      }
    }

    /*
      6.
      OAuth klart.
    */
    return NextResponse.redirect(
      new URL(
        `/influencers/${influencerId}?instagram_connected=1`,
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