import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

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
    const scheduledAt = body.scheduledAt;

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

    if (!scheduledAt) {
      return NextResponse.json(
        {
          ok: false,
          error: "scheduledAt is required.",
        },
        { status: 400 }
      );
    }

    const {
      data: socialAccount,
      error: accountError,
    } = await supabase
      .from("social_accounts")
      .select("id, username")
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

    const {
      data: post,
      error: insertError,
    } = await supabase
      .from("posts")
      .insert({
        influencer_id: influencerId,
        platform: "instagram",
        social_account_id: socialAccount.id,
        caption,
        media_url: imageUrl,
        status: "scheduled",
        scheduled_at: scheduledAt,
      })
      .select("id")
      .single();

    if (insertError || !post) {
      return NextResponse.json(
        {
          ok: false,
          step: "save_schedule",
          error:
            insertError?.message ??
            "Could not schedule post.",
        },
        { status: 500 }
      );
    }

    return NextResponse.json({
      ok: true,
      postId: post.id,
      username: socialAccount.username,
      scheduledAt,
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