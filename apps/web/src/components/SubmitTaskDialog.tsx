// @gosleep/web — Submit-task dialog (GSL-383, observer mode phase C).
//
// Owner opens this dialog from the "Submit task" button on a Fleet or Observed card
// where the session is `state='controlled' && shim_registered=true`. The dialog is a
// strict PRD-mapped surface:
//
//   * Multiline textarea, char counter, 16 KB cap enforced client-side too (server
//     is the real gate at R16.7 -- this is UX polish).
//   * Framing radio: none | prompt-boundary (default) | slash-command. See PRD scope.
//   * Debounced (500 ms) dry-run preview that runs on every body/framing change. The
//     preview payload shows `resolved_target` + `body_len` + `body_sha256` + `warnings`.
//   * "Send task" (confirm) button DISABLED until a fresh preview is loaded AND the
//     preview's body_sha256 matches the current textarea's body (else the server would
//     refuse with 428).
//   * Persistent banner: "Submitting writes into the session's tmux pane. This session
//     must be under panel control (Phase 15) and its shim must be registered." Two
//     advisory checkboxes ("I have Take control on this session" + "I understand this
//     cannot be recalled once delivered") -- v1 advisory, NOT hard gates (PRD § Scope).
//
// Idempotency-Key strategy per PRD F16-S4: the confirm POST must reuse the SAME key as
// the LAST successful dry-run. The dialog mints a fresh key AFTER the body/framing
// stabilises (see `previewKey` state below) so a debounced re-preview + confirm share
// exactly one key. If the body changes AFTER the confirm button is enabled, the key
// is discarded and a fresh preview + fresh key runs.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type {
  SubmissionFraming,
  SubmitTaskPreviewResult,
} from "@gosleep/schema";
import { Badge } from "./ui/Badge";
import { Button } from "./ui/Button";
import { Dialog } from "./ui/Dialog";
import { useToast } from "./ui/Toast";
import { useSubmitTask } from "../data/queries";
import { ApiError } from "@gosleep/sdk";

const MAX_BYTES = 16 * 1024;
const DEBOUNCE_MS = 500;

const FRAMING_LABELS: Record<SubmissionFraming, string> = {
  none: "None (send verbatim)",
  "prompt-boundary": "Wait for prompt (default, 5 s ceiling)",
  "slash-command": "Slash-command (advisory shape check)",
};

/** Byte length of a UTF-8 string in the browser -- TextEncoder is standard modern JS. */
export function utf8Bytes(s: string): number {
  return new TextEncoder().encode(s).byteLength;
}

/** Match the server's advisory secret-shape sweep -- keep in sync with
 *  apps/core/src/sessions/submit.ts scanForSecretShapes. Runs client-side too so the
 *  owner sees the warning even before the debounced preview lands. */
export function scanForSecretShapesClient(body: string): string[] {
  const messages: string[] = [];
  if (/(?:AKIA|ASIA|AGPA|AIDA|AROA|AIPA|ANPA|ANVA|ASCA)[0-9A-Z]{16}\b/.test(body)) {
    messages.push("Body contains something shaped like an AWS access key ID.");
  }
  if (/\bsk-ant-[A-Za-z0-9\-_]{20,}\b/.test(body)) {
    messages.push("Body contains an Anthropic-shaped API key (sk-ant-…).");
  }
  if (/\bsk-[A-Za-z0-9\-_]{20,}\b/.test(body)) {
    messages.push("Body contains an OpenAI-shaped API key (sk-…).");
  }
  if (/\b(?:ghp|ghs|gho|ghu|ghr)_[A-Za-z0-9]{20,}\b/.test(body)) {
    messages.push("Body contains a GitHub-shaped token (ghp_ / ghs_ / gho_).");
  }
  return messages;
}

/** Mint a fresh idempotency key per preview cycle. Same shape as the SDK's
 *  `stableIdempotencyKey` but freshly random per attempt. */
