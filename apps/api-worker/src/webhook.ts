import { Hono } from "hono";
import { crcResponse, verifyWebhookSignature, sha256Hex, webhookEventId } from "@xie/x-client";
import type { HonoEnv } from "./bindings.js";

/**
 * X webhook endpoint (spec §7.5). GET handles the CRC challenge; POST verifies the
 * signature, dedupes, enqueues, and returns promptly. Expensive work is async.
 *
 * NOTE: header names / challenge format must be confirmed against current official X
 * docs before enabling in production (see packages/x-client/src/webhook.ts).
 */
export function webhookRoutes(): Hono<HonoEnv> {
  const app = new Hono<HonoEnv>();

  app.get("/x", async (c) => {
    const env = c.get("env");
    if (!env.X_WEBHOOK_SECRET) return c.json({ error: "webhook not configured" }, 503);
    const crcToken = new URL(c.req.url).searchParams.get("crc_token");
    if (!crcToken) return c.json({ error: "missing crc_token" }, 400);
    const responseToken = await crcResponse(env.X_WEBHOOK_SECRET, crcToken);
    return c.json({ response_token: responseToken });
  });

  app.post("/x", async (c) => {
    const env = c.get("env");
    const logger = c.get("logger");
    if (!env.X_WEBHOOK_SECRET) return c.json({ error: "webhook not configured" }, 503);

    const raw = await c.req.text();
    const signature = c.req.header("x-twitter-webhooks-signature") ?? c.req.header("x-x-webhooks-signature") ?? null;
    const ok = await verifyWebhookSignature(env.X_WEBHOOK_SECRET, raw, signature);
    if (!ok) {
      logger.warn("webhook.invalid_signature", { event: "webhook.invalid_signature" });
      return c.json({ error: "invalid signature" }, 403);
    }

    let payload: Record<string, unknown> = {};
    try {
      payload = JSON.parse(raw);
    } catch {
      return c.json({ error: "invalid json" }, 400);
    }

    const hash = await sha256Hex(raw);
    const externalId = webhookEventId(payload as { id?: string; event_id?: string }, hash);
    const isNew = await c.get("repo").recordWebhookEvent("x", externalId, hash);
    if (!isNew) return c.json({ ok: true, duplicate: true }); // idempotent (spec §7.5)

    // Enqueue for async processing; return promptly.
    await c.env.INGEST_QUEUE.send({
      schema_version: 1,
      event_id: externalId,
      source_type: "webhook",
      monitor_id: "",
      received_at: new Date().toISOString(),
      payload,
    });
    logger.info("webhook.accepted", { event: "webhook.accepted" });
    return c.json({ ok: true });
  });

  return app;
}
