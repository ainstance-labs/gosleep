// @gosleep/web — Skills management screen (T7, GSL-255 + closes verifier GSL-287).
//
// Fills the `/skills` route that until now fell through to NotFoundScreen (GSL-295). Renders
// the seven-skill list from GET /skills (enriched with filesystem hashes) and, on row click,
// a details drawer with the full diff + registry changelog from GET /skills/:name/diff.
//
// The Publish button is visible on every row with `has_changes === true` but is DISABLED
// tonight per `d-2026-08-09-001` (TouchID pause). The disabled state carries a tooltip
// pointing at the CLI equivalent (`bash tools/skills/publish.sh <name>`). The mutation
// hook (`usePublishSkill`) is wired so flipping the disabled flag is a one-line change when
// the pause lifts.
//
// Design language: matches the existing shadcn-lookalike screens (Overview, Tasks, Questions) —
// PageHeader + Cards + Badges + Table. No new UI primitives.

import { useState, useMemo } from "react";

import { Card, CardBody, CardHeader, CardTitle } from "../components/ui/Card";
import { PageHeader } from "../components/PageHeader";
import { QueryStatus } from "../components/QueryStatus";
import { useSkills, useSkillDiff, usePublishSkill } from "../data/queries";
import { Badge } from "../components/ui/Badge";
import { Button } from "../components/ui/Button";
import { Dialog } from "../components/ui/Dialog";
import { useToast } from "../components/ui/Toast";
import { timeAgo } from "../lib/format";
import type { SkillRow } from "@gosleep/schema";

type Tone = "info" | "ok" | "warn" | "neutral" | "danger" | "accent";

const TOUCHID_PAUSED_TOOLTIP =
  "TouchID paused (d-2026-08-09-001). Publish via CLI: bash tools/skills/publish.sh <name>";

// The row is a compact tuple; the details drawer carries the diff and changelog.
function statusTone(row: SkillRow): Tone {
  if (row.local_exists === false) return "warn"; // production-only skill (no dev copy)
  if (row.prod_exists === false) return "info"; // never published
  if (row.has_changes) return "warn";
  return "ok";
}

function statusLabel(row: SkillRow): string {
  if (row.local_exists === false) return "no development copy";
  if (row.prod_exists === false) return "never published";
  if (row.has_changes) return "has changes";
  return "clean";
}

function shortHash(hash: string | undefined): string {
  if (!hash) return "";
  if (hash === "absent") return "absent";
  if (hash.startsWith("sha256:")) return hash.slice(7, 15);
  return hash.slice(0, 12);
}

