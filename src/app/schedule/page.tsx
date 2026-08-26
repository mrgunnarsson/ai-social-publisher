"use client";

import {
  useEffect,
  useMemo,
  useState,
} from "react";

type Influencer = {
  id: string;
  name: string;
};

type Destination = {
  id: string;
  platform: string;
  status: string;
};

type ScheduledPost = {
  id: string;

  influencerId: string;
  influencerName: string;

  caption: string | null;

  mediaUrl: string | null;

  mediaType:
    | "image"
    | "video"
    | null;

  scheduledAt:
    | string
    | null;

  status: string;

  platform: string;

  destinations:
    Destination[];
};

type ScheduleResponse = {
  ok: boolean;

  count?: number;

  posts?:
    ScheduledPost[];

  influencers?:
    Influencer[];

  error?: string;
};

function formatDay(
  value: string
) {
  return new Intl.DateTimeFormat(
    "sv-SE",
    {
      weekday: "long",
      day: "numeric",
      month: "long",
    }
  ).format(
    new Date(value)
  );
}

function formatFullDate(
  value: string
) {
  return new Intl.DateTimeFormat(
    "sv-SE",
    {
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric",
    }
  ).format(
    new Date(value)
  );
}

function formatTime(
  value: string
) {
  return new Intl.DateTimeFormat(
    "sv-SE",
    {
      hour: "2-digit",
      minute: "2-digit",
    }
  ).format(
    new Date(value)
  );
}

function getDateKey(
  value: string
) {
  return new Intl.DateTimeFormat(
    "sv-SE",
    {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }
  ).format(
    new Date(value)
  );
}

