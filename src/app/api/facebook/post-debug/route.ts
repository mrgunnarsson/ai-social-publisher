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
    const url = new URL(request.url);

    const influencerId =
      url.searchParams.get("influencerId");

    const postId =
      url.searchParams.get("postId");

    if (!influencerId || !postId) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "influencerId and postId are required.",
        },
        { status: 400 }
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

    if (
      accountError ||
      !account?.access_token
    ) {
      return NextResponse.json(
        {
          ok: false,
          step: "load_account",
          error:
            accountError?.message ??
            "Facebook account not found.",
        },
        { status: 500 }
      );
    }

    /*
      TEST 1:
      Läs objektet direkt.
    */
    const objectUrl =
      new URL(
        `https://graph.facebook.com/v26.0/${postId}`
      );

    objectUrl.searchParams.set(
      "fields",
      "id,message,created_time,permalink_url"
    );

    objectUrl.searchParams.set(
      "access_token",
      account.access_token
    );

    const objectResponse =
      await fetch(
        objectUrl.toString(),
        {
          cache: "no-store",
        }
      );

    const objectData =
      await objectResponse.json();

    /*
      TEST 2:
      Läs insights direkt.
    */
    const insightsUrl =
      new URL(
        `https://graph.facebook.com/v26.0/${postId}/insights`
      );

    insightsUrl.searchParams.set(
      "metric",
      "post_clicks,post_video_views"
    );

    insightsUrl.searchParams.set(
      "access_token",
      account.access_token
    );

    const insightsResponse =
      await fetch(
        insightsUrl.toString(),
        {
          cache: "no-store",
        }
      );

    const insightsData =
      await insightsResponse.json();

    return NextResponse.json({
      ok: true,

      page: {
        id:
          account.external_account_id,
        name:
          account.username,
      },

      requestedPostId:
        postId,

      objectTest: {
        status:
          objectResponse.status,
        ok:
          objectResponse.ok,
        data:
          objectData,
      },

      insightsTest: {
        status:
          insightsResponse.status,
        ok:
          insightsResponse.ok,
        data:
          insightsData,
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