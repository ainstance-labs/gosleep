// @gosleep/web — Questions screen (GSL-265 read-only; GSL-268 answer/resolve;
// GSL-277 apply-manifest + provenance badge; GSL-278 defer + countdown).
//
// Four owner-facing actions on each open question:
//   - "Answer"            → POST /actions/questions/answer          (typed text answer, by='owner-web').
//   - "Apply manifest"    → POST /actions/questions/apply-manifest  (owner picks a rule from
//                            docs/lab/decisions/manifest.md; provenance columns record it).
//   - "Defer"             → POST /actions/questions/defer           (optional auto-reopen ts;
//                            deferred rows show a countdown when defer_until is set).
//   - "Mark resolved"     → POST /actions/questions/resolve         (non-early; final closure).
//
// The provenance badge on every answered row names WHO answered the question — 'manifest',
// 'owner', 'orchestrator', or '(unknown)' for legacy rows without applied_by set. When the
// row cites a manifest rule (applied_by='manifest'), the badge is clickable and expands into
// a tooltip showing the parsed rule body from `useManifest()`.

import { useEffect, useMemo, useState } from "react";

import { Card, CardBody, CardHeader, CardTitle } from "../components/ui/Card";
import { PageHeader } from "../components/PageHeader";
import { QueryStatus } from "../components/QueryStatus";
import {
  useAnswerQuestion,
  useApplyManifest,
  useDeferQuestion,
  useManifest,
  useQuestions,
  useResolveQuestion,
} from "../data/queries";
import { Badge } from "../components/ui/Badge";
import { Button } from "../components/ui/Button";
import { Dialog } from "../components/ui/Dialog";
import { useToast } from "../components/ui/Toast";
import { timeAgo } from "../lib/format";
import { cn } from "../lib/cn";

type StatusTone = "info" | "ok" | "warn" | "neutral" | "danger" | "accent";
const TONE: Record<string, StatusTone> = {
  open: "warn",
  answered: "ok",
  resolved: "accent",
  superseded: "neutral",
  deferred: "info",
};

interface AnswerDialogState {
  qid: string;
  question: string;
  value: string;
}

interface ResolveDialogState {
  qid: string;
  question: string;
  value: string;
}

interface DeferDialogState {
  qid: string;
  question: string;
  duration: DeferDurationKey;
  customIso: string;
}

interface ApplyManifestDialogState {
  qid: string;
  question: string;
  selectedRuleId: string;
  answerOverride: string;
}

// -----------------------------------------------------------------------------
// helpers
// -----------------------------------------------------------------------------

type DeferDurationKey =
  | "no-timer"
  | "30m"
  | "2h"
  | "tomorrow-10am"
  | "next-week"
  | "custom";

function isoNowPlus(seconds: number): string {
  const d = new Date(Date.now() + seconds * 1000);
  return d.toISOString();
}

function tomorrowAt10Iso(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(10, 0, 0, 0);
  return d.toISOString();
}

function nextWeekMondayAt10Iso(): string {
  const d = new Date();
  const day = d.getDay(); // 0 = Sun
  const daysUntilMonday = (8 - day) % 7 || 7;
  d.setDate(d.getDate() + daysUntilMonday);
  d.setHours(10, 0, 0, 0);
  return d.toISOString();
}

function deferKeyToIso(key: DeferDurationKey, custom: string): string | null {
  switch (key) {
    case "no-timer":
      return null;
    case "30m":
      return isoNowPlus(30 * 60);
    case "2h":
      return isoNowPlus(2 * 60 * 60);
    case "tomorrow-10am":
      return tomorrowAt10Iso();
    case "next-week":
      return nextWeekMondayAt10Iso();
    case "custom":
      // Empty custom => no timer (mirrors CLI semantics).
      return custom.trim().length > 0 ? custom.trim() : null;
    default:
      return null;
  }
}

