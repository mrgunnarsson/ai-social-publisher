"use client";

import {
  useEffect,
  useState,
} from "react";

import { useParams } from "next/navigation";
import { supabase } from "@/lib/supabase";

type Influencer = {
  id: string;
  name: string;
};

type PlatformFilter =
  | "all"
  | "instagram"
  | "facebook";

type PublishedPost = {
  id: string;
  caption: string | null;
  media_url: string | null;
  published_at: string | null;
  external_post_id: string | null;
  platform: string | null;
  likes: number | null;
  comments: number | null;
  saves: number | null;
  shares: number | null;
  reach: number | null;
  views: number | null;
};

type PostDestination = {
  id: string;
  post_id: string;
  platform: string;
  status: string;
  external_post_id: string | null;
  published_at: string | null;
  reactions: number | null;
  comments: number | null;
  shares: number | null;
  clicks: number | null;
  views: number | null;
};

type AnalyticsPost = {
  id: string;
  postId: string;

  caption: string | null;
  media_url: string | null;
  published_at: string | null;

  platform:
    | "instagram"
    | "facebook"
    | "all";

  hasInstagram: boolean;
  hasFacebook: boolean;

  likes: number;
  reactions: number;
  comments: number;
  saves: number;
  shares: number;
  clicks: number;
  reach: number;
  views: number;
};

function formatPublishedTime(
  value: string
) {
  return new Intl.DateTimeFormat(
    "sv-SE",
    {
      timeZone:
        "Europe/Stockholm",
      day: "numeric",
      month: "long",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }
  ).format(
    new Date(value)
  );
}

function formatNumber(
  value: number | null
) {
  return new Intl.NumberFormat(
    "sv-SE"
  ).format(
    value ?? 0
  );
}

