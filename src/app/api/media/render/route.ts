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
import {
  REEL_HEIGHT,
  REEL_WIDTH,
  buildTextOverlaySvg,
  clamp,
  resolveCanonicalTextOverlay,
  type CanonicalTextOverlay,
  type LegacyTextPosition,
} from "@/lib/text-overlay";

export const runtime = "nodejs";
export const maxDuration = 300;

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

type TextPosition =
  | LegacyTextPosition
  | "custom";

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

  overlayLayout?:
    Partial<CanonicalTextOverlay> | null;

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

      overlayLayout =
        null,

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
        "custom",
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

    if (
      textPosition ===
        "custom" &&
      overlayLayout?.version !==
        2
    ) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "Custom text position requires overlayLayout version 2.",
        },
        {
          status: 400,
        }
      );
    }

    const canonicalOverlay =
      resolveCanonicalTextOverlay({
        overlay:
          overlayLayout,
        legacyPosition:
          textPosition ===
          "custom"
            ? "bottom"
            : textPosition,
        legacyFontSize:
          safeFontSize,
      });

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
        buildTextOverlaySvg({
          text:
            overlayText,

          overlay:
            canonicalOverlay,

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
