import { NextResponse } from "next/server";

export async function GET() {
  const accessToken =
    process.env.INSTAGRAM_ACCESS_TOKEN;

  const instagramUserId =
    process.env.INSTAGRAM_USER_ID;

  if (!accessToken || !instagramUserId) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "Instagram environment variables are missing.",
      },
      { status: 500 }
    );
  }

  const url =
    `https://graph.instagram.com/${instagramUserId}` +
    `?fields=id,username,account_type` +
    `&access_token=${accessToken}`;

  const response = await fetch(url, {
    cache: "no-store",
  });

  const data = await response.json();

  if (!response.ok) {
    return NextResponse.json(
      {
        ok: false,
        error: data,
      },
      { status: response.status }
    );
  }

  return NextResponse.json({
    ok: true,
    account: data,
  });
}