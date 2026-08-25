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

    const influencerId =
      url.searchParams.get(
        "influencerId"
      );

    if (!influencerId) {
      return NextResponse.json(
        {
          ok: false,
          connected: false,
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
      Facebook-konto.
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
        "facebook"
      )
      .maybeSingle();

    if (accountError) {
      return NextResponse.json(
        {
          ok: false,
          connected: false,
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
      !account.access_token ||
      !account.external_account_id
    ) {
      return NextResponse.json({
        ok: true,
        connected: false,
        reason:
          "not_configured",
      });
    }

    /*
      Verifiera tokenen mot Meta.

      Vi frågar efter Page ID + namn.
      Om detta fungerar vet vi att
      Page Access Token fortfarande
      kan användas.
    */
    const graphUrl =
      new URL(
        `https://graph.facebook.com/v26.0/${account.external_account_id}`
      );

    graphUrl.searchParams.set(
      "fields",
      "id,name"
    );

    graphUrl.searchParams.set(
      "access_token",
      account.access_token
    );

    const response =
      await fetch(
        graphUrl.toString(),
        {
          cache: "no-store",
        }
      );

    const data =
      await response.json();

    if (!response.ok) {
      return NextResponse.json({
        ok: true,
        connected: false,
        reason:
          "token_invalid",
        metaError:
          data?.error?.message ??
          "Facebook token is invalid.",
      });
    }

    /*
      Extra säkerhetskontroll:
      Meta måste svara med samma
      Page ID som vi har sparat.
    */
    if (
      data.id !==
      account.external_account_id
    ) {
      return NextResponse.json({
        ok: true,
        connected: false,
        reason:
          "page_mismatch",
      });
    }

    return NextResponse.json({
      ok: true,
      connected: true,

      account: {
        id:
          account.id,

        pageId:
          data.id,

        name:
          data.name ??
          account.username,
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        connected: false,

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