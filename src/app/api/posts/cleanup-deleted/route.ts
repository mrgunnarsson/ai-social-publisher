import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

type Platform =
  | "instagram"
  | "facebook";

type Classification =
  | "exists"
  | "deleted"
  | "uncertain";

type SocialAccount = {
  id: string;
  influencer_id: string;
  platform: Platform;
  username: string | null;
  external_account_id: string | null;
  access_token: string | null;
};

type LocalPost = {
  id: string;
  influencer_id: string;
  platform: string;
  social_account_id: string | null;
  status: string;
  external_post_id: string | null;
};

type Destination = {
  id: string;
  post_id: string;
  platform: string;
  social_account_id: string;
  status: string;
  external_post_id: string | null;
};

type CleanupTarget = {
  localType:
    | "legacy_post"
    | "destination";
  localId: string;
  postId: string;
  platform: Platform;
  socialAccountId: string | null;
  externalPostId: string;
};

type MetaErrorDetails = {
  httpStatus: number | null;
  code: number | null;
  subcode: number | null;
  type: string | null;
  message: string;
  transient: boolean | null;
};

type CleanupDetail =
  CleanupTarget & {
    classification: Classification;
    reason: string;
    metaChecked: boolean;
    metaError: MetaErrorDetails | null;
    wouldRemove: boolean;
    removed: boolean;
    removalError: string | null;
  };

type AccountValidation = {
  ok: boolean;
  reason: string;
  metaError: MetaErrorDetails | null;
};

type MetaReadResult = {
  response: Response | null;
  data: unknown;
  networkError: string | null;
};

function isRecord(
  value: unknown
): value is Record<
  string,
  unknown
> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value)
  );
}

function readNumber(
  value: unknown
) {
  const numberValue =
    Number(value);

  return Number.isFinite(
    numberValue
  )
    ? numberValue
    : null;
}

function getMetaError(
  httpStatus: number | null,
  data: unknown,
  fallbackMessage: string
): MetaErrorDetails {
  const root =
    isRecord(data)
      ? data
      : null;
  const error =
    root &&
    isRecord(root.error)
      ? root.error
      : root;

  return {
    httpStatus,
    code:
      readNumber(
        error?.code
      ),
    subcode:
      readNumber(
        error?.error_subcode
      ),
    type:
      typeof error?.type ===
      "string"
        ? error.type
        : null,
    message:
      typeof error?.message ===
      "string"
        ? error.message
        : fallbackMessage,
    transient:
      typeof error?.is_transient ===
      "boolean"
        ? error.is_transient
        : null,
  };
}

function isConfirmedDeleted(
  error: MetaErrorDetails
) {
  const message =
    error.message.toLowerCase();

  const ambiguousError =
    error.transient === true ||
    [
      1,
      2,
      4,
      10,
      17,
      32,
      102,
      190,
      200,
      299,
      341,
      368,
      613,
    ].includes(
      error.code ?? -1
    ) ||
    /permission|access token|oauth|rate limit|temporar|try again|unsupported|get request|cannot be loaded|does not support/.test(
      message
    );

  if (ambiguousError) {
    return false;
  }

  const explicitlyMissing =
    /deleted|does not exist|not found|unknown object|no longer available/.test(
      message
    );

  const notFoundSignal =
    error.httpStatus === 404 ||
    error.httpStatus === 410 ||
    error.code === 803 ||
    (
      error.code === 100 &&
      error.subcode === 33
    );

  return (
    explicitlyMissing &&
    notFoundSignal
  );
}

async function readMeta(
  url: URL
): Promise<MetaReadResult> {
  try {
    const response =
      await fetch(
        url.toString(),
        {
          method: "GET",
          cache: "no-store",
          signal:
            AbortSignal.timeout(
              15_000
            ),
        }
      );

    let data:
      unknown = null;

    try {
      data =
        await response.json();
    } catch {
      data = null;
    }

    return {
      response,
      data,
      networkError: null,
    };
  } catch (error) {
    return {
      response: null,
      data: null,
      networkError:
        error instanceof Error
          ? error.message
          : "Meta request failed.",
    };
  }
}

