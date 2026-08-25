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

type PublishedPost = {
  id: string;
  caption: string | null;
  media_url: string | null;
  published_at: string | null;
  external_post_id: string | null;
  likes: number | null;
  comments: number | null;
  saves: number | null;
  shares: number | null;
  reach: number | null;
  views: number | null;
};

function formatPublishedTime(
  value: string
) {
  return new Intl.DateTimeFormat(
    "sv-SE",
    {
      timeZone: "Europe/Stockholm",
      day: "numeric",
      month: "long",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }
  ).format(new Date(value));
}

function formatNumber(
  value: number | null
) {
  return new Intl.NumberFormat(
    "sv-SE"
  ).format(value ?? 0);
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
        data: influencerData,
        error: influencerError,
      } = await supabase
        .from("influencers")
        .select("id, name")
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
        data: publishedPosts,
        error: postsError,
      } = await supabase
        .from("posts")
        .select(
          `
          id,
          caption,
          media_url,
          published_at,
          external_post_id,
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
          "platform",
          "instagram"
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

      if (postsError) {
        throw new Error(
          postsError.message
        );
      }

      setPosts(
        publishedPosts ?? []
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

const analytics = (() => {
  const analyzedPosts =
    posts.filter(
      (post) =>
        (post.reach ?? 0) > 0 ||
        (post.views ?? 0) > 0 ||
        (post.likes ?? 0) > 0 ||
        (post.comments ?? 0) > 0 ||
        (post.saves ?? 0) > 0 ||
        (post.shares ?? 0) > 0
    );

  const totalReach =
    analyzedPosts.reduce(
      (sum, post) =>
        sum +
        (post.reach ?? 0),
      0
    );

  const totalViews =
    analyzedPosts.reduce(
      (sum, post) =>
        sum +
        (post.views ?? 0),
      0
    );

  const totalLikes =
    analyzedPosts.reduce(
      (sum, post) =>
        sum +
        (post.likes ?? 0),
      0
    );

  const totalComments =
    analyzedPosts.reduce(
      (sum, post) =>
        sum +
        (post.comments ?? 0),
      0
    );

  const totalSaves =
    analyzedPosts.reduce(
      (sum, post) =>
        sum +
        (post.saves ?? 0),
      0
    );

  const totalShares =
    analyzedPosts.reduce(
      (sum, post) =>
        sum +
        (post.shares ?? 0),
      0
    );

  const totalEngagements =
    totalLikes +
    totalComments +
    totalSaves +
    totalShares;

  const engagementRate =
    totalReach > 0
      ? (
          (totalEngagements /
            totalReach) *
          100
        )
      : 0;

  const scoredPosts =
    analyzedPosts.map(
      (post) => {
        const score =
          (post.likes ?? 0) +
          (post.comments ?? 0) *
            3 +
          (post.saves ?? 0) *
            4 +
          (post.shares ?? 0) *
            4;

        const normalizedScore =
          (post.reach ?? 0) > 0
            ? (score /
                (post.reach ??
                  1)) *
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
    [...scoredPosts].sort(
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
    totalComments,
    totalSaves,
    totalShares,
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
              {influencer.name}
            </p>

            <h1 className="mt-2 text-4xl font-bold">
              Published Posts
            </h1>

            <p className="mt-2 text-zinc-400">
              Publicerade Instagram-inlägg
              och deras resultat.
            </p>
          </div>

          <div className="rounded-full border border-zinc-800 bg-zinc-900 px-4 py-2 text-sm text-zinc-400">
            {posts.length} publicerade
          </div>

        </div>

        <div className="mt-10">

  {posts.length > 0 && (
    <div className="mb-10">

      <div className="mb-5 flex items-end justify-between">
        <div>
          <h2 className="text-2xl font-bold">
            Analytics
          </h2>

          <p className="mt-1 text-sm text-zinc-500">
            Baserat på{" "}
            {analytics.analyzedPosts}{" "}
            analyserade inlägg
          </p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">

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

      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">

        <div className="rounded-2xl border border-zinc-800 bg-zinc-900 p-5">

          <p className="text-sm text-zinc-500">
            Interactions
          </p>

          <div className="mt-4 grid grid-cols-2 gap-4">

            <div>
              <div className="text-2xl font-bold">
                {formatNumber(
                  analytics.totalLikes
                )}
              </div>

              <div className="mt-1 text-xs text-zinc-500">
                Likes
              </div>
            </div>

            <div>
              <div className="text-2xl font-bold">
                {formatNumber(
                  analytics.totalComments
                )}
              </div>

              <div className="mt-1 text-xs text-zinc-500">
                Comments
              </div>
            </div>

            <div>
              <div className="text-2xl font-bold">
                {formatNumber(
                  analytics.totalSaves
                )}
              </div>

              <div className="mt-1 text-xs text-zinc-500">
                Saves
              </div>
            </div>

            <div>
              <div className="text-2xl font-bold">
                {formatNumber(
                  analytics.totalShares
                )}
              </div>

              <div className="mt-1 text-xs text-zinc-500">
                Shares
              </div>
            </div>

          </div>
        </div>

        {analytics.bestPost && (
          <div className="overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-900 lg:col-span-2">

            <div className="flex h-full">

              {analytics.bestPost.post
                .media_url && (
                <div className="w-32 shrink-0 bg-zinc-800 sm:w-44">
                  <img
                    src={
                      analytics.bestPost
                        .post.media_url
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
                  {analytics.bestPost.post
                    .caption ||
                    "Ingen caption"}
                </p>

                <div className="mt-4 flex flex-wrap gap-4 text-sm">

                  <span>
                    ♥{" "}
                    {formatNumber(
                      analytics.bestPost
                        .post.likes
                    )}
                  </span>

                  <span>
                    🔖{" "}
                    {formatNumber(
                      analytics.bestPost
                        .post.saves
                    )}
                  </span>

                  <span>
                    ◎{" "}
                    {formatNumber(
                      analytics.bestPost
                        .post.reach
                    )}
                  </span>

                  <span>
                    ◉{" "}
                    {formatNumber(
                      analytics.bestPost
                        .post.views
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

  {posts.length === 0 ? (
            <div className="rounded-2xl border border-zinc-800 bg-zinc-900 p-10 text-center">

              <div className="text-4xl">
                📊
              </div>

              <h2 className="mt-4 text-xl font-semibold">
                Inga publicerade inlägg
              </h2>

              <p className="mt-2 text-sm text-zinc-500">
                Publicerade Instagram-inlägg
                kommer att visas här.
              </p>

            </div>
          ) : (
            <div className="space-y-5">

              {posts.map(
                (post) => (
                  <div
                    key={post.id}
                    className="overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-900"
                  >
                    <div className="flex flex-col md:flex-row">

                      <div className="h-80 w-full shrink-0 bg-zinc-800 md:h-auto md:w-72">

                        {post.media_url ? (
                          <img
                            src={post.media_url}
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

                        <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3">

                          <Stat
                            label="Likes"
                            value={post.likes}
                            icon="♥"
                          />

                          <Stat
                            label="Comments"
                            value={post.comments}
                            icon="💬"
                          />

                          <Stat
                            label="Saves"
                            value={post.saves}
                            icon="🔖"
                          />

                          <Stat
                            label="Shares"
                            value={post.shares}
                            icon="↗"
                          />

                          <Stat
                            label="Reach"
                            value={post.reach}
                            icon="◎"
                          />

                          <Stat
                            label="Views"
                            value={post.views}
                            icon="◉"
                          />

                        </div>

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
        {formatNumber(value)}
      </div>

    </div>
  );
}