import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

type FacebookDestination = {
  id: string;
  post_id: string;
  external_post_id: string | null;
  published_at: string | null;
  last_synced_at: string | null;
};

type MetricValue = {
  metric: string;
  value: number;
};

async function loadMetric(
  postId: string,
  metric: string,
  accessToken: string
): Promise<MetricValue | null> {
  try {
    const url =
      new URL(
        `https://graph.facebook.com/v26.0/${postId}/insights`
      );

    url.searchParams.set(
      "metric",
      metric
    );

    url.searchParams.set(
      "access_token",
      accessToken
    );

    const response =
      await fetch(
        url.toString(),
        {
          cache: "no-store",
        }
      );

    const data =
      await response.json();

    if (!response.ok) {
      return null;
    }

    const insight =
      Array.isArray(data.data)
        ? data.data[0]
        : null;

    if (!insight) {
      return null;
    }

    const rawValue =
      insight.value ??
      insight.values?.[
        insight.values.length - 1
      ]?.value ??
      0;

    if (
      typeof rawValue ===
      "number"
    ) {
      return {
        metric,
        value:
          rawValue,
      };
    }

    return null;
  } catch {
    return null;
  }
}

export async function POST(
  request: Request
) {
  try {
    const body =
      await request.json();

    const influencerId =
      body.influencerId;

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

    /*
      1. Hämta Facebook-kontot.
    */
    const {
      data: account,
      error: accountError,
    } = await supabase
      .from("social_accounts")
      .select(
        `
        id,
        username,
        external_account_id,
        access_token
        `
      )
      .eq(
        "influencer_id",
        influencerId
      )
      .eq(
        "platform",
        "facebook"
      )
      .maybeSingle();

    if (accountError) {
      return NextResponse.json(
        {
          ok: false,
          step:
            "load_account",
          error:
            accountError.message,
        },
        {
          status: 500,
        }
      );
    }

    if (
      !account ||
      !account.access_token
    ) {
      return NextResponse.json(
        {
          ok: false,
          step:
            "load_account",
          error:
            "Facebook account is not connected.",
        },
        {
          status: 404,
        }
      );
    }

    /*
      2. Hämta publicerade
      Facebook-destinationer.
    */
    const {
      data: destinations,
      error: destinationsError,
    } = await supabase
      .from(
        "post_destinations"
      )
      .select(
        `
        id,
        post_id,
        external_post_id,
        published_at,
        last_synced_at
        `
      )
      .eq(
        "platform",
        "facebook"
      )
      .eq(
        "status",
        "published"
      )
      .eq(
        "social_account_id",
        account.id
      )
      .not(
        "external_post_id",
        "is",
        null
      );

    if (
      destinationsError
    ) {
      return NextResponse.json(
        {
          ok: false,
          step:
            "load_destinations",
          error:
            destinationsError.message,
        },
        {
          status: 500,
        }
      );
    }

    const results = [];

    for (
      const destination of
        (destinations ??
          []) as FacebookDestination[]
    ) {
      const facebookPostId =
        destination.external_post_id;

      if (!facebookPostId) {
        continue;
      }

      /*
        3. Hämta själva postfält
        för reactions/comments/shares.
      */
      const postUrl =
        new URL(
          `https://graph.facebook.com/v26.0/${facebookPostId}`
        );

      postUrl.searchParams.set(
        "fields",
        [
          "id",
          "reactions.limit(0).summary(true)",
          "comments.limit(0).summary(true)",
          "shares",
        ].join(",")
      );

      postUrl.searchParams.set(
        "access_token",
        account.access_token
      );

      const postResponse =
        await fetch(
          postUrl.toString(),
          {
            cache:
              "no-store",
          }
        );

      const postData =
        await postResponse.json();

      if (!postResponse.ok) {
  const metaError =
    postData?.error;

  const errorCode =
    Number(
      metaError?.code ??
      0
    );

  const errorSubcode =
    Number(
      metaError?.error_subcode ??
      0
    );

  const errorMessage =
    String(
      metaError?.message ??
      ""
    );

  /*
    Om Meta säger att objektet
    inte längre finns markerar
    vi destinationen som deleted.

    Då försöker syncen inte läsa
    samma borttagna Facebook-post
    vid varje framtida körning.
  */
  const postIsDeleted =
    (
      errorCode === 10 &&
      errorMessage.includes(
        "Object does not exist"
      )
    ) ||
    (
      errorCode === 100 &&
      errorSubcode === 33
    );

  if (postIsDeleted) {
    const {
      error:
        deletedUpdateError,
    } = await supabase
      .from(
        "post_destinations"
      )
      .update({
        status:
          "deleted",

        last_synced_at:
          new Date()
            .toISOString(),
      })
      .eq(
        "id",
        destination.id
      );

    if (
      deletedUpdateError
    ) {
      results.push({
        destinationId:
          destination.id,

        postId:
          destination.post_id,

        facebookPostId,

        ok:
          false,

        step:
          "mark_deleted",

        error:
          deletedUpdateError.message,
      });
    } else {
      results.push({
        destinationId:
          destination.id,

        postId:
          destination.post_id,

        facebookPostId,

        ok:
          true,

        deleted:
          true,
      });
    }

    continue;
  }

  /*
    Andra Meta-fel ska fortfarande
    rapporteras som riktiga fel.
  */
  results.push({
    destinationId:
      destination.id,

    postId:
      destination.post_id,

    facebookPostId,

    ok:
      false,

    step:
      "load_post",

    error:
      errorMessage ||
      "Could not load Facebook post.",
  });

  continue;
}

      const reactions =
        Number(
          postData.reactions
            ?.summary
            ?.total_count ??
          0
        );

      const comments =
        Number(
          postData.comments
            ?.summary
            ?.total_count ??
          0
        );

      const shares =
        Number(
          postData.shares
            ?.count ??
          0
        );

      /*
        4. Hämta Insights metrics.
      */
      const clicksResult =
        await loadMetric(
          facebookPostId,
          "post_clicks",
          account.access_token
        );

      const viewsResult =
        await loadMetric(
          facebookPostId,
          "post_video_views",
          account.access_token
        );

      const clicks =
        clicksResult?.value ??
        0;

      const views =
        viewsResult?.value ??
        0;

      const syncedAt =
        new Date()
          .toISOString();

      /*
        5. Spara i destinationen.
      */
      const {
        error: updateError,
      } = await supabase
        .from(
          "post_destinations"
        )
        .update({
          reactions,
          comments,
          shares,
          clicks,
          views,
          last_synced_at:
            syncedAt,
        })
        .eq(
          "id",
          destination.id
        );

      if (updateError) {
        results.push({
          destinationId:
            destination.id,
          postId:
            destination.post_id,
          facebookPostId,
          ok: false,
          step:
            "update_destination",
          error:
            updateError.message,
        });

        continue;
      }

      results.push({
        destinationId:
          destination.id,

        postId:
          destination.post_id,

        facebookPostId,

        ok:
          true,

        reactions,
        comments,
        shares,
        clicks,
        views,

        syncedAt,
      });
    }

    return NextResponse.json({
      ok: true,

      page:
        account.username,

      processed:
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