function createAccountUrl(
  account: SocialAccount
) {
  const baseUrl =
    account.platform ===
    "instagram"
      ? "https://graph.instagram.com"
      : "https://graph.facebook.com/v26.0";

  const url = new URL(
    `${baseUrl}/${encodeURIComponent(
      account.external_account_id ??
        ""
    )}`
  );

  url.searchParams.set(
    "fields",
    account.platform ===
      "instagram"
      ? "id,username"
      : "id"
  );
  url.searchParams.set(
    "access_token",
    account.access_token ?? ""
  );

  return url;
}

function createObjectUrl(
  platform: Platform,
  externalPostId: string,
  accessToken: string
) {
  const baseUrl =
    platform === "instagram"
      ? "https://graph.instagram.com"
      : "https://graph.facebook.com/v26.0";

  const url = new URL(
    `${baseUrl}/${encodeURIComponent(
      externalPostId
    )}`
  );

  url.searchParams.set(
    "fields",
    "id"
  );
  url.searchParams.set(
    "access_token",
    accessToken
  );

  return url;
}

async function validateAccount(
  account: SocialAccount
): Promise<AccountValidation> {
  if (
    !account.access_token ||
    !account.external_account_id
  ) {
    return {
      ok: false,
      reason:
        "Social account is missing its access token or external account ID.",
      metaError: null,
    };
  }

  const result =
    await readMeta(
      createAccountUrl(
        account
      )
    );

  if (!result.response) {
    return {
      ok: false,
      reason:
        "Could not verify the social account with Meta.",
      metaError:
        getMetaError(
          null,
          null,
          result.networkError ??
            "Meta account verification failed."
        ),
    };
  }

  if (!result.response.ok) {
    return {
      ok: false,
      reason:
        "Meta did not verify the social account.",
      metaError:
        getMetaError(
          result.response.status,
          result.data,
          "Meta account verification failed."
        ),
    };
  }

  const returnedId =
    isRecord(result.data)
      ? result.data.id
      : null;
  const idMatches =
    String(returnedId ?? "") ===
    String(
      account.external_account_id
    );

  if (
    account.platform ===
    "instagram"
  ) {
    const returnedUsername =
      isRecord(result.data) &&
      typeof result.data
        .username === "string"
        ? result.data.username
            .trim()
            .toLowerCase()
        : "";
    const configuredUsername =
      String(
        account.username ?? ""
      )
        .trim()
        .toLowerCase();
    const usernameMatches =
      Boolean(returnedUsername) &&
      Boolean(
        configuredUsername
      ) &&
      returnedUsername ===
        configuredUsername;

    if (
      !idMatches &&
      !usernameMatches
    ) {
      return {
        ok: false,
        reason:
          "Meta Instagram account identity does not match the configured social account.",
        metaError: null,
      };
    }

    return {
      ok: true,
      reason:
        "Social account verified.",
      metaError: null,
    };
  }

  if (
    !idMatches
  ) {
    return {
      ok: false,
      reason:
        "Meta account ID does not match the configured social account.",
      metaError: null,
    };
  }

  return {
    ok: true,
    reason:
      "Social account verified.",
    metaError: null,
  };
}

