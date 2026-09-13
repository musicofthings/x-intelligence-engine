/**
 * The only server-side X write in LiveRound: an original post whose exact text
 * the user approved. Never attach a reply target.
 */

export type OriginalPostPayload = { text: string };

export function originalPostPayload(text: string): OriginalPostPayload {
  const trimmed = text.trim();
  if (!trimmed) throw new Error("Approved text is empty");
  if (trimmed.length > 280) throw new Error("Approved text exceeds 280 characters");
  return { text: trimmed };
}

export async function publishOriginalPost(
  accessToken: string,
  text: string,
  fetchImpl: typeof fetch = fetch,
): Promise<{ id: string }> {
  const payload = originalPostPayload(text);
  const res = await fetchImpl("https://api.x.com/2/tweets", {
    method: "POST",
    headers: {
      authorization: `Bearer ${accessToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  if (res.status === 401 || res.status === 403) {
    throw new Error("X token expired. Reconnect the account in Settings.");
  }
  if (!res.ok) {
    throw new Error(`Original post failed (${res.status})`);
  }
  const body = (await res.json()) as { data?: { id?: string } };
  if (!body.data?.id) throw new Error("X returned no post id");
  return { id: body.data.id };
}

/** Structural guard: the payload must be exactly `{ text }`. */
export function payloadIsOriginalOnly(payload: OriginalPostPayload): boolean {
  const keys = Object.keys(payload);
  return keys.length === 1 && keys[0] === "text" && !("reply" in payload);
}
