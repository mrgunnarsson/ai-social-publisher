import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(
  request: Request
) {
  try {
    const body =
      await request.json();

    const postId =
      body.postId;

    if (!postId) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "postId is required.",
        },
        { status: 400 }
      );
    }

    /*
      Kontrollera att posten finns
      och fortfarande är scheduled.
    */

    const {
      data: post,
      error: postError,
    } = await supabase
      .from("posts")
      .select(
        `
        id,
        status,
        platform
        `
      )
      .eq("id", postId)
      .single();

    if (
      postError ||
      !post
    ) {
      return NextResponse.json(
        {
          ok: false,
          error:
            postError?.message ??
            "Post not found.",
        },
        { status: 404 }
      );
    }

    if (
      post.status !==
      "scheduled"
    ) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "Only scheduled posts can be published now.",
        },
        { status: 400 }
      );
    }

   if (
  post.platform !== "instagram" &&
  post.platform !== "multi"
) {
  return NextResponse.json(
    {
      ok: false,
      error:
        "Only Instagram or multi-platform posts are supported.",
    },
    { status: 400 }
  );
}

    /*
      Flytta scheduled_at till nu.

      Då blir posten omedelbart
      "due" för vår befintliga
      run-scheduled-route.
    */

    const now =
      new Date()
        .toISOString();

    const {
      error: updateError,
    } = await supabase
      .from("posts")
      .update({
        scheduled_at: now,
      })
      .eq("id", postId)
      .eq(
        "status",
        "scheduled"
      );

    if (updateError) {
      return NextResponse.json(
        {
          ok: false,
          error:
            updateError.message,
        },
        { status: 500 }
      );
    }

    /*
      Anropa exakt samma
      publiceringsmotor som Cron använder.
    */

    const origin =
      new URL(
        request.url
      ).origin;

    const cronSecret =
      process.env.CRON_SECRET;

    if (!cronSecret) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "CRON_SECRET is missing.",
        },
        { status: 500 }
      );
    }

    const publishResponse =
      await fetch(
        `${origin}/api/instagram/run-scheduled`,
        {
          method: "POST",

          headers: {
            Authorization:
              `Bearer ${cronSecret}`,

            "Content-Type":
              "application/json",
          },

          body:
            JSON.stringify({
              postId,
            }),

          cache:
            "no-store",
        }
      );

    const publishResult =
      await publishResponse.json();

    if (
      !publishResponse.ok ||
      !publishResult.ok
    ) {
      return NextResponse.json(
        {
          ok: false,
          step:
            "run_scheduled",
          error:
            publishResult,
        },
        { status: 500 }
      );
    }

    /*
      Hitta resultatet för just
      posten användaren klickade på.
    */

    const result =
      Array.isArray(
        publishResult.results
      )
        ? publishResult.results.find(
            (
              item: {
                postId?: string;
              }
            ) =>
              item.postId ===
              postId
          )
        : null;

    if (!result) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "Post was not processed.",
        },
        { status: 500 }
      );
    }

    if (!result.ok) {
  return NextResponse.json(
    {
      ok: false,
      error:
        result,
    },
    { status: 500 }
  );
}

/*
  Multi-platform-poster returnerar
  destinationer i stället för ett
  enda mediaId.
*/
if (
  post.platform ===
  "multi"
) {
  return NextResponse.json({
    ok: true,
    postId,
    platform:
      "multi",
    destinations:
      result.destinations ??
      [],
    remaining:
      result.remaining ??
      0,
  });
}

/*
  Legacy Instagram.
*/
return NextResponse.json({
  ok: true,
  postId,
  platform:
    "instagram",
  mediaId:
    result.mediaId,
  publishedAt:
    result.publishedAt,
});
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "Unknown error",
      },
      { status: 500 }
    );
  }
}
