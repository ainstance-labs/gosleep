-- GSL-320 — capture the actual tool_input (Bash command, Edit target, …) alongside
-- every permission question so the owner sees WHAT is being approved on the panel card.
-- Nullable — non-permission rows leave it NULL. Text (JSON-encoded) to keep the shape
-- flexible without a second table.
ALTER TABLE `questions` ADD COLUMN `tool_input` text;
