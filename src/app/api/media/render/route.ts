import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

import ffmpegPath from "ffmpeg-static";
import ffmpeg from "fluent-ffmpeg";
import sharp from "sharp";

import {
  mkdtemp,
  rm,
  writeFile,
  readFile,
} from "fs/promises";

import path from "path";
import os from "os";

export const runtime = "nodejs";
export const maxDuration = 300;

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const REEL_WIDTH = 1080;
const REEL_HEIGHT = 1920;

type TextPosition =
  | "top"
  | "center"
  | "bottom";

type TextColor =
  | "white"
  | "black";

type RenderRequest = {
  influencerId?: string;

  videoUrl?: string;

  overlayText?: string;

  textPosition?: TextPosition;

  fontSize?: number;

  textColor?: TextColor;

  musicUrl?: string | null;

  originalAudioVolume?: number;

  musicVolume?: number;
};

const resolvedFfmpegPath =
  process.env.FFMPEG_PATH ||
  ffmpegPath;

if (resolvedFfmpegPath) {
  ffmpeg.setFfmpegPath(
    resolvedFfmpegPath
  );
}

function clamp(
  value: number,
  min: number,
  max: number
) {
  return Math.min(
    max,
    Math.max(
      min,
      value
    )
  );
}

function escapeXml(
  value: string
) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function getTextY(
  position: TextPosition
) {
  if (
    position === "top"
  ) {
    return Math.round(
      REEL_HEIGHT * 0.16
    );
  }

  if (
    position === "center"
  ) {
    return Math.round(
      REEL_HEIGHT * 0.5
    );
  }

  return Math.round(
    REEL_HEIGHT * 0.82
  );
}

function buildOverlaySvg({
  text,
  position,
  fontSize,
  color,
}: {
  text: string;
  position: TextPosition;
  fontSize: number;
  color: TextColor;
}) {
  const y =
    getTextY(
      position
    );

  const safeText =
    escapeXml(text);

  const previewReferenceWidth =
    384;

  const renderedFontSize =
    Math.round(
      fontSize *
        (
          REEL_WIDTH /
          previewReferenceWidth
        )
    );

  const strokeColor =
    color === "white"
      ? "rgba(0,0,0,0.85)"
      : "rgba(255,255,255,0.7)";

  return `
    <svg
      width="${REEL_WIDTH}"
      height="${REEL_HEIGHT}"
      viewBox="0 0 ${REEL_WIDTH} ${REEL_HEIGHT}"
      xmlns="http://www.w3.org/2000/svg"
    >
      <style>
        .text {
          font-family: Arial, Helvetica, sans-serif;
          font-size: ${renderedFontSize}px;
          font-weight: 700;
          fill: ${color};
          text-anchor: middle;
          dominant-baseline: middle;
          paint-order: stroke;
          stroke: ${strokeColor};
          stroke-width: 8px;
          stroke-linejoin: round;
        }
      </style>

      <text
        x="${REEL_WIDTH / 2}"
        y="${y}"
        class="text"
      >
        ${safeText}
      </text>
    </svg>
  `;
}

function probeInput(
  inputPath: string
) {
  return new Promise<{
    hasAudio: boolean;
    duration: number | null;
  }>(
    (
      resolve,
      reject
    ) => {
      ffmpeg.ffprobe(
        inputPath,
        (
          error,
          metadata
        ) => {
          if (error) {
            reject(error);
            return;
          }

          const hasAudio =
            metadata.streams.some(
              (stream) =>
                stream.codec_type ===
                "audio"
            );

          const rawDuration =
            metadata.format.duration;

          resolve({
            hasAudio,

            duration:
              typeof rawDuration ===
              "number"
                ? rawDuration
                : rawDuration
                  ? Number(
                      rawDuration
                    )
                  : null,
          });
        }
      );
    }
  );
}

