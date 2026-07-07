import { describe, it, expect } from "vitest";
import { toSnowflake, isSnowflake, jobKey } from "./ids.js";
import { buildPostUrl, isSafeOutboundUrl } from "./url.js";
import { AppError, toAppError } from "./errors.js";

describe("snowflake ids", () => {
  it("accepts numeric strings", () => {
    expect(isSnowflake("1234567890123456789")).toBe(true);
    expect(toSnowflake("1234567890123456789")).toBe("1234567890123456789");
  });

  it("rejects numbers to avoid precision loss", () => {
    expect(() => toSnowflake(1234567890123456789)).toThrow(/number/);
  });

  it("rejects non-numeric strings", () => {
    expect(isSnowflake("abc")).toBe(false);
    expect(() => toSnowflake("abc")).toThrow();
  });

  it("builds stable job keys", () => {
    expect(jobKey("screen", "post123", "v1")).toBe("screen:post123:v1");
  });
});

describe("post url", () => {
  it("builds canonical url with username", () => {
    expect(buildPostUrl("OncoPhenomics", "1800000000000000001")).toBe(
      "https://x.com/OncoPhenomics/status/1800000000000000001",
    );
  });

  it("falls back to i/web/status without a username", () => {
    expect(buildPostUrl(null, "1800000000000000001")).toBe(
      "https://x.com/i/web/status/1800000000000000001",
    );
  });

  it("returns null for a bad post id", () => {
    expect(buildPostUrl("user", "not-an-id")).toBeNull();
  });

  it("rejects invalid usernames by falling back", () => {
    expect(buildPostUrl("bad name!", "1800000000000000001")).toBe(
      "https://x.com/i/web/status/1800000000000000001",
    );
  });
});

describe("outbound url safety", () => {
  it("allows public https", () => {
    expect(isSafeOutboundUrl("https://www.nature.com/articles/x")).toBe(true);
  });
  it("blocks metadata + private ranges", () => {
    expect(isSafeOutboundUrl("http://169.254.169.254/latest/meta-data")).toBe(false);
    expect(isSafeOutboundUrl("http://127.0.0.1:8080")).toBe(false);
    expect(isSafeOutboundUrl("http://10.0.0.5")).toBe(false);
    expect(isSafeOutboundUrl("http://192.168.1.1")).toBe(false);
    expect(isSafeOutboundUrl("ftp://example.com")).toBe(false);
  });
});

describe("errors", () => {
  it("maps codes to status + safe public shape", () => {
    const e = new AppError("BUDGET_EXCEEDED", "daily x budget hit", {
      detail: { budget: 5000 },
    });
    expect(e.status).toBe(429);
    const pub = e.toPublic("req-1");
    expect(pub.error.code).toBe("BUDGET_EXCEEDED");
    expect(JSON.stringify(pub)).not.toContain("5000"); // detail never leaks
    expect(pub.error.request_id).toBe("req-1");
  });

  it("normalizes unknown throwables", () => {
    expect(toAppError(new Error("boom")).code).toBe("INTERNAL_ERROR");
    expect(toAppError("boom").code).toBe("INTERNAL_ERROR");
  });
});
