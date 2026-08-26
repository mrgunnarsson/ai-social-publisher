"use client";

import {
  useEffect,
  useState,
} from "react";

import {
  useParams,
} from "next/navigation";

import {
  supabase,
} from "@/lib/supabase";

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
  caption: string | null;
  media_url: string | null;
  media_type:
    | "image"
    | "video"
    | null;
  scheduled_at:
    | string
    | null;
  status: string;
  platform: string;
  created_at: string;

  destinations?:
    Destination[];
};

function formatScheduledTime(
  value: string
) {
  return new Intl.DateTimeFormat(
    "sv-SE",
    {
      timeZone:
        "Europe/Stockholm",

      weekday:
        "long",

      day:
        "numeric",

      month:
        "long",

      year:
        "numeric",

      hour:
        "2-digit",

      minute:
        "2-digit",
    }
  ).format(
    new Date(value)
  );
}

function toLocalDateTimeInput(
  value: string
) {
  const date =
    new Date(value);

  const formatter =
    new Intl.DateTimeFormat(
      "sv-SE",
      {
        timeZone:
          "Europe/Stockholm",

        year:
          "numeric",

        month:
          "2-digit",

        day:
          "2-digit",

        hour:
          "2-digit",

        minute:
          "2-digit",

        hourCycle:
          "h23",
      }
    );

  const parts =
    formatter.formatToParts(
      date
    );

  const getPart = (
    type: string
  ) =>
    parts.find(
      (part) =>
        part.type ===
        type
    )?.value ?? "";

  return (
    `${getPart("year")}-` +
    `${getPart("month")}-` +
    `${getPart("day")}T` +
    `${getPart("hour")}:` +
    `${getPart("minute")}`
  );
}

function stockholmLocalToIso(
  value: string
) {
  const [
    datePart,
    timePart,
  ] =
    value.split("T");

  if (
    !datePart ||
    !timePart
  ) {
    return null;
  }

  const [
    year,
    month,
    day,
  ] =
    datePart
      .split("-")
      .map(Number);

  const [
    hour,
    minute,
  ] =
    timePart
      .split(":")
      .map(Number);

  if (
    !year ||
    !month ||
    !day ||
    Number.isNaN(
      hour
    ) ||
    Number.isNaN(
      minute
    )
  ) {
    return null;
  }

  let utc =
    Date.UTC(
      year,
      month - 1,
      day,
      hour,
      minute
    );

  const formatter =
    new Intl.DateTimeFormat(
      "sv-SE",
      {
        timeZone:
          "Europe/Stockholm",

        year:
          "numeric",

        month:
          "2-digit",

        day:
          "2-digit",

        hour:
          "2-digit",

        minute:
          "2-digit",

        hourCycle:
          "h23",
      }
    );

  for (
    let i = 0;
    i < 2;
    i++
  ) {
    const parts =
      formatter.formatToParts(
        new Date(utc)
      );

    const getPart = (
      type: string
    ) =>
      Number(
        parts.find(
          (part) =>
            part.type ===
            type
        )?.value
      );

    const shownAsUtc =
      Date.UTC(
        getPart("year"),
        getPart("month") -
          1,
        getPart("day"),
        getPart("hour"),
        getPart("minute")
      );

    const wantedAsUtc =
      Date.UTC(
        year,
        month - 1,
        day,
        hour,
        minute
      );

    utc -=
      shownAsUtc -
      wantedAsUtc;
  }

  return new Date(
    utc
  ).toISOString();
}

function platformName(
  platform: string
) {
  if (
    platform ===
    "instagram"
  ) {
    return "Instagram";
  }

  if (
    platform ===
    "facebook"
  ) {
    return "Facebook";
  }

  return platform;
}

function statusName(
  status: string
) {
  if (
    status ===
    "published"
  ) {
    return "Published";
  }

  if (
    status ===
    "scheduled"
  ) {
    return "Scheduled";
  }

  if (
    status ===
    "failed"
  ) {
    return "Failed";
  }

  return status;
}

