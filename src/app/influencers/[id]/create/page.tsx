"use client";

import {
  useEffect,
  useMemo,
  useState,
} from "react";

import { useParams } from "next/navigation";
import { supabase } from "@/lib/supabase";

type Recommendation = {
  rank: number;
  weekday: number;
  weekdayName: string;
  hour: number;
  time: string;
  averageScore: number;
  medianScore: number;
  rankingScore: number;
  sampleSize: number;
  confidence: "high" | "medium" | "low";
};

type RecommendationResponse = {
  ok: boolean;
  postsUsed?: number;
  bestReliableTime?: Recommendation | null;
  bestPotentialTime?: Recommendation | null;
};

type PublishMode =
  | "recommended"
  | "now"
  | "custom";

function getNextRecommendedDate(
  weekday: number,
  hour: number
) {
  const now = new Date();

  /*
    JS:
    0 = Sunday
    1 = Monday
    ...
    6 = Saturday
  */

  const currentWeekday =
    now.getDay();

  let daysAhead =
    (weekday -
      currentWeekday +
      7) %
    7;

  const candidate =
    new Date(now);

  candidate.setDate(
    now.getDate() +
      daysAhead
  );

  candidate.setHours(
    hour,
    0,
    0,
    0
  );

  /*
    Om rekommendationen är idag
    men tiden redan passerat,
    flytta till nästa vecka.
  */
  if (
    candidate.getTime() <=
    now.getTime()
  ) {
    candidate.setDate(
      candidate.getDate() +
        7
    );
  }

  return candidate;
}

function formatLocalDateTime(
  date: Date
) {
  return new Intl.DateTimeFormat(
    "sv-SE",
    {
      weekday: "long",
      day: "numeric",
      month: "long",
      hour: "2-digit",
      minute: "2-digit",
      timeZone:
        "Europe/Stockholm",
    }
  ).format(date);
}

