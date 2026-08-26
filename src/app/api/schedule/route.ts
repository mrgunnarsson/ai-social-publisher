import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

type Destination = {
  id: string;
  platform: string;
  status: string;
};

type Influencer = {
  id: string;
  name: string;
};

type SchedulePostRow = {
  id: string;
  influencer_id: string;
  caption: string | null;
  media_url: string | null;
  media_type: "image" | "video" | null;
  scheduled_at: string | null;
  status: string;
  platform: string;

  influencer:
    | Influencer
    | Influencer[]
    | null;

  destinations:
    | Destination[]
    | null;
};

export async function GET(
  request: Request
) {
  try {
    const url =
      new URL(
        request.url
      );

    const influencerId =
      url.searchParams.get(
        "influencerId"
      ) ?? "all";

    const daysParam =
      Number(
        url.searchParams.get(
          "days"
        ) ?? 30
      );

    const days =
      Math.min(
        180,
        Math.max(
          1,
          Number.isFinite(
            daysParam
          )
            ? daysParam
            : 30
        )
      );

    /*
      Schema från idag och framåt.
    */
    const now =
      new Date();

    const end =
      new Date(
        now
      );

    end.setDate(
      end.getDate() +
        days
    );

    let query =
      supabase
        .from("posts")
        .select(
          `
          id,
          influencer_id,
          caption,
          media_url,
          media_type,
          scheduled_at,
          status,
          platform,

          influencer:influencers (
            id,
            name
          ),

          destinations:post_destinations (
            id,
            platform,
            status
          )
          `
        )
        .eq(
          "status",
          "scheduled"
        )
        .not(
          "scheduled_at",
          "is",
          null
        )
        .gte(
          "scheduled_at",
          now.toISOString()
        )
        .lte(
          "scheduled_at",
          end.toISOString()
        )
        .order(
          "scheduled_at",
          {
            ascending:
              true,
          }
        );

    if (
      influencerId !==
      "all"
    ) {
      query =
        query.eq(
          "influencer_id",
          influencerId
        );
    }

    const {
      data,
      error,
    } =
      await query;

    if (error) {
      return NextResponse.json(
        {
          ok: false,
          step:
            "load_schedule",
          error:
            error.message,
        },
        {
          status: 500,
        }
      );
    }

    const rows =
      (
        data ??
        []
      ) as SchedulePostRow[];

    const posts =
      rows.map(
        (row) => {
          const influencer =
            Array.isArray(
              row.influencer
            )
              ? row.influencer[0] ??
                null
              : row.influencer;

          return {
            id:
              row.id,

            influencerId:
              row.influencer_id,

            influencerName:
              influencer?.name ??
              "Unknown influencer",

            caption:
              row.caption,

            mediaUrl:
              row.media_url,

            mediaType:
              row.media_type,

            scheduledAt:
              row.scheduled_at,

            status:
              row.status,

            platform:
              row.platform,

            destinations:
              row.destinations ??
              [],
          };
        }
      );

    const {
      data:
        influencers,
      error:
        influencersError,
    } = await supabase
      .from(
        "influencers"
      )
      .select(
        "id, name"
      )
      .order(
        "name",
        {
          ascending:
            true,
        }
      );

    if (
      influencersError
    ) {
      return NextResponse.json(
        {
          ok: false,
          step:
            "load_influencers",
          error:
            influencersError.message,
        },
        {
          status: 500,
        }
      );
    }

    return NextResponse.json({
      ok: true,

      filters: {
        influencerId,
        days,
      },

      count:
        posts.length,

      posts,

      influencers:
        influencers ??
        [],
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