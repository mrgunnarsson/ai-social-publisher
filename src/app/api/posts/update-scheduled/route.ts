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

    const {
      postId,
      caption,
      scheduledAt,
    } = body;

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

    if (!scheduledAt) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "scheduledAt is required.",
        },
        { status: 400 }
      );
    }

    const date =
      new Date(scheduledAt);

    if (
      Number.isNaN(
        date.getTime()
      )
    ) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "Invalid scheduledAt.",
        },
        { status: 400 }
      );
    }

    const {
      data: post,
      error: loadError,
    } = await supabase
      .from("posts")
      .select(
        "id, status"
      )
      .eq(
        "id",
        postId
      )
      .single();

    if (
      loadError ||
      !post
    ) {
      return NextResponse.json(
        {
          ok: false,
          error:
            loadError?.message ??
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
            "Only scheduled posts can be edited.",
        },
        { status: 400 }
      );
    }

    const {
      data: updatedPost,
      error: updateError,
    } = await supabase
      .from("posts")
      .update({
        caption:
          caption ?? "",
        scheduled_at:
          date.toISOString(),
      })
      .eq(
        "id",
        postId
      )
      .eq(
        "status",
        "scheduled"
      )
      .select(
        `
        id,
        caption,
        media_url,
        scheduled_at,
        status,
        created_at
        `
      )
      .single();

    if (
      updateError ||
      !updatedPost
    ) {
      return NextResponse.json(
        {
          ok: false,
          error:
            updateError?.message ??
            "Could not update post.",
        },
        { status: 500 }
      );
    }

    return NextResponse.json({
      ok: true,
      post:
        updatedPost,
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