function formatCountdown(untilIso: string): string {
  const total = new Date(untilIso).getTime() - Date.now();
  if (Number.isNaN(total) || total <= 0) return "reopening…";
  const secs = Math.floor(total / 1000);
  const hours = Math.floor(secs / 3600);
  const minutes = Math.floor((secs % 3600) / 60);
  const seconds = secs % 60;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

/** Live countdown: re-renders once a second so the timer visible in the UI stays honest. */
function useTicker(intervalMs: number = 1000): number {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return tick;
}

// -----------------------------------------------------------------------------
// provenance badge — small, hoverable, cites the manifest §N.bullet when applicable
// -----------------------------------------------------------------------------

interface ProvenanceBadgeProps {
  applied_by: string | null | undefined;
  applied_rule_ref: string | null | undefined;
  manifestBody?: string; // resolved body of the cited rule, for a title/tooltip.
}

function ProvenanceBadge({
  applied_by,
  applied_rule_ref,
  manifestBody,
}: ProvenanceBadgeProps) {
  if (!applied_by) return null;
  if (applied_by === "manifest") {
    return (
      <Badge
        tone="accent"
        title={
          manifestBody !== undefined
            ? `${applied_rule_ref}\n\n${manifestBody}`
            : (applied_rule_ref ?? "manifest")
        }
      >
        applied by manifest{applied_rule_ref ? ` · ${applied_rule_ref}` : ""}
      </Badge>
    );
  }
  return (
    <Badge tone={applied_by === "owner" ? "ok" : "neutral"} title={applied_by}>
      applied by {applied_by}
    </Badge>
  );
}

// -----------------------------------------------------------------------------
// screen
// -----------------------------------------------------------------------------

export function QuestionsScreen() {
  const [status, setStatus] = useState<string>("");
  const q = useQuestions(status.length > 0 ? status : undefined);
  const manifest = useManifest();
  const { push: pushToast } = useToast();

  const [answerDialog, setAnswerDialog] = useState<AnswerDialogState | null>(null);
  const [resolveDialog, setResolveDialog] = useState<ResolveDialogState | null>(null);
  const [deferDialog, setDeferDialog] = useState<DeferDialogState | null>(null);
  const [applyDialog, setApplyDialog] = useState<ApplyManifestDialogState | null>(null);

  const answerMut = useAnswerQuestion();
  const resolveMut = useResolveQuestion();
  const deferMut = useDeferQuestion();
  const applyMut = useApplyManifest();

  useTicker(1000); // re-render every second so the defer countdown updates.

  const manifestById = useMemo(() => {
    const map = new Map<string, string>();
    if (manifest.data !== undefined) {
      for (const r of manifest.data.rules) map.set(r.id, r.body);
    }
    return map;
  }, [manifest.data]);

  const submitAnswer = async (): Promise<void> => {
    if (answerDialog === null) return;
    const trimmed = answerDialog.value.trim();
    if (trimmed.length === 0) return;
    try {
      const res = await answerMut.mutateAsync({
        qid: answerDialog.qid,
        answer: trimmed,
        by: "owner-web",
        channel: "web",
      });
      pushToast({
        title: `Answered ${answerDialog.qid}`,
        description: res.cached === true ? "cached replay (no re-run)" : "sent to lab-emit + DB",
        tone: "ok",
      });
      setAnswerDialog(null);
    } catch (err) {
      pushToast({
        title: `Answer failed for ${answerDialog.qid}`,
        description: err instanceof Error ? err.message : String(err),
        tone: "danger",
      });
    }
  };

  const submitResolve = async (): Promise<void> => {
    if (resolveDialog === null) return;
    const trimmed = resolveDialog.value.trim();
    if (trimmed.length === 0) return;
    try {
      const res = await resolveMut.mutateAsync({
        qid: resolveDialog.qid,
        applied: trimmed,
        early: false,
      });
      pushToast({
        title: `Resolved ${resolveDialog.qid}`,
        description: `status → ${res.result?.status ?? "resolved"}`,
        tone: "ok",
      });
      setResolveDialog(null);
    } catch (err) {
      pushToast({
        title: `Resolve failed for ${resolveDialog.qid}`,
        description: err instanceof Error ? err.message : String(err),
        tone: "danger",
      });
    }
  };

  const submitDefer = async (): Promise<void> => {
    if (deferDialog === null) return;
    const iso = deferKeyToIso(deferDialog.duration, deferDialog.customIso);
    try {
      const res = await deferMut.mutateAsync({
        qid: deferDialog.qid,
        defer_until: iso,
        by: "owner-web",
      });
      pushToast({
        title: `Deferred ${deferDialog.qid}`,
        description:
          res.result?.defer_until !== null && res.result?.defer_until !== undefined
            ? `reopens at ${res.result.defer_until}`
            : "no timer — reopen by hand",
        tone: "info",
      });
      setDeferDialog(null);
    } catch (err) {
      pushToast({
        title: `Defer failed for ${deferDialog.qid}`,
        description: err instanceof Error ? err.message : String(err),
        tone: "danger",
      });
    }
  };

  const submitApplyManifest = async (): Promise<void> => {
    if (applyDialog === null) return;
    if (applyDialog.selectedRuleId.length === 0) return;
    try {
      const res = await applyMut.mutateAsync({
        qid: applyDialog.qid,
        rule_ref: applyDialog.selectedRuleId,
        answer:
          applyDialog.answerOverride.trim().length > 0
            ? applyDialog.answerOverride.trim()
            : undefined,
        by: "owner-web",
      });
      pushToast({
        title: `Applied ${applyDialog.selectedRuleId}`,
        description: `qid ${applyDialog.qid} → ${res.result?.applied_rule_ref ?? applyDialog.selectedRuleId}`,
        tone: "ok",
      });
      setApplyDialog(null);
    } catch (err) {
      pushToast({
        title: `Apply-manifest failed for ${applyDialog.qid}`,
        description: err instanceof Error ? err.message : String(err),
        tone: "danger",
      });
    }
  };

  return (
    <div className="space-y-5">
      <PageHeader
        title="Questions"
        subtitle="Interactive queue: answer, apply a manifest rule, defer with an optional timer, or resolve. Every action lands in server_intents + fans out on SSE."
        right={
          <div className="flex flex-wrap gap-1">
            {[
              ["", "All"],
              ["open", "Open"],
              ["answered", "Answered"],
              ["deferred", "Deferred"],
              ["resolved", "Resolved"],
            ].map(([value, label]) => (
              <Button
                key={value}
                variant={status === value ? "solid" : "outline"}
                size="sm"
                onClick={() => setStatus(value ?? "")}
              >
                {label}
              </Button>
            ))}
          </div>
        }
      />

      <QueryStatus
        isPending={q.isPending}
        error={q.error}
        data={q.data}
        isEmpty={(d) => d.questions.length === 0}
        emptyMessage="No questions match the current filter."
      >
        {(d) => (
          <div className="grid grid-cols-1 gap-3">
            {d.questions.map((question) => {
              const tone: StatusTone = TONE[question.status] ?? "neutral";
              const canAnswer = question.status === "open";
              const canApply = question.status === "open";
              const canDefer =
                question.status === "open" || question.status === "answered";
              const canResolve =
                question.status === "open" || question.status === "answered";
              const provenanceBody =
                question.applied_rule_ref !== null && question.applied_rule_ref !== undefined
                  ? manifestById.get(question.applied_rule_ref)
                  : undefined;
              return (
                <Card key={question.qid}>
                  <CardHeader>
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge tone={tone}>{question.status}</Badge>
                      <span className="mono text-muted text-xs">{question.qid}</span>
                      {question.task !== null && question.task !== undefined ? (
                        <span className="mono text-[var(--color-accent)] text-xs">
                          {question.task}
                        </span>
                      ) : null}
                      <Badge tone="neutral">{question.kind}</Badge>
                      <ProvenanceBadge
                        applied_by={question.applied_by}
                        applied_rule_ref={question.applied_rule_ref}
                        manifestBody={provenanceBody}
                      />
                    </div>
                    <span className="text-muted text-xs">
                      opened {timeAgo(question.opened_at)}
                    </span>
                  </CardHeader>
                  <CardBody className="space-y-3">
                    <CardTitle>{question.question}</CardTitle>

                    {question.options !== null && question.options !== undefined ? (
                      <div className="sunken rounded-md p-3">
                        <div className="text-muted mb-1 text-xs uppercase tracking-wide">
                          Options
                        </div>
                        <pre className="mono text-secondary max-h-40 overflow-auto text-xs">
                          {typeof question.options === "string"
                            ? question.options
                            : JSON.stringify(question.options, null, 2)}
                        </pre>
                      </div>
                    ) : null}

                    {question.answer_text !== null &&
                    question.answer_text !== undefined &&
                    question.answer_text.length > 0 ? (
                      <div
                        className={cn(
                          "rounded-md border p-3",
                          "bg-[var(--color-ok-soft)] border-[color-mix(in_oklab,var(--color-ok),transparent_70%)]",
                        )}
                      >
                        <div className="text-muted mb-1 text-xs uppercase tracking-wide">
                          Answer
                        </div>
                        <p className="text-sm text-[var(--color-fg)]">{question.answer_text}</p>
                        {question.answered_at !== null &&
                        question.answered_at !== undefined ? (
                          <p className="text-muted mt-1 text-xs">
                            answered {timeAgo(question.answered_at)}
                          </p>
                        ) : null}
                        {question.applied_by === "manifest" &&
                        question.applied_rule_ref !== null &&
                        question.applied_rule_ref !== undefined ? (
                          <p className="mono text-[var(--color-accent)] mt-1 text-xs">
                            via {question.applied_rule_ref}
                            {provenanceBody !== undefined ? ` — ${provenanceBody}` : ""}
                          </p>
                        ) : null}
                      </div>
                    ) : null}

                    {question.status === "deferred" &&
                    question.defer_until !== null &&
                    question.defer_until !== undefined ? (
                      <div className="text-muted text-xs">
                        reopens in{" "}
                        <span className="mono text-[var(--color-fg)]">
                          {formatCountdown(question.defer_until)}
                        </span>{" "}
                        (
                        <span className="mono">{question.defer_until}</span>)
                      </div>
                    ) : question.status === "deferred" ? (
                      <div className="text-muted text-xs">
                        deferred, no timer — reopen by hand
                      </div>
                    ) : null}

                    {(canAnswer || canApply || canDefer || canResolve) ? (
                      <div className="flex flex-wrap gap-2 pt-1">
                        {canAnswer ? (
                          <Button
                            variant="solid"
                            size="sm"
                            onClick={() =>
                              setAnswerDialog({
                                qid: question.qid,
                                question: question.question,
                                value: "",
                              })
                            }
                          >
                            Answer
                          </Button>
                        ) : null}
                        {canApply ? (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() =>
                              setApplyDialog({
                                qid: question.qid,
                                question: question.question,
                                selectedRuleId: "",
                                answerOverride: "",
                              })
                            }
                            disabled={manifest.data === undefined}
                            title={
                              manifest.data === undefined
                                ? "manifest not loaded yet"
                                : "Apply a rule from docs/lab/decisions/manifest.md"
                            }
                          >
                            Apply manifest
                          </Button>
                        ) : null}
                        {canDefer ? (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() =>
                              setDeferDialog({
                                qid: question.qid,
                                question: question.question,
                                duration: "30m",
                                customIso: "",
                              })
                            }
                          >
                            Defer
                          </Button>
                        ) : null}
                        {canResolve ? (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() =>
                              setResolveDialog({
                                qid: question.qid,
                                question: question.question,
                                value: question.answer_text ?? "",
                              })
                            }
                          >
                            Mark resolved
                          </Button>
                        ) : null}
                      </div>
                    ) : null}
                  </CardBody>
                </Card>
              );
            })}
          </div>
        )}
      </QueryStatus>

      {/* Answer dialog — unchanged from GSL-268. */}
      <Dialog
        open={answerDialog !== null}
        onOpenChange={(o) => {
          if (!o) setAnswerDialog(null);
        }}
        title={`Answer ${answerDialog?.qid ?? ""}`}
        description={answerDialog?.question}
        footer={
          <>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setAnswerDialog(null)}
              disabled={answerMut.isPending}
            >
              Cancel
            </Button>
            <Button
              variant="solid"
              size="sm"
              onClick={() => void submitAnswer()}
              disabled={
                answerMut.isPending || (answerDialog?.value.trim().length ?? 0) === 0
              }
            >
              {answerMut.isPending ? "Answering…" : "Send answer"}
            </Button>
          </>
        }
      >
        <textarea
          className="surface mono w-full rounded-md p-2 text-sm"
          rows={4}
          autoFocus
          placeholder="Type the answer for the agent…"
          value={answerDialog?.value ?? ""}
          onChange={(e) =>
            setAnswerDialog((prev) =>
              prev === null ? prev : { ...prev, value: e.currentTarget.value },
            )
          }
        />
        <p className="text-muted mt-2 text-xs">
          Provenance: <code className="mono">owner-web</code> via <code className="mono">web</code> channel.
          Recorded in <code className="mono">server_intents</code> before the agent reads it.
        </p>
      </Dialog>

      {/* Resolve dialog — unchanged from GSL-268. */}
      <Dialog
        open={resolveDialog !== null}
        onOpenChange={(o) => {
          if (!o) setResolveDialog(null);
        }}
        title={`Resolve ${resolveDialog?.qid ?? ""}`}
        description={resolveDialog?.question}
        footer={
          <>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setResolveDialog(null)}
              disabled={resolveMut.isPending}
            >
              Cancel
            </Button>
            <Button
              variant="solid"
              size="sm"
              onClick={() => void submitResolve()}
              disabled={
                resolveMut.isPending || (resolveDialog?.value.trim().length ?? 0) === 0
              }
            >
              {resolveMut.isPending ? "Resolving…" : "Mark resolved"}
            </Button>
          </>
        }
      >
        <textarea
          className="surface mono w-full rounded-md p-2 text-sm"
          rows={3}
          autoFocus
          placeholder="What was applied to close this out?"
          value={resolveDialog?.value ?? ""}
          onChange={(e) =>
            setResolveDialog((prev) =>
              prev === null ? prev : { ...prev, value: e.currentTarget.value },
            )
          }
        />
        <p className="text-muted mt-2 text-xs">
          <code className="mono">lab-emit resolve</code> enforces manifest §2 (never before deadline unless <code className="mono">--early</code>);
          this button always resolves without <code className="mono">--early</code>.
        </p>
      </Dialog>

      {/* Apply-manifest dialog (GSL-277) — rule picker from parsed manifest. */}
      <Dialog
        open={applyDialog !== null}
        onOpenChange={(o) => {
          if (!o) setApplyDialog(null);
        }}
        title={`Apply a manifest rule to ${applyDialog?.qid ?? ""}`}
        description={applyDialog?.question}
        footer={
          <>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setApplyDialog(null)}
              disabled={applyMut.isPending}
            >
              Cancel
            </Button>
            <Button
              variant="solid"
              size="sm"
              onClick={() => void submitApplyManifest()}
              disabled={
                applyMut.isPending || (applyDialog?.selectedRuleId ?? "").length === 0
              }
            >
              {applyMut.isPending ? "Applying…" : "Apply rule"}
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <div className="text-muted text-xs">
            Rule is cited in the decision log as{" "}
            <code className="mono">applied_by=manifest</code> +{" "}
            <code className="mono">applied_rule_ref=&lt;id&gt;</code>. Provenance is recorded in
            both the DB and <code className="mono">docs/lab/decisions/log.jsonl</code>.
          </div>
          <div className="max-h-64 overflow-auto rounded-md border p-2 text-sm">
            {manifest.data === undefined ? (
              <p className="text-muted">Loading manifest…</p>
            ) : manifest.data.rules.length === 0 ? (
              <p className="text-muted">Manifest has no parseable rules.</p>
            ) : (
              <ul className="space-y-1">
                {manifest.data.rules.map((rule) => {
                  const selected = applyDialog?.selectedRuleId === rule.id;
                  return (
                    <li key={rule.id}>
                      <label
                        className={cn(
                          "flex cursor-pointer gap-2 rounded-md p-2",
                          selected
                            ? "bg-[color-mix(in_oklab,var(--color-accent),transparent_85%)]"
                            : "hover:bg-[color-mix(in_oklab,var(--color-fg),transparent_92%)]",
                        )}
                      >
                        <input
                          type="radio"
                          name="rule"
                          className="mt-1"
                          checked={selected}
                          onChange={() =>
                            setApplyDialog((prev) =>
                              prev === null
                                ? prev
                                : { ...prev, selectedRuleId: rule.id },
                            )
                          }
                        />
                        <div className="min-w-0 flex-1">
                          <div className="mono text-[var(--color-accent)] text-xs">
                            {rule.id}
                          </div>
                          <div className="text-sm">{rule.body}</div>
                          {rule.section_title.length > 0 ? (
                            <div className="text-muted text-xs">
                              §{rule.section} — {rule.section_title}
                            </div>
                          ) : null}
                        </div>
                      </label>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
          <textarea
            className="surface mono w-full rounded-md p-2 text-sm"
            rows={2}
            placeholder="Optional: override the answer text (default = the rule body)."
            value={applyDialog?.answerOverride ?? ""}
            onChange={(e) =>
              setApplyDialog((prev) =>
                prev === null ? prev : { ...prev, answerOverride: e.currentTarget.value },
              )
            }
          />
        </div>
      </Dialog>

      {/* Defer dialog (GSL-278) — duration picker with a custom-ISO override. */}
      <Dialog
        open={deferDialog !== null}
        onOpenChange={(o) => {
          if (!o) setDeferDialog(null);
        }}
        title={`Defer ${deferDialog?.qid ?? ""}`}
        description={deferDialog?.question}
        footer={
          <>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setDeferDialog(null)}
              disabled={deferMut.isPending}
            >
              Cancel
            </Button>
            <Button
              variant="solid"
              size="sm"
              onClick={() => void submitDefer()}
              disabled={deferMut.isPending}
            >
              {deferMut.isPending ? "Deferring…" : "Defer"}
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <div className="text-muted text-xs">
            The agent never learns you deferred — its long-poll keeps waiting until you actually
            answer. An empty timer means "not now" — you reopen by hand.
          </div>
          <div className="grid grid-cols-2 gap-2">
            {(
              [
                ["no-timer", "No timer"],
                ["30m", "30 minutes"],
                ["2h", "2 hours"],
                ["tomorrow-10am", "Tomorrow 10:00"],
                ["next-week", "Next Monday 10:00"],
                ["custom", "Custom ISO"],
              ] as Array<[DeferDurationKey, string]>
            ).map(([k, label]) => (
              <Button
                key={k}
                variant={deferDialog?.duration === k ? "solid" : "outline"}
                size="sm"
                onClick={() =>
                  setDeferDialog((prev) =>
                    prev === null ? prev : { ...prev, duration: k },
                  )
                }
              >
                {label}
              </Button>
            ))}
          </div>
          {deferDialog?.duration === "custom" ? (
            <input
              type="text"
              className="surface mono w-full rounded-md p-2 text-sm"
              placeholder="YYYY-MM-DDTHH:MM:SSZ (empty = no timer)"
              value={deferDialog?.customIso ?? ""}
              onChange={(e) =>
                setDeferDialog((prev) =>
                  prev === null ? prev : { ...prev, customIso: e.currentTarget.value },
                )
              }
            />
          ) : null}
        </div>
      </Dialog>
    </div>
  );
}
