import { countMockMatches } from "@/lib/adapters/mock-x";
import { env, xSearchConfigured } from "@/lib/env";
import type { VolumeReport } from "@/lib/types";
import { classifyVolume, countRecent, RetryableAdapterError, volumeMessage } from "@/lib/x/search";

export async function volumeForQuery(
  query: string,
  accessToken?: string,
  fetchImpl: typeof fetch = fetch,
): Promise<VolumeReport> {
  const q = query.trim();
  if (!q) {
    return { query: q, count24h: 0, band: "quiet", message: "Add a search rule first.", retryable: false };
  }
  if (!xSearchConfigured()) {
    const count24h = Math.min(100, countMockMatches(q) * 12);
    const band = classifyVolume(count24h);
    return {
      query: q,
      count24h,
      band,
      message: `${volumeMessage(band, count24h, q)} (mock corpus — not production X.)`,
      retryable: false,
    };
  }
  const token = accessToken || env.xBearer;
  if (!token) {
    return {
      query: q,
      count24h: 0,
      band: "quiet",
      message: "Connect X in Settings or set X_BEARER_TOKEN to check live volume.",
      retryable: false,
    };
  }
  try {
    const count24h = await countRecent(token, `${q} -is:retweet`, fetchImpl);
    const band = classifyVolume(count24h);
    return { query: q, count24h, band, message: volumeMessage(band, count24h, q), retryable: false };
  } catch (err) {
    if (err instanceof RetryableAdapterError) {
      return {
        query: q,
        count24h: 0,
        band: "ok",
        message: err.message,
        retryable: true,
      };
    }
    throw err;
  }
}
