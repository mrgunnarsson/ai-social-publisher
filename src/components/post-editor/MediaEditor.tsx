"use client";

import {
  useEffect,
  useRef,
  useState,
} from "react";

import { supabase } from "@/lib/supabase";

export type TextPosition =
  | "top"
  | "center"
  | "bottom";

export type TextColor =
  | "white"
  | "black";

export type MusicTrack = {
  id: string;
  title: string;
  artist: string | null;
  audio_url: string;
  genre: string | null;
  mood: string | null;
  energy: number | null;
  duration_seconds: number | null;
};

type MediaEditorProps = {
  file: File | null;

  overlayText: string;

  onOverlayTextChange: (
    value: string
  ) => void;

  textPosition: TextPosition;

  onTextPositionChange: (
    value: TextPosition
  ) => void;

  fontSize: number;

  onFontSizeChange: (
    value: number
  ) => void;

  textColor: TextColor;

  onTextColorChange: (
    value: TextColor
  ) => void;

  selectedMusicTrack:
    MusicTrack | null;

  onSelectedMusicTrackChange: (
    value: MusicTrack | null
  ) => void;

  originalAudioVolume: number;

  onOriginalAudioVolumeChange: (
    value: number
  ) => void;

  musicVolume: number;

  onMusicVolumeChange: (
    value: number
  ) => void;

  musicStartTime: number;

onMusicStartTimeChange: (
  value: number
) => void;
};

const REEL_WIDTH =
  1080;

const PREVIEW_REFERENCE_WIDTH =
  384;