export default function SchedulePage() {
  const [
    influencerId,
    setInfluencerId,
  ] =
    useState("all");

  const [
    days,
    setDays,
  ] =
    useState(30);

  const [
    influencers,
    setInfluencers,
  ] =
    useState<
      Influencer[]
    >([]);

  const [
    posts,
    setPosts,
  ] =
    useState<
      ScheduledPost[]
    >([]);

  const [
    selectedPost,
    setSelectedPost,
  ] =
    useState<
      ScheduledPost | null
    >(null);

  const [
    loading,
    setLoading,
  ] =
    useState(true);

  const [
    actionLoading,
    setActionLoading,
  ] =
    useState(false);

  const [
    error,
    setError,
  ] =
    useState("");

  const [
    actionError,
    setActionError,
  ] =
    useState("");

  async function loadSchedule() {
    try {
      setLoading(true);

      setError("");

      const params =
        new URLSearchParams({
          influencerId,
          days:
            String(days),
        });

      const response =
        await fetch(
          `/api/schedule?${params.toString()}`,
          {
            cache:
              "no-store",
          }
        );

      const data:
        ScheduleResponse =
        await response.json();

      if (
        !response.ok ||
        !data.ok
      ) {
        throw new Error(
          data.error ??
            "Kunde inte hämta schemat."
        );
      }

      setPosts(
        data.posts ??
          []
      );

      setInfluencers(
        data.influencers ??
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
    loadSchedule();
  }, [
    influencerId,
    days,
  ]);

  /*
   * ESC stänger modalen.
   */
  useEffect(() => {
    function handleKeyDown(
      event: KeyboardEvent
    ) {
      if (
        event.key ===
        "Escape"
      ) {
        setSelectedPost(
          null
        );

        setActionError(
          ""
        );
      }
    }

    window.addEventListener(
      "keydown",
      handleKeyDown
    );

    return () => {
      window.removeEventListener(
        "keydown",
        handleKeyDown
      );
    };
  }, []);

  const groupedPosts =
    useMemo(() => {
      const groups =
        new Map<
          string,
          ScheduledPost[]
        >();

      for (
        const post of posts
      ) {
        if (
          !post.scheduledAt
        ) {
          continue;
        }

        const key =
          getDateKey(
            post.scheduledAt
          );

        const existing =
          groups.get(
            key
          ) ?? [];

        existing.push(
          post
        );

        groups.set(
          key,
          existing
        );
      }

      return Array.from(
        groups.entries()
      );
    }, [posts]);

  async function publishNow(
    post: ScheduledPost
  ) {
    try {
      setActionLoading(
        true
      );

      setActionError(
        ""
      );

      const response =
        await fetch(
          "/api/posts/publish-now",
          {
            method:
              "POST",

            headers: {
              "Content-Type":
                "application/json",
            },

            body:
              JSON.stringify({
                postId:
                  post.id,
              }),
          }
        );

      const data =
        await response.json();

      if (
        !response.ok ||
        !data.ok
      ) {
        throw new Error(
          data.error ??
            "Publiceringen misslyckades."
        );
      }

      setSelectedPost(
        null
      );

      await loadSchedule();
    } catch (error) {
      setActionError(
        error instanceof Error
          ? error.message
          : "Publiceringen misslyckades."
      );
    } finally {
      setActionLoading(
        false
      );
    }
  }

  async function cancelSchedule(
    post: ScheduledPost
  ) {
    const confirmed =
      window.confirm(
        "Vill du avbryta schemaläggningen för den här posten?"
      );

    if (!confirmed) {
      return;
    }

    try {
      setActionLoading(
        true
      );

      setActionError(
        ""
      );

      const response =
        await fetch(
          "/api/posts/cancel",
          {
            method:
              "POST",

            headers: {
              "Content-Type":
                "application/json",
            },

            body:
              JSON.stringify({
                postId:
                  post.id,
              }),
          }
        );

      const data =
        await response.json();

      if (
        !response.ok ||
        !data.ok
      ) {
        throw new Error(
          data.error ??
            "Kunde inte avbryta schemaläggningen."
        );
      }

      setSelectedPost(
        null
      );

      await loadSchedule();
    } catch (error) {
      setActionError(
        error instanceof Error
          ? error.message
          : "Kunde inte avbryta schemaläggningen."
      );
    } finally {
      setActionLoading(
        false
      );
    }
  }

  return (
    <main className="min-h-screen bg-zinc-950 px-6 py-10 text-white">

      <div className="mx-auto max-w-6xl">

        <a
          href="/"
          className="text-sm text-zinc-400 transition hover:text-white"
        >
          ← Back
        </a>

        <div className="mt-8 flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">

          <div>

            <p className="text-sm font-medium uppercase tracking-wider text-zinc-500">
              Publishing
            </p>

            <h1 className="mt-2 text-4xl font-bold">
              Schedule
            </h1>

            <p className="mt-2 text-zinc-400">
              Kommande publiceringar för alla eller enskilda influencers.
            </p>

          </div>

          <div className="flex flex-col gap-3 sm:flex-row">

            <select
              value={
                influencerId
              }
              onChange={(
                event
              ) =>
                setInfluencerId(
                  event.target.value
                )
              }
              className="rounded-xl border border-zinc-700 bg-zinc-900 px-4 py-3 text-sm outline-none"
            >

              <option value="all">
                Alla influencers
              </option>

              {influencers.map(
                (
                  influencer
                ) => (
                  <option
                    key={
                      influencer.id
                    }
                    value={
                      influencer.id
                    }
                  >
                    {
                      influencer.name
                    }
                  </option>
                )
              )}

            </select>

            <select
              value={
                days
              }
              onChange={(
                event
              ) =>
                setDays(
                  Number(
                    event.target.value
                  )
                )
              }
              className="rounded-xl border border-zinc-700 bg-zinc-900 px-4 py-3 text-sm outline-none"
            >

              <option value="7">
                7 dagar
              </option>

              <option value="30">
                30 dagar
              </option>

              <option value="90">
                90 dagar
              </option>

            </select>

          </div>

        </div>

        <div className="mt-8 flex items-center justify-between rounded-2xl border border-zinc-800 bg-zinc-900 px-5 py-4">

          <div>

            <p className="text-sm text-zinc-500">
              Scheduled posts
            </p>

            <p className="mt-1 text-2xl font-bold">
              {posts.length}
            </p>

          </div>

          {influencerId !==
            "all" && (
            <a
              href={`/influencers/${influencerId}/create`}
              className="rounded-xl bg-white px-4 py-2 text-sm font-semibold text-black transition hover:bg-zinc-200"
            >
              Create post
            </a>
          )}

        </div>

        {loading ? (
          <div className="mt-10 text-zinc-500">
            Hämtar schema...
          </div>
        ) : error ? (
          <div className="mt-10 rounded-2xl border border-red-900/40 bg-red-950/30 p-5 text-red-300">
            {error}
          </div>
        ) : groupedPosts.length ===
          0 ? (
          <div className="mt-10 rounded-2xl border border-dashed border-zinc-800 p-12 text-center">

            <p className="text-lg font-medium">
              Inga schemalagda poster
            </p>

            <p className="mt-2 text-sm text-zinc-500">
              Det finns inga kommande publiceringar inom vald period.
            </p>

          </div>
        ) : (
          <div className="mt-10 space-y-10">

            {groupedPosts.map(
              ([
                date,
                datePosts,
              ]) => (
                <section
                  key={
                    date
                  }
                >

                  <div className="mb-4 flex items-center gap-3">

                    <h2 className="text-xl font-semibold capitalize">
                      {formatDay(
                        datePosts[0]
                          .scheduledAt!
                      )}
                    </h2>

                    <span className="rounded-full bg-zinc-900 px-2.5 py-1 text-xs text-zinc-500">
                      {
                        datePosts.length
                      }{" "}
                      {datePosts.length ===
                      1
                        ? "post"
                        : "posts"}
                    </span>

                  </div>

                  <div className="space-y-3">

                    {datePosts.map(
                      (
                        post
                      ) => (
                        <ScheduledPostCard
                          key={
                            post.id
                          }
                          post={
                            post
                          }
                          onClick={() => {
                            setActionError(
                              ""
                            );

                            setSelectedPost(
                              post
                            );
                          }}
                        />
                      )
                    )}

                  </div>

                </section>
              )
            )}

          </div>
        )}

      </div>

      {selectedPost && (
        <ScheduleModal
          post={
            selectedPost
          }
          loading={
            actionLoading
          }
          error={
            actionError
          }
          onClose={() => {
            if (
              actionLoading
            ) {
              return;
            }

            setSelectedPost(
              null
            );

            setActionError(
              ""
            );
          }}
          onPublishNow={() =>
            publishNow(
              selectedPost
            )
          }
          onCancel={() =>
            cancelSchedule(
              selectedPost
            )
          }
        />
      )}

    </main>
  );
}

function ScheduledPostCard({
  post,
  onClick,
}: {
  post: ScheduledPost;
  onClick: () => void;
}) {
  const isVideo =
    post.mediaType ===
    "video";

  const platforms =
    getPlatforms(
      post
    );

  return (
    <button
      type="button"
      onClick={
        onClick
      }
      className="flex w-full gap-4 rounded-2xl border border-zinc-800 bg-zinc-900 p-4 text-left transition hover:border-zinc-700 hover:bg-zinc-900/80"
    >

      {/* TIME */}

      <div className="w-16 shrink-0 pt-1">

        <p className="text-lg font-bold">
          {post.scheduledAt
            ? formatTime(
                post.scheduledAt
              )
            : "—"}
        </p>

      </div>

      {/* PREVIEW */}

      <div
        className={`relative shrink-0 overflow-hidden rounded-xl bg-black ${
          isVideo
            ? "h-32 w-[72px]"
            : "h-24 w-24"
        }`}
      >

        {post.mediaUrl ? (
          isVideo ? (
            <video
              src={
                post.mediaUrl
              }
              muted
              playsInline
              preload="metadata"
              className="h-full w-full object-cover"
            />
          ) : (
            <img
              src={
                post.mediaUrl
              }
              alt=""
              className="h-full w-full object-cover"
            />
          )
        ) : (
          <div className="flex h-full items-center justify-center text-xs text-zinc-600">
            No media
          </div>
        )}

      </div>

      {/* INFO */}

      <div className="min-w-0 flex-1">

        <div className="flex flex-wrap items-center gap-2">

          <p className="font-semibold">
            {
              post.influencerName
            }
          </p>

          <span className="rounded-full border border-zinc-700 px-2 py-0.5 text-xs text-zinc-400">
            {isVideo
              ? "Reel"
              : "Image"}
          </span>

        </div>

        {post.caption && (
          <p className="mt-2 line-clamp-2 max-w-2xl text-sm text-zinc-400">
            {
              post.caption
            }
          </p>
        )}

        <div className="mt-3 flex flex-wrap gap-2">

          {platforms.map(
            (
              platform
            ) => (
              <PlatformBadge
                key={
                  platform
                }
                platform={
                  platform
                }
              />
            )
          )}

        </div>

      </div>

      {/* STATUS */}

      <div className="hidden shrink-0 items-start gap-3 sm:flex">

        <span className="rounded-full border border-emerald-900/60 bg-emerald-950/40 px-3 py-1 text-xs font-medium text-emerald-400">
          Scheduled
        </span>

        <span className="pt-0.5 text-xl text-zinc-600">
          ›
        </span>

      </div>

    </button>
  );
}

function ScheduleModal({
  post,
  loading,
  error,
  onClose,
  onPublishNow,
  onCancel,
}: {
  post: ScheduledPost;

  loading: boolean;

  error: string;

  onClose: () => void;

  onPublishNow:
    () => void;

  onCancel:
    () => void;
}) {
  const isVideo =
    post.mediaType ===
    "video";

  const platforms =
    getPlatforms(
      post
    );

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm"
      onMouseDown={(
        event
      ) => {
        if (
          event.target ===
          event.currentTarget
        ) {
          onClose();
        }
      }}
    >

      <div className="max-h-[94vh] w-full max-w-5xl overflow-y-auto rounded-3xl border border-zinc-800 bg-zinc-950 shadow-2xl">

        {/* HEADER */}

        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-zinc-800 bg-zinc-950/95 px-6 py-4 backdrop-blur">

          <div>

            <p className="text-xs font-medium uppercase tracking-wider text-zinc-500">
              Scheduled post
            </p>

            <h2 className="mt-1 text-xl font-bold">
              {
                post.influencerName
              }
            </h2>

          </div>

          <button
            type="button"
            onClick={
              onClose
            }
            disabled={
              loading
            }
            className="flex h-10 w-10 items-center justify-center rounded-full border border-zinc-800 text-xl text-zinc-400 transition hover:bg-zinc-900 hover:text-white disabled:opacity-50"
            aria-label="Close"
          >
            ×
          </button>

        </div>

        <div className="grid gap-8 p-6 lg:grid-cols-[360px_1fr]">

          {/* MEDIA */}

          <div>

            <div
              className={`mx-auto overflow-hidden rounded-2xl border border-zinc-800 bg-black ${
                isVideo
                  ? "aspect-[9/16] w-full max-w-[340px]"
                  : "aspect-square w-full"
              }`}
            >

              {post.mediaUrl ? (
                isVideo ? (
                  <video
                    src={
                      post.mediaUrl
                    }
                    controls
                    playsInline
                    preload="metadata"
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <img
                    src={
                      post.mediaUrl
                    }
                    alt=""
                    className="h-full w-full object-cover"
                  />
                )
              ) : (
                <div className="flex h-full items-center justify-center text-sm text-zinc-600">
                  No media
                </div>
              )}

            </div>

            {isVideo && (
              <p className="mt-2 text-center text-xs text-zinc-600">
                Reel · 9:16
              </p>
            )}

          </div>

          {/* DETAILS */}

          <div className="min-w-0">

            <div className="flex flex-wrap items-center gap-2">

              <span className="rounded-full border border-emerald-900/60 bg-emerald-950/40 px-3 py-1 text-xs font-medium text-emerald-400">
                Scheduled
              </span>

              <span className="rounded-full border border-zinc-700 px-3 py-1 text-xs text-zinc-400">
                {isVideo
                  ? "Reel"
                  : "Image"}
              </span>

            </div>

            {/* DATE */}

            <div className="mt-6 rounded-2xl border border-zinc-800 bg-zinc-900 p-5">

              <p className="text-xs font-medium uppercase tracking-wider text-zinc-500">
                Publiceras
              </p>

              {post.scheduledAt ? (
                <>

                  <p className="mt-2 text-lg font-semibold capitalize">
                    {formatFullDate(
                      post.scheduledAt
                    )}
                  </p>

                  <p className="mt-1 text-3xl font-bold">
                    {formatTime(
                      post.scheduledAt
                    )}
                  </p>

                </>
              ) : (
                <p className="mt-2 text-zinc-400">
                  Ingen tid
                </p>
              )}

            </div>

            {/* PLATFORMS */}

            <div className="mt-6">

              <p className="text-sm font-medium">
                Plattformar
              </p>

              <div className="mt-3 flex flex-wrap gap-2">

                {platforms.map(
                  (
                    platform
                  ) => (
                    <PlatformBadge
                      key={
                        platform
                      }
                      platform={
                        platform
                      }
                    />
                  )
                )}

              </div>

            </div>

            {/* CAPTION */}

            <div className="mt-6">

              <p className="text-sm font-medium">
                Caption
              </p>

              <div className="mt-3 whitespace-pre-wrap rounded-2xl border border-zinc-800 bg-zinc-900 p-4 text-sm leading-relaxed text-zinc-300">

                {post.caption ||
                  "Ingen caption."}

              </div>

            </div>

            {error && (
              <div className="mt-6 rounded-xl border border-red-900/50 bg-red-950/30 p-4 text-sm text-red-300">
                {error}
              </div>
            )}

            {/* ACTIONS */}

            <div className="mt-8 border-t border-zinc-800 pt-6">

              <div className="grid gap-3 sm:grid-cols-2">

                <a
                  href={`/influencers/${post.influencerId}/create?postId=${post.id}`}
                  className={`rounded-xl border border-zinc-700 bg-zinc-900 px-4 py-3 text-center text-sm font-semibold transition hover:bg-zinc-800 ${
                    loading
                      ? "pointer-events-none opacity-50"
                      : ""
                  }`}
                >
                  Redigera
                </a>

                <button
                  type="button"
                  onClick={
                    onPublishNow
                  }
                  disabled={
                    loading
                  }
                  className="rounded-xl bg-white px-4 py-3 text-sm font-semibold text-black transition hover:bg-zinc-200 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {loading
                    ? "Arbetar..."
                    : "Publicera nu"}
                </button>

              </div>

              <button
                type="button"
                onClick={
                  onCancel
                }
                disabled={
                  loading
                }
                className="mt-3 w-full rounded-xl border border-red-900/60 bg-red-950/20 px-4 py-3 text-sm font-semibold text-red-400 transition hover:bg-red-950/40 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Avbryt schemaläggning
              </button>

            </div>

          </div>

        </div>

      </div>

    </div>
  );
}

function getPlatforms(
  post: ScheduledPost
) {
  const platforms =
    post.destinations.length >
    0
      ? post.destinations.map(
          (
            destination
          ) =>
            destination.platform
        )
      : [
          post.platform,
        ];

  return [
    ...new Set(
      platforms.filter(
        Boolean
      )
    ),
  ];
}

function PlatformBadge({
  platform,
}: {
  platform: string;
}) {
  const label =
    platform ===
    "instagram"
      ? "Instagram"
      : platform ===
          "facebook"
        ? "Facebook"
        : platform;

  return (
    <span className="rounded-lg border border-zinc-700 bg-zinc-950 px-2.5 py-1 text-xs capitalize text-zinc-300">
      {label}
    </span>
  );
}