function mintKey(): string {
  const rand = crypto.getRandomValues(new Uint8Array(9));
  const hex = Array.from(rand)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return `submit-${hex}`;
}

export interface SubmitTaskDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sessionId: string;
  sessionName: string;
  paneRef: string | null;
}

interface PreviewState {
  key: string;
  body: string;
  framing: SubmissionFraming;
  preview: SubmitTaskPreviewResult | null;
  error: string | null;
  loading: boolean;
}

export function SubmitTaskDialog({
  open,
  onOpenChange,
  sessionId,
  sessionName,
  paneRef,
}: SubmitTaskDialogProps) {
  const submit = useSubmitTask();
  const { push: pushToast } = useToast();

  const [body, setBody] = useState("");
  const [framing, setFraming] = useState<SubmissionFraming>("prompt-boundary");
  const [ackControl, setAckControl] = useState(true);
  const [ackNoRecall, setAckNoRecall] = useState(false);
  const [previewState, setPreviewState] = useState<PreviewState | null>(null);
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Reset on close so a re-open doesn't leak previous state (or a previous key that
  // the server would treat as a preview for a DIFFERENT body_sha256).
  useEffect(() => {
    if (!open) {
      setBody("");
      setFraming("prompt-boundary");
      setPreviewState(null);
      setAckNoRecall(false);
      if (debounceTimer.current !== null) {
        clearTimeout(debounceTimer.current);
        debounceTimer.current = null;
      }
    }
  }, [open]);

  const byteLen = useMemo(() => utf8Bytes(body), [body]);
  const overCap = byteLen > MAX_BYTES;
  const bodyClientWarnings = useMemo(() => scanForSecretShapesClient(body), [body]);

  const runPreview = useCallback(
    async (nextBody: string, nextFraming: SubmissionFraming): Promise<void> => {
      // Skip empty / over-cap bodies -- no preview to run.
      if (nextBody.trim().length === 0 || utf8Bytes(nextBody) > MAX_BYTES) {
        setPreviewState(null);
        return;
      }
      const key = mintKey();
      setPreviewState({
        key,
        body: nextBody,
        framing: nextFraming,
        preview: null,
        error: null,
        loading: true,
      });
      try {
        const res = await submit.mutateAsync({
          sessionId,
          input: { body: nextBody, framing: nextFraming, dry_run: true },
          idempotencyKey: key,
        });
        const result = res.result as SubmitTaskPreviewResult | undefined;
        if (result === undefined || !("keystroke_bytes" in result)) {
          setPreviewState({
            key,
            body: nextBody,
            framing: nextFraming,
            preview: null,
            error: "preview response missing result field",
            loading: false,
          });
          return;
        }
        setPreviewState({
          key,
          body: nextBody,
          framing: nextFraming,
          preview: result,
          error: null,
          loading: false,
        });
      } catch (err) {
        // ApiError with a `reason` on the JSON body tells us WHY the guard fired.
        let msg = err instanceof Error ? err.message : String(err);
        if (err instanceof ApiError && typeof err.body === "string") {
          try {
            const parsed = JSON.parse(err.body) as { reason?: string; error?: string };
            if (typeof parsed.reason === "string" && parsed.reason.length > 0) {
              msg = `${parsed.reason}: ${parsed.error ?? msg}`;
            }
          } catch {
            /* ignore JSON parse noise */
          }
        }
        setPreviewState({
          key,
          body: nextBody,
          framing: nextFraming,
          preview: null,
          error: msg,
          loading: false,
        });
      }
    },
    [sessionId, submit],
  );

  // Debounced preview run on body / framing change.
  useEffect(() => {
    if (!open) return;
    if (debounceTimer.current !== null) clearTimeout(debounceTimer.current);
    debounceTimer.current = setTimeout(() => {
      void runPreview(body, framing);
    }, DEBOUNCE_MS);
    return () => {
      if (debounceTimer.current !== null) {
        clearTimeout(debounceTimer.current);
        debounceTimer.current = null;
      }
    };
  }, [body, framing, open, runPreview]);

  const previewReady =
    previewState !== null &&
    previewState.preview !== null &&
    previewState.body === body &&
    previewState.framing === framing;

  const submitting = submit.isPending && !previewState?.loading;

  const canConfirm =
    previewReady &&
    !overCap &&
    !submitting &&
    body.trim().length > 0 &&
    ackNoRecall;

  const onConfirm = async (): Promise<void> => {
    if (!canConfirm || previewState === null || previewState.preview === null) return;
    const key = previewState.key;
    try {
      const res = await submit.mutateAsync({
        sessionId,
        input: { body, framing, dry_run: false },
        idempotencyKey: key,
      });
      const result = res.result as
        | { outcome: string; submission_id: string; error: string | null }
        | undefined;
      if (result === undefined) {
        pushToast({
          title: "Submission response missing result",
          tone: "warn",
        });
        return;
      }
      if (result.outcome === "delivered") {
        pushToast({
          title: `Task delivered to ${sessionName}`,
          description: `submission_id=${result.submission_id}`,
          tone: "ok",
        });
        onOpenChange(false);
      } else {
        pushToast({
          title: `Task submission recorded but not delivered (outcome=${result.outcome})`,
          description: result.error ?? "Check the session's submission history drawer.",
          tone: "warn",
        });
        onOpenChange(false);
      }
    } catch (err) {
      let msg = err instanceof Error ? err.message : String(err);
      let reason: string | null = null;
      if (err instanceof ApiError && typeof err.body === "string") {
        try {
          const parsed = JSON.parse(err.body) as { reason?: string; error?: string };
          if (typeof parsed.reason === "string") reason = parsed.reason;
          if (typeof parsed.error === "string") msg = parsed.error;
        } catch {
          /* noop */
        }
      }
      pushToast({
        title: reason ? `Refused: ${reason}` : "Submission failed",
        description: msg,
        tone: "danger",
      });
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={`Submit task to ${sessionName}`}
      description="Writes the exact text below into the session's tmux pane. Preview refreshes automatically."
      footer={
        <>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onOpenChange(false)}
            disabled={submitting}
          >
            Cancel
          </Button>
          <Button
            size="sm"
            onClick={() => void onConfirm()}
            disabled={!canConfirm}
            data-testid="submit-task-confirm"
          >
            {submitting ? "Sending…" : "Send task"}
          </Button>
        </>
      }
    >
      <div className="space-y-4 px-4 py-3">
        {/* Persistent guardrail banner -- PRD § Scope "Guardrails". */}
        <div
          className="rounded-md border border-[color-mix(in_oklab,var(--color-warn),transparent_70%)] bg-[var(--color-warn-soft)] px-3 py-2 text-xs text-[var(--color-warn)]"
          role="note"
          data-testid="submit-task-banner"
        >
          Submitting writes into the session's tmux pane. The session must be under panel
          control (Phase 15) and its shim must be registered. Submissions cannot be
          recalled once delivered.
        </div>

        <label className="flex flex-col gap-1 text-xs text-[var(--color-fg-secondary)]">
          Task body (UTF-8, ≤ 16 KB)
          <textarea
            className="surface mono min-h-32 rounded-md px-2 py-1.5 text-sm"
            value={body}
            onChange={(e) => setBody(e.currentTarget.value)}
            placeholder="Type the exact text you want the receiving session to see at its next prompt…"
            data-testid="submit-task-body"
          />
          <div className="flex items-center justify-between text-[10px]">
            <span
              className={overCap ? "text-[var(--color-danger)]" : "text-muted"}
              data-testid="submit-task-bytes"
            >
              {byteLen.toLocaleString()} / {MAX_BYTES.toLocaleString()} bytes
              {overCap ? " — over cap; server will refuse" : ""}
            </span>
            <span className="text-muted">
              Target pane:{" "}
              <span className="mono">{paneRef ?? "resolving…"}</span>
            </span>
          </div>
        </label>

        <label className="flex flex-col gap-1 text-xs text-[var(--color-fg-secondary)]">
          Framing
          <select
            className="surface rounded-md px-2 py-1.5 text-sm"
            value={framing}
            onChange={(e) => setFraming(e.currentTarget.value as SubmissionFraming)}
            data-testid="submit-task-framing"
          >
            {(Object.keys(FRAMING_LABELS) as SubmissionFraming[]).map((f) => (
              <option key={f} value={f}>
                {FRAMING_LABELS[f]}
              </option>
            ))}
          </select>
        </label>

        {/* Preview panel. */}
        <div
          className="surface rounded-md border border-[var(--color-border-subtle)] p-3 text-xs"
          data-testid="submit-task-preview"
        >
          <div className="mb-2 flex items-center justify-between">
            <span className="text-secondary font-medium">Preview</span>
            {previewState === null ? (
              <Badge tone="neutral">idle</Badge>
            ) : previewState.loading ? (
              <Badge tone="info">running…</Badge>
            ) : previewState.error !== null ? (
              <Badge tone="danger">error</Badge>
            ) : previewReady ? (
              <Badge tone="ok">ready</Badge>
            ) : (
              <Badge tone="warn">stale (body changed)</Badge>
            )}
          </div>
          {previewState === null ? (
            <p className="text-muted">
              Type a task body above — the preview auto-refreshes every {DEBOUNCE_MS} ms.
            </p>
          ) : previewState.error !== null ? (
            <p className="text-[var(--color-danger)]">{previewState.error}</p>
          ) : previewState.preview !== null ? (
            <div className="space-y-2">
              <dl className="grid grid-cols-[110px_1fr] gap-y-1">
                <dt className="text-muted">Target</dt>
                <dd className="mono">
                  {previewState.preview.resolved_target ?? "— (pane pending)"}
                </dd>
                <dt className="text-muted">Bytes</dt>
                <dd className="mono">
                  {previewState.preview.body_len.toLocaleString()}
                </dd>
                <dt className="text-muted">SHA-256</dt>
                <dd className="mono text-[10px]" title={previewState.preview.body_sha256}>
                  {previewState.preview.body_sha256.slice(0, 16)}…
                </dd>
                <dt className="text-muted">Framing</dt>
                <dd className="mono">{previewState.preview.framing}</dd>
              </dl>
              <pre className="sunken max-h-40 overflow-auto rounded-md p-2 text-[11px] leading-4">
                {previewState.preview.keystroke_bytes}
              </pre>
              {previewState.preview.warnings.length > 0 || bodyClientWarnings.length > 0 ? (
                <div className="space-y-1">
                  {(previewState.preview.warnings.length > 0
                    ? previewState.preview.warnings.map((w) => w.message)
                    : bodyClientWarnings
                  ).map((msg, i) => (
                    <div
                      key={i}
                      className="rounded-md bg-[var(--color-warn-soft)] px-2 py-1 text-[var(--color-warn)]"
                      data-testid="submit-task-warning"
                    >
                      {msg}
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}
        </div>

        {/* Advisory checkboxes -- v1 non-blocking gates per PRD § Scope Guardrails row. */}
        <div className="space-y-1.5 text-xs">
          <label className="flex items-start gap-2">
            <input
              type="checkbox"
              checked={ackControl}
              onChange={(e) => setAckControl(e.currentTarget.checked)}
              className="mt-0.5"
            />
            <span className="text-secondary">
              I have Take-control on this session (advisory — server re-checks).
            </span>
          </label>
          <label className="flex items-start gap-2">
            <input
              type="checkbox"
              checked={ackNoRecall}
              onChange={(e) => setAckNoRecall(e.currentTarget.checked)}
              className="mt-0.5"
              data-testid="submit-task-ack-norecall"
            />
            <span className="text-secondary">
              I understand this submission cannot be recalled once delivered.
              <span className="text-[var(--color-danger)]"> (required to enable Send)</span>
            </span>
          </label>
        </div>
      </div>
    </Dialog>
  );
}
