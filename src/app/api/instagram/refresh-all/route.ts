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
    /*
      1. Hämta alla Instagramkonton
      som har en access token.
    */
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
    const {
      data: accounts,
      error: accountsError,
    } = await supabase
      .from("social_accounts")
      .select(
        `
        id,
        influencer_id,
        username,
        external_account_id,
        access_token
        `
      )
      .eq("platform", "instagram")
      .not("access_token", "is", null);

    if (accountsError) {
      return NextResponse.json(
        {
          ok: false,
          step: "load_accounts",
          error: accountsError.message,
        },
        {
          status: 500,
        }
      );
    }

    const results = [];

    /*
      2. Refresha varje konto.
    */
    for (const account of accounts ?? []) {
      try {
        if (!account.access_token) {
          continue;
        }

        const refreshUrl =
          new URL(
            "https://graph.instagram.com/refresh_access_token"
          );

        refreshUrl.searchParams.set(
          "grant_type",
          "ig_refresh_token"
        );

        refreshUrl.searchParams.set(
          "access_token",
          account.access_token
        );

        const refreshResponse =
          await fetch(
            refreshUrl.toString(),
            {
              method: "GET",
              cache: "no-store",
            }
          );

        const refreshData =
          await refreshResponse.json();

        if (!refreshResponse.ok) {
          results.push({
            accountId: account.id,
            influencerId:
              account.influencer_id,
            username:
              account.username,
            ok: false,
            step: "refresh_token",
            error:
              refreshData?.error?.message ??
              "Instagram token refresh failed.",
          });

          continue;
        }

        const newAccessToken =
          refreshData.access_token;

        const expiresIn =
          Number(
            refreshData.expires_in ??
              0
          );

        if (!newAccessToken) {
          results.push({
            accountId: account.id,
            influencerId:
              account.influencer_id,
            username:
              account.username,
            ok: false,
            step: "refresh_token",
            error:
              "Instagram did not return a refreshed access token.",
          });

          continue;
        }

        /*
          3. Spara nya tokenen.
        */
        const {
          error: updateError,
        } = await supabase
          .from("social_accounts")
          .update({
            access_token:
              newAccessToken,
          })
          .eq(
            "id",
            account.id
          );

        if (updateError) {
          results.push({
            accountId: account.id,
            influencerId:
              account.influencer_id,
            username:
              account.username,
            ok: false,
            step: "save_token",
            error:
              updateError.message,
          });

          continue;
        }

        results.push({
          accountId: account.id,
          influencerId:
            account.influencer_id,
          username:
            account.username,
          ok: true,
          expiresIn,
        });
      } catch (error) {
        results.push({
          accountId: account.id,
          influencerId:
            account.influencer_id,
          username:
            account.username,
          ok: false,
          step: "unexpected_error",
          error:
            error instanceof Error
              ? error.message
              : "Unknown error",
        });
      }
    }

    const succeeded =
      results.filter(
        (result) =>
          result.ok
      ).length;

    const failed =
      results.length -
      succeeded;

    return NextResponse.json({
      ok:
        failed === 0,
      total:
        results.length,
      succeeded,
      failed,
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