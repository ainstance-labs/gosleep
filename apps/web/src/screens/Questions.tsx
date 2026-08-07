// @gosleep/web — Questions screen (GSL-265 read-only; GSL-268 interactive).
//
// The folded question queue with two working write actions:
//   - "Answer" opens a text-field dialog → POST /actions/questions/answer.
//   - "Mark resolved" opens a text-field dialog → POST /actions/questions/resolve
//     (v1 always non-early — an early resolve is the tick's job via apply-due, not owner-facing).
//
// Both actions:
//   - Bearer + Idempotency-Key (both handled inside CoreClient.postAction).
//   - Optimistic UX via TanStack Query invalidation on success (SSE fan-out lands within ~1 s).
//   - Toast on success ("answered {qid}"), error toast on failure.
//   - Answer button only surfaces on status='open'; Resolve on status ∈ {'open','answered'}.

import { useState } from "react";

import { Card, CardBody, CardHeader, CardTitle } from "../components/ui/Card";
import { PageHeader } from "../components/PageHeader";
import { QueryStatus } from "../components/QueryStatus";
import {
  useAnswerQuestion,
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

export function QuestionsScreen() {
  const [status, setStatus] = useState<string>("");
  const q = useQuestions(status.length > 0 ? status : undefined);
  const { push: pushToast } = useToast();

  const [answerDialog, setAnswerDialog] = useState<AnswerDialogState | null>(null);
  const [resolveDialog, setResolveDialog] = useState<ResolveDialogState | null>(null);

  const answerMut = useAnswerQuestion();
  const resolveMut = useResolveQuestion();

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

  return (
    <div className="space-y-5">
      <PageHeader
        title="Questions"
        subtitle="Interactive queue: answer open questions or mark them resolved. Every action lands in server_intents + fans out on SSE."
        right={
          <div className="flex gap-1">
            {[
              ["", "All"],
              ["open", "Open"],
              ["answered", "Answered"],
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
              const canResolve =
                question.status === "open" || question.status === "answered";
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
                      </div>
                    ) : null}

                    {(canAnswer || canResolve) ? (
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
                        {canResolve ? (
                          <Button
                            variant="outline"
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
    </div>
  );
}
