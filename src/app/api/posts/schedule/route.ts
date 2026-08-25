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
      imageUrl,
      caption = "",
      scheduledAt,
      platforms = [],
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

    if (
      !Array.isArray(platforms) ||
      platforms.length === 0
    ) {
      return NextResponse.json(
        {
          ok: false,
          error: "At least one platform is required.",
        },
        { status: 400 }
      );
    }

    const allowedPlatforms = [
      "instagram",
      "facebook",
    ];

    const uniquePlatforms =
      Array.from(
        new Set(
          platforms.map(
            (platform: string) =>
              platform.toLowerCase()
          )
        )
      ).filter((platform) =>
        allowedPlatforms.includes(platform)
      );

    if (uniquePlatforms.length === 0) {
      return NextResponse.json(
        {
          ok: false,
          error: "No supported platform selected.",
        },
        { status: 400 }
      );
    }

    // Hämta social accounts för valda plattformar
    const {
      data: socialAccounts,
      error: accountsError,
    } = await supabase
      .from("social_accounts")
      .select(
        `
        id,
        platform,
        username
        `
      )
      .eq(
        "influencer_id",
        influencerId
      )
      .in(
        "platform",
        uniquePlatforms
      );

    if (accountsError) {
      return NextResponse.json(
        {
          ok: false,
          step: "load_accounts",
          error: accountsError.message,
        },
        { status: 500 }
      );
    }

    const accounts =
      socialAccounts ?? [];

    const missingPlatforms =
      uniquePlatforms.filter(
        (platform) =>
          !accounts.some(
            (account) =>
              account.platform ===
              platform
          )
      );

    if (missingPlatforms.length > 0) {
      return NextResponse.json(
        {
          ok: false,
          step: "missing_accounts",
          error:
            `Missing account for: ${missingPlatforms.join(", ")}`,
        },
        { status: 400 }
      );
    }

    // Skapa själva posten
    const {
      data: post,
      error: postError,
    } = await supabase
      .from("posts")
      .insert({
        influencer_id: influencerId,
        platform: "multi",
        caption,
        media_url: imageUrl,
        status: "scheduled",
        scheduled_at: scheduledAt,
      })
      .select("id")
      .single();

    if (postError || !post) {
      return NextResponse.json(
        {
          ok: false,
          step: "create_post",
          error:
            postError?.message ??
            "Could not create post.",
        },
        { status: 500 }
      );
    }

    // Skapa destinationerna
    const destinationRows =
      accounts.map((account) => ({
        post_id: post.id,
        platform: account.platform,
        social_account_id: account.id,
        status: "scheduled",
      }));

    const {
      error: destinationsError,
    } = await supabase
      .from("post_destinations")
      .insert(destinationRows);

    if (destinationsError) {
      await supabase
        .from("posts")
        .delete()
        .eq("id", post.id);

      return NextResponse.json(
        {
          ok: false,
          step: "create_destinations",
          error: destinationsError.message,
        },
        { status: 500 }
      );
    }

    return NextResponse.json({
      ok: true,
      postId: post.id,
      scheduledAt,
      platforms: accounts.map(
        (account) => ({
          platform: account.platform,
          username: account.username,
        })
      ),
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