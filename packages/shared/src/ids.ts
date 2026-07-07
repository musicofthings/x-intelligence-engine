/**
 * X IDs (post ids, user ids, conversation ids) are 64-bit snowflakes that MUST be
 * treated as strings. Coercing them to a JS number silently corrupts the low bits.
 * These helpers make that boundary explicit.
 */

/** A validated decimal snowflake string (digits only). */
export type SnowflakeId = string & { readonly __brand: "SnowflakeId" };

const SNOWFLAKE_RE = /^[0-9]{1,20}$/;

export function isSnowflake(value: unknown): value is SnowflakeId {
  return typeof value === "string" && SNOWFLAKE_RE.test(value);
}

/** Validate and brand an X id. Throws on non-string / non-numeric-string input. */
export function toSnowflake(value: unknown): SnowflakeId {
  if (typeof value === "number") {
    // Refuse silently-lossy numeric ids — callers must pass strings.
    throw new TypeError(
      `X id received as number (${value}); pass ids as strings to avoid precision loss`,
    );
  }
  if (!isSnowflake(value)) {
    throw new TypeError(`Invalid X id: ${JSON.stringify(value)}`);
  }
  return value;
}

/** Generate a random opaque id for internal records (not an X id). */
export function newInternalId(prefix: string, randomHex: string): string {
  return `${prefix}_${randomHex}`;
}

/**
 * Deterministic job/run key builder. Keeps idempotency keys consistent and
 * collision-resistant across queue redelivery.
 */
export function jobKey(...parts: (string | number)[]): string {
  return parts.map((p) => String(p)).join(":");
}
