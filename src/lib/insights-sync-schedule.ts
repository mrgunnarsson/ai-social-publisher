const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

export type SyncFailureKind =
  | "authentication"
  | "rate_limit"
  | "temporary"
  | "configuration"
  | "query"
  | "content_unavailable";

function stableFraction(value: string) {
  let hash = 2166136261;

  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return (hash >>> 0) / 0xffffffff;
}

function addJitter(delayMs: number, jitterKey: string) {
  const jitter = delayMs * 0.1 * stableFraction(jitterKey);

  return Math.round(delayMs + jitter);
}

export function getSuccessfulSyncIntervalMs(
  publishedAt: string,
  now: Date = new Date()
) {
  const publishedTime = new Date(publishedAt).getTime();

  if (!Number.isFinite(publishedTime)) {
    throw new Error("published_at is invalid.");
  }

  const ageMs = Math.max(0, now.getTime() - publishedTime);

  if (ageMs < HOUR_MS) {
    return 5 * MINUTE_MS;
  }

  if (ageMs < 6 * HOUR_MS) {
    return 10 * MINUTE_MS;
  }

  if (ageMs < DAY_MS) {
    return 30 * MINUTE_MS;
  }

  if (ageMs < 3 * DAY_MS) {
    return 2 * HOUR_MS;
  }

  if (ageMs < 7 * DAY_MS) {
    return 6 * HOUR_MS;
  }

  if (ageMs < 30 * DAY_MS) {
    return DAY_MS;
  }

  if (ageMs < 90 * DAY_MS) {
    return 3 * DAY_MS;
  }

  if (ageMs < 180 * DAY_MS) {
    return 7 * DAY_MS;
  }

  return 30 * DAY_MS;
}

export function calculateNextSuccessfulSyncAt({
  publishedAt,
  from = new Date(),
  jitterKey,
}: {
  publishedAt: string;
  from?: Date;
  jitterKey: string;
}) {
  const intervalMs = getSuccessfulSyncIntervalMs(
    publishedAt,
    from
  );
  const delayMs = addJitter(intervalMs, jitterKey);

  return new Date(from.getTime() + delayMs).toISOString();
}

export function calculateRetryAt({
  failureKind,
  errorCount,
  from = new Date(),
  jitterKey,
  retryAfterMs = null,
}: {
  failureKind: SyncFailureKind;
  errorCount: number;
  from?: Date;
  jitterKey: string;
  retryAfterMs?: number | null;
}) {
  const exponent = Math.max(0, Math.min(errorCount - 1, 8));
  let delayMs: number;

  switch (failureKind) {
    case "authentication":
      delayMs = Math.min(24 * HOUR_MS * 2 ** exponent, 7 * DAY_MS);
      break;

    case "rate_limit":
      delayMs = Math.min(HOUR_MS * 2 ** exponent, DAY_MS);
      break;

    case "configuration":
      delayMs = Math.min(12 * HOUR_MS * 2 ** exponent, 7 * DAY_MS);
      break;

    case "query":
      delayMs = Math.min(DAY_MS * 2 ** exponent, 7 * DAY_MS);
      break;

    case "content_unavailable":
      delayMs = Math.min(7 * DAY_MS * 2 ** exponent, 30 * DAY_MS);
      break;

    default:
      delayMs = Math.min(15 * MINUTE_MS * 2 ** exponent, 6 * HOUR_MS);
      break;
  }

  if (retryAfterMs !== null && Number.isFinite(retryAfterMs)) {
    delayMs = Math.max(delayMs, Math.max(0, retryAfterMs));
  }

  return new Date(
    from.getTime() + addJitter(delayMs, jitterKey)
  ).toISOString();
}
