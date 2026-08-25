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
    const limit = Number(body.limit ?? 50);

    if (!influencerId) {
      return NextResponse.json(
        {
          ok: false,
          error: "influencerId is required.",
        },
        { status: 400 }
      );
    }

    // 1. Hämta rätt Instagramkonto
    const {
      data: socialAccount,
      error: accountError,
    } = await supabase
      .from("social_accounts")
      .select(
        "id, external_account_id, access_token, username"
      )
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

    const instagramUserId =
      socialAccount.external_account_id;

    const accessToken =
      socialAccount.access_token;

    // 2. Hämta historiska media från Instagram
    const mediaResponse = await fetch(
      `https://graph.instagram.com/${instagramUserId}/media` +
        `?fields=id,caption,timestamp,media_type,media_url,thumbnail_url,permalink` +
        `&limit=${limit}` +
        `&access_token=${accessToken}`,
      {
        cache: "no-store",
      }
    );

    const mediaData =
      await mediaResponse.json();

    if (!mediaResponse.ok) {
      return NextResponse.json(
        {
          ok: false,
          step: "load_instagram_media",
          error: mediaData,
        },
        {
          status: mediaResponse.status,
        }
      );
    }

    const mediaItems =
      Array.isArray(mediaData.data)
        ? mediaData.data
        : [];

    const results = [];

    // 3. Spara varje historisk post
    for (const media of mediaItems) {
      try {
        const externalPostId =
          media.id;

        const caption =
          media.caption ?? "";

        const publishedAt =
          media.timestamp;

        const mediaType =
          media.media_type ?? null;

        const mediaUrl =
          media.media_url ??
          media.thumbnail_url ??
          null;

        const permalink =
          media.permalink ?? null;

        // Kontrollera om posten redan finns
        const {
          data: existingPost,
          error: existingError,
        } = await supabase
          .from("posts")
          .select("id")
          .eq(
            "influencer_id",
            influencerId
          )
          .eq(
            "platform",
            "instagram"
          )
          .eq(
            "external_post_id",
            externalPostId
          )
          .maybeSingle();

        if (existingError) {
          results.push({
            externalPostId,
            ok: false,
            step: "check_existing",
            error:
              existingError.message,
          });

          continue;
        }

        if (existingPost) {
          results.push({
            externalPostId,
            ok: true,
            status: "already_exists",
          });

          continue;
        }

        const {
          error: insertError,
        } = await supabase
          .from("posts")
          .insert({
            influencer_id:
              influencerId,

            platform:
              "instagram",

            social_account_id:
              socialAccount.id,

            caption,

            media_url:
              mediaUrl,

            external_post_id:
              externalPostId,

            status:
              "published",

            published_at:
              publishedAt,

            likes:
              0,

            comments:
              0,

            saves:
              0,

            shares:
              0,

            reach:
              0,

            views:
              0,
          });

        if (insertError) {
          results.push({
            externalPostId,
            ok: false,
            step: "insert",
            error:
              insertError.message,
          });

          continue;
        }

        results.push({
          externalPostId,
          ok: true,
          status: "imported",
          mediaType,
          permalink,
          publishedAt,
        });
      } catch (error) {
        results.push({
          externalPostId:
            media?.id ?? null,
          ok: false,
          error:
            error instanceof Error
              ? error.message
              : "Unknown error",
        });
      }
    }

    return NextResponse.json({
      ok: true,
      username:
        socialAccount.username,
      found:
        mediaItems.length,
      imported:
        results.filter(
          (item) =>
            item.status ===
            "imported"
        ).length,
      existing:
        results.filter(
          (item) =>
            item.status ===
            "already_exists"
        ).length,
      results,
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