function renderVideo({
  inputPath,
  overlayPath,
  musicPath,
  outputPath,
  hasOverlay,
  hasMusic,
  hasOriginalAudio,
  originalAudioVolume,
  musicVolume,
}: {
  inputPath: string;

  overlayPath: string;

  musicPath: string;

  outputPath: string;

  hasOverlay: boolean;

  hasMusic: boolean;

  hasOriginalAudio: boolean;

  originalAudioVolume: number;

  musicVolume: number;
}) {
  return new Promise<void>(
    (
      resolve,
      reject
    ) => {
      const command =
        ffmpeg(
          inputPath
        );

      /*
       * Input-index:
       *
       * 0 = video
       * 1 = overlay om den finns
       * nästa = musik om den finns
       */
      let nextInputIndex =
        1;

      let overlayInputIndex:
        number | null =
        null;

      let musicInputIndex:
        number | null =
        null;

      if (
        hasOverlay
      ) {
        overlayInputIndex =
          nextInputIndex;

        command.input(
          overlayPath
        );

        nextInputIndex++;
      }

      if (
        hasMusic
      ) {
        musicInputIndex =
          nextInputIndex;

        command.input(
          musicPath
        );

        /*
         * Om musikfilen är kortare
         * än videon loopar vi den.
         */
        command.inputOptions([
          "-stream_loop -1",
        ]);

        nextInputIndex++;
      }

      const filters:
        string[] =
        [];

      /*
       * VIDEO
       */
      filters.push(
        `[0:v]scale=${REEL_WIDTH}:${REEL_HEIGHT}:force_original_aspect_ratio=increase,crop=${REEL_WIDTH}:${REEL_HEIGHT}[reel_video]`
      );

      let finalVideoLabel =
        "reel_video";

      if (
        hasOverlay &&
        overlayInputIndex !==
          null
      ) {
        filters.push(
          `[reel_video][${overlayInputIndex}:v]overlay=0:0[video_with_overlay]`
        );

        finalVideoLabel =
          "video_with_overlay";
      }

      /*
       * AUDIO
       */
      let finalAudioLabel:
        string | null =
        null;

      if (
        hasMusic &&
        musicInputIndex !==
          null &&
        hasOriginalAudio
      ) {
        filters.push(
          `[0:a]volume=${originalAudioVolume}[original_audio]`
        );

        filters.push(
          `[${musicInputIndex}:a]volume=${musicVolume}[music_audio]`
        );

        filters.push(
          `[original_audio][music_audio]amix=inputs=2:duration=first:dropout_transition=2[mixed_audio]`
        );

        finalAudioLabel =
          "mixed_audio";
      } else if (
        hasMusic &&
        musicInputIndex !==
          null
      ) {
        filters.push(
          `[${musicInputIndex}:a]volume=${musicVolume}[music_audio]`
        );

        finalAudioLabel =
          "music_audio";
      } else if (
        hasOriginalAudio
      ) {
        filters.push(
          `[0:a]volume=${originalAudioVolume}[original_audio]`
        );

        finalAudioLabel =
          "original_audio";
      }

      command
        .complexFilter(
          filters
        )
        .outputOptions([
          `-map [${finalVideoLabel}]`,

          ...(finalAudioLabel
            ? [
                `-map [${finalAudioLabel}]`,
                "-c:a aac",
                "-b:a 192k",
              ]
            : []),

          "-c:v libx264",
          "-pix_fmt yuv420p",
          "-movflags +faststart",

          /*
           * Outputen får aldrig bli
           * längre än originalvideon.
           */
          "-shortest",
        ])
        .on(
          "end",
          () =>
            resolve()
        )
        .on(
          "error",
          (
            error
          ) =>
            reject(
              error
            )
        )
        .save(
          outputPath
        );
    }
  );
}