function DestinationBadge({
  destination,
}: {
  destination:
    Destination;
}) {
  const isPublished =
    destination.status ===
    "published";

  const isFailed =
    destination.status ===
    "failed";

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium ${
        isPublished
          ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400"
          : isFailed
            ? "border-red-500/30 bg-red-500/10 text-red-400"
            : "border-amber-500/30 bg-amber-500/10 text-amber-400"
      }`}
    >
      <span>
        {platformName(
          destination.platform
        )}
      </span>

      <span className="opacity-60">
        ·
      </span>

      <span>
        {isPublished
          ? "✓ Published"
          : statusName(
              destination.status
            )}
      </span>
    </span>
  );
}

export default function ScheduledPostsPage() {
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
    useState<ScheduledPost[]>(
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

  const [
    publishingPostId,
    setPublishingPostId,
  ] =
    useState<string | null>(
      null
    );

  const [
    editingPostId,
    setEditingPostId,
  ] =
    useState<string | null>(
      null
    );

  const [
    editCaption,
    setEditCaption,
  ] =
    useState("");

  const [
    editScheduledAt,
    setEditScheduledAt,
  ] =
    useState("");

  const [
    savingPostId,
    setSavingPostId,
  ] =
    useState<string | null>(
      null
    );

  async function loadData() {
    try {
      setLoading(
        true
      );

      setError("");

      const {
        data:
          influencerData,

        error:
          influencerError,
      } = await supabase
        .from(
          "influencers"
        )
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
          scheduledPosts,

        error:
          postsError,
      } = await supabase
        .from("posts")
        .select(
          `
          id,
          caption,
          media_url,
          media_type,
          scheduled_at,
          status,
          platform,
          created_at,
          destinations:post_destinations (
            id,
            platform,
            status
          )
          `
        )
        .eq(
          "influencer_id",
          influencerId
        )
        .eq(
          "status",
          "scheduled"
        )
        .order(
          "scheduled_at",
          {
            ascending:
              true,
          }
        );

      if (
        postsError
      ) {
        throw new Error(
          postsError.message
        );
      }

      setPosts(
        (
          scheduledPosts ??
          []
        ) as ScheduledPost[]
      );
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : "Något gick fel."
      );
    } finally {
      setLoading(
        false
      );
    }
  }

  async function cancelPost(
    postId: string
  ) {
    const confirmed =
      window.confirm(
        "Vill du avbryta det här schemalagda inlägget?"
      );

    if (
      !confirmed
    ) {
      return;
    }

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
              postId,
            }),
        }
      );

    const result =
      await response.json();

    if (
      !response.ok ||
      !result.ok
    ) {
      alert(
        result?.error ??
          "Kunde inte avbryta inlägget."
      );

      return;
    }

    setPosts(
      (current) =>
        current.filter(
          (post) =>
            post.id !==
            postId
        )
    );
  }

  async function publishNow(
    postId: string
  ) {
    const confirmed =
      window.confirm(
        "Vill du publicera det här inlägget nu?"
      );

    if (
      !confirmed
    ) {
      return;
    }

    try {
      setPublishingPostId(
        postId
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
                postId,
              }),
          }
        );

      const result =
        await response.json();

      if (
        !response.ok ||
        !result.ok
      ) {
        console.error(
          result
        );

        alert(
          "Publiceringen misslyckades."
        );

        /*
          Ladda om datan så vi ser
          om en destination trots allt
          hann publiceras.
        */
        await loadData();

        return;
      }

      /*
        Backend avgör vilka
        destinationer som återstår.

        Ladda därför om från databasen
        i stället för att anta att
        hela posten är färdig.
      */
      await loadData();

      alert(
        "Publiceringen är klar."
      );
    } catch (error) {
      console.error(
        error
      );

      alert(
        "Publiceringen misslyckades."
      );

      await loadData();
    } finally {
      setPublishingPostId(
        null
      );
    }
  }

  function startEditing(
    post:
      ScheduledPost
  ) {
    setEditingPostId(
      post.id
    );

    setEditCaption(
      post.caption ??
        ""
    );

    if (
      post.scheduled_at
    ) {
      setEditScheduledAt(
        toLocalDateTimeInput(
          post.scheduled_at
        )
      );
    } else {
      setEditScheduledAt(
        ""
      );
    }
  }

  function stopEditing() {
    setEditingPostId(
      null
    );

    setEditCaption(
      ""
    );

    setEditScheduledAt(
      ""
    );
  }

  async function saveChanges(
    postId: string
  ) {
    if (
      !editScheduledAt
    ) {
      alert(
        "Välj datum och tid."
      );

      return;
    }

    const scheduledAtIso =
      stockholmLocalToIso(
        editScheduledAt
      );

    if (
      !scheduledAtIso
    ) {
      alert(
        "Datum eller tid är ogiltig."
      );

      return;
    }

    const scheduledDate =
      new Date(
        scheduledAtIso
      );

    if (
      scheduledDate.getTime() <=
      Date.now()
    ) {
      alert(
        "Den schemalagda tiden måste ligga i framtiden."
      );

      return;
    }

    try {
      setSavingPostId(
        postId
      );

      const response =
        await fetch(
          "/api/posts/update-scheduled",
          {
            method:
              "POST",

            headers: {
              "Content-Type":
                "application/json",
            },

            body:
              JSON.stringify({
                postId,

                caption:
                  editCaption,

                scheduledAt:
                  scheduledAtIso,
              }),
          }
        );

      const result =
        await response.json();

      if (
        !response.ok ||
        !result.ok
      ) {
        console.error(
          result
        );

        alert(
          result?.error ??
            "Kunde inte spara ändringarna."
        );

        return;
      }

      /*
        Vi laddar om posten från
        databasen eftersom destinationer
        inte nödvändigtvis returneras
        från update-endpointen.
      */
      await loadData();

      stopEditing();
    } catch (error) {
      console.error(
        error
      );

      alert(
        "Kunde inte spara ändringarna."
      );
    } finally {
      setSavingPostId(
        null
      );
    }
  }

  useEffect(() => {
    loadData();
  }, [
    influencerId,
  ]);

  if (
    loading
  ) {
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
              Scheduled Posts
            </h1>

            <p className="mt-2 text-zinc-400">
              Kommande schemalagda publiceringar.
            </p>

          </div>

          <a
            href={`/influencers/${influencerId}/create`}
            className="rounded-xl bg-white px-5 py-3 text-center font-semibold text-black transition hover:bg-zinc-200"
          >
            + Create Post
          </a>

        </div>

        <div className="mt-10">

          {posts.length ===
          0 ? (
            <div className="rounded-2xl border border-zinc-800 bg-zinc-900 p-10 text-center">

              <div className="text-4xl">
                🗓️
              </div>

              <h2 className="mt-4 text-xl font-semibold">
                Inga schemalagda inlägg
              </h2>

              <p className="mt-2 text-sm text-zinc-500">
                När du schemalägger ett inlägg kommer det att visas här.
              </p>

              <a
                href={`/influencers/${influencerId}/create`}
                className="mt-6 inline-block rounded-xl bg-white px-5 py-3 font-semibold text-black transition hover:bg-zinc-200"
              >
                Skapa ett inlägg
              </a>

            </div>
          ) : (
            <div className="space-y-5">

              {posts.map(
                (post) => {
                  const isEditing =
                    editingPostId ===
                    post.id;

                  const isVideo =
                    post.media_type ===
                    "video";

                  const destinations =
                    post.destinations ??
                    [];

                  return (
                    <div
                      key={
                        post.id
                      }
                      className="overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-900"
                    >

                      <div className="flex flex-col sm:flex-row">

                        {/* MEDIA */}

                        <div className="flex shrink-0 items-start justify-center bg-black p-4 sm:w-56">

                          {post.media_url ? (
                            isVideo ? (
                              /*
                                REEL

                                Samma 9:16-format som
                                1080 x 1920.

                                object-contain gör att vi
                                aldrig croppar videon i
                                Scheduled Posts.
                              */
                              <div className="aspect-[9/16] w-full max-w-[190px] overflow-hidden rounded-xl bg-black">

                                <video
                                  src={
                                    post.media_url
                                  }
                                  controls
                                  playsInline
                                  preload="metadata"
                                  className="h-full w-full object-contain"
                                />

                              </div>
                            ) : (
                              /*
                                IMAGE

                                Vi tvingar inte längre
                                bilden till kvadrat.

                                Bilden får behålla sitt
                                riktiga format.
                              */
                              <div className="flex w-full max-w-[220px] items-center justify-center overflow-hidden rounded-xl bg-black">

                                <img
                                  src={
                                    post.media_url
                                  }
                                  alt=""
                                  className="h-auto max-h-[360px] w-full object-contain"
                                />

                              </div>
                            )
                          ) : (
                            <div className="flex aspect-[9/16] w-full max-w-[190px] items-center justify-center rounded-xl bg-zinc-900 text-sm text-zinc-600">
                              No media
                            </div>
                          )}

                        </div>

                        {/* CONTENT */}

                        <div className="flex min-w-0 flex-1 flex-col justify-between p-5 sm:p-6">

                          <div>

                            <div className="flex flex-wrap items-center gap-2">

                              <span className="rounded-full bg-amber-500/10 px-3 py-1 text-xs font-semibold text-amber-400">
                                Scheduled
                              </span>

                              {isVideo && (
                                <span className="rounded-full border border-zinc-700 bg-zinc-950 px-2.5 py-1 text-xs text-zinc-400">
                                  Reel · 9:16
                                </span>
                              )}

                            </div>

                            {/* DESTINATIONS */}

                            <div className="mt-4">

                              <p className="mb-2 text-xs font-medium uppercase tracking-wider text-zinc-600">
                                Destinationer
                              </p>

                              <div className="flex flex-wrap gap-2">

                                {destinations.length >
                                0 ? (
                                  destinations.map(
                                    (
                                      destination
                                    ) => (
                                      <DestinationBadge
                                        key={
                                          destination.id
                                        }
                                        destination={
                                          destination
                                        }
                                      />
                                    )
                                  )
                                ) : (
                                  <span className="rounded-full border border-zinc-700 bg-zinc-950 px-2.5 py-1 text-xs text-zinc-400">
                                    {platformName(
                                      post.platform
                                    )}
                                  </span>
                                )}

                              </div>

                            </div>

                            {isEditing ? (
                              <div className="mt-5 space-y-4">

                                <div>

                                  <label className="mb-2 block text-sm font-medium text-zinc-300">
                                    Caption
                                  </label>

                                  <textarea
                                    value={
                                      editCaption
                                    }
                                    onChange={(
                                      event
                                    ) =>
                                      setEditCaption(
                                        event.target.value
                                      )
                                    }
                                    rows={
                                      5
                                    }
                                    className="w-full resize-none rounded-xl border border-zinc-700 bg-zinc-950 px-4 py-3 text-sm text-white outline-none transition focus:border-zinc-500"
                                  />

                                </div>

                                <div>

                                  <label className="mb-2 block text-sm font-medium text-zinc-300">
                                    Datum och tid
                                  </label>

                                  <input
                                    type="datetime-local"
                                    value={
                                      editScheduledAt
                                    }
                                    onChange={(
                                      event
                                    ) =>
                                      setEditScheduledAt(
                                        event.target.value
                                      )
                                    }
                                    className="w-full rounded-xl border border-zinc-700 bg-zinc-950 px-4 py-3 text-sm text-white outline-none transition focus:border-zinc-500"
                                  />

                                </div>

                              </div>
                            ) : (
                              <>

                                {post.scheduled_at && (
                                  <h2 className="mt-5 text-xl font-semibold capitalize">
                                    {formatScheduledTime(
                                      post.scheduled_at
                                    )}
                                  </h2>
                                )}

                                <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-zinc-400">
                                  {post.caption ||
                                    "Ingen caption"}
                                </p>

                              </>
                            )}

                          </div>

                          {isEditing ? (
                            <div className="mt-6 flex flex-wrap gap-3">

                              <button
                                type="button"
                                onClick={() =>
                                  saveChanges(
                                    post.id
                                  )
                                }
                                disabled={
                                  savingPostId ===
                                  post.id
                                }
                                className="rounded-xl bg-white px-4 py-2 text-sm font-semibold text-black transition hover:bg-zinc-200 disabled:cursor-not-allowed disabled:opacity-50"
                              >
                                {savingPostId ===
                                post.id
                                  ? "Sparar..."
                                  : "Spara ändringar"}
                              </button>

                              <button
                                type="button"
                                onClick={
                                  stopEditing
                                }
                                disabled={
                                  savingPostId ===
                                  post.id
                                }
                                className="rounded-xl border border-zinc-700 px-4 py-2 text-sm font-medium transition hover:bg-zinc-800 disabled:opacity-50"
                              >
                                Avbryt redigering
                              </button>

                            </div>
                          ) : (
                            <div className="mt-6 flex flex-wrap gap-3">

                              <button
                                type="button"
                                onClick={() =>
                                  startEditing(
                                    post
                                  )
                                }
                                className="rounded-xl border border-zinc-700 px-4 py-2 text-sm font-medium transition hover:bg-zinc-800"
                              >
                                Redigera
                              </button>

                              <button
                                type="button"
                                onClick={() =>
                                  publishNow(
                                    post.id
                                  )
                                }
                                disabled={
                                  publishingPostId ===
                                  post.id
                                }
                                className="rounded-xl border border-zinc-700 px-4 py-2 text-sm font-medium transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-50"
                              >
                                {publishingPostId ===
                                post.id
                                  ? "Publicerar..."
                                  : "Publicera nu"}
                              </button>

                              <button
                                type="button"
                                onClick={() =>
                                  cancelPost(
                                    post.id
                                  )
                                }
                                className="rounded-xl px-4 py-2 text-sm font-medium text-red-400 transition hover:bg-red-500/10"
                              >
                                Avbryt
                              </button>

                            </div>
                          )}

                        </div>

                      </div>

                    </div>
                  );
                }
              )}

            </div>
          )}

        </div>

      </div>

    </main>
  );
}