import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const DEFAULT_MAX_ITEMS = 500;
const MAX_MAX_ITEMS = 1000;
const PAGE_SIZE = 100;
const MAX_PAGE_REQUESTS = 100;

type InstagramMedia = {
  id?: string;
  caption?: string;
  timestamp?: string;
  media_type?: string;
  media_url?: string;
  thumbnail_url?: string;
  permalink?: string;
};

type InstagramMediaPage = {
  data?: InstagramMedia[];
  paging?: {
    next?: unknown;
  };
  [key: string]: unknown;
};

export async function POST(request: Request) {
  try {
    const body = await request.json();

    const influencerId = body.influencerId;
    const maxItems = Number(
      body.maxItems ??
        body.limit ??
        DEFAULT_MAX_ITEMS
    );

    if (!influencerId) {
      return NextResponse.json(
        {
          ok: false,
          error: "influencerId is required.",
        },
        { status: 400 }
      );
    }

    if (
      !Number.isInteger(maxItems) ||
      maxItems < 1 ||
      maxItems > MAX_MAX_ITEMS
    ) {
      return NextResponse.json(
        {
          ok: false,
          error:
            `maxItems must be an integer between 1 and ${MAX_MAX_ITEMS}.`,
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
    const firstPageUrl = new URL(
      `https://graph.instagram.com/${instagramUserId}/media`
    );

    firstPageUrl.searchParams.set(
      "fields",
      "id,caption,timestamp,media_type,media_url,thumbnail_url,permalink"
    );
    firstPageUrl.searchParams.set(
      "limit",
      String(
        Math.min(
          PAGE_SIZE,
          maxItems
        )
      )
    );
    firstPageUrl.searchParams.set(
      "access_token",
      accessToken
    );

    const mediaItems:
      InstagramMedia[] = [];
    const seenMediaIds =
      new Set<string>();
    const visitedPageUrls =
      new Set<string>();
    let duplicateMediaItems =
      0;

    let nextPageUrl:
      string | null =
        firstPageUrl.toString();
    let pagesFetched = 0;

    while (
      nextPageUrl &&
      mediaItems.length <
        maxItems
    ) {
      if (
        pagesFetched >=
        MAX_PAGE_REQUESTS
      ) {
        return NextResponse.json(
          {
            ok: false,
            step:
              "load_instagram_media",
            error:
              "Instagram pagination exceeded the safe page limit.",
          },
          { status: 502 }
        );
      }

      if (
        visitedPageUrls.has(
          nextPageUrl
        )
      ) {
        return NextResponse.json(
          {
            ok: false,
            step:
              "load_instagram_media",
            error:
              "Instagram returned a repeated pagination URL.",
          },
          { status: 502 }
        );
      }

      const pageUrl:
        URL =
        new URL(nextPageUrl);

      if (
        pageUrl.protocol !==
          "https:" ||
        pageUrl.hostname !==
          "graph.instagram.com"
      ) {
        return NextResponse.json(
          {
            ok: false,
            step:
              "load_instagram_media",
            error:
              "Instagram returned an invalid pagination URL.",
          },
          { status: 502 }
        );
      }

      visitedPageUrls.add(
        nextPageUrl
      );

      const mediaResponse:
        Response =
        await fetch(
          pageUrl.toString(),
          {
            cache: "no-store",
          }
        );

      const mediaData:
        InstagramMediaPage =
        await mediaResponse.json();

      if (!mediaResponse.ok) {
        return NextResponse.json(
          {
            ok: false,
            step:
              "load_instagram_media",
            page:
              pagesFetched + 1,
            error: mediaData,
          },
          {
            status:
              mediaResponse.status,
          }
        );
      }

      pagesFetched += 1;

      const pageItems =
        Array.isArray(
          mediaData.data
        )
          ? (mediaData.data as InstagramMedia[])
          : [];

      for (const media of pageItems) {
        if (
          mediaItems.length >=
          maxItems
        ) {
          break;
        }

        if (!media.id) {
          mediaItems.push(media);
          continue;
        }

        if (
          seenMediaIds.has(
            media.id
          )
        ) {
          duplicateMediaItems +=
            1;
          continue;
        }

        seenMediaIds.add(
          media.id
        );
        mediaItems.push(media);
      }

      const pagingNext:
        unknown =
        mediaData?.paging?.next;

      nextPageUrl =
        typeof pagingNext ===
          "string" &&
        pagingNext
          ? pagingNext
          : null;
    }

    const maxItemsReached =
      mediaItems.length >=
        maxItems &&
      Boolean(nextPageUrl);

    const results = [];

    // 3. Spara varje historisk post
    for (const media of mediaItems) {
      try {
        const externalPostId =
          media.id;

        if (!externalPostId) {
          results.push({
            externalPostId: null,
            ok: false,
            status: "failed",
            step:
              "validate_media",
            error:
              "Instagram media item is missing an id.",
          });

          continue;
        }

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
            status: "failed",
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
            status: "skipped",
            reason:
              "already_exists",
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
            status: "failed",
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
          status: "failed",
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
        mediaItems.length +
        duplicateMediaItems,
      pagesFetched,
      maxItems,
      maxItemsReached,
      imported:
        results.filter(
          (item) =>
            item.status ===
            "imported"
        ).length,
      skipped:
        results.filter(
          (item) =>
            item.status ===
            "skipped"
        ).length +
        duplicateMediaItems,
      failed:
        results.filter(
          (item) =>
            item.status ===
            "failed"
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