export function SkillsScreen() {
  const q = useSkills();
  const [selected, setSelected] = useState<string | null>(null);
  const diff = useSkillDiff(selected);
  const publish = usePublishSkill();
  const { push: pushToast } = useToast();

  const changedCount = useMemo(() => {
    if (!q.data) return 0;
    return q.data.skills.filter((r) => r.has_changes === true).length;
  }, [q.data]);

  const submitPublish = async (row: SkillRow): Promise<void> => {
    try {
      const res = await publish.mutateAsync({
        skill: row.name,
        lesson: `web publish of ${row.name} at ${new Date().toISOString()}`,
      });
      pushToast({
        title: `Published ${row.name}`,
        description:
          res.cached === true
            ? "cached replay (no re-run)"
            : `commit ${res.result?.commit.slice(0, 12) ?? "?"} — backup at ${res.result?.backup ?? "?"}`,
        tone: "ok",
      });
    } catch (err) {
      pushToast({
        title: `Publish failed for ${row.name}`,
        description: err instanceof Error ? err.message : String(err),
        tone: "danger",
      });
    }
  };

  return (
    <div className="space-y-5">
      <PageHeader
        title="Skills"
        subtitle="Skills management system — seven skills, git-tracked development copies, publish by owner via one button. Every publish leaves a CHANGELOG row + backup + timeline event chain."
        right={
          <div className="flex items-center gap-2">
            <Badge tone={changedCount > 0 ? "warn" : "ok"}>
              {changedCount === 0
                ? "all clean"
                : `${changedCount} skill${changedCount === 1 ? "" : "s"} with changes`}
            </Badge>
          </div>
        }
      />

      <div className="rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface-sunken)] px-3 py-2 text-xs text-[var(--color-fg-secondary)]">
        <strong>TouchID paused</strong> (owner decision <code className="mono">d-2026-08-09-001</code>).
        The Publish button is disabled tonight; use the CLI:{" "}
        <code className="mono">bash tools/skills/publish.sh &lt;name&gt;</code>. The web
        publish path (<code className="mono">POST /actions/skills/publish</code>) is wired and
        endpoint-tested; flipping the button re-enables it when the pause lifts.
      </div>

      <QueryStatus
        isPending={q.isPending}
        error={q.error}
        data={q.data}
        isEmpty={(d) => d.skills.length === 0}
        emptyMessage="No skills registered."
      >
        {(d) => (
          <div className="grid grid-cols-1 gap-3">
            {d.skills.map((row) => {
              const tone = statusTone(row);
              const label = statusLabel(row);
              const canPublish = row.has_changes === true && row.local_exists !== false;
              return (
                <Card key={row.name}>
                  <CardHeader>
                    <div className="flex min-w-0 flex-wrap items-center gap-2">
                      <Badge tone={tone}>{label}</Badge>
                      <CardTitle className="mono truncate text-sm">{row.name}</CardTitle>
                      <span className="mono text-muted text-xs">
                        {row.version}
                      </span>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      {row.last_published_at !== null && row.last_published_at !== undefined ? (
                        <span className="text-muted text-xs">
                          last publish {timeAgo(row.last_published_at)}
                          {row.last_published_by
                            ? ` · ${row.last_published_by}`
                            : ""}
                        </span>
                      ) : (
                        <span className="text-muted text-xs">no publish yet</span>
                      )}
                    </div>
                  </CardHeader>
                  <CardBody className="space-y-2">
                    <div className="grid grid-cols-1 gap-1 text-xs sm:grid-cols-2">
                      <div>
                        <span className="text-muted">local hash:</span>{" "}
                        <code className="mono">{shortHash(row.hash_local)}</code>
                      </div>
                      <div>
                        <span className="text-muted">prod hash:</span>{" "}
                        <code className="mono">{shortHash(row.hash_prod)}</code>
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2 pt-1">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setSelected(row.name)}
                      >
                        View diff + history
                      </Button>
                      <Button
                        variant="solid"
                        size="sm"
                        disabled
                        title={TOUCHID_PAUSED_TOOLTIP}
                        aria-disabled="true"
                      >
                        {canPublish ? "Publish (paused)" : "Publish"}
                      </Button>
                      {/* The mutation is wired but never called from a click while
                          disabled=true. Keeping the reference around so tsc catches an
                          accidental hook-signature drift. */}
                      <span className="hidden">
                        {String(publish.isPending)}
                        {typeof submitPublish}
                      </span>
                    </div>
                  </CardBody>
                </Card>
              );
            })}
          </div>
        )}
      </QueryStatus>

      {/* Details drawer — full diff + changelog for the selected skill. */}
      <Dialog
        open={selected !== null}
        onOpenChange={(o) => {
          if (!o) setSelected(null);
        }}
        title={`Skill: ${selected ?? ""}`}
        description={
          diff.data
            ? `Local hash ${shortHash(diff.data.hashLocal)} · Prod hash ${shortHash(diff.data.hashProd)} · Diff ${diff.data.diffBytes.toLocaleString()} bytes${diff.data.truncated ? " (truncated)" : ""}`
            : "Loading diff…"
        }
        footer={
          <Button variant="ghost" size="sm" onClick={() => setSelected(null)}>
            Close
          </Button>
        }
      >
        <div className="space-y-3">
          {diff.isPending ? (
            <p className="text-muted text-sm">Loading diff…</p>
          ) : diff.error ? (
            <p className="text-danger text-sm">
              {diff.error instanceof Error ? diff.error.message : String(diff.error)}
            </p>
          ) : diff.data ? (
            <>
              <div>
                <div className="text-muted mb-1 text-xs uppercase tracking-wide">Diff</div>
                <pre className="mono surface max-h-96 overflow-auto rounded-md p-3 text-xs">
                  {diff.data.diffText.length > 0
                    ? diff.data.diffText
                    : "(no differences — dev copy matches production)"}
                </pre>
              </div>
              <div>
                <div className="text-muted mb-1 text-xs uppercase tracking-wide">
                  CHANGELOG history
                </div>
                {Array.isArray(diff.data.changelog) && diff.data.changelog.length > 0 ? (
                  <ul className="space-y-1 text-xs">
                    {(diff.data.changelog as Array<Record<string, unknown>>).map((row, i) => (
                      <li
                        key={`${row.ts as string}-${i}`}
                        className="border-b border-[var(--color-border-subtle)] pb-1"
                      >
                        <span className="mono">{String(row.ts ?? "")}</span>{" "}
                        <Badge tone={row.status === "published" ? "ok" : "neutral"}>
                          {String(row.status ?? "?")}
                        </Badge>{" "}
                        <code className="mono text-[var(--color-accent)]">
                          {String(row.task ?? "?")}
                        </code>{" "}
                        {row.commit ? (
                          <code className="mono text-muted">
                            {String(row.commit).slice(0, 10)}
                          </code>
                        ) : null}
                        {row.lesson ? (
                          <span className="ml-2 text-[var(--color-fg-secondary)]">
                            — {String(row.lesson)}
                          </span>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-muted text-xs">No CHANGELOG entries yet.</p>
                )}
              </div>
            </>
          ) : null}
        </div>
      </Dialog>
    </div>
  );
}
