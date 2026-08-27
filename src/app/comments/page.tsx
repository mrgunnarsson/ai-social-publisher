"use client";

/* eslint-disable @next/next/no-img-element */

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { supabase } from "@/lib/supabase";

type InboxStatus = "all" | "needs_reply" | "replied" | "ignored";
type PlatformFilter = "all" | "instagram" | "facebook";

type Influencer = {
  id: string;
  name: string;
  avatar_url: string | null;
};

type InboxComment = {
  id: string;
  parentId: string | null;
  authorUsername: string | null;
  authorName: string | null;
  message: string | null;
  createdAt: string;
  likeCount: number | null;
  isFromOurAccount: boolean;
  isHidden: boolean | null;
  isDeleted: boolean;
};

type InboxThread = {
  id: string;
  platform: "instagram" | "facebook";
  status: Exclude<InboxStatus, "all">;
  needsReply: boolean;
  lastActivityAt: string;
  influencer: Influencer | null;
  post: {
    id: string;
    caption: string | null;
    media_url: string | null;
    media_type: "image" | "video" | null;
    published_at: string | null;
  } | null;
  rootComment: {
    id: string;
    authorUsername: string | null;
    authorName: string | null;
    message: string | null;
    createdAt: string;
    likeCount: number | null;
    isHidden: boolean | null;
  } | null;
  comments: InboxComment[];
};

type InboxResponse = {
  ok: boolean;
  influencers?: Influencer[];
  threads?: InboxThread[];
  nextCursor?: string | null;
  error?: string;
};

const statusFilters: Array<{ value: InboxStatus; label: string }> = [
  { value: "all", label: "All" },
  { value: "needs_reply", label: "Needs reply" },
  { value: "replied", label: "Replied" },
  { value: "ignored", label: "Ignored" },
];

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function authorLabel(comment: {
  authorUsername: string | null;
  authorName: string | null;
}) {
  if (comment.authorUsername) return `@${comment.authorUsername}`;
  return comment.authorName ?? "Instagram or Facebook user";
}

