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
  avatar_url: string | null;
};

export default function InfluencerPage() {
  const params =
    useParams();

  const id =
    params.id as string;

  const [
    influencer,
    setInfluencer,
  ] =
    useState<Influencer | null>(
      null
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

  /*
   * INSTAGRAM
   */

  const [
    instagramConnected,
    setInstagramConnected,
  ] =
    useState<boolean | null>(
      null
    );

  const [
    instagramUsername,
    setInstagramUsername,
  ] =
    useState<string | null>(
      null
    );

  /*
   * FACEBOOK
   */

  const [
    facebookConnected,
    setFacebookConnected,
  ] =
    useState<boolean | null>(
      null
    );

  const [
    facebookName,
    setFacebookName,
  ] =
    useState<string | null>(
      null
    );

  async function loadInfluencer() {
    const {
      data,
      error,
    } = await supabase
      .from(
        "influencers"
      )
      .select(
        `
        id,
        name,
        avatar_url
        `
      )
      .eq(
        "id",
        id
      )
      .single();

    if (
      error ||
      !data
    ) {
      throw new Error(
        error?.message ??
          "Influencer hittades inte."
      );
    }

    setInfluencer(
      data
    );
  }

  async function loadInstagramStatus() {
    try {
      const response =
        await fetch(
          `/api/instagram/status?influencerId=${id}`,
          {
            cache:
              "no-store",
          }
        );

      const result =
        await response.json();

      if (
        response.ok &&
        result.ok &&
        result.connected
      ) {
        setInstagramConnected(
          true
        );

        setInstagramUsername(
          result.account
            ?.username ??
            null
        );

        return;
      }

      setInstagramConnected(
        false
      );

      setInstagramUsername(
        null
      );
    } catch {
      setInstagramConnected(
        false
      );

      setInstagramUsername(
        null
      );
    }
  }

  async function loadFacebookStatus() {
    try {
      const response =
        await fetch(
          `/api/facebook/status?influencerId=${id}`,
          {
            cache:
              "no-store",
          }
        );

      const result =
        await response.json();

      if (
        response.ok &&
        result.ok &&
        result.connected
      ) {
        setFacebookConnected(
          true
        );

        setFacebookName(
          result.account
            ?.name ??
            result.account
              ?.username ??
            null
        );

        return;
      }

      setFacebookConnected(
        false
      );

      setFacebookName(
        null
      );
    } catch {
      setFacebookConnected(
        false
      );

      setFacebookName(
        null
      );
    }
  }

  useEffect(() => {
    async function loadPage() {
      try {
        setLoading(
          true
        );

        setError("");

        /*
         * Influencern måste finnas,
         * men sociala statusanrop
         * kan köras parallellt.
         */
        await Promise.all([
          loadInfluencer(),
          loadInstagramStatus(),
          loadFacebookStatus(),
        ]);
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

    loadPage();
  }, [id]);

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

      <div className="mx-auto max-w-4xl">

        <a
          href="/"
          className="text-sm text-zinc-400 transition hover:text-white"
        >
          ← Back
        </a>

        {/* PROFILE */}

        <div className="mt-8 flex items-center gap-5">

          {influencer.avatar_url ? (
            <img
              src={
                influencer.avatar_url
              }
              alt=""
              className="h-20 w-20 rounded-full object-cover"
            />
          ) : (
            <div className="flex h-20 w-20 items-center justify-center rounded-full bg-zinc-800 text-3xl font-semibold">
              {influencer.name
                .charAt(0)
                .toUpperCase()}
            </div>
          )}

          <div>

            <h1 className="text-4xl font-bold">
              {
                influencer.name
              }
            </h1>

            <p className="mt-1 text-zinc-400">
              AI Influencer
            </p>

          </div>

        </div>

        {/* CONNECTIONS */}

        <section className="mt-10">

          <div className="mb-4">

            <h2 className="text-xl font-semibold">
              Connections
            </h2>

            <p className="mt-1 text-sm text-zinc-500">
              Sociala konton kopplade till denna influencer.
            </p>

          </div>

          <div className="space-y-4">

            {/* INSTAGRAM */}

            <ConnectionCard
              title="Instagram"
              connected={
                instagramConnected
              }
              accountName={
                instagramUsername
                  ? `@${instagramUsername}`
                  : null
              }
              connectUrl={
                `/api/instagram/oauth/start?influencerId=${influencer.id}`
              }
            />

            {/* FACEBOOK */}

            <ConnectionCard
              title="Facebook"
              connected={
                facebookConnected
              }
              accountName={
                facebookName
              }
              connectUrl={
                `/api/facebook/oauth/start?influencerId=${influencer.id}`
              }
            />

            {/* TIKTOK */}

            <div className="rounded-2xl border border-zinc-800 bg-zinc-900 p-5">

              <div className="flex items-center justify-between gap-4">

                <div>

                  <h3 className="text-lg font-semibold">
                    TikTok
                  </h3>

                  <p className="mt-1 text-sm text-zinc-500">
                    Not connected
                  </p>

                </div>

                <span className="rounded-xl border border-zinc-700 px-4 py-2 text-sm text-zinc-500">
                  Coming later
                </span>

              </div>

            </div>

          </div>

        </section>

        {/* ACTIONS */}

        <section className="mt-10">

          <h2 className="mb-4 text-xl font-semibold">
            Content
          </h2>

          <div className="grid gap-3 sm:grid-cols-2">

            <a
              href={`/influencers/${influencer.id}/create`}
              className="rounded-xl bg-white px-5 py-3 text-center font-semibold text-black transition hover:bg-zinc-200"
            >
              + Create Post
            </a>

            <a
              href={`/influencers/${influencer.id}/scheduled`}
              className="rounded-xl border border-zinc-700 px-5 py-3 text-center font-semibold transition hover:bg-zinc-800"
            >
              Scheduled Posts
            </a>

            <a
              href={`/influencers/${influencer.id}/published`}
              className="rounded-xl border border-zinc-700 px-5 py-3 text-center font-semibold transition hover:bg-zinc-800"
            >
              Published Posts
            </a>

            <a
              href={`/analytics?influencerId=${influencer.id}`}
              className="rounded-xl border border-zinc-700 px-5 py-3 text-center font-semibold transition hover:bg-zinc-800"
            >
              Analytics
            </a>

          </div>

        </section>

      </div>

    </main>
  );
}

function ConnectionCard({
  title,
  connected,
  accountName,
  connectUrl,
}: {
  title: string;

  connected:
    boolean | null;

  accountName:
    string | null;

  connectUrl:
    string;
}) {
  return (
    <div className="rounded-2xl border border-zinc-800 bg-zinc-900 p-5">

      <div className="flex items-center justify-between gap-4">

        <div className="min-w-0">

          <h3 className="text-lg font-semibold">
            {title}
          </h3>

          {connected ===
          null ? (
            <p className="mt-1 text-sm text-zinc-500">
              Checking connection...
            </p>
          ) : connected ? (
            <div className="mt-1">

              <p className="text-sm text-emerald-400">
                ✓ Connected
              </p>

              {accountName && (
                <p className="mt-1 truncate text-sm text-zinc-500">
                  {
                    accountName
                  }
                </p>
              )}

            </div>
          ) : (
            <p className="mt-1 text-sm text-zinc-500">
              ○ Not connected
            </p>
          )}

        </div>

        <a
          href={
            connectUrl
          }
          className={`shrink-0 rounded-xl px-4 py-2 text-sm font-medium transition ${
            connected
              ? "border border-zinc-700 bg-zinc-950 hover:bg-zinc-800"
              : "bg-white text-black hover:bg-zinc-200"
          }`}
        >
          {connected
            ? "Reconnect"
            : "Connect"}
        </a>

      </div>

    </div>
  );
}