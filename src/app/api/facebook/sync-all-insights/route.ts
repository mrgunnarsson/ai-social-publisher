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
    const authHeader =
      request.headers.get(
        "authorization"
      );

    const expectedSecret =
      process.env.CRON_SECRET;

    if (!expectedSecret) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "CRON_SECRET is missing.",
        },
        {
          status: 500,
        }
      );
    }

    if (
      authHeader !==
      `Bearer ${expectedSecret}`
    ) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "Unauthorized.",
        },
        {
          status: 401,
        }
      );
    }

    /*
      Hämta alla Facebookkonton.
    */
    const {
      data: accounts,
      error: accountsError,
    } = await supabase
      .from("social_accounts")
      .select(
        `
        id,
        influencer_id,
        username
        `
      )
      .eq(
        "platform",
        "facebook"
      );

    if (accountsError) {
      return NextResponse.json(
        {
          ok: false,
          step:
            "load_accounts",
          error:
            accountsError.message,
        },
        {
          status: 500,
        }
      );
    }

    const origin =
      new URL(
        request.url
      ).origin;

    const results = [];

    for (
      const account of
        accounts ?? []
    ) {
      try {
        const response =
          await fetch(
            `${origin}/api/facebook/sync-insights`,
            {
              method: "POST",

              headers: {
                "Content-Type":
                  "application/json",
              },

              body:
                JSON.stringify({
                  influencerId:
                    account.influencer_id,
                }),

              cache:
                "no-store",
            }
          );

        const data =
          await response.json();

        results.push({
          influencerId:
            account.influencer_id,

          username:
            account.username,

          ok:
            response.ok &&
            data.ok,

          result:
            data,
        });
      } catch (error) {
        results.push({
          influencerId:
            account.influencer_id,

          username:
            account.username,

          ok:
            false,

          error:
            error instanceof Error
              ? error.message
              : "Unknown error",
        });
      }
    }

    return NextResponse.json({
      ok:
        results.every(
          (item) =>
            item.ok
        ),

      total:
        results.length,

      succeeded:
        results.filter(
          (item) =>
            item.ok
        ).length,

      failed:
        results.filter(
          (item) =>
            !item.ok
        ).length,

      results,
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