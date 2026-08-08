CREATE TABLE `decisions` (
	`did` text PRIMARY KEY NOT NULL,
	`ts` text NOT NULL,
	`kind` text,
	`subject` text,
	`body` text NOT NULL,
	`last_event_seq` integer
);
--> statement-breakpoint
CREATE TABLE `events` (
	`seq` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`day` text NOT NULL,
	`ts` text NOT NULL,
	`src` text NOT NULL,
	`actor` text NOT NULL,
	`task` text,
	`type` text NOT NULL,
	`payload` text NOT NULL,
	`supersedes_seq` integer,
	`ingested_from` text
);
--> statement-breakpoint
CREATE INDEX `ix_events_type_ts` ON `events` (`type`,`ts`);--> statement-breakpoint
CREATE INDEX `ix_events_task_ts` ON `events` (`task`,`ts`);--> statement-breakpoint
CREATE INDEX `ix_events_actor_ts` ON `events` (`actor`,`ts`);--> statement-breakpoint
CREATE UNIQUE INDEX `uq_events_ingested` ON `events` (`ingested_from`);--> statement-breakpoint
CREATE TABLE `heartbeat` (
	`seq` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`ts` text NOT NULL,
	`cycle` integer,
	`context_pct` integer,
	`open_workers` integer,
	`extra` text
);
--> statement-breakpoint
CREATE TABLE `ingest_state` (
	`file_path` text PRIMARY KEY NOT NULL,
	`last_ingested_offset` integer NOT NULL,
	`last_sha256_prefix` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `questions` (
	`qid` text PRIMARY KEY NOT NULL,
	`status` text NOT NULL,
	`kind` text NOT NULL,
	`task` text,
	`question` text NOT NULL,
	`options` text,
	`opened_at` text NOT NULL,
	`answered_at` text,
	`answer_text` text,
	`resolved_at` text,
	`applied` text,
	`last_event_seq` integer
);
--> statement-breakpoint
CREATE TABLE `server_intents` (
	`intent_id` text PRIMARY KEY NOT NULL,
	`endpoint` text NOT NULL,
	`started_at` text NOT NULL,
	`finished_at` text,
	`status` text,
	`params` text
);
--> statement-breakpoint
CREATE TABLE `skills` (
	`name` text PRIMARY KEY NOT NULL,
	`version` text NOT NULL,
	`status` text NOT NULL,
	`last_published_at` text,
	`last_published_by` text,
	`changelog` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `tasks` (
	`key` text PRIMARY KEY NOT NULL,
	`epic` text,
	`status` text NOT NULL,
	`title` text NOT NULL,
	`labels` text,
	`last_synced_at` text
);
