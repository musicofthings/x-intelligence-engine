import type { Bindings, IngestMessage, ScreeningMessage } from "./bindings.js";
import { buildCtx, dispatchDueMonitors, dispatchWatchlists, handleIngest, handleScreening } from "./pipeline.js";
import { generateDailyDigest } from "./digest.js";

/** Pipeline Worker: scheduled() dispatcher/digest/maintenance + queue() consumers. */
export default {
  async scheduled(event: ScheduledController, env: Bindings, _ctx: ExecutionContext): Promise<void> {
    const ctx = buildCtx(env);
    const nowMs = Date.now();
    // Cron routing by schedule string (spec §28). Each branch is gated by a master
    // on/off switch in app_settings so nothing runs unsupervised (spec §30).
    if (event.cron === "*/15 * * * *") {
      const enabled = (await ctx.repo.getSetting<boolean>("cron.collection_enabled")) ?? false;
      if (!enabled) {
        ctx.logger.info("cron.collection_disabled", { event: "cron.collection_disabled" });
        return;
      }
      await dispatchDueMonitors(ctx, nowMs);
      await dispatchWatchlists(ctx, nowMs);
    } else if (event.cron === "30 2 * * *") {
      if (((await ctx.repo.getSetting<boolean>("cron.digest_enabled")) ?? true)) {
        await generateDailyDigest(ctx, nowMs);
      }
    } else if (event.cron === "0 3 * * *") {
      if (((await ctx.repo.getSetting<boolean>("cron.maintenance_enabled")) ?? true)) {
        await runMaintenance(ctx, nowMs);
      }
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
