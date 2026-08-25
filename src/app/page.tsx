"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

type Influencer = {
  id: string;
  name: string;
  avatar_url: string | null;
  user_id: string;
};

export default function Home() {
  const [influencers, setInfluencers] = useState<Influencer[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState("");

  useEffect(() => {
    async function loadInfluencers() {
      const { data, error } = await supabase
        .from("influencers")
        .select("*")
        .order("created_at", { ascending: true });

      if (error) {
        setErrorMessage(error.message);
      } else {
        setInfluencers(data ?? []);
      }

      setLoading(false);
    }

    loadInfluencers();
  }, []);

  if (loading) {
    return (
      <main className="min-h-screen bg-zinc-950 p-8 text-white">
        <h1 className="text-3xl font-bold">AI Social Publisher</h1>
        <p className="mt-4 text-zinc-400">Laddar...</p>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-zinc-950 px-6 py-10 text-white">
      <div className="mx-auto max-w-5xl">
        <div className="mb-10">
          <h1 className="text-4xl font-bold tracking-tight">
            AI Social Publisher
          </h1>

          <p className="mt-2 text-zinc-400">
            Hantera dina AI-influencers och deras sociala konton.
          </p>
        </div>

        {errorMessage && (
          <div className="mb-6 rounded-xl border border-red-900 bg-red-950/40 p-4 text-red-300">
            {errorMessage}
          </div>
        )}

        <div className="mb-6 flex items-center justify-between">
          <h2 className="text-2xl font-semibold">
            Your Influencers
          </h2>

          <button
            type="button"
            className="rounded-xl bg-white px-4 py-2 font-medium text-black transition hover:bg-zinc-200"
          >
            + Add Influencer
          </button>
        </div>

        <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
          {influencers.map((influencer) => (
            <div
              key={influencer.id}
              className="rounded-2xl border border-zinc-800 bg-zinc-900 p-6"
            >
              <div className="mb-6 flex items-center gap-4">
                <div className="flex h-14 w-14 items-center justify-center rounded-full bg-zinc-800 text-xl font-semibold">
                  {influencer.name.charAt(0).toUpperCase()}
                </div>

                <div>
                  <h3 className="text-xl font-semibold">
                    {influencer.name}
                  </h3>

                  <p className="text-sm text-zinc-500">
                    AI Influencer
                  </p>
                </div>
              </div>

              <div className="space-y-3 text-sm">
                <div className="flex items-center justify-between">
                  <span>Instagram</span>
                  <span className="text-zinc-500">○ Not connected</span>
                </div>

                <div className="flex items-center justify-between">
                  <span>TikTok</span>
                  <span className="text-zinc-500">○ Not connected</span>
                </div>

                <div className="flex items-center justify-between">
                  <span>Facebook</span>
                  <span className="text-zinc-500">○ Not connected</span>
                </div>
              </div>

             <a
  href={`/influencers/${influencer.id}`}
  className="mt-6 block w-full rounded-xl border border-zinc-700 px-4 py-2 text-center font-medium transition hover:bg-zinc-800"
>
  Open →
</a>
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}