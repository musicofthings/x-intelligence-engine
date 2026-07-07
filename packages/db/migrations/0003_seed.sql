-- 0003_seed.sql — starter data (spec §58, §8). Monitors seeded DISABLED to avoid
-- unexpected X API cost. Default settings + timezone. NO fake production posts.

INSERT INTO app_settings (key, value_json, is_secret_reference, updated_at) VALUES
  ('app.timezone', '"Asia/Kolkata"', 0, '2026-01-01T00:00:00Z'),
  ('score.bands', '{"discardMax":39,"archiveMax":59,"digestMax":74,"priorityMax":89}', 0, '2026-01-01T00:00:00Z'),
  ('digest.dailyTimeLocal', '"08:00"', 0, '2026-01-01T00:00:00Z'),
  ('retention.raw_payload_retention_days', '30', 0, '2026-01-01T00:00:00Z'),
  ('retention.low_score_post_retention_days', '90', 0, '2026-01-01T00:00:00Z'),
  ('retention.job_log_retention_days', '30', 0, '2026-01-01T00:00:00Z'),
  ('retention.audit_log_retention_days', '365', 0, '2026-01-01T00:00:00Z');

-- Starter monitors (spec §8). enabled=0. Queries validated against X operators before
-- enabling (see docs/X_API_SETUP.md). id = slug for deterministic seeding.
INSERT INTO monitors
  (id, name, slug, description, type, enabled, priority, x_query, poll_interval_minutes,
   max_results_per_run, max_pages_per_run, prefilter_threshold, ai_screening_threshold,
   alert_threshold, language, excluded_terms_json, required_terms_json, created_at, updated_at)
VALUES
  ('mon_ai_models','AI Models','ai-models','Foundation/reasoning model releases and agents','recent_search',0,80,
   '("foundation model" OR "reasoning model" OR "AI agent" OR "model release") lang:en -is:retweet',
   30,25,1,45,50,90,'en','[]','[]','2026-01-01T00:00:00Z','2026-01-01T00:00:00Z'),
  ('mon_ai_biology','AI Biology','ai-biology','AI for biology / generative biology','recent_search',0,85,
   '("AI for biology" OR "generative biology" OR "foundation model biology" OR "protein design") lang:en -is:retweet',
   60,25,1,45,50,90,'en','[]','[]','2026-01-01T00:00:00Z','2026-01-01T00:00:00Z'),
  ('mon_ai_drug','AI Drug Discovery','ai-drug-discovery','AI-enabled drug discovery','recent_search',0,90,
   '("AI drug discovery" OR "AI-enabled drug discovery" OR "generative chemistry" OR "molecular design") lang:en -is:retweet',
   60,25,1,45,50,90,'en','[]','[]','2026-01-01T00:00:00Z','2026-01-01T00:00:00Z'),
  ('mon_oncology','Oncology','oncology','Practice-changing oncology developments','recent_search',0,88,
   '(oncology OR cancer) ("phase 3" OR "Phase III" OR "practice changing" OR approval) lang:en -is:retweet',
   60,25,1,45,50,90,'en','[]','[]','2026-01-01T00:00:00Z','2026-01-01T00:00:00Z'),
  ('mon_ctdna','ctDNA and MRD','ctdna-mrd','Liquid biopsy / MRD signals','recent_search',0,88,
   '(ctDNA OR "liquid biopsy" OR MRD OR "molecular residual disease") lang:en -is:retweet',
   60,25,1,45,50,90,'en','[]','[]','2026-01-01T00:00:00Z','2026-01-01T00:00:00Z'),
  ('mon_genomics','Genomics','genomics','Genomics and sequencing developments','recent_search',0,80,
   '(genomics OR sequencing OR "whole genome" OR "whole exome") lang:en -is:retweet',
   120,25,1,45,50,90,'en','[]','[]','2026-01-01T00:00:00Z','2026-01-01T00:00:00Z'),
  ('mon_longread','Long-Read Sequencing','long-read-sequencing','Long-read platforms','recent_search',0,82,
   '("long-read sequencing" OR nanopore OR "Oxford Nanopore" OR PacBio) lang:en -is:retweet',
   120,25,1,45,50,90,'en','[]','[]','2026-01-01T00:00:00Z','2026-01-01T00:00:00Z'),
  ('mon_regulatory','Regulatory and FDA','regulatory-fda','FDA / regulatory approvals','recent_search',0,88,
   '(FDA OR "regulatory approval" OR "accelerated approval") (drug OR diagnostic OR biotech OR pharma) lang:en -is:retweet',
   60,25,1,45,50,90,'en','[]','[]','2026-01-01T00:00:00Z','2026-01-01T00:00:00Z');