function safeMediaUrl(value: string | null | undefined) {
  if (!value) return null;

  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function commentDepth(comment: InboxComment, comments: InboxComment[]) {
  const commentsById = new Map(comments.map((item) => [item.id, item]));
  const visited = new Set<string>();
  let parentId = comment.parentId;
  let depth = 0;

  while (parentId && depth < 3 && !visited.has(parentId)) {
    visited.add(parentId);
    depth += 1;
    parentId = commentsById.get(parentId)?.parentId ?? null;
  }

  return depth;
}

function PlatformMark({ platform }: { platform: InboxThread["platform"] }) {
  return (
    <span
      aria-label={platform === "instagram" ? "Instagram" : "Facebook"}
      className={`flex h-8 w-8 items-center justify-center rounded-lg text-xs font-bold text-white ${
        platform === "instagram"
          ? "bg-gradient-to-br from-fuchsia-500 via-rose-500 to-amber-400"
          : "bg-blue-600"
      }`}
    >
      {platform === "instagram" ? "IG" : "f"}
    </span>
  );
}

function StatusBadge({ status }: { status: InboxThread["status"] }) {
  const styles = {
    needs_reply: "border-amber-400/20 bg-amber-400/10 text-amber-200",
    replied: "border-emerald-400/20 bg-emerald-400/10 text-emerald-200",
    ignored: "border-zinc-700 bg-zinc-800 text-zinc-400",
  }[status];
  const label = {
    needs_reply: "Needs reply",
    replied: "Replied",
    ignored: "Ignored",
  }[status];

  return (
    <span className={`rounded-full border px-2.5 py-1 text-[11px] font-medium ${styles}`}>
      {label}
    </span>
  );
}

export default function CommentsPage() {
  const [threads, setThreads] = useState<InboxThread[]>([]);
  const [influencers, setInfluencers] = useState<Influencer[]>([]);
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null);
  const [status, setStatus] = useState<InboxStatus>("all");
  const [platform, setPlatform] = useState<PlatformFilter>("all");
  const [influencerId, setInfluencerId] = useState("all");
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");
  const requestIdRef = useRef(0);

  const selectedThread = useMemo(
    () => threads.find((thread) => thread.id === selectedThreadId) ?? threads[0] ?? null,
    [selectedThreadId, threads]
  );

  const loadThreads = useCallback(
    async (cursor: string | null = null) => {
      await Promise.resolve();
      const requestId = requestIdRef.current + 1;
      requestIdRef.current = requestId;

      if (cursor) {
        setLoadingMore(true);
      } else {
        setLoading(true);
      }
      setError("");

      try {
        const {
          data: { session },
          error: sessionError,
        } = await supabase.auth.getSession();

        if (sessionError || !session) {
          throw new Error("Your session has expired. Please sign in again.");
        }

        const parameters = new URLSearchParams({
          platform,
          status,
          limit: "30",
        });

        if (influencerId !== "all") parameters.set("influencerId", influencerId);
        if (cursor) parameters.set("cursor", cursor);

        const response = await fetch(`/api/comments?${parameters.toString()}`, {
          cache: "no-store",
          headers: {
            Authorization: `Bearer ${session.access_token}`,
          },
        });
        const result = (await response.json()) as InboxResponse;

        if (!response.ok || !result.ok) {
          throw new Error(result.error ?? "Could not load the comment inbox.");
        }

        if (requestId !== requestIdRef.current) {
          return;
        }

        const incoming = result.threads ?? [];
        setInfluencers(result.influencers ?? []);
        setThreads((current) => (cursor ? [...current, ...incoming] : incoming));
        setNextCursor(result.nextCursor ?? null);

        if (!cursor) {
          setSelectedThreadId(incoming[0]?.id ?? null);
        }
      } catch (loadError) {
        if (requestId !== requestIdRef.current) {
          return;
        }

        setError(
          loadError instanceof Error ? loadError.message : "Could not load the comment inbox."
        );

        if (!cursor) {
          setThreads([]);
          setSelectedThreadId(null);
        }
      } finally {
        if (requestId === requestIdRef.current) {
          setLoading(false);
          setLoadingMore(false);
        }
      }
    },
    [influencerId, platform, status]
  );

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      void loadThreads();
    }, 0);

    return () => window.clearTimeout(timeout);
  }, [loadThreads]);

  return (
    <main className="min-h-screen bg-[#09090b] text-zinc-100">
      <header className="border-b border-white/5 bg-zinc-950/80 px-5 py-4 backdrop-blur-xl lg:px-8">
        <div className="mx-auto flex max-w-[1500px] items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <Link
              href="/"
              className="flex h-10 w-10 items-center justify-center rounded-xl border border-zinc-800 bg-zinc-900 text-zinc-400 transition hover:border-zinc-700 hover:text-white"
              aria-label="Back to dashboard"
            >
              ←
            </Link>
            <div>
              <div className="flex items-center gap-2.5">
                <h1 className="text-xl font-semibold tracking-tight">Comment Inbox</h1>
                <span className="rounded-md border border-violet-400/20 bg-violet-400/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-violet-300">
                  Read only
                </span>
              </div>
              <p className="mt-0.5 text-sm text-zinc-500">
                Instagram and Facebook conversations in one place
              </p>
            </div>
          </div>

          <div className="hidden items-center gap-2 rounded-full border border-zinc-800 bg-zinc-900/80 px-3 py-1.5 text-xs text-zinc-400 sm:flex">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
            Synced comments only
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-[1500px] px-5 py-6 lg:px-8">
        <section className="mb-5 flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
          <div className="flex gap-1 overflow-x-auto rounded-xl border border-zinc-800 bg-zinc-900/70 p-1">
            {statusFilters.map((filter) => (
              <button
                key={filter.value}
                type="button"
                onClick={() => setStatus(filter.value)}
                className={`whitespace-nowrap rounded-lg px-3.5 py-2 text-sm font-medium transition ${
                  status === filter.value
                    ? "bg-zinc-700 text-white shadow-sm"
                    : "text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
                }`}
              >
                {filter.label}
              </button>
            ))}
          </div>

          <div className="grid gap-2 sm:grid-cols-2">
            <label className="relative">
              <span className="sr-only">Influencer</span>
              <select
                value={influencerId}
                onChange={(event) => setInfluencerId(event.target.value)}
                className="h-10 min-w-48 appearance-none rounded-xl border border-zinc-800 bg-zinc-900 px-3 pr-9 text-sm text-zinc-200 outline-none transition focus:border-violet-500"
              >
                <option value="all">All influencers</option>
                {influencers.map((influencer) => (
                  <option key={influencer.id} value={influencer.id}>
                    {influencer.name}
                  </option>
                ))}
              </select>
              <span className="pointer-events-none absolute right-3 top-2.5 text-xs text-zinc-500">⌄</span>
            </label>

            <label className="relative">
              <span className="sr-only">Platform</span>
              <select
                value={platform}
                onChange={(event) => setPlatform(event.target.value as PlatformFilter)}
                className="h-10 min-w-44 appearance-none rounded-xl border border-zinc-800 bg-zinc-900 px-3 pr-9 text-sm text-zinc-200 outline-none transition focus:border-violet-500"
              >
                <option value="all">All platforms</option>
                <option value="instagram">Instagram</option>
                <option value="facebook">Facebook</option>
              </select>
              <span className="pointer-events-none absolute right-3 top-2.5 text-xs text-zinc-500">⌄</span>
            </label>
          </div>
        </section>

        {error && (
          <div className="mb-5 rounded-xl border border-red-900/70 bg-red-950/40 px-4 py-3 text-sm text-red-200">
            {error}
          </div>
        )}

        <section className="grid min-h-[680px] overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-900/40 shadow-2xl shadow-black/20 lg:grid-cols-[390px_minmax(0,1fr)]">
          <aside className="border-b border-zinc-800 lg:border-b-0 lg:border-r">
            <div className="flex h-14 items-center justify-between border-b border-zinc-800 px-4">
              <h2 className="text-sm font-semibold text-zinc-200">Conversations</h2>
              <span className="text-xs text-zinc-500">{threads.length} loaded</span>
            </div>

            <div className="max-h-[420px] overflow-y-auto lg:max-h-[730px]">
              {loading ? (
                <div className="space-y-3 p-4">
                  {[0, 1, 2, 3].map((item) => (
                    <div key={item} className="h-28 animate-pulse rounded-xl bg-zinc-800/70" />
                  ))}
                </div>
              ) : threads.length === 0 ? (
                <div className="px-8 py-20 text-center">
                  <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl border border-zinc-800 bg-zinc-900 text-xl">
                    ◌
                  </div>
                  <h3 className="mt-4 font-medium">No comments here yet</h3>
                  <p className="mt-2 text-sm leading-6 text-zinc-500">
                    Comments will appear after the read-only sync worker has processed published content.
                  </p>
                </div>
              ) : (
                <>
                  {threads.map((thread) => (
                    <button
                      key={thread.id}
                      type="button"
                      onClick={() => setSelectedThreadId(thread.id)}
                      className={`w-full border-b border-zinc-800/80 p-4 text-left transition ${
                        selectedThread?.id === thread.id
                          ? "bg-violet-500/[0.08] shadow-[inset_3px_0_0_#8b5cf6]"
                          : "hover:bg-zinc-800/50"
                      }`}
                    >
                      <div className="flex items-start gap-3">
                        <PlatformMark platform={thread.platform} />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center justify-between gap-2">
                            <p className="truncate text-sm font-semibold text-zinc-200">
                              {thread.rootComment ? authorLabel(thread.rootComment) : "Unknown commenter"}
                            </p>
                            <span className="shrink-0 text-[11px] text-zinc-600">
                              {formatDateTime(thread.lastActivityAt)}
                            </span>
                          </div>
                          <p className="mt-1 line-clamp-2 text-sm leading-5 text-zinc-400">
                            {thread.rootComment?.message || "Comment content unavailable"}
                          </p>
                          <div className="mt-3 flex items-center justify-between gap-2">
                            <span className="truncate text-xs text-zinc-600">
                              {thread.influencer?.name ?? "Influencer"}
                            </span>
                            <StatusBadge status={thread.status} />
                          </div>
                        </div>
                      </div>
                    </button>
                  ))}

                  {nextCursor && (
                    <div className="p-4">
                      <button
                        type="button"
                        disabled={loadingMore}
                        onClick={() => void loadThreads(nextCursor)}
                        className="w-full rounded-xl border border-zinc-700 px-4 py-2.5 text-sm font-medium text-zinc-300 transition hover:bg-zinc-800 disabled:cursor-wait disabled:opacity-50"
                      >
                        {loadingMore ? "Loading…" : "Load more"}
                      </button>
                    </div>
                  )}
                </>
              )}
            </div>
          </aside>

          <div className="min-w-0 bg-zinc-950/40">
            {!selectedThread ? (
              <div className="flex min-h-[600px] items-center justify-center px-6 text-center">
                <div>
                  <p className="text-sm text-zinc-500">Select a conversation to view its thread.</p>
                </div>
              </div>
            ) : (
              <div className="flex min-h-[680px] flex-col">
                <div className="border-b border-zinc-800 p-5 sm:p-6">
                  <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
                    <div className="flex min-w-0 gap-4">
                      {safeMediaUrl(selectedThread.post?.media_url) ? (
                        <img
                          src={safeMediaUrl(selectedThread.post?.media_url) ?? undefined}
                          alt="Associated post"
                          className="h-16 w-16 shrink-0 rounded-xl border border-zinc-800 object-cover"
                        />
                      ) : (
                        <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-xl border border-zinc-800 bg-zinc-900 text-xl text-zinc-600">
                          {selectedThread.post?.media_type === "video" ? "▶" : "◇"}
                        </div>
                      )}
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <PlatformMark platform={selectedThread.platform} />
                          <StatusBadge status={selectedThread.status} />
                        </div>
                        <p className="mt-3 line-clamp-2 max-w-2xl text-sm leading-6 text-zinc-300">
                          {selectedThread.post?.caption || "Published post without a caption"}
                        </p>
                        <p className="mt-1.5 text-xs text-zinc-600">
                          {selectedThread.influencer?.name ?? "Influencer"}
                          {selectedThread.post?.published_at
                            ? ` · Published ${formatDateTime(selectedThread.post.published_at)}`
                            : ""}
                        </p>
                      </div>
                    </div>

                    <div className="flex shrink-0 gap-2">
                      <button
                        type="button"
                        disabled
                        title="Coming soon"
                        className="cursor-not-allowed rounded-xl border border-zinc-800 bg-zinc-900 px-3.5 py-2 text-xs font-medium text-zinc-600"
                      >
                        Ignore · Soon
                      </button>
                    </div>
                  </div>
                </div>

                <div className="flex-1 space-y-4 overflow-y-auto p-5 sm:p-7">
                  {selectedThread.comments.map((comment) => (
                    <article
                      key={comment.id}
                      className={`flex gap-3 ${comment.parentId ? "border-l border-zinc-800 pl-4 sm:pl-5" : ""}`}
                      style={
                        comment.parentId
                          ? {
                              marginLeft: `${Math.min(
                                commentDepth(comment, selectedThread.comments),
                                3
                              ) * 24}px`,
                            }
                          : undefined
                      }
                    >
                      <div
                        className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${
                          comment.isFromOurAccount
                            ? "bg-violet-500 text-white"
                            : "bg-zinc-800 text-zinc-300"
                        }`}
                      >
                        {(comment.isFromOurAccount
                          ? selectedThread.influencer?.name
                          : comment.authorUsername ?? comment.authorName ?? "U"
                        )
                          ?.charAt(0)
                          .toUpperCase()}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                          <p className="text-sm font-semibold text-zinc-200">
                            {comment.isFromOurAccount
                              ? selectedThread.influencer?.name ?? "Connected account"
                              : authorLabel(comment)}
                          </p>
                          {comment.isFromOurAccount && (
                            <span className="text-[10px] font-medium uppercase tracking-wider text-violet-400">
                              Your account
                            </span>
                          )}
                          <time className="text-xs text-zinc-600">
                            {formatDateTime(comment.createdAt)}
                          </time>
                        </div>
                        <div
                          className={`mt-2 rounded-2xl border px-4 py-3 ${
                            comment.isFromOurAccount
                              ? "border-violet-500/20 bg-violet-500/[0.08]"
                              : "border-zinc-800 bg-zinc-900/80"
                          }`}
                        >
                          <p className="whitespace-pre-wrap break-words text-sm leading-6 text-zinc-300">
                            {comment.isDeleted
                              ? "Comment deleted"
                              : comment.isHidden
                                ? "Hidden comment"
                                : comment.message || "Comment content unavailable"}
                          </p>
                        </div>
                        {comment.likeCount !== null && comment.likeCount > 0 && (
                          <p className="mt-1.5 text-xs text-zinc-600">♥ {comment.likeCount}</p>
                        )}
                      </div>
                    </article>
                  ))}
                </div>

                <div className="border-t border-zinc-800 bg-zinc-950/80 p-4 sm:p-5">
                  <div className="rounded-2xl border border-zinc-800 bg-zinc-900/70 p-3">
                    <textarea
                      disabled
                      rows={2}
                      placeholder="Replying is coming in a later phase"
                      className="w-full resize-none bg-transparent px-1 py-1 text-sm text-zinc-500 outline-none placeholder:text-zinc-600 disabled:cursor-not-allowed"
                    />
                    <div className="mt-2 flex flex-wrap items-center justify-between gap-2 border-t border-zinc-800 pt-3">
                      <button
                        type="button"
                        disabled
                        title="Coming soon"
                        className="cursor-not-allowed rounded-lg border border-violet-500/10 bg-violet-500/[0.06] px-3 py-2 text-xs font-medium text-violet-400/50"
                      >
                        ✦ Generate AI reply · Coming soon
                      </button>
                      <button
                        type="button"
                        disabled
                        title="Coming soon"
                        className="cursor-not-allowed rounded-lg bg-zinc-800 px-5 py-2 text-xs font-semibold text-zinc-600"
                      >
                        Reply · Coming soon
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </section>
      </div>
    </main>
  );
}