export default function PublishedPostsPage() {
  const params =
    useParams();

  const influencerId =
    params.id as string;

  const [
    influencer,
    setInfluencer,
  ] =
    useState<Influencer | null>(
      null
    );

  const [
    posts,
    setPosts,
  ] =
    useState<PublishedPost[]>(
      []
    );

  const [
    destinations,
    setDestinations,
  ] =
    useState<
      PostDestination[]
    >([]);

  const [
    platformFilter,
    setPlatformFilter,
  ] =
    useState<PlatformFilter>(
      "all"
    );

  const [
    loading,
    setLoading,
  ] =
    useState(true);

  const [
    error,
    setError,
  ] =
    useState("");

  async function loadData() {
    try {
      setLoading(true);
      setError("");

      const {
        data:
          influencerData,
        error:
          influencerError,
      } = await supabase
        .from("influencers")
        .select(
          "id, name"
        )
        .eq(
          "id",
          influencerId
        )
        .single();

      if (
        influencerError ||
        !influencerData
      ) {
        throw new Error(
          "Influencer hittades inte."
        );
      }

      setInfluencer(
        influencerData
      );

      const {
        data:
          publishedPosts,
        error:
          postsError,
      } = await supabase
        .from("posts")
        .select(
          `
          id,
          caption,
          media_url,
          published_at,
          external_post_id,
          platform,
          likes,
          comments,
          saves,
          shares,
          reach,
          views
          `
        )
        .eq(
          "influencer_id",
          influencerId
        )
        .eq(
          "status",
          "published"
        )
        .order(
          "published_at",
          {
            ascending: false,
          }
        );

      if (
        postsError
      ) {
        throw new Error(
          postsError.message
        );
      }

      const loadedPosts =
        publishedPosts ?? [];

      setPosts(
        loadedPosts
      );

      if (
        loadedPosts.length ===
        0
      ) {
        setDestinations(
          []
        );

        return;
      }

      const postIds =
        loadedPosts.map(
          (post) =>
            post.id
        );

      const {
        data:
          postDestinations,
        error:
          destinationsError,
      } = await supabase
        .from(
          "post_destinations"
        )
        .select(
          `
          id,
          post_id,
          platform,
          status,
          external_post_id,
          published_at,
          reactions,
          comments,
          shares,
          clicks,
          views
          `
        )
        .in(
          "post_id",
          postIds
        );

      if (
        destinationsError
      ) {
        throw new Error(
          destinationsError.message
        );
      }

      setDestinations(
        postDestinations ??
          []
      );
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : "Något gick fel."
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadData();
  }, [influencerId]);

  /*
   * INSTAGRAM
   *
   * Instagram Insights ligger
   * fortfarande på posts.
   */
  const instagramPosts: AnalyticsPost[] =
    posts
      .filter(
        (post) => {
          if (
            post.platform ===
            "instagram"
          ) {
            return true;
          }

          return destinations.some(
            (
              destination
            ) =>
              destination.post_id ===
                post.id &&
              destination.platform ===
                "instagram" &&
              destination.status ===
                "published"
          );
        }
      )
      .map(
        (post) => ({
          id:
            `instagram-${post.id}`,

          postId:
            post.id,

          caption:
            post.caption,

          media_url:
            post.media_url,

          published_at:
            post.published_at,

          platform:
            "instagram",

          hasInstagram:
            true,

          hasFacebook:
            false,

          likes:
            post.likes ?? 0,

          reactions:
            0,

          comments:
            post.comments ??
            0,

          saves:
            post.saves ?? 0,

          shares:
            post.shares ?? 0,

          clicks:
            0,

          reach:
            post.reach ?? 0,

          views:
            post.views ?? 0,
        })
      );

  /*
   * FACEBOOK
   *
   * Facebook Insights ligger
   * i post_destinations.
   */
  const facebookPosts: AnalyticsPost[] =
    destinations
      .filter(
        (
          destination
        ) =>
          destination.platform ===
            "facebook" &&
          destination.status ===
            "published"
      )
      .map(
        (destination) => {
          const parentPost =
            posts.find(
              (post) =>
                post.id ===
                destination.post_id
            );

          return {
            id:
              `facebook-${destination.id}`,

            postId:
              destination.post_id,

            caption:
              parentPost?.caption ??
              null,

            media_url:
              parentPost?.media_url ??
              null,

            published_at:
              destination.published_at ??
              parentPost?.published_at ??
              null,

            platform:
              "facebook",

            hasInstagram:
              false,

            hasFacebook:
              true,

            likes:
              0,

            reactions:
              destination.reactions ??
              0,

            comments:
              destination.comments ??
              0,

            saves:
              0,

            shares:
              destination.shares ??
              0,

            clicks:
              destination.clicks ??
              0,

            reach:
              0,

            views:
              destination.views ??
              0,
          };
        }
      );

  /*
   * ALL
   *
   * Här grupperar vi på postId.
   *
   * Samma masterpost visas alltså
   * bara EN gång och Instagram +
   * Facebook summeras ihop.
   */
  const allPostsMap =
    new Map<
      string,
      AnalyticsPost
    >();

  for (
    const post
    of instagramPosts
  ) {
    allPostsMap.set(
      post.postId,
      {
        ...post,

        id:
          `all-${post.postId}`,

        platform:
          "all",

        hasInstagram:
          true,

        hasFacebook:
          false,
      }
    );
  }

  for (
    const facebookPost
    of facebookPosts
  ) {
    const existing =
      allPostsMap.get(
        facebookPost.postId
      );

    if (existing) {
      allPostsMap.set(
        facebookPost.postId,
        {
          ...existing,

          hasFacebook:
            true,

          reactions:
            existing.reactions +
            facebookPost.reactions,

          comments:
            existing.comments +
            facebookPost.comments,

          shares:
            existing.shares +
            facebookPost.shares,

          clicks:
            existing.clicks +
            facebookPost.clicks,

          views:
            existing.views +
            facebookPost.views,

          published_at:
            existing.published_at ??
            facebookPost.published_at,

          caption:
            existing.caption ??
            facebookPost.caption,

          media_url:
            existing.media_url ??
            facebookPost.media_url,
        }
      );
    } else {
      allPostsMap.set(
        facebookPost.postId,
        {
          ...facebookPost,

          id:
            `all-${facebookPost.postId}`,

          platform:
            "all",

          hasInstagram:
            false,

          hasFacebook:
            true,
        }
      );
    }
  }

  const allPosts =
    Array.from(
      allPostsMap.values()
    ).sort(
      (a, b) => {
        const aTime =
          a.published_at
            ? new Date(
                a.published_at
              ).getTime()
            : 0;

        const bTime =
          b.published_at
            ? new Date(
                b.published_at
              ).getTime()
            : 0;

        return (
          bTime - aTime
        );
      }
    );

  const filteredPosts =
    platformFilter ===
    "instagram"
      ? instagramPosts
      : platformFilter ===
          "facebook"
        ? facebookPosts
        : allPosts;

  /*
   * ANALYTICS
   */
  const analytics = (() => {
    const analyzedPosts =
      filteredPosts.filter(
        (post) =>
          post.reach > 0 ||
          post.views > 0 ||
          post.likes > 0 ||
          post.reactions >
            0 ||
          post.comments > 0 ||
          post.saves > 0 ||
          post.shares > 0 ||
          post.clicks > 0
      );

    const totalReach =
      analyzedPosts.reduce(
        (sum, post) =>
          sum +
          post.reach,
        0
      );

    const totalViews =
      analyzedPosts.reduce(
        (sum, post) =>
          sum +
          post.views,
        0
      );

    const totalLikes =
      analyzedPosts.reduce(
        (sum, post) =>
          sum +
          post.likes,
        0
      );

    const totalReactions =
      analyzedPosts.reduce(
        (sum, post) =>
          sum +
          post.reactions,
        0
      );

    const totalComments =
      analyzedPosts.reduce(
        (sum, post) =>
          sum +
          post.comments,
        0
      );

    const totalSaves =
      analyzedPosts.reduce(
        (sum, post) =>
          sum +
          post.saves,
        0
      );

    const totalShares =
      analyzedPosts.reduce(
        (sum, post) =>
          sum +
          post.shares,
        0
      );

    const totalClicks =
      analyzedPosts.reduce(
        (sum, post) =>
          sum +
          post.clicks,
        0
      );

    const totalInteractions =
      totalLikes +
      totalReactions +
      totalComments +
      totalSaves +
      totalShares +
      totalClicks;

    const engagementRate =
      totalReach > 0
        ? (
            totalLikes +
            totalComments +
            totalSaves +
            totalShares
          ) /
          totalReach *
          100
        : 0;

    const scoredPosts =
      analyzedPosts.map(
        (post) => {
          const score =
            post.likes +
            post.reactions +
            post.comments *
              3 +
            post.saves *
              4 +
            post.shares *
              4 +
            post.clicks *
              2;

          const denominator =
            post.reach > 0
              ? post.reach
              : post.views >
                  0
                ? post.views
                : 0;

          const normalizedScore =
            denominator > 0
              ? (
                  score /
                  denominator
                ) *
                100
              : score;

          return {
            post,
            score,
            normalizedScore,
          };
        }
      );

    const bestPost =
      [
        ...scoredPosts,
      ].sort(
        (a, b) =>
          b.normalizedScore -
          a.normalizedScore
      )[0] ?? null;

    return {
      analyzedPosts:
        analyzedPosts.length,

      totalReach,
      totalViews,
      totalLikes,
      totalReactions,
      totalComments,
      totalSaves,
      totalShares,
      totalClicks,
      totalInteractions,
      engagementRate,
      bestPost,
    };
  })();

  if (loading) {
    return (
      <main className="min-h-screen bg-zinc-950 p-8 text-white">
        Laddar...
      </main>
    );
  }

  if (
    error ||
    !influencer
  ) {
    return (
      <main className="min-h-screen bg-zinc-950 p-8 text-white">
        {error ||
          "Influencer hittades inte."}
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-zinc-950 px-6 py-10 text-white">

      <div className="mx-auto max-w-5xl">

        <a
          href={`/influencers/${influencerId}`}
          className="text-sm text-zinc-400 transition hover:text-white"
        >
          ← Back
        </a>

        <div className="mt-8 flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">

          <div>

            <p className="text-sm font-medium uppercase tracking-wider text-zinc-500">
              {
                influencer.name
              }
            </p>

            <h1 className="mt-2 text-4xl font-bold">
              Published Posts
            </h1>

            <p className="mt-2 text-zinc-400">
              Publicerade inlägg
              och deras resultat.
            </p>

          </div>

          <div className="rounded-full border border-zinc-800 bg-zinc-900 px-4 py-2 text-sm text-zinc-400">
            {
              filteredPosts.length
            }{" "}
            publicerade
          </div>

        </div>

        <div className="mt-10">

          <div className="mb-8 flex flex-wrap gap-2">

            {[
              {
                value:
                  "all",
                label:
                  "All",
              },
              {
                value:
                  "instagram",
                label:
                  "Instagram",
              },
              {
                value:
                  "facebook",
                label:
                  "Facebook",
              },
            ].map(
              (item) => {
                const active =
                  platformFilter ===
                  item.value;

                return (
                  <button
                    key={
                      item.value
                    }
                    type="button"
                    onClick={() =>
                      setPlatformFilter(
                        item.value as PlatformFilter
                      )
                    }
                    className={`rounded-full px-4 py-2 text-sm font-medium transition ${
                      active
                        ? "bg-white text-black"
                        : "border border-zinc-800 bg-zinc-900 text-zinc-400 hover:text-white"
                    }`}
                  >
                    {
                      item.label
                    }
                  </button>
                );
              }
            )}

          </div>

          {filteredPosts.length >
            0 && (
            <div className="mb-10">

              <div className="mb-5">

                <h2 className="text-2xl font-bold">
                  Analytics
                </h2>

                <p className="mt-1 text-sm text-zinc-500">
                  Baserat på{" "}
                  {
                    analytics.analyzedPosts
                  }{" "}
                  analyserade
                  inlägg
                </p>

              </div>

              <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">

                {platformFilter ===
                "instagram" && (
                  <>
                    <AnalyticsCard
                      label="Total Reach"
                      value={formatNumber(
                        analytics.totalReach
                      )}
                      description="Unika konton nådda"
                    />

                    <AnalyticsCard
                      label="Total Views"
                      value={formatNumber(
                        analytics.totalViews
                      )}
                      description="Totala visningar"
                    />

                    <AnalyticsCard
                      label="Engagement"
                      value={`${analytics.engagementRate.toFixed(
                        1
                      )}%`}
                      description="Av total reach"
                    />

                    <AnalyticsCard
                      label="Total Saves"
                      value={formatNumber(
                        analytics.totalSaves
                      )}
                      description="Sparade inlägg"
                    />
                  </>
                )}

                {platformFilter ===
                "facebook" && (
                  <>
                    <AnalyticsCard
                      label="Reactions"
                      value={formatNumber(
                        analytics.totalReactions
                      )}
                      description="Facebook-reaktioner"
                    />

                    <AnalyticsCard
                      label="Total Views"
                      value={formatNumber(
                        analytics.totalViews
                      )}
                      description="Facebook-visningar"
                    />

                    <AnalyticsCard
                      label="Clicks"
                      value={formatNumber(
                        analytics.totalClicks
                      )}
                      description="Facebook-klick"
                    />

                    <AnalyticsCard
                      label="Shares"
                      value={formatNumber(
                        analytics.totalShares
                      )}
                      description="Facebook-delningar"
                    />
                  </>
                )}

                {platformFilter ===
                "all" && (
                  <>
                    <AnalyticsCard
                      label="Interactions"
                      value={formatNumber(
                        analytics.totalInteractions
                      )}
                      description="Instagram + Facebook"
                    />

                    <AnalyticsCard
                      label="Total Views"
                      value={formatNumber(
                        analytics.totalViews
                      )}
                      description="Instagram + Facebook"
                    />

                    <AnalyticsCard
                      label="Comments"
                      value={formatNumber(
                        analytics.totalComments
                      )}
                      description="Instagram + Facebook"
                    />

                    <AnalyticsCard
                      label="Shares"
                      value={formatNumber(
                        analytics.totalShares
                      )}
                      description="Instagram + Facebook"
                    />
                  </>
                )}

              </div>

              <div className="mt-4 grid gap-4 lg:grid-cols-3">

                <div className="rounded-2xl border border-zinc-800 bg-zinc-900 p-5">

                  <p className="text-sm text-zinc-500">
                    Interactions
                  </p>

                  <div className="mt-4 grid grid-cols-2 gap-4">

                    <InteractionValue
                      value={
                        analytics.totalLikes +
                        analytics.totalReactions
                      }
                      label={
                        platformFilter ===
                        "facebook"
                          ? "Reactions"
                          : platformFilter ===
                              "instagram"
                            ? "Likes"
                            : "Likes / Reactions"
                      }
                    />

                    <InteractionValue
                      value={
                        analytics.totalComments
                      }
                      label="Comments"
                    />

                    <InteractionValue
                      value={
                        analytics.totalSaves
                      }
                      label="Saves"
                    />

                    <InteractionValue
                      value={
                        analytics.totalShares
                      }
                      label="Shares"
                    />

                    {platformFilter !==
                      "instagram" && (
                      <InteractionValue
                        value={
                          analytics.totalClicks
                        }
                        label="Clicks"
                      />
                    )}

                  </div>

                </div>

                {analytics.bestPost && (
                  <div className="overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-900 lg:col-span-2">

                    <div className="flex h-full">

                      {analytics
                        .bestPost
                        .post
                        .media_url && (
                        <div className="w-32 shrink-0 bg-zinc-800 sm:w-44">

                          <img
                            src={
                              analytics
                                .bestPost
                                .post
                                .media_url
                            }
                            alt=""
                            className="h-full min-h-44 w-full object-cover"
                          />

                        </div>
                      )}

                      <div className="flex-1 p-5">

                        <div className="flex items-center gap-2">

                          <span>
                            🏆
                          </span>

                          <p className="text-sm font-semibold">
                            Best Performing Post
                          </p>

                        </div>

                        <p className="mt-3 line-clamp-3 text-sm leading-6 text-zinc-400">
                          {analytics
                            .bestPost
                            .post
                            .caption ||
                            "Ingen caption"}
                        </p>

                        <div className="mt-4 flex flex-wrap gap-4 text-sm">

                          <span>
                            ♥{" "}
                            {formatNumber(
                              analytics
                                .bestPost
                                .post
                                .likes +
                                analytics
                                  .bestPost
                                  .post
                                  .reactions
                            )}
                          </span>

                          <span>
                            💬{" "}
                            {formatNumber(
                              analytics
                                .bestPost
                                .post
                                .comments
                            )}
                          </span>

                          <span>
                            ↗{" "}
                            {formatNumber(
                              analytics
                                .bestPost
                                .post
                                .shares
                            )}
                          </span>

                          <span>
                            ◉{" "}
                            {formatNumber(
                              analytics
                                .bestPost
                                .post
                                .views
                            )}
                          </span>

                        </div>

                      </div>

                    </div>

                  </div>
                )}

              </div>

            </div>
          )}

          {filteredPosts.length ===
          0 ? (
            <div className="rounded-2xl border border-zinc-800 bg-zinc-900 p-10 text-center">

              <div className="text-4xl">
                📊
              </div>

              <h2 className="mt-4 text-xl font-semibold">
                Inga publicerade
                inlägg
              </h2>

              <p className="mt-2 text-sm text-zinc-500">
                Det finns inga
                publicerade inlägg
                för den valda
                plattformen.
              </p>

            </div>
          ) : (
            <div className="space-y-5">

              {filteredPosts.map(
                (post) => (
                  <div
                    key={
                      post.id
                    }
                    className="overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-900"
                  >

                    <div className="flex flex-col md:flex-row">

                      <div className="h-80 w-full shrink-0 bg-zinc-800 md:h-auto md:w-72">

                        {post.media_url ? (
                          <img
                            src={
                              post.media_url
                            }
                            alt=""
                            className="h-full w-full object-cover"
                          />
                        ) : (
                          <div className="flex h-full min-h-72 items-center justify-center text-zinc-600">
                            No media
                          </div>
                        )}

                      </div>

                      <div className="min-w-0 flex-1 p-6">

                        <div className="flex flex-wrap items-center gap-3">

                          <span className="rounded-full bg-green-500/10 px-3 py-1 text-xs font-semibold text-green-400">
                            Published
                          </span>

                          {post.hasInstagram && (
                            <span className="rounded-full border border-zinc-700 bg-zinc-800 px-3 py-1 text-xs font-semibold text-zinc-300">
                              Instagram
                            </span>
                          )}

                          {post.hasFacebook && (
                            <span className="rounded-full border border-zinc-700 bg-zinc-800 px-3 py-1 text-xs font-semibold text-zinc-300">
                              Facebook
                            </span>
                          )}

                          {post.published_at && (
                            <span className="text-sm text-zinc-500">
                              {formatPublishedTime(
                                post.published_at
                              )}
                            </span>
                          )}

                        </div>

                        <p className="mt-5 whitespace-pre-wrap text-sm leading-6 text-zinc-300">
                          {post.caption ||
                            "Ingen caption"}
                        </p>

                        {platformFilter ===
                        "instagram" ? (
                          <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3">

                            <Stat
                              label="Likes"
                              value={
                                post.likes
                              }
                              icon="♥"
                            />

                            <Stat
                              label="Comments"
                              value={
                                post.comments
                              }
                              icon="💬"
                            />

                            <Stat
                              label="Saves"
                              value={
                                post.saves
                              }
                              icon="🔖"
                            />

                            <Stat
                              label="Shares"
                              value={
                                post.shares
                              }
                              icon="↗"
                            />

                            <Stat
                              label="Reach"
                              value={
                                post.reach
                              }
                              icon="◎"
                            />

                            <Stat
                              label="Views"
                              value={
                                post.views
                              }
                              icon="◉"
                            />

                          </div>
                        ) : platformFilter ===
                          "facebook" ? (
                          <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3">

                            <Stat
                              label="Reactions"
                              value={
                                post.reactions
                              }
                              icon="♥"
                            />

                            <Stat
                              label="Comments"
                              value={
                                post.comments
                              }
                              icon="💬"
                            />

                            <Stat
                              label="Shares"
                              value={
                                post.shares
                              }
                              icon="↗"
                            />

                            <Stat
                              label="Clicks"
                              value={
                                post.clicks
                              }
                              icon="↖"
                            />

                            <Stat
                              label="Views"
                              value={
                                post.views
                              }
                              icon="◉"
                            />

                          </div>
                        ) : (
                          <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3">

                            <Stat
                              label="Likes / Reactions"
                              value={
                                post.likes +
                                post.reactions
                              }
                              icon="♥"
                            />

                            <Stat
                              label="Comments"
                              value={
                                post.comments
                              }
                              icon="💬"
                            />

                            <Stat
                              label="Saves"
                              value={
                                post.saves
                              }
                              icon="🔖"
                            />

                            <Stat
                              label="Shares"
                              value={
                                post.shares
                              }
                              icon="↗"
                            />

                            <Stat
                              label="Clicks"
                              value={
                                post.clicks
                              }
                              icon="↖"
                            />

                            <Stat
                              label="Views"
                              value={
                                post.views
                              }
                              icon="◉"
                            />

                            {post.reach >
                              0 && (
                              <Stat
                                label="Instagram Reach"
                                value={
                                  post.reach
                                }
                                icon="◎"
                              />
                            )}

                          </div>
                        )}

                      </div>

                    </div>

                  </div>
                )
              )}

            </div>
          )}

        </div>

      </div>

    </main>
  );
}

function AnalyticsCard({
  label,
  value,
  description,
}: {
  label: string;
  value: string;
  description: string;
}) {
  return (
    <div className="rounded-2xl border border-zinc-800 bg-zinc-900 p-5">

      <p className="text-sm text-zinc-500">
        {label}
      </p>

      <div className="mt-2 text-3xl font-bold tracking-tight">
        {value}
      </div>

      <p className="mt-2 text-xs text-zinc-600">
        {description}
      </p>

    </div>
  );
}

function InteractionValue({
  value,
  label,
}: {
  value: number;
  label: string;
}) {
  return (
    <div>

      <div className="text-2xl font-bold">
        {formatNumber(
          value
        )}
      </div>

      <div className="mt-1 text-xs text-zinc-500">
        {label}
      </div>

    </div>
  );
}

function Stat({
  label,
  value,
  icon,
}: {
  label: string;
  value: number | null;
  icon: string;
}) {
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-3">

      <div className="flex items-center gap-2 text-xs text-zinc-500">

        <span>
          {icon}
        </span>

        {label}

      </div>

      <div className="mt-1 text-lg font-semibold">
        {formatNumber(
          value
        )}
      </div>

    </div>
  );
}