async function checkTarget(
  target: CleanupTarget,
  influencerId: string,
  accountsById: Map<
    string,
    SocialAccount
  >,
  accountValidations: Map<
    string,
    Promise<AccountValidation>
  >
): Promise<CleanupDetail> {
  const uncertain = (
    reason: string,
    metaError:
      MetaErrorDetails | null = null,
    metaChecked = false
  ): CleanupDetail => ({
    ...target,
    classification:
      "uncertain",
    reason,
    metaChecked,
    metaError,
    wouldRemove: false,
    removed: false,
    removalError: null,
  });

  if (!target.socialAccountId) {
    return uncertain(
      "Local record has no social account reference."
    );
  }

  const account =
    accountsById.get(
      target.socialAccountId
    );

  if (!account) {
    return uncertain(
      "Referenced social account was not found for this influencer and platform."
    );
  }

  if (
    account.influencer_id !==
    influencerId
  ) {
    return uncertain(
      "Referenced social account belongs to another influencer."
    );
  }

  if (
    account.platform !==
    target.platform
  ) {
    return uncertain(
      "Referenced social account platform does not match the local record."
    );
  }

  let validationPromise =
    accountValidations.get(
      account.id
    );

  if (!validationPromise) {
    validationPromise =
      validateAccount(account);
    accountValidations.set(
      account.id,
      validationPromise
    );
  }

  const accountValidation =
    await validationPromise;

  if (!accountValidation.ok) {
    return uncertain(
      accountValidation.reason,
      accountValidation.metaError
    );
  }

  const lookupResult =
    await readMeta(
      createObjectUrl(
        target.platform,
        target.externalPostId,
        account.access_token!
      )
    );

  if (!lookupResult.response) {
    return uncertain(
      "Meta object lookup failed before a definitive response was received.",
      getMetaError(
        null,
        null,
        lookupResult.networkError ??
          "Meta object lookup failed."
      ),
      true
    );
  }

  if (lookupResult.response.ok) {
    const returnedId =
      isRecord(
        lookupResult.data
      )
        ? lookupResult.data.id
        : null;

    if (
      String(
        returnedId ?? ""
      ) ===
      String(
        target.externalPostId
      )
    ) {
      return {
        ...target,
        classification:
          "exists",
        reason:
          "Meta returned the external object.",
        metaChecked: true,
        metaError: null,
        wouldRemove: false,
        removed: false,
        removalError: null,
      };
    }

    return uncertain(
      "Meta returned a successful but mismatched object response.",
      null,
      true
    );
  }

  const metaError =
    getMetaError(
      lookupResult.response.status,
      lookupResult.data,
      "Meta object lookup failed."
    );

  if (
    isConfirmedDeleted(
      metaError
    )
  ) {
    return {
      ...target,
      classification:
        "deleted",
      reason:
        "Meta explicitly confirmed that the external object no longer exists.",
      metaChecked: true,
      metaError,
      wouldRemove: true,
      removed: false,
      removalError: null,
    };
  }

  return uncertain(
    "Meta did not return a definitive deletion confirmation.",
    metaError,
    true
  );
}

