-- GSL-379 (observer mode phase C) — per-submission history for task-body writes into a
-- receiving tmux pane of a controlled session.
--
-- One row per submission ATTEMPT — whether it went through or was refused mid-dispatch.
-- Never stores the body itself: R16.7 caps body at 16 KB and R16.6 keeps the full body on the
-- timeline event payload (subject to that layer's retention). This row keeps sha256 + byte
-- length so the panel history drawer stays cheap.
--
-- Writer paths:
--   1. POST /actions/sessions/:id/submit-task with dry_run=false (confirm phase) — writes
--      exactly one row per confirm invocation, keyed by a random UUID minted by the endpoint.
--      Outcomes:
--        * 'delivered'            — tmux send-keys returned cleanly.
--        * 'pane_gone'            — pane_ref resolved by the executor was missing at dispatch
--                                   (F16-S5).
--        * 'released_mid_submit'  — session state re-read at confirm is not 'controlled'
--                                   anymore (F16-S6).
--        * 'not_at_prompt'        — framing='prompt-boundary' timed out on the
--                                   pane_current_command wait (Risk 1, Q1 = 5 s default).
--        * 'send_failed'          — tmux send-keys itself returned non-zero (rare).
--   2. The dry_run=true phase does NOT write a row — a preview never leaves the process.
--
-- Additive per R28 — no DROP.

CREATE TABLE `task_submissions` (
	`id` text PRIMARY KEY NOT NULL,
	`ts` text NOT NULL,
	`session_id` text NOT NULL,
	`pane_ref_at_dispatch` text,
	`body_sha256` text NOT NULL,
	`body_len` integer NOT NULL,
	`framing` text NOT NULL,
	`outcome` text NOT NULL,
	`error` text
);
--> statement-breakpoint
CREATE INDEX `ix_task_submissions_session_ts` ON `task_submissions` (`session_id`,`ts`);--> statement-breakpoint
CREATE INDEX `ix_task_submissions_ts` ON `task_submissions` (`ts`);
