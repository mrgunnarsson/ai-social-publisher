import { NextResponse } from "next/server";

export async function GET(
  request: Request
) {
  const appId =
  process.env.INSTAGRAM_APP_ID;

  if (!appId) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "INSTAGRAM_APP_ID is missing.",
      },
      {
        status: 500,
      }
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
      {
        status: 400,
      }
    );
  }

const redirectUri =
  process.env.INSTAGRAM_REDIRECT_URI;

if (!redirectUri) {
  return NextResponse.json(
    {
      ok: false,
      error:
        "INSTAGRAM_REDIRECT_URI is missing.",
    },
    {
      status: 500,
    }
  );
}

  const state =
    Buffer.from(
      JSON.stringify({
        influencerId,
      })
    ).toString(
      "base64url"
    );

  /*
    Business Login for Instagram.

    OBS:
    Detta är Instagram OAuth,
    inte Facebook Login.
  */
  const authUrl =
    new URL(
      "https://www.instagram.com/oauth/authorize"
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
    "response_type",
    "code"
  );

  authUrl.searchParams.set(
    "state",
    state
  );

  authUrl.searchParams.set(
    "scope",
    [
      "instagram_business_basic",
      "instagram_business_content_publish",
      "instagram_business_manage_insights",
      "instagram_business_manage_comments",
    ].join(",")
  );

  return NextResponse.redirect(
    authUrl.toString()
  );
}