export default function CreatePostPage() {
  const params =
    useParams();

  const influencerId =
    params.id as string;

  const [file, setFile] =
    useState<File | null>(
      null
    );

  const [caption, setCaption] =
    useState("");

    const [
  publishToInstagram,
  setPublishToInstagram,
] = useState(true);

const [
  publishToFacebook,
  setPublishToFacebook,
] = useState(false);

  const [
    publishMode,
    setPublishMode,
  ] =
    useState<PublishMode>(
      "recommended"
    );

  const [
    recommendation,
    setRecommendation,
  ] =
    useState<Recommendation | null>(
      null
    );

  const [
    potentialRecommendation,
    setPotentialRecommendation,
  ] =
    useState<Recommendation | null>(
      null
    );

  const [
    recommendationsLoading,
    setRecommendationsLoading,
  ] =
    useState(true);

  const [
    customDate,
    setCustomDate,
  ] =
    useState("");

  const [
    customTime,
    setCustomTime,
  ] =
    useState("");

  const [loading, setLoading] =
    useState(false);

  const [message, setMessage] =
    useState("");

  useEffect(() => {
    async function loadRecommendations() {
      try {
        setRecommendationsLoading(
          true
        );

        const response =
          await fetch(
            "/api/recommendations/times",
            {
              method:
                "POST",

              headers: {
                "Content-Type":
                  "application/json",
              },

              body:
                JSON.stringify(
                  {
                    influencerId,
                  }
                ),
            }
          );

        const data:
          RecommendationResponse =
          await response.json();

        if (
          response.ok &&
          data.ok
        ) {
          setRecommendation(
            data.bestReliableTime ??
              null
          );

          setPotentialRecommendation(
            data.bestPotentialTime ??
              null
          );

          if (
            !data.bestReliableTime
          ) {
            setPublishMode(
              "now"
            );
          }
        }
      } catch (error) {
        console.error(
          "Could not load recommendations:",
          error
        );

        setPublishMode(
          "now"
        );
      } finally {
        setRecommendationsLoading(
          false
        );
      }
    }

    loadRecommendations();
  }, [influencerId]);

  const recommendedDate =
    useMemo(() => {
      if (!recommendation) {
        return null;
      }

      return getNextRecommendedDate(
        recommendation.weekday,
        recommendation.hour
      );
    }, [recommendation]);

  async function uploadImage() {
    if (!file) {
      throw new Error(
        "Välj en bild först."
      );
    }

    const extension =
      file.name
        .split(".")
        .pop() ??
      "jpg";

    const fileName =
      `${influencerId}/${crypto.randomUUID()}.${extension}`;

    const {
      error: uploadError,
    } = await supabase.storage
      .from(
        "social-media"
      )
      .upload(
        fileName,
        file,
        {
          contentType:
            file.type,
          upsert:
            false,
        }
      );

    if (uploadError) {
      throw new Error(
        uploadError.message
      );
    }

    const {
      data:
        publicUrlData,
    } = supabase.storage
      .from(
        "social-media"
      )
      .getPublicUrl(
        fileName
      );

    return (
      publicUrlData.publicUrl
    );
  }

  async function schedulePost(
  imageUrl: string,
  scheduledAt: Date
) {
  const platforms: string[] =
    [];

  if (publishToInstagram) {
    platforms.push(
      "instagram"
    );
  }

  if (publishToFacebook) {
    platforms.push(
      "facebook"
    );
  }

  const response =
    await fetch(
      "/api/posts/schedule",
      {
        method: "POST",

        headers: {
          "Content-Type":
            "application/json",
        },

        body:
          JSON.stringify({
            influencerId,
            imageUrl,
            caption,
            scheduledAt:
              scheduledAt.toISOString(),
            platforms,
          }),
      }
    );

  const result =
    await response.json();

  if (
    !response.ok ||
    !result.ok
  ) {
    throw new Error(
      result?.error ??
        "Schemaläggningen misslyckades."
    );
  }

  return result;
}

  function getCustomDateTime() {
    if (
      !customDate ||
      !customTime
    ) {
      throw new Error(
        "Välj både datum och tid."
      );
    }

    /*
      Inputen representerar lokal tid.
    */
    const date =
      new Date(
        `${customDate}T${customTime}:00`
      );

    if (
      Number.isNaN(
        date.getTime()
      )
    ) {
      throw new Error(
        "Ogiltigt datum eller tid."
      );
    }

    if (
      date.getTime() <=
      Date.now()
    ) {
      throw new Error(
        "Tiden måste ligga i framtiden."
      );
    }

    return date;
  }

 async function handleSubmit() {
  if (!file) {
    setMessage(
      "Välj en bild först."
    );

    return;
  }

  if (
    !publishToInstagram &&
    !publishToFacebook
  ) {
    setMessage(
      "Välj minst en kanal."
    );

    return;
  }

  try {
    setLoading(true);

    setMessage(
      "Laddar upp bilden..."
    );

    const imageUrl =
      await uploadImage();

/*
  PUBLICERA NU

  Vi skapar först posten genom samma
  datamodell som schemalagda poster.

  Därefter använder vi publish-now,
  som i sin tur kör samma
  publiceringsmotor som Cron.
*/
if (
  publishMode ===
  "now"
) {
  const platformNames:
    string[] = [];

  if (
    publishToInstagram
  ) {
    platformNames.push(
      "Instagram"
    );
  }

  if (
    publishToFacebook
  ) {
    platformNames.push(
      "Facebook"
    );
  }

  setMessage(
    `Förbereder publicering på ${platformNames.join(
      " + "
    )}...`
  );

  /*
    schedule-route kräver en tid.

    Vi lägger posten några sekunder
    framåt så att den skapas som en
    vanlig scheduled multi-post.
  */
  const scheduledAt =
    new Date(
      Date.now() + 5000
    );

  const scheduledResult =
    await schedulePost(
      imageUrl,
      scheduledAt
    );

  if (
    !scheduledResult.postId
  ) {
    throw new Error(
      "Posten skapades men postId saknas."
    );
  }

  setMessage(
    `Publicerar på ${platformNames.join(
      " + "
    )}...`
  );

  /*
    Flytta posten till nu och kör
    befintlig run-scheduled-motor.
  */
  const publishResponse =
    await fetch(
      "/api/posts/publish-now",
      {
        method: "POST",

        headers: {
          "Content-Type":
            "application/json",
        },

        body:
          JSON.stringify({
            postId:
              scheduledResult.postId,
          }),
      }
    );

  const publishResult =
    await publishResponse.json();

  if (
    !publishResponse.ok ||
    !publishResult.ok
  ) {
    throw new Error(
      typeof publishResult.error ===
        "string"
        ? publishResult.error
        : JSON.stringify(
            publishResult.error ??
              publishResult
          )
    );
  }

  setMessage(
    `Publicerat på ${platformNames.join(
      " + "
    )} ✓`
  );

  setFile(null);
  setCaption("");

  return;
}

    /*
      SCHEMALÄGG
    */

    let scheduledAt:
      Date;

    if (
      publishMode ===
      "recommended"
    ) {
      if (
        !recommendedDate
      ) {
        throw new Error(
          "Ingen rekommenderad tid finns ännu."
        );
      }

      scheduledAt =
        recommendedDate;
    } else {
      scheduledAt =
        getCustomDateTime();
    }

    const platforms:
      string[] = [];

    if (
      publishToInstagram
    ) {
      platforms.push(
        "Instagram"
      );
    }

    if (
      publishToFacebook
    ) {
      platforms.push(
        "Facebook"
      );
    }

    setMessage(
      `Schemalägger för ${platforms.join(
        " + "
      )}...`
    );

    const result =
      await schedulePost(
        imageUrl,
        scheduledAt
      );

    setMessage(
      `Schemalagt för ${formatLocalDateTime(
        new Date(
          result.scheduledAt
        )
      )} på ${platforms.join(
        " + "
      )} ✓`
    );

    setFile(null);
    setCaption("");
  } catch (error) {
    setMessage(
      error instanceof Error
        ? error.message
        : "Något gick fel."
    );
  } finally {
    setLoading(false);
  }
}

  const buttonText =
    publishMode ===
    "now"
      ? "Publicera nu"
      : "Schemalägg";

  return (
    <main className="min-h-screen bg-zinc-950 px-6 py-10 text-white">
      <div className="mx-auto max-w-2xl">

        <a
          href={`/influencers/${influencerId}`}
          className="text-sm text-zinc-400 hover:text-white"
        >
          ← Back
        </a>

        <div className="mt-8">
          <p className="text-sm font-medium uppercase tracking-wider text-zinc-500">
            Instagram
          </p>

          <h1 className="mt-2 text-4xl font-bold">
            Create Post
          </h1>

          <p className="mt-2 text-zinc-400">
            Publicera nu eller
            schemalägg till en
            rekommenderad tid.
          </p>
        </div>

        <div className="mt-10 space-y-8 rounded-2xl border border-zinc-800 bg-zinc-900 p-6">

          {/* Bild */}

          <div>
            <label className="mb-3 block font-medium">
              Bild
            </label>

            <input
              type="file"
              accept="image/jpeg,image/png"
              disabled={
                loading
              }
              onChange={(
                event
              ) => {
                setFile(
                  event
                    .target
                    .files?.[0] ??
                    null
                );
              }}
              className="block w-full text-sm text-zinc-400"
            />

            {file && (
              <p className="mt-3 text-sm text-zinc-500">
                {file.name}
              </p>
            )}
          </div>

          {/* Caption */}

          <div>
            <label className="mb-3 block font-medium">
              Caption
            </label>

            <textarea
              value={
                caption
              }
              disabled={
                loading
              }
              onChange={(
                event
              ) =>
                setCaption(
                  event
                    .target
                    .value
                )
              }
              placeholder="Skriv din caption..."
              rows={7}
              className="w-full resize-none rounded-xl border border-zinc-700 bg-zinc-950 p-4 outline-none focus:border-zinc-500"
            />
          </div>

          {/* Kanaler */}

<div>
  <h2 className="mb-4 text-lg font-semibold">
    Publicera till
  </h2>

  <div className="grid gap-3 sm:grid-cols-2">

    {/* Instagram */}

    <label
      className={`cursor-pointer rounded-xl border p-4 transition ${
        publishToInstagram
          ? "border-white bg-zinc-800"
          : "border-zinc-700 bg-zinc-950"
      }`}
    >
      <div className="flex items-center gap-3">
        <input
          type="checkbox"
          checked={publishToInstagram}
          disabled={loading}
          onChange={(event) =>
            setPublishToInstagram(
              event.target.checked
            )
          }
        />

        <div>
          <div className="font-semibold">
            Instagram
          </div>

          <div className="mt-1 text-xs text-zinc-500">
            Feed
          </div>
        </div>
      </div>
    </label>

    {/* Facebook */}

    <label
      className={`cursor-pointer rounded-xl border p-4 transition ${
        publishToFacebook
          ? "border-white bg-zinc-800"
          : "border-zinc-700 bg-zinc-950"
      }`}
    >
      <div className="flex items-center gap-3">
        <input
          type="checkbox"
          checked={publishToFacebook}
          disabled={loading}
          onChange={(event) =>
            setPublishToFacebook(
              event.target.checked
            )
          }
        />

        <div>
          <div className="font-semibold">
            Facebook
          </div>

          <div className="mt-1 text-xs text-zinc-500">
            Page
          </div>
        </div>
      </div>
    </label>

  </div>

  {!publishToInstagram &&
    !publishToFacebook && (
      <p className="mt-3 text-sm text-amber-400">
        Välj minst en kanal.
      </p>
    )}
</div>

          {/* Publiceringstid */}

          <div>
            <h2 className="mb-4 text-lg font-semibold">
              När?
            </h2>

            <div className="space-y-3">

              {/* Recommended */}

              {recommendationsLoading ? (
                <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-4 text-sm text-zinc-500">
                  Hämtar
                  rekommenderad
                  tid...
                </div>
              ) : (
                recommendation && (
                  <label className="block cursor-pointer rounded-xl border border-zinc-700 bg-zinc-950 p-4">
                    <div className="flex gap-3">
                      <input
                        type="radio"
                        name="publishMode"
                        checked={
                          publishMode ===
                          "recommended"
                        }
                        onChange={() =>
                          setPublishMode(
                            "recommended"
                          )
                        }
                      />

                      <div className="flex-1">
                        <div className="font-semibold">
                          Rekommenderad
                          tid
                        </div>

                        <div className="mt-1 text-lg">
                          {
                            recommendation.weekdayName
                          }{" "}
                          {
                            recommendation.time
                          }
                        </div>

                        {recommendedDate && (
                          <div className="mt-1 text-sm text-zinc-400">
                            Nästa:{" "}
                            {formatLocalDateTime(
                              recommendedDate
                            )}
                          </div>
                        )}

                        <div className="mt-2 text-xs text-zinc-500">
                          Baserat på{" "}
                          {
                            recommendation.sampleSize
                          }{" "}
                          historiska
                          inlägg ·{" "}
                          {
                            recommendation.confidence
                          }{" "}
                          confidence
                        </div>
                      </div>
                    </div>
                  </label>
                )
              )}

              {/* Potential */}

              {potentialRecommendation && (
                <div className="rounded-xl border border-zinc-800 p-4">
                  <p className="text-xs font-medium uppercase tracking-wider text-zinc-500">
                    Potential
                  </p>

                  <p className="mt-1">
                    {
                      potentialRecommendation.weekdayName
                    }{" "}
                    {
                      potentialRecommendation.time
                    }
                  </p>

                  <p className="mt-1 text-xs text-zinc-500">
                    Stark historisk
                    prestation, men
                    endast{" "}
                    {
                      potentialRecommendation.sampleSize
                    }{" "}
                    datapunkt(er).
                  </p>
                </div>
              )}

              {/* Now */}

              <label className="block cursor-pointer rounded-xl border border-zinc-700 bg-zinc-950 p-4">
                <div className="flex gap-3">
                  <input
                    type="radio"
                    name="publishMode"
                    checked={
                      publishMode ===
                      "now"
                    }
                    onChange={() =>
                      setPublishMode(
                        "now"
                      )
                    }
                  />

                  <div>
                    <div className="font-semibold">
                      Publicera nu
                    </div>

                    <p className="mt-1 text-sm text-zinc-500">
                      Publiceras direkt
                      på Instagram.
                    </p>
                  </div>
                </div>
              </label>

              {/* Custom */}

              <label className="block cursor-pointer rounded-xl border border-zinc-700 bg-zinc-950 p-4">
                <div className="flex gap-3">
                  <input
                    type="radio"
                    name="publishMode"
                    checked={
                      publishMode ===
                      "custom"
                    }
                    onChange={() =>
                      setPublishMode(
                        "custom"
                      )
                    }
                  />

                  <div className="flex-1">
                    <div className="font-semibold">
                      Välj egen tid
                    </div>

                    {publishMode ===
                      "custom" && (
                      <div className="mt-4 grid gap-3 sm:grid-cols-2">
                        <input
                          type="date"
                          value={
                            customDate
                          }
                          onChange={(
                            event
                          ) =>
                            setCustomDate(
                              event
                                .target
                                .value
                            )
                          }
                          className="rounded-lg border border-zinc-700 bg-zinc-900 p-3"
                        />

                        <input
                          type="time"
                          value={
                            customTime
                          }
                          onChange={(
                            event
                          ) =>
                            setCustomTime(
                              event
                                .target
                                .value
                            )
                          }
                          className="rounded-lg border border-zinc-700 bg-zinc-900 p-3"
                        />
                      </div>
                    )}
                  </div>
                </div>
              </label>

            </div>
          </div>

          {/* Action */}

          <button
            type="button"
            onClick={
              handleSubmit
            }
       disabled={
  loading ||
  !file ||
  (
    !publishToInstagram &&
    !publishToFacebook
  )
}
            className="w-full rounded-xl bg-white px-5 py-3 font-semibold text-black transition hover:bg-zinc-200 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {loading
              ? "Arbetar..."
              : buttonText}
          </button>

          {message && (
            <p className="text-center text-sm text-zinc-300">
              {message}
            </p>
          )}

        </div>
      </div>
    </main>
  );
}