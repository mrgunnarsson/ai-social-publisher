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
          error:
            "influencerId is required.",
        },
        { status: 400 }
      );
    }

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
        { status: 500 }
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
        "facebook"
      )
      .maybeSingle();

    if (accountError) {
      return NextResponse.json(
        {
          ok: false,
          error:
            accountError.message,
        },
        { status: 500 }
      );
    }

    if (
      !account ||
      !account.access_token
    ) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "Facebook account not connected.",
        },
        { status: 404 }
      );
    }

    const appAccessToken =
      `${appId}|${appSecret}`;

    const debugUrl =
      new URL(
        "https://graph.facebook.com/v26.0/debug_token"
      );

    debugUrl.searchParams.set(
      "input_token",
      account.access_token
    );

    debugUrl.searchParams.set(
      "access_token",
      appAccessToken
    );

    const response =
      await fetch(
        debugUrl.toString(),
        {
          cache: "no-store",
        }
      );

    const data =
      await response.json();

    if (!response.ok) {
      return NextResponse.json(
        {
          ok: false,
          error: data,
        },
        {
          status:
            response.status,
        }
      );
    }

    return NextResponse.json({
      ok: true,

      page: {
        id:
          account.external_account_id,
        name:
          account.username,
      },

      token: {
        isValid:
          data.data?.is_valid ??
          false,

        type:
          data.data?.type ??
          null,

        appId:
          data.data?.app_id ??
          null,

        userId:
          data.data?.user_id ??
          null,

        scopes:
          data.data?.scopes ??
          [],

        granularScopes:
          data.data?.granular_scopes ??
          [],
      },
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