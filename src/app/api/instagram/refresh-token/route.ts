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

    const influencerId =
      body.influencerId;

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
      Hämta influencerns
      Instagram-konto.
    */
    const {
      data: account,
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
        "instagram"
      )
      .maybeSingle();

    if (accountError) {
      return NextResponse.json(
        {
          ok: false,
          step:
            "load_account",
          error:
            accountError.message,
        },
        {
          status: 500,
        }
      );
    }

    if (
      !account ||
      !account.access_token
    ) {
      return NextResponse.json(
        {
          ok: false,
          step:
            "load_account",
          error:
            "Instagram account not found.",
        },
        {
          status: 404,
        }
      );
    }

    /*
      Instagram long-lived tokens
      refreshas via graph.instagram.com.
    */
    const refreshUrl =
      new URL(
        "https://graph.instagram.com/refresh_access_token"
      );

    refreshUrl.searchParams.set(
      "grant_type",
      "ig_refresh_token"
    );

    refreshUrl.searchParams.set(
      "access_token",
      account.access_token
    );

    const refreshResponse =
      await fetch(
        refreshUrl.toString(),
        {
          method: "GET",
          cache: "no-store",
        }
      );

    const refreshData =
      await refreshResponse.json();

    if (
      !refreshResponse.ok
    ) {
      return NextResponse.json(
        {
          ok: false,
          step:
            "refresh_token",
          error:
            refreshData,
        },
        {
          status:
            refreshResponse.status,
        }
      );
    }

    const newAccessToken =
      refreshData.access_token;

    const expiresIn =
      Number(
        refreshData.expires_in ??
          0
      );

    if (!newAccessToken) {
      return NextResponse.json(
        {
          ok: false,
          step:
            "refresh_token",
          error:
            "Instagram did not return a refreshed access token.",
        },
        {
          status: 500,
        }
      );
    }

    /*
      Spara den nya tokenen.
    */
    const {
      error: updateError,
    } = await supabase
      .from("social_accounts")
      .update({
        access_token:
          newAccessToken,
      })
      .eq(
        "id",
        account.id
      );

    if (updateError) {
      return NextResponse.json(
        {
          ok: false,
          step:
            "save_token",
          error:
            updateError.message,
        },
        {
          status: 500,
        }
      );
    }

    return NextResponse.json({
      ok: true,

      username:
        account.username,

      instagramId:
        account.external_account_id,

      expiresIn,
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