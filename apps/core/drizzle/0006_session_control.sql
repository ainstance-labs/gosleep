-- GSL-361 (observer mode phase B) — per-session control registry.
--
-- One row per session that has ever been observed. Written by TWO paths:
--   1. Shim's first invocation stamps `shim_registered=1` + `last_heartbeat_at` — plus,
--      when the launching shell exported GOSLEEP_WEB_QUESTIONS=1, immediately upserts
--      `state='controlled', source='env'` (not releasable from the panel per R15.3).
--   2. POST /actions/sessions/:id/take-control and /release-control flip `state` and
--      stamp `source='runtime'` + `activated_by='owner-web'`.
--
-- Read at every shim invocation (cached in the shim at 1 s TTL per R15.6). Read at every
-- panel render of Fleet / Observed cards for the pill + toggle state.
--
-- Additive per R28 — no DROP.

CREATE TABLE `session_control` (
	`session_id` text PRIMARY KEY NOT NULL,
	`state` text DEFAULT 'observer' NOT NULL,
	`source` text DEFAULT 'runtime' NOT NULL,
	`activated_at` text,
	`activated_by` text,
	`deactivated_at` text,
	`shim_registered` integer DEFAULT 0 NOT NULL,
	`last_heartbeat_at` text,
	`last_heartbeat_pid` integer
);
--> statement-breakpoint
CREATE INDEX `ix_session_control_state` ON `session_control` (`state`);--> statement-breakpoint
CREATE INDEX `ix_session_control_last_heartbeat` ON `session_control` (`last_heartbeat_at`);
