-- GSL-319 — surface the PR the dev-agent just opened on the panel.
--
-- Per-session cache of the most recently observed GitHub pull-request URL. Populated by
-- `POST /internal/agents/tool-observed` when the extractor finds a
-- `https://github.com/<org>/<repo>/pull/<n>` URL in the observed command / response / intent
-- text. Consumed by `/fleet`, `/bundle`, and the Overview "Latest PR" card.
ALTER TABLE `agent_sessions` ADD COLUMN `last_pr_url` text;--> statement-breakpoint
ALTER TABLE `agent_sessions` ADD COLUMN `last_pr_at` text;
