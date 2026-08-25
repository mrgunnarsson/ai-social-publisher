"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { supabase } from "@/lib/supabase";

type Influencer = {
  id: string;
  name: string;
  avatar_url: string | null;
};

export default function InfluencerPage() {
  const params = useParams();
  const id = params.id as string;

  const [influencer, setInfluencer] =
    useState<Influencer | null>(null);

  const [loading, setLoading] =
    useState(true);

    const [facebookConnected, setFacebookConnected] =
  useState<boolean | null>(null);

const [facebookName, setFacebookName] =
  useState<string | null>(null);

  const [instagramConnected, setInstagramConnected] =
  useState<boolean | null>(null);

const [instagramUsername, setInstagramUsername] =
  useState<string | null>(null);

  useEffect(() => {
    async function loadInfluencer() {
      const { data } = await supabase
        .from("influencers")
        .select("id, name, avatar_url")
        .eq("id", id)
        .single();

      setInfluencer(data);
      setLoading(false);
    }

    loadInfluencer();
    async function loadFacebookStatus() {
  try {
    const response =
      await fetch(
        `/api/facebook/status?influencerId=${id}`,
        {
          cache: "no-store",
        }
      );

    const result =
      await response.json();

    if (
      response.ok &&
      result.ok &&
      result.connected
    ) {
      setFacebookConnected(true);

      setFacebookName(
        result.account?.name ??
          null
      );
    } else {
      setFacebookConnected(false);
      setFacebookName(null);
    }
  } catch {
    setFacebookConnected(false);
    setFacebookName(null);
  }
}

loadFacebookStatus();
  }, [id]);

  async function loadInstagramStatus() {
  try {
    const response =
      await fetch(
        `/api/instagram/status?influencerId=${id}`,
        {
          cache: "no-store",
        }
      );

    const result =
      await response.json();

    if (
      response.ok &&
      result.ok &&
      result.connected
    ) {
      setInstagramConnected(true);

      setInstagramUsername(
        result.account?.username ??
          null
      );
    } else {
      setInstagramConnected(false);
      setInstagramUsername(null);
    }
  } catch {
    setInstagramConnected(false);
    setInstagramUsername(null);
  }
}

loadInstagramStatus();

  if (loading) {
    return (
      <main className="min-h-screen bg-zinc-950 p-8 text-white">
        Laddar...
      </main>
    );
  }

  if (!influencer) {
    return (
      <main className="min-h-screen bg-zinc-950 p-8 text-white">
        Influencer hittades inte.
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-zinc-950 px-6 py-10 text-white">
      <div className="mx-auto max-w-4xl">

        <a
          href="/"
          className="text-sm text-zinc-400 hover:text-white"
        >
          ← Back
        </a>

        <div className="mt-8 flex items-center gap-5">
          <div className="flex h-20 w-20 items-center justify-center rounded-full bg-zinc-800 text-3xl font-semibold">
            {influencer.name.charAt(0)}
          </div>

          <div>
            <h1 className="text-4xl font-bold">
              {influencer.name}
            </h1>

            <p className="mt-1 text-zinc-400">
              AI Influencer
            </p>
          </div>
        </div>

        <div className="mt-10 grid gap-4">

         <div className="rounded-2xl border border-zinc-800 bg-zinc-900 p-5">
  <div className="flex items-center justify-between">
    <div>
      <h2 className="text-lg font-semibold">
        Instagram
      </h2>

      {instagramConnected === null ? (
        <p className="text-sm text-zinc-500">
          Checking connection...
        </p>
      ) : instagramConnected ? (
        <p className="text-sm text-green-400">
          Connected
          {instagramUsername
            ? ` · @${instagramUsername}`
            : ""}
        </p>
      ) : (
        <p className="text-sm text-zinc-500">
          Not connected
        </p>
      )}
    </div>

<a
  href={`/api/instagram/oauth/start?influencerId=${influencer.id}`}
  className="rounded-xl bg-zinc-800 px-4 py-2 font-medium transition hover:bg-zinc-700"
>
  {instagramConnected
    ? "Reconnect"
    : "Connect"}
</a>
  </div>
</div>

          <div className="rounded-2xl border border-zinc-800 bg-zinc-900 p-5">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-lg font-semibold">
                  TikTok
                </h2>

                <p className="text-sm text-zinc-500">
                  Not connected
                </p>
              </div>

              <button className="rounded-xl bg-zinc-800 px-4 py-2 font-medium">
                Connect
              </button>
            </div>
          </div>

          <div className="rounded-2xl border border-zinc-800 bg-zinc-900 p-5">
  <div className="flex items-center justify-between">
    <div>
      <h2 className="text-lg font-semibold">
        Facebook
      </h2>

      {facebookConnected === null ? (
        <p className="text-sm text-zinc-500">
          Checking connection...
        </p>
      ) : facebookConnected ? (
        <p className="text-sm text-green-400">
          Connected
          {facebookName
            ? ` · ${facebookName}`
            : ""}
        </p>
      ) : (
        <p className="text-sm text-zinc-500">
          Not connected
        </p>
      )}
    </div>

    <a
      href={`/api/facebook/oauth/start?influencerId=${influencer.id}`}
      className="rounded-xl bg-zinc-800 px-4 py-2 font-medium transition hover:bg-zinc-700"
    >
      {facebookConnected
        ? "Reconnect"
        : "Connect"}
    </a>
  </div>
</div>

          <a
  href={`/influencers/${influencer.id}/create`}
  className="mt-8 block w-full rounded-xl bg-white px-5 py-3 text-center font-semibold text-black transition hover:bg-zinc-200"
>
  + Create Post
</a>

<a
  href={`/influencers/${influencer.id}/scheduled`}
  className="block w-full rounded-xl border border-zinc-700 px-5 py-3 text-center font-semibold transition hover:bg-zinc-800"
>
  Scheduled Posts
</a>

<a
  href={`/influencers/${influencer.id}/published`}
  className="block w-full rounded-xl border border-zinc-700 px-5 py-3 text-center font-semibold transition hover:bg-zinc-800"
>
  Published Posts
</a>

        </div>
      </div>
    </main>
  );
}