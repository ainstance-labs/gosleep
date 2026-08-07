CREATE TABLE `agent_sessions` (
	`session_id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`kind` text NOT NULL,
	`pid` integer,
	`model` text,
	`cwd` text NOT NULL,
	`cycle` integer,
	`context_pct` integer,
	`current_tool` text,
	`current_intent` text,
	`status` text NOT NULL,
	`started_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`ended_at` text
);
--> statement-breakpoint
CREATE INDEX `ix_agent_sessions_status_updated` ON `agent_sessions` (`status`,`updated_at`);--> statement-breakpoint
CREATE INDEX `ix_agent_sessions_updated` ON `agent_sessions` (`updated_at`);