export async function POST(
  request: Request
) {
  let tempDirectory:
    string | null =
    null;

  try {
    const body =
      (await request.json()) as RenderRequest;

    const {
      influencerId,

      videoUrl,

      overlayText = "",

      textPosition =
        "bottom",

      fontSize = 48,

      textColor =
        "white",

      musicUrl =
        null,

      originalAudioVolume =
        1,

      musicVolume =
        0.7,
    } = body;

    if (
      !influencerId
    ) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "influencerId is required.",
        },
        {
          status: 400,
        }
      );
    }

    if (!videoUrl) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "videoUrl is required.",
        },
        {
          status: 400,
        }
      );
    }

    if (
      !resolvedFfmpegPath
    ) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "FFmpeg binary could not be resolved.",
        },
        {
          status: 500,
        }
      );
    }

    if (
      ![
        "top",
        "center",
        "bottom",
      ].includes(
        textPosition
      )
    ) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "Invalid textPosition.",
        },
        {
          status: 400,
        }
      );
    }

    if (
      ![
        "white",
        "black",
      ].includes(
        textColor
      )
    ) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "Invalid textColor.",
        },
        {
          status: 400,
        }
      );
    }

    const safeFontSize =
      clamp(
        Number(
          fontSize
        ) || 48,
        20,
        96
      );

    const safeOriginalAudioVolume =
      clamp(
        Number(
          originalAudioVolume
        ) || 0,
        0,
        1
      );

    const safeMusicVolume =
      clamp(
        Number(
          musicVolume
        ) || 0,
        0,
        1
      );

    /*
     * 1. Hämta video
     */
    const videoResponse =
      await fetch(
        videoUrl,
        {
          cache:
            "no-store",
        }
      );

    if (
      !videoResponse.ok
    ) {
      return NextResponse.json(
        {
          ok: false,
          step:
            "download_video",
          error:
            `Could not download video: ${videoResponse.status}`,
        },
        {
          status: 400,
        }
      );
    }

    const videoBuffer =
      Buffer.from(
        await videoResponse.arrayBuffer()
      );

    /*
     * 2. Tempfiler
     */
    tempDirectory =
      await mkdtemp(
        path.join(
          os.tmpdir(),
          "social-render-"
        )
      );

    const inputPath =
      path.join(
        tempDirectory,
        "input.mp4"
      );

    const overlayPath =
      path.join(
        tempDirectory,
        "overlay.png"
      );

    const musicPath =
      path.join(
        tempDirectory,
        "music.mp3"
      );

    const outputPath =
      path.join(
        tempDirectory,
        "output.mp4"
      );

    await writeFile(
      inputPath,
      videoBuffer
    );

    /*
     * 3. Läs input
     */
    const {
      hasAudio:
        hasOriginalAudio,
    } =
      await probeInput(
        inputPath
      );

    /*
     * 4. Overlay
     */
    const hasOverlay =
      overlayText.trim()
        .length > 0;

    if (
      hasOverlay
    ) {
      const svg =
        buildOverlaySvg({
          text:
            overlayText,

          position:
            textPosition,

          fontSize:
            safeFontSize,

          color:
            textColor,
        });

      await sharp(
        Buffer.from(
          svg
        )
      )
        .png()
        .toFile(
          overlayPath
        );
    }

    /*
     * 5. Musik
     */
    const hasMusic =
      Boolean(
        musicUrl &&
        musicUrl.trim()
      );

    if (
      hasMusic &&
      musicUrl
    ) {
      const musicResponse =
        await fetch(
          musicUrl,
          {
            cache:
              "no-store",
          }
        );

      if (
        !musicResponse.ok
      ) {
        return NextResponse.json(
          {
            ok: false,
            step:
              "download_music",
            error:
              `Could not download music: ${musicResponse.status}`,
          },
          {
            status: 400,
          }
        );
      }

      const musicBuffer =
        Buffer.from(
          await musicResponse.arrayBuffer()
        );

      await writeFile(
        musicPath,
        musicBuffer
      );
    }

    /*
     * 6. Rendera
     */
    await renderVideo({
      inputPath,

      overlayPath,

      musicPath,

      outputPath,

      hasOverlay,

      hasMusic,

      hasOriginalAudio,

      originalAudioVolume:
        safeOriginalAudioVolume,

      musicVolume:
        safeMusicVolume,
    });

    /*
     * 7. Läs output
     */
    const renderedBuffer =
      await readFile(
        outputPath
      );

    /*
     * 8. Upload
     */
    const storagePath =
      `${influencerId}/rendered/${crypto.randomUUID()}.mp4`;

    const {
      error:
        uploadError,
    } = await supabase.storage
      .from(
        "social-media"
      )
      .upload(
        storagePath,
        renderedBuffer,
        {
          contentType:
            "video/mp4",
          upsert:
            false,
        }
      );

    if (
      uploadError
    ) {
      return NextResponse.json(
        {
          ok: false,
          step:
            "upload_rendered_video",
          error:
            uploadError.message,
        },
        {
          status: 500,
        }
      );
    }

    /*
     * 9. URL
     */
    const {
      data:
        publicUrlData,
    } = supabase.storage
      .from(
        "social-media"
      )
      .getPublicUrl(
        storagePath
      );

    return NextResponse.json({
      ok: true,

      renderedMediaUrl:
        publicUrlData.publicUrl,

      storagePath,

      mediaType:
        "video",

      width:
        REEL_WIDTH,

      height:
        REEL_HEIGHT,

      hasOriginalAudio,

      hasMusic,

      originalAudioVolume:
        safeOriginalAudioVolume,

      musicVolume:
        safeMusicVolume,
    });
  } catch (error) {
    console.error(
      "Render error:",
      error
    );

    return NextResponse.json(
      {
        ok: false,

        error:
          error instanceof Error
            ? error.message
            : "Unknown render error.",
      },
      {
        status: 500,
      }
    );
  } finally {
    if (
      tempDirectory
    ) {
      try {
        await rm(
          tempDirectory,
          {
            recursive:
              true,
            force:
              true,
          }
        );
      } catch (
        cleanupError
      ) {
        console.error(
          "Could not clean render temp directory:",
          cleanupError
        );
      }
    }
  }
}