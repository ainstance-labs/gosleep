-- GSL-351 (GSL-350 observer mode phase A) — schema for machine-wide passive observation.
--
-- Two new tables + three additive columns on `agent_sessions`. All additive per R28
-- (target-arch §12) — no DROP. Enumerates the WHOLE tmux server + every project directory
-- under ~/.claude/projects/* (R14.2). Enforced zero-influence sentinel (R14.1) at the writer
-- layer, not at the SQL layer.

CREATE TABLE `tmux_panes` (
	`pane_id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`session_name` text NOT NULL,
	`window_id` text NOT NULL,
	`pane_pid` integer NOT NULL,
	`pane_current_path` text,
	`pane_current_command` text,
	`pane_title` text,
	`first_seen` text NOT NULL,
	`last_seen` text NOT NULL,
	`misses` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE INDEX `ix_tmux_panes_last_seen` ON `tmux_panes` (`last_seen`);--> statement-breakpoint
CREATE INDEX `ix_tmux_panes_pane_pid` ON `tmux_panes` (`pane_pid`);--> statement-breakpoint

CREATE TABLE `observed_events` (
	`seq` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`ts` text NOT NULL,
	`project_slug` text,
	`kind` text NOT NULL,
	`source` text NOT NULL,
	`payload_json` text
);
--> statement-breakpoint
CREATE INDEX `ix_observed_events_ts` ON `observed_events` (`ts`);--> statement-breakpoint
CREATE INDEX `ix_observed_events_project_ts` ON `observed_events` (`project_slug`,`ts`);--> statement-breakpoint
CREATE INDEX `ix_observed_events_kind_ts` ON `observed_events` (`kind`,`ts`);--> statement-breakpoint

ALTER TABLE `agent_sessions` ADD COLUMN `project_slug` text;--> statement-breakpoint
ALTER TABLE `agent_sessions` ADD COLUMN `cwd_project_root` text;--> statement-breakpoint
ALTER TABLE `agent_sessions` ADD COLUMN `observed_only` integer DEFAULT 0 NOT NULL;
