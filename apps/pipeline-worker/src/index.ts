import type { Bindings, IngestMessage, ScreeningMessage } from "./bindings.js";
import { buildCtx, dispatchDueMonitors, handleIngest, handleScreening } from "./pipeline.js";
import { generateDailyDigest } from "./digest.js";

/** Pipeline Worker: scheduled() dispatcher/digest/maintenance + queue() consumers. */
export default {
  async scheduled(event: ScheduledController, env: Bindings, _ctx: ExecutionContext): Promise<void> {
    const ctx = buildCtx(env);
    const nowMs = Date.now();
    // Cron routing by schedule string (spec §28).
    if (event.cron === "*/15 * * * *") {
      await dispatchDueMonitors(ctx, nowMs);
    } else if (event.cron === "30 2 * * *") {
      await generateDailyDigest(ctx, nowMs);
    } else if (event.cron === "0 3 * * *") {
      await runMaintenance(ctx, nowMs);
    }
  },

  async queue(batch: MessageBatch, env: Bindings, _ctx: ExecutionContext): Promise<void> {
    const ctx = buildCtx(env);
    const nowMs = Date.now();
    for (const message of batch.messages) {
      try {
        if (batch.queue.includes("ingest")) {
          await handleIngest(ctx, message.body as IngestMessage, nowMs);
        } else {
          await handleScreening(ctx, message.body as ScreeningMessage, nowMs);
        }
        message.ack();
      } catch (e) {
        ctx.logger.error("queue.error", { event: "queue.error", error_code: e instanceof Error ? e.message : "err" });
        message.retry(); // bounded by max_retries -> DLQ (spec §27)
      }
    }
  },
};

async function runMaintenance(ctx: ReturnType<typeof buildCtx>, nowMs: number): Promise<void> {
  // Expire stuck runs (spec §28). Marks long-running collections as failed.
  const cutoff = new Date(nowMs - 30 * 60_000).toISOString();
  await ctx.db.prepare("UPDATE ingestion_runs SET status='failed', error='stuck run expired' WHERE status='running' AND started_at < ?").bind(cutoff).run();
  ctx.logger.info("maintenance.done", { event: "maintenance.done" });
}
