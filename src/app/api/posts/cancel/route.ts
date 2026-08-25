import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const postId = body.postId;

    if (!postId) {
      return NextResponse.json(
        {
          ok: false,
          error: "postId is required.",
        },
        { status: 400 }
      );
    }

    const {
      data: post,
      error: loadError,
    } = await supabase
      .from("posts")
      .select("id, status")
      .eq("id", postId)
      .single();

    if (loadError || !post) {
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

    if (post.status !== "scheduled") {
      return NextResponse.json(
        {
          ok: false,
          error:
            "Only scheduled posts can be cancelled.",
        },
        { status: 400 }
      );
    }

    const {
      error: updateError,
    } = await supabase
      .from("posts")
      .update({
        status: "cancelled",
      })
      .eq("id", postId);

    if (updateError) {
      return NextResponse.json(
        {
          ok: false,
          error: updateError.message,
        },
        { status: 500 }
      );
    }

    return NextResponse.json({
      ok: true,
      postId,
      status: "cancelled",
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