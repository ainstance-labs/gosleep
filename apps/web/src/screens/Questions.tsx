// @gosleep/web — Questions screen (READ-ONLY, GSL-265).
//
// The full question queue. Read-only in this task; the "answer" button lands with GSL-268.
// A status pill + a compact card per question so the owner can scan open questions at a
// glance. Answered / resolved rows go into a lower-density secondary section.

import { useState } from "react";

import { Card, CardBody, CardHeader, CardTitle } from "../components/ui/Card";
import { PageHeader } from "../components/PageHeader";
import { QueryStatus } from "../components/QueryStatus";
import { useQuestions } from "../data/queries";
import { Badge } from "../components/ui/Badge";
import { Button } from "../components/ui/Button";
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

export function QuestionsScreen() {
  const [status, setStatus] = useState<string>("");
  const q = useQuestions(status.length > 0 ? status : undefined);

  return (
    <div className="space-y-5">
      <PageHeader
        title="Questions"
        subtitle="The folded question queue. Answer buttons ship with a later task; this view is read-only."
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
              return (
                <Card key={question.qid}>
                  <CardHeader>
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge tone={tone}>{question.status}</Badge>
                      <span className="mono text-muted text-xs">{question.qid}</span>
                      {question.task !== null ? (
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
                  </CardBody>
                </Card>
              );
            })}
          </div>
        )}
      </QueryStatus>
    </div>
  );
}