export default function MediaEditor({
  file,

  overlayText,

  onOverlayTextChange,

  textPosition,

  onTextPositionChange,

  fontSize,

  onFontSizeChange,

  textColor,

  onTextColorChange,

  selectedMusicTrack,

  onSelectedMusicTrackChange,

  originalAudioVolume,

  onOriginalAudioVolumeChange,

  musicVolume,

  onMusicVolumeChange,

  musicStartTime,

onMusicStartTimeChange,
}: MediaEditorProps) {
  const [
    previewUrl,
    setPreviewUrl,
  ] =
    useState<string | null>(
      null
    );

  const [
    musicTracks,
    setMusicTracks,
  ] =
    useState<MusicTrack[]>(
      []
    );

  const [
    musicLoading,
    setMusicLoading,
  ] =
    useState(false);

  const [
    musicError,
    setMusicError,
  ] =
    useState("");

  const [
    previewingTrackId,
    setPreviewingTrackId,
  ] =
    useState<string | null>(
      null
    );

  const audioRef =
    useRef<HTMLAudioElement | null>(
      null
    );

  const isVideo =
    file?.type.startsWith(
      "video/"
    ) ?? false;

  useEffect(() => {
    if (!file) {
      setPreviewUrl(
        null
      );

      return;
    }

    const url =
      URL.createObjectURL(
        file
      );

    setPreviewUrl(
      url
    );

    return () => {
      URL.revokeObjectURL(
        url
      );
    };
  }, [file]);

  useEffect(() => {
    if (!isVideo) {
      return;
    }

    async function loadMusic() {
      try {
        setMusicLoading(
          true
        );

        setMusicError(
          ""
        );

        const {
          data,
          error,
        } = await supabase
          .from(
            "music_tracks"
          )
          .select(
            `
            id,
            title,
            artist,
            audio_url,
            genre,
            mood,
            energy,
            duration_seconds
            `
          )
          .eq(
            "is_active",
            true
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

        setMusicTracks(
          data ?? []
        );
      } catch (error) {
        setMusicError(
          error instanceof Error
            ? error.message
            : "Kunde inte hämta musik."
        );
      } finally {
        setMusicLoading(
          false
        );
      }
    }

    loadMusic();
  }, [isVideo]);

  useEffect(() => {
    return () => {
      if (
        audioRef.current
      ) {
        audioRef.current.pause();
      }
    };
  }, []);

  const previewFontSize =
    (
      fontSize *
      (
        REEL_WIDTH /
        PREVIEW_REFERENCE_WIDTH
      )
    ) *
    (
      PREVIEW_REFERENCE_WIDTH /
      REEL_WIDTH
    );

  function getPositionStyle():
    React.CSSProperties {
    switch (
      textPosition
    ) {
      case "top":
        return {
          top:
            "16%",
          transform:
            "translateY(-50%)",
        };

      case "center":
        return {
          top:
            "50%",
          transform:
            "translateY(-50%)",
        };

      case "bottom":
      default:
        return {
          top:
            "82%",
          transform:
            "translateY(-50%)",
        };
    }
  }

  async function toggleMusicPreview(
    track: MusicTrack
  ) {
    if (
      previewingTrackId ===
      track.id
    ) {
      audioRef.current?.pause();

      setPreviewingTrackId(
        null
      );

      return;
    }

    if (
      audioRef.current
    ) {
      audioRef.current.pause();
    }

    const audio =
      new Audio(
        track.audio_url
      );

    audio.volume =
      musicVolume;

      audio.currentTime =
  musicStartTime;

    audioRef.current =
      audio;

    audio.onended =
      () => {
        setPreviewingTrackId(
          null
        );
      };

    try {
      await audio.play();

      setPreviewingTrackId(
        track.id
      );
    } catch {
      setMusicError(
        "Kunde inte spela upp låten."
      );
    }
  }

  function selectTrack(
    track: MusicTrack
  ) {
    onSelectedMusicTrackChange(
      track
    );
  }

  function removeMusic() {
    if (
      audioRef.current
    ) {
      audioRef.current.pause();
    }

    setPreviewingTrackId(
      null
    );

    onSelectedMusicTrackChange(
      null
    );
  }

  if (!file) {
    return null;
  }

  return (
    <div className="space-y-5">

      <div>
        <h2 className="text-lg font-semibold">
          Media Editor
        </h2>

        <p className="mt-1 text-sm text-zinc-500">
          {isVideo
            ? "Förhandsgranska din Reel, lägg text och musik ovanpå videon."
            : "Förhandsgranska och lägg text ovanpå bilden."}
        </p>
      </div>

      {/* PREVIEW */}

      <div className="mx-auto w-full max-w-sm">

        <div
          className={`relative w-full overflow-hidden rounded-2xl border border-zinc-800 bg-black ${
            isVideo
              ? "aspect-[9/16]"
              : "aspect-square"
          }`}
        >

          {previewUrl ? (
            isVideo ? (
              <video
                src={
                  previewUrl
                }
                controls
                playsInline
                preload="metadata"
                className="absolute inset-0 h-full w-full object-cover"
              />
            ) : (
              <img
                src={
                  previewUrl
                }
                alt="Preview"
                className="absolute inset-0 h-full w-full object-cover"
              />
            )
          ) : (
            <div className="flex h-full items-center justify-center text-sm text-zinc-500">
              Laddar preview...
            </div>
          )}

          {/* OVERLAY */}

          {overlayText && (
            <div
              className="pointer-events-none absolute left-[7%] right-[7%] z-10"
              style={
                getPositionStyle()
              }
            >
              <div
                className="break-words text-center font-bold leading-tight"
                style={{
                  fontSize:
                    `${previewFontSize}px`,

                  color:
                    textColor ===
                    "white"
                      ? "#ffffff"
                      : "#000000",

                  WebkitTextStroke:
                    textColor ===
                    "white"
                      ? "2px rgba(0,0,0,0.85)"
                      : "2px rgba(255,255,255,0.7)",

                  paintOrder:
                    "stroke fill",

                  textShadow:
                    textColor ===
                    "white"
                      ? "0 2px 5px rgba(0,0,0,0.65)"
                      : "0 2px 5px rgba(255,255,255,0.55)",
                }}
              >
                {
                  overlayText
                }
              </div>
            </div>
          )}

        </div>

        {isVideo && (
          <div className="mt-2 flex items-center justify-between text-xs text-zinc-600">

            <span>
              Reel preview
            </span>

            <span>
              1080 × 1920 · 9:16
            </span>

          </div>
        )}

      </div>

      {/* CONTROLS */}

      <div className="space-y-5 rounded-2xl border border-zinc-800 bg-zinc-950 p-5">

        {/* TEXT */}

        <div>
          <label className="mb-2 block text-sm font-medium">
            Overlaytext
          </label>

          <textarea
            value={
              overlayText
            }
            onChange={(
              event
            ) =>
              onOverlayTextChange(
                event
                  .target
                  .value
              )
            }
            placeholder="Skriv text på din Reel..."
            rows={3}
            className="w-full resize-none rounded-xl border border-zinc-700 bg-zinc-900 px-4 py-3 outline-none focus:border-zinc-500"
          />
        </div>

        {/* POSITION */}

        <div>
          <p className="mb-3 text-sm font-medium">
            Placering
          </p>

          <div className="grid grid-cols-3 gap-2">

            <OptionButton
              label="Top"
              active={
                textPosition ===
                "top"
              }
              onClick={() =>
                onTextPositionChange(
                  "top"
                )
              }
            />

            <OptionButton
              label="Center"
              active={
                textPosition ===
                "center"
              }
              onClick={() =>
                onTextPositionChange(
                  "center"
                )
              }
            />

            <OptionButton
              label="Bottom"
              active={
                textPosition ===
                "bottom"
              }
              onClick={() =>
                onTextPositionChange(
                  "bottom"
                )
              }
            />

          </div>
        </div>

        {/* SIZE */}

        <div>

          <div className="mb-3 flex items-center justify-between">

            <p className="text-sm font-medium">
              Storlek
            </p>

            <span className="text-xs text-zinc-500">
              {fontSize}
            </span>

          </div>

          <input
            type="range"
            min="20"
            max="96"
            step="2"
            value={
              fontSize
            }
            onChange={(
              event
            ) =>
              onFontSizeChange(
                Number(
                  event
                    .target
                    .value
                )
              )
            }
            className="w-full"
          />

        </div>

        {/* COLOR */}

        <div>

          <p className="mb-3 text-sm font-medium">
            Färg
          </p>

          <div className="grid grid-cols-2 gap-2">

            <OptionButton
              label="White"
              active={
                textColor ===
                "white"
              }
              onClick={() =>
                onTextColorChange(
                  "white"
                )
              }
            />

            <OptionButton
              label="Black"
              active={
                textColor ===
                "black"
              }
              onClick={() =>
                onTextColorChange(
                  "black"
                )
              }
            />

          </div>

        </div>

        {/* MUSIC */}

        {isVideo && (
          <div className="border-t border-zinc-800 pt-5">

            <div>
              <p className="text-sm font-medium">
                Musik
              </p>

              <p className="mt-1 text-xs text-zinc-500">
                Välj musik till din Reel.
              </p>
            </div>

            {musicLoading && (
              <div className="mt-4 rounded-xl border border-zinc-800 bg-zinc-900 p-4 text-sm text-zinc-500">
                Hämtar musik...
              </div>
            )}

            {musicError && (
              <div className="mt-4 rounded-xl border border-red-900/50 bg-red-950/30 p-4 text-sm text-red-300">
                {musicError}
              </div>
            )}

            {!musicLoading &&
              musicTracks.length ===
                0 && (
                <div className="mt-4 rounded-xl border border-zinc-800 bg-zinc-900 p-4 text-sm text-zinc-500">
                  Ingen musik finns ännu.
                </div>
              )}

            {musicTracks.length >
              0 && (
              <div className="mt-4 space-y-2">

                {musicTracks.map(
                  (
                    track
                  ) => {
                    const selected =
                      selectedMusicTrack?.id ===
                      track.id;

                    const previewing =
                      previewingTrackId ===
                      track.id;

                    return (
                      <div
                        key={
                          track.id
                        }
                        className={`rounded-xl border p-3 transition ${
                          selected
                            ? "border-white bg-zinc-800"
                            : "border-zinc-800 bg-zinc-900"
                        }`}
                      >

                        <div className="flex items-center gap-3">

                          <button
                            type="button"
                            onClick={() =>
                              toggleMusicPreview(
                                track
                              )
                            }
                            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white text-sm font-bold text-black"
                          >
                            {previewing
                              ? "❚❚"
                              : "▶"}
                          </button>

                          <button
                            type="button"
                            onClick={() =>
                              selectTrack(
                                track
                              )
                            }
                            className="min-w-0 flex-1 text-left"
                          >

                            <div className="truncate text-sm font-semibold">
                              {
                                track.title
                              }
                            </div>

                            <div className="mt-1 truncate text-xs text-zinc-500">
                              {track.artist ??
                                "Unknown artist"}

                              {track.mood
                                ? ` · ${track.mood}`
                                : ""}
                            </div>

                          </button>

                          {selected && (
                            <span className="text-sm text-green-400">
                              ✓
                            </span>
                          )}

                        </div>

                      </div>
                    );
                  }
                )}

              </div>
            )}

            {selectedMusicTrack && (
              <div className="mt-5 space-y-5 rounded-xl border border-zinc-800 bg-zinc-900 p-4">

                <div className="flex items-center justify-between gap-3">

                  <div className="min-w-0">

                    <p className="text-xs uppercase tracking-wider text-zinc-500">
                      Vald musik
                    </p>

                    <p className="mt-1 truncate text-sm font-semibold">
                      {
                        selectedMusicTrack.title
                      }
                    </p>

                  </div>

                  <button
                    type="button"
                    onClick={
                      removeMusic
                    }
                    className="text-xs text-zinc-400 hover:text-white"
                  >
                    Ta bort
                  </button>

                </div>

                {/* ORIGINAL AUDIO */}

                <div>

                  <div className="mb-2 flex items-center justify-between">

                    <span className="text-sm">
                      Originalljud
                    </span>

                    <span className="text-xs text-zinc-500">
                      {Math.round(
                        originalAudioVolume *
                          100
                      )}
                      %
                    </span>

                  </div>

                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.05"
                    value={
                      originalAudioVolume
                    }
                    onChange={(
                      event
                    ) =>
                      onOriginalAudioVolumeChange(
                        Number(
                          event
                            .target
                            .value
                        )
                      )
                    }
                    className="w-full"
                  />

                </div>

                {/* MUSIC VOLUME */}

                <div>

                  <div className="mb-2 flex items-center justify-between">

                    <span className="text-sm">
                      Musik
                    </span>

                    <span className="text-xs text-zinc-500">
                      {Math.round(
                        musicVolume *
                          100
                      )}
                      %
                    </span>

                  </div>

                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.05"
                    value={
                      musicVolume
                    }
                    onChange={(
                      event
                    ) => {
                      const value =
                        Number(
                          event
                            .target
                            .value
                        );

                      onMusicVolumeChange(
                        value
                      );

                      if (
                        audioRef.current
                      ) {
                        audioRef.current.volume =
                          value;
                      }
                    }}
                    className="w-full"
                  />

                </div>

                {/* MUSIC START TIME */}

<div>

  <div className="mb-2 flex items-center justify-between">

    <span className="text-sm">
      Musikstart
    </span>

    <span className="text-xs text-zinc-500">
      {Math.floor(
        musicStartTime / 60
      )}
      :
      {Math.floor(
        musicStartTime % 60
      )
        .toString()
        .padStart(
          2,
          "0"
        )}
    </span>

  </div>

  <input
    type="range"
    min="0"
    max={
      selectedMusicTrack.duration_seconds ??
      120
    }
    step="1"
    value={
      musicStartTime
    }
    onChange={(
      event
    ) => {
      const value =
        Number(
          event.target.value
        );

      onMusicStartTimeChange(
        value
      );

      /*
        Om låten spelas i preview
        hoppar vi direkt till den
        nya startpunkten.
      */
      if (
        audioRef.current
      ) {
        audioRef.current.currentTime =
          value;
      }
    }}
    className="w-full"
  />

  <div className="mt-2 flex items-center justify-between">

    <button
      type="button"
      onClick={() => {
        const value =
          Math.max(
            0,
            musicStartTime -
              5
          );

        onMusicStartTimeChange(
          value
        );

        if (
          audioRef.current
        ) {
          audioRef.current.currentTime =
            value;
        }
      }}
      className="rounded-lg border border-zinc-700 px-3 py-1.5 text-xs text-zinc-400 transition hover:bg-zinc-800 hover:text-white"
    >
      −5s
    </button>

    <span className="text-xs text-zinc-600">
      Startpunkt i låten
    </span>

    <button
      type="button"
      onClick={() => {
        const max =
          selectedMusicTrack.duration_seconds ??
          120;

        const value =
          Math.min(
            max,
            musicStartTime +
              5
          );

        onMusicStartTimeChange(
          value
        );

        if (
          audioRef.current
        ) {
          audioRef.current.currentTime =
            value;
        }
      }}
      className="rounded-lg border border-zinc-700 px-3 py-1.5 text-xs text-zinc-400 transition hover:bg-zinc-800 hover:text-white"
    >
      +5s
    </button>

  </div>

</div>

              </div>

              
            )}

          </div>
        )}

      </div>

    </div>
  );
}

function OptionButton({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={
        onClick
      }
      className={`rounded-xl border px-3 py-2 text-sm transition ${
        active
          ? "border-white bg-white text-black"
          : "border-zinc-700 bg-zinc-900 text-zinc-400 hover:text-white"
      }`}
    >
      {label}
    </button>
  );
}