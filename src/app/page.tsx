"use client";

import {
  useEffect,
  useState,
} from "react";

import {
  supabase,
} from "@/lib/supabase";

type SocialAccount = {
  id: string;
  platform: string;
  username: string;
};

type Influencer = {
  id: string;
  name: string;
  avatar_url: string | null;
  user_id: string;

  social_accounts:
    SocialAccount[];
};

export default function Home() {
  const [
    influencers,
    setInfluencers,
  ] =
    useState<
      Influencer[]
    >([]);

  const [
    loading,
    setLoading,
  ] =
    useState(true);

  const [
    errorMessage,
    setErrorMessage,
  ] =
    useState("");

  const [
    showAddInfluencer,
    setShowAddInfluencer,
  ] =
    useState(false);

  const [
    newInfluencerName,
    setNewInfluencerName,
  ] =
    useState("");

  const [
    creatingInfluencer,
    setCreatingInfluencer,
  ] =
    useState(false);

  async function loadInfluencers() {
    try {
      setLoading(true);

      setErrorMessage("");

      const {
        data,
        error,
      } = await supabase
        .from("influencers")
        .select(
          `
          id,
          name,
          avatar_url,
          user_id,

          social_accounts (
            id,
            platform,
            username
          )
          `
        )
        .order(
          "created_at",
          {
            ascending:
              true,
          }
        );

      if (error) {
        throw error;
      }

      setInfluencers(
        (data ?? []) as Influencer[]
      );
    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : "Kunde inte hämta influencers."
      );
    } finally {
      setLoading(
        false
      );
    }
  }

  useEffect(() => {
    loadInfluencers();
  }, []);

  async function createInfluencer() {
    const name =
      newInfluencerName.trim();

    if (!name) {
      return;
    }

    try {
      setCreatingInfluencer(
        true
      );

      setErrorMessage("");

      /*
       * Hämta aktuell användare
       * så den nya influencern får
       * samma user_id-struktur som
       * befintliga influencers.
       */
      const {
        data:
          userData,
        error:
          userError,
      } =
        await supabase.auth
          .getUser();

      if (userError) {
        throw userError;
      }

      if (
        !userData.user
      ) {
        throw new Error(
          "Du är inte inloggad."
        );
      }

      const {
        error,
      } = await supabase
        .from("influencers")
        .insert({
          name,
          user_id:
            userData.user.id,
        });

      if (error) {
        throw error;
      }

      setNewInfluencerName(
        ""
      );

      setShowAddInfluencer(
        false
      );

      await loadInfluencers();
    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : "Kunde inte skapa influencern."
      );
    } finally {
      setCreatingInfluencer(
        false
      );
    }
  }

  if (loading) {
    return (
      <main className="min-h-screen bg-zinc-950 p-8 text-white">
        <h1 className="text-3xl font-bold">
          AI Social Publisher
        </h1>

        <p className="mt-4 text-zinc-400">
          Laddar...
        </p>
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

          <div className="mt-5 flex gap-3">

            <a
              href="/analytics"
              className="rounded-xl border border-zinc-800 bg-zinc-900 px-4 py-2 text-sm font-medium transition hover:bg-zinc-800"
            >
              Analytics
            </a>

            <a
              href="/schedule"
              className="rounded-xl border border-zinc-800 bg-zinc-900 px-4 py-2 text-sm font-medium transition hover:bg-zinc-800"
            >
              Schedule
            </a>

            <a
              href="/comments"
              className="rounded-xl border border-zinc-800 bg-zinc-900 px-4 py-2 text-sm font-medium transition hover:bg-zinc-800"
            >
              Comments
            </a>

          </div>

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
            onClick={() =>
              setShowAddInfluencer(
                true
              )
            }
            className="rounded-xl bg-white px-4 py-2 font-medium text-black transition hover:bg-zinc-200"
          >
            + Add Influencer
          </button>

        </div>

        <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">

          {influencers.map(
            (
              influencer
            ) => {
              const instagram =
                influencer.social_accounts.find(
                  (
                    account
                  ) =>
                    account.platform ===
                    "instagram"
                );

              const facebook =
                influencer.social_accounts.find(
                  (
                    account
                  ) =>
                    account.platform ===
                    "facebook"
                );

              const tiktok =
                influencer.social_accounts.find(
                  (
                    account
                  ) =>
                    account.platform ===
                    "tiktok"
                );

              return (
                <div
                  key={
                    influencer.id
                  }
                  className="rounded-2xl border border-zinc-800 bg-zinc-900 p-6"
                >

                  <div className="mb-6 flex items-center gap-4">

                    {influencer.avatar_url ? (
                      <img
                        src={
                          influencer.avatar_url
                        }
                        alt=""
                        className="h-14 w-14 rounded-full object-cover"
                      />
                    ) : (
                      <div className="flex h-14 w-14 items-center justify-center rounded-full bg-zinc-800 text-xl font-semibold">
                        {influencer.name
                          .charAt(0)
                          .toUpperCase()}
                      </div>
                    )}

                    <div>

                      <h3 className="text-xl font-semibold">
                        {
                          influencer.name
                        }
                      </h3>

                      <p className="text-sm text-zinc-500">
                        AI Influencer
                      </p>

                    </div>

                  </div>

                  <div className="space-y-3 text-sm">

                    <ConnectionRow
                      platform="Instagram"
                      account={
                        instagram
                      }
                    />

                    <ConnectionRow
                      platform="TikTok"
                      account={
                        tiktok
                      }
                    />

                    <ConnectionRow
                      platform="Facebook"
                      account={
                        facebook
                      }
                    />

                  </div>

                  <a
                    href={`/influencers/${influencer.id}`}
                    className="mt-6 block w-full rounded-xl border border-zinc-700 px-4 py-2 text-center font-medium transition hover:bg-zinc-800"
                  >
                    Open →
                  </a>

                </div>
              );
            }
          )}

        </div>

      </div>

      {showAddInfluencer && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm"
          onMouseDown={(
            event
          ) => {
            if (
              event.target ===
              event.currentTarget
            ) {
              setShowAddInfluencer(
                false
              );
            }
          }}
        >

          <div className="w-full max-w-md rounded-3xl border border-zinc-800 bg-zinc-950 p-6">

            <div className="flex items-center justify-between">

              <div>

                <p className="text-xs font-medium uppercase tracking-wider text-zinc-500">
                  New influencer
                </p>

                <h2 className="mt-1 text-2xl font-bold">
                  Add Influencer
                </h2>

              </div>

              <button
                type="button"
                onClick={() =>
                  setShowAddInfluencer(
                    false
                  )
                }
                className="flex h-9 w-9 items-center justify-center rounded-full border border-zinc-800 text-xl text-zinc-400 transition hover:bg-zinc-900 hover:text-white"
              >
                ×
              </button>

            </div>

            <div className="mt-6">

              <label className="mb-2 block text-sm font-medium">
                Name
              </label>

              <input
                type="text"
                value={
                  newInfluencerName
                }
                onChange={(
                  event
                ) =>
                  setNewInfluencerName(
                    event.target.value
                  )
                }
                onKeyDown={(
                  event
                ) => {
                  if (
                    event.key ===
                    "Enter"
                  ) {
                    createInfluencer();
                  }
                }}
                placeholder="Ex. Nova Vale"
                className="w-full rounded-xl border border-zinc-700 bg-zinc-900 px-4 py-3 outline-none transition focus:border-zinc-500"
                autoFocus
              />

            </div>

            <div className="mt-6 flex gap-3">

              <button
                type="button"
                onClick={() =>
                  setShowAddInfluencer(
                    false
                  )
                }
                disabled={
                  creatingInfluencer
                }
                className="flex-1 rounded-xl border border-zinc-700 px-4 py-3 text-sm font-medium transition hover:bg-zinc-900 disabled:opacity-50"
              >
                Cancel
              </button>

              <button
                type="button"
                onClick={
                  createInfluencer
                }
                disabled={
                  creatingInfluencer ||
                  !newInfluencerName.trim()
                }
                className="flex-1 rounded-xl bg-white px-4 py-3 text-sm font-semibold text-black transition hover:bg-zinc-200 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {creatingInfluencer
                  ? "Creating..."
                  : "Create"}
              </button>

            </div>

          </div>

        </div>
      )}

    </main>
  );
}

function ConnectionRow({
  platform,
  account,
}: {
  platform: string;

  account:
    | SocialAccount
    | undefined;
}) {
  return (
    <div className="flex items-center justify-between gap-3">

      <span>
        {platform}
      </span>

      {account ? (
        <span className="min-w-0 truncate text-emerald-400">
          ✓{" "}
          {account.username ||
            "Connected"}
        </span>
      ) : (
        <span className="text-zinc-500">
          ○ Not connected
        </span>
      )}

    </div>
  );
}