function chunkValues<T>(
  values: T[],
  size: number
) {
  const chunks:
    T[][] = [];

  for (
    let index = 0;
    index < values.length;
    index += size
  ) {
    chunks.push(
      values.slice(
        index,
        index + size
      )
    );
  }

  return chunks;
}

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
        { status: 500 }
      );
    }

    if (
      authHeader !==
      `Bearer ${expectedSecret}`
    ) {
      return NextResponse.json(
        {
          ok: false,
          error: "Unauthorized.",
        },
        { status: 401 }
      );
    }

    let body:
      unknown;

    try {
      body =
        await request.json();
    } catch {
      return NextResponse.json(
        {
          ok: false,
          error:
            "A JSON body is required.",
        },
        { status: 400 }
      );
    }

    if (
      !isRecord(body)
    ) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "Request body must be a JSON object.",
        },
        { status: 400 }
      );
    }

    if (
      typeof body.influencerId !==
        "string" ||
      !body.influencerId.trim()
    ) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "influencerId is required.",
        },
        { status: 400 }
      );
    }

    const influencerId =
      body.influencerId.trim();
    const platform =
      body.platform ?? "all";

    if (
      platform !== "all" &&
      platform !== "instagram" &&
      platform !== "facebook"
    ) {
      return NextResponse.json(
        {
          ok: false,
          error:
            'platform must be "instagram", "facebook", or "all".',
        },
        { status: 400 }
      );
    }

    if (
      body.dryRun !== undefined &&
      typeof body.dryRun !==
        "boolean"
    ) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "dryRun must be a boolean.",
        },
        { status: 400 }
      );
    }

    const dryRun =
      body.dryRun !== false;
    const requestedPlatforms:
      Platform[] =
        platform === "all"
          ? [
              "instagram",
              "facebook",
            ]
          : [platform];

    const {
      data: accounts,
      error: accountsError,
    } = await supabase
      .from("social_accounts")
      .select(
        `
        id,
        influencer_id,
        platform,
        username,
        external_account_id,
        access_token
        `
      )
      .eq(
        "influencer_id",
        influencerId
      )
      .in(
        "platform",
        requestedPlatforms
      );

    if (accountsError) {
      return NextResponse.json(
        {
          ok: false,
          step:
            "load_social_accounts",
          error:
            accountsError.message,
        },
        { status: 500 }
      );
    }

    const socialAccounts =
      (accounts ?? []) as SocialAccount[];
    const accountsById =
      new Map(
        socialAccounts.map(
          (account) => [
            account.id,
            account,
          ]
        )
      );

    const {
      data: posts,
      error: postsError,
    } = await supabase
      .from("posts")
      .select(
        `
        id,
        influencer_id,
        platform,
        social_account_id,
        status,
        external_post_id
        `
      )
      .eq(
        "influencer_id",
        influencerId
      );

    if (postsError) {
      return NextResponse.json(
        {
          ok: false,
          step: "load_posts",
          error:
            postsError.message,
        },
        { status: 500 }
      );
    }

    const localPosts =
      (posts ?? []) as LocalPost[];
    const postsById =
      new Map(
        localPosts.map(
          (post) => [
            post.id,
            post,
          ]
        )
      );
    const allDestinations:
      Destination[] = [];

    for (
      const postIdChunk of
        chunkValues(
          localPosts.map(
            (post) =>
              post.id
          ),
          100
        )
    ) {
      const {
        data: destinations,
        error:
          destinationsError,
      } = await supabase
        .from(
          "post_destinations"
        )
        .select(
          `
          id,
          post_id,
          platform,
          social_account_id,
          status,
          external_post_id
          `
        )
        .in(
          "post_id",
          postIdChunk
        );

      if (destinationsError) {
        return NextResponse.json(
          {
            ok: false,
            step:
              "load_post_destinations",
            error:
              destinationsError.message,
          },
          { status: 500 }
        );
      }

      allDestinations.push(
        ...(
          destinations ??
          []
        ) as Destination[]
      );
    }

    const destinationsByPost =
      new Map<
        string,
        Destination[]
      >();

    for (
      const destination of
        allDestinations
    ) {
      const existing =
        destinationsByPost.get(
          destination.post_id
        ) ?? [];
      existing.push(destination);
      destinationsByPost.set(
        destination.post_id,
        existing
      );
    }

    const targets:
      CleanupTarget[] = [];

    for (const post of localPosts) {
      if (
        post.status !==
          "published" ||
        (
          post.platform !==
            "instagram" &&
          post.platform !==
            "facebook"
        ) ||
        !requestedPlatforms.includes(
          post.platform as Platform
        ) ||
        !post.external_post_id
      ) {
        continue;
      }

      targets.push({
        localType:
          "legacy_post",
        localId: post.id,
        postId: post.id,
        platform:
          post.platform as Platform,
        socialAccountId:
          post.social_account_id,
        externalPostId:
          post.external_post_id,
      });
    }

    for (
      const destination of
        allDestinations
    ) {
      if (
        destination.status !==
          "published" ||
        !destination.external_post_id ||
        !requestedPlatforms.includes(
          destination.platform as Platform
        ) ||
        (
          destination.platform !==
            "instagram" &&
          destination.platform !==
            "facebook"
        ) ||
        !postsById.has(
          destination.post_id
        )
      ) {
        continue;
      }

      targets.push({
        localType:
          "destination",
        localId:
          destination.id,
        postId:
          destination.post_id,
        platform:
          destination.platform as Platform,
        socialAccountId:
          destination.social_account_id,
        externalPostId:
          destination.external_post_id,
      });
    }

    const accountValidations =
      new Map<
        string,
        Promise<AccountValidation>
      >();
    const details:
      CleanupDetail[] = [];

    for (const target of targets) {
      details.push(
        await checkTarget(
          target,
          influencerId,
          accountsById,
          accountValidations
        )
      );
    }

    const detailsByDestinationId =
      new Map(
        details
          .filter(
            (detail) =>
              detail.localType ===
              "destination"
          )
          .map((detail) => [
            detail.localId,
            detail,
          ])
      );
    const detailsByLegacyPostId =
      new Map(
        details
          .filter(
            (detail) =>
              detail.localType ===
              "legacy_post"
          )
          .map((detail) => [
            detail.postId,
            detail,
          ])
      );

    const parentCandidates =
      localPosts.filter(
        (post) => {
          const destinations =
            destinationsByPost.get(
              post.id
            ) ?? [];

          if (
            destinations.length ===
            0
          ) {
            return false;
          }

          const allDestinationsDeleted =
            destinations.every(
              (destination) =>
                destination.status ===
                  "published" &&
                Boolean(
                  destination.external_post_id
                ) &&
                detailsByDestinationId.get(
                  destination.id
                )?.classification ===
                  "deleted"
            );

          if (
            !allDestinationsDeleted
          ) {
            return false;
          }

          if (
            post.external_post_id
          ) {
            return (
              detailsByLegacyPostId.get(
                post.id
              )?.classification ===
              "deleted"
            );
          }

          return true;
        }
      );
    const parentCandidateIds =
      new Set(
        parentCandidates.map(
          (post) =>
            post.id
        )
      );

    for (const detail of details) {
      if (
        detail.localType ===
          "legacy_post" &&
        detail.classification ===
          "deleted" &&
        destinationsByPost.has(
          detail.postId
        ) &&
        !parentCandidateIds.has(
          detail.postId
        )
      ) {
        detail.wouldRemove =
          false;
      }
    }

    const wouldRemove = [
      ...details
        .filter(
          (detail) =>
            detail.classification ===
              "deleted" &&
            (
              detail.localType ===
                "destination" ||
              !destinationsByPost.has(
                detail.postId
              )
            )
        )
        .map((detail) => ({
          localType:
            detail.localType,
          localId:
            detail.localId,
          postId:
            detail.postId,
          platform:
            detail.platform,
          externalPostId:
            detail.externalPostId,
        })),
      ...parentCandidates.map(
        (post) => ({
          localType:
            "parent_post" as const,
          localId: post.id,
          postId: post.id,
          platform:
            post.platform,
          externalPostId:
            post.external_post_id,
        })
      ),
    ];

    let removed = 0;
    let skipped =
      dryRun
        ? details.filter(
            (detail) =>
              detail.classification ===
                "deleted" &&
              !detail.wouldRemove
          ).length
        : 0;
    const parentActions:
      Array<{
        postId: string;
        action:
          | "would_remove"
          | "removed"
          | "skipped";
        reason: string;
        error?: string;
      }> = parentCandidates.map(
        (post) => ({
          postId: post.id,
          action:
            "would_remove",
          reason:
            "All local external destinations were confirmed deleted by Meta.",
        })
      );

    if (!dryRun) {
      for (const detail of details) {
        if (
          detail.classification !==
          "deleted"
        ) {
          continue;
        }

        if (
          detail.localType ===
          "legacy_post"
        ) {
          const dependencies =
            destinationsByPost.get(
              detail.postId
            ) ?? [];

          if (
            dependencies.length >
            0
          ) {
            if (
              !parentCandidateIds.has(
                detail.postId
              )
            ) {
              detail.removalError =
                "Parent post has destination records and cannot be removed as a legacy post.";
              skipped += 1;
            }
            continue;
          }

          const {
            data: deletedPost,
            error: deleteError,
          } = await supabase
            .from("posts")
            .delete()
            .eq("id", detail.postId)
            .eq(
              "influencer_id",
              influencerId
            )
            .eq(
              "platform",
              detail.platform
            )
            .eq(
              "status",
              "published"
            )
            .eq(
              "external_post_id",
              detail.externalPostId
            )
            .select("id")
            .maybeSingle();

          if (
            deleteError ||
            !deletedPost
          ) {
            detail.removalError =
              deleteError?.message ??
              "Post changed or was already removed.";
            skipped += 1;
          } else {
            detail.removed = true;
            removed += 1;
          }

          continue;
        }

        const {
          data: deletedDestination,
          error: deleteError,
        } = await supabase
          .from(
            "post_destinations"
          )
          .delete()
          .eq("id", detail.localId)
          .eq(
            "post_id",
            detail.postId
          )
          .eq(
            "platform",
            detail.platform
          )
          .eq(
            "social_account_id",
            detail.socialAccountId!
          )
          .eq(
            "status",
            "published"
          )
          .eq(
            "external_post_id",
            detail.externalPostId
          )
          .select("id")
          .maybeSingle();

        if (
          deleteError ||
          !deletedDestination
        ) {
          detail.removalError =
            deleteError?.message ??
            "Destination changed or was already removed.";
          skipped += 1;
        } else {
          detail.removed = true;
          removed += 1;
        }
      }

      for (
        let index = 0;
        index <
          parentCandidates.length;
        index++
      ) {
        const post =
          parentCandidates[index];
        const parentAction =
          parentActions[index];
        const candidateDestinations =
          destinationsByPost.get(
            post.id
          ) ?? [];
        const allChildrenRemoved =
          candidateDestinations.every(
            (destination) =>
              detailsByDestinationId.get(
                destination.id
              )?.removed === true
          );

        if (!allChildrenRemoved) {
          parentAction.action =
            "skipped";
          parentAction.reason =
            "Not every confirmed-deleted destination was removed.";
          skipped += 1;
          continue;
        }

        const {
          data:
            remainingDestinations,
          error:
            remainingError,
        } = await supabase
          .from(
            "post_destinations"
          )
          .select("id")
          .eq("post_id", post.id)
          .limit(1);

        if (
          remainingError ||
          (
            remainingDestinations ??
            []
          ).length > 0
        ) {
          parentAction.action =
            "skipped";
          parentAction.reason =
            "Parent still has destination records or could not be revalidated.";
          if (remainingError) {
            parentAction.error =
              remainingError.message;
          }
          skipped += 1;
          continue;
        }

        const {
          data: deletedParent,
          error: parentDeleteError,
        } = await supabase
          .from("posts")
          .delete()
          .eq("id", post.id)
          .eq(
            "influencer_id",
            influencerId
          )
          .select("id")
          .maybeSingle();

        if (
          parentDeleteError ||
          !deletedParent
        ) {
          parentAction.action =
            "skipped";
          parentAction.reason =
            "Parent post could not be removed safely.";
          parentAction.error =
            parentDeleteError?.message ??
            "Parent changed or was already removed.";
          skipped += 1;
        } else {
          parentAction.action =
            "removed";
          parentAction.reason =
            "All destinations were removed and no destination records remained.";
          removed += 1;
        }
      }
    }

    return NextResponse.json({
      ok: true,
      influencerId,
      platform,
      dryRun,
      checked:
        details.length,
      exists:
        details.filter(
          (detail) =>
            detail.classification ===
            "exists"
        ).length,
      deleted:
        details.filter(
          (detail) =>
            detail.classification ===
            "deleted"
        ).length,
      uncertain:
        details.filter(
          (detail) =>
            detail.classification ===
            "uncertain"
        ).length,
      removed,
      skipped,
      wouldRemove,
      details,
      parentActions,
      preserved: {
        socialAccounts: true,
        socialDailyStats: true,
        metaContent: true,
      },
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
