import { NextResponse } from "next/server";

export async function GET(
  request: Request
) {
  const appId =
    process.env.META_APP_ID;

  if (!appId) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "META_APP_ID is missing.",
      },
      { status: 500 }
    );
  }

  const url =
    new URL(request.url);

  const influencerId =
    url.searchParams.get(
      "influencerId"
    );

  if (!influencerId) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "influencerId is required.",
      },
      { status: 400 }
    );
  }

  const origin =
    url.origin;

  const redirectUri =
    `${origin}/api/facebook/oauth/callback`;

  const state =
    Buffer.from(
      JSON.stringify({
        influencerId,
      })
    ).toString("base64url");

  const authUrl =
    new URL(
      "https://www.facebook.com/v26.0/dialog/oauth"
    );

  authUrl.searchParams.set(
    "client_id",
    appId
  );

  authUrl.searchParams.set(
    "redirect_uri",
    redirectUri
  );

  authUrl.searchParams.set(
    "state",
    state
  );

  authUrl.searchParams.set(
    "response_type",
    "code"
  );

  authUrl.searchParams.set(
    "scope",
    [
      "pages_show_list",
      "pages_read_engagement",
      "pages_manage_posts",
      "business_management",
      "read_insights",
    ].join(",")
  );

  return NextResponse.redirect(
    authUrl.toString()
  );
}