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

    const graphUrl =
      new URL(
        `https://graph.instagram.com/${account.external_account_id}`
      );

    graphUrl.searchParams.set(
      "fields",
      "id,username"
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
          "Instagram token is invalid.",
      });
    }

    const idMatches =
      String(data.id) ===
      String(
        account.external_account_id
      );

    const usernameMatches =
      String(
        data.username ?? ""
      ).toLowerCase() ===
      String(
        account.username ?? ""
      ).toLowerCase();

    if (
      !idMatches &&
      !usernameMatches
    ) {
      return NextResponse.json({
        ok: true,
        connected: false,
        reason:
          "account_mismatch",
      });
    }

    return NextResponse.json({
      ok: true,
      connected: true,

      account: {
        id:
          account.id,

        instagramId:
          data.id,

        username:
          data.username ??
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