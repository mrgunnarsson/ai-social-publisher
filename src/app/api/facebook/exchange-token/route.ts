import { NextResponse } from "next/server";

export async function POST(
  request: Request
) {
  try {
    const {
      accessToken,
    } = await request.json();

    if (!accessToken) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "accessToken is required.",
        },
        {
          status: 400,
        }
      );
    }

    const appId =
      process.env.META_APP_ID;

    const appSecret =
      process.env.META_APP_SECRET;

    if (
      !appId ||
      !appSecret
    ) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "Meta app credentials are missing.",
        },
        {
          status: 500,
        }
      );
    }

    const url =
      new URL(
        "https://graph.facebook.com/v26.0/oauth/access_token"
      );

    url.searchParams.set(
      "grant_type",
      "fb_exchange_token"
    );

    url.searchParams.set(
      "client_id",
      appId
    );

    url.searchParams.set(
      "client_secret",
      appSecret
    );

    url.searchParams.set(
      "fb_exchange_token",
      accessToken
    );

    const response =
      await fetch(
        url.toString(),
        {
          method: "GET",
          cache: "no-store",
        }
      );

    const data =
      await response.json();

    if (!response.ok) {
      return NextResponse.json(
        {
          ok: false,
          error: data,
        },
        {
          status:
            response.status,
        }
      );
    }

    return NextResponse.json({
      ok: true,

      accessToken:
        data.access_token,

      tokenType:
        data.token_type,

      expiresIn:
        data.expires_in,
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
      {
        status: 500,
      }
    );
  }
}