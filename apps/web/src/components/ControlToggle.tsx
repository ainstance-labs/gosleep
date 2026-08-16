// @gosleep/web — Per-session control toggle (GSL-361, observer mode phase B).
//
// Renders the three-state pill (observer / controlled / env-locked) + a Take-control or
// Release-control affordance depending on state and shim_registered. Consumed by both the
// Fleet and Observed screens.
//
// State matrix per PRD § Scope table:
//   * env-locked    → pill "env-locked" (padlock semantic, `warn` tone); no button — tooltip
//                     explains that the session must be restarted in a shell without the flag.
//   * controlled + runtime → pill "controlled"; button "Release control".
//   * observer + shim_registered=true → pill "observer"; button "Take control".
//   * observer + shim_registered=false → pill "observer"; button DISABLED with tooltip
//                                        (R15.7: cannot flip state without the shim).
//
// Every state change fires a confirmation-free mutation (`useTakeControl` / `useReleaseControl`),
// but the mutation is idempotent (server-side Idempotency-Key). SSE fan-out from the write
// endpoint invalidates the fleet + session-control buckets so a second tab sees the flip within
// one round-trip (F15-S3, sub-second cutover).

import { Badge } from "./ui/Badge";
import { Button } from "./ui/Button";
import { useReleaseControl, useTakeControl } from "../data/queries";

export interface ControlToggleProps {
  sessionId: string;
  state: "observer" | "controlled" | undefined;
  source: "env" | "runtime" | "inherited" | null | undefined;
  shimRegistered: boolean | undefined;
  envLocked: boolean | undefined;
  /** Compact layout squeezes both pill + button onto a single flex row (default). */
  compact?: boolean;
}

const TOOLTIP_ENV_LOCKED =
  "Session started with GOSLEEP_WEB_QUESTIONS=1. Release it by restarting in a shell without the flag.";
const TOOLTIP_NO_SHIM =
  "Shim has not checked in yet — cannot take control until the session fires a hook (this happens on the first AskUserQuestion or PermissionRequest event).";
const TOOLTIP_TAKE =
  "Route this session's AskUserQuestion + PermissionRequest events to the panel. Reverse with Release control.";
const TOOLTIP_RELEASE =
  "Send this session back to the terminal for AskUserQuestion + PermissionRequest events. The next event lands in the local TUI dialog.";

export function ControlToggle(props: ControlToggleProps) {
  const {
    sessionId,
    state,
    source,
    shimRegistered,
    envLocked,
    compact = true,
  } = props;
  const takeControl = useTakeControl();
  const releaseControl = useReleaseControl();

  // Derive effective props with defaults for undefined shapes (an older API response missing
  // the fields collapses to a safe "observer, cannot take" — the panel will still render).
  const effectiveState = state ?? "observer";
  const shimReg = shimRegistered ?? false;
  const isEnvLocked =
    envLocked ??
    (effectiveState === "controlled" && source === "env");

  const busy = takeControl.isPending || releaseControl.isPending;

  const onTake = (): void => {
    if (busy) return;
    takeControl.mutate({ session_id: sessionId, by: "owner-web", channel: "web" });
  };
  const onRelease = (): void => {
    if (busy) return;
    releaseControl.mutate({ session_id: sessionId, by: "owner-web", channel: "web" });
  };

  return (
    <div
      className={compact ? "inline-flex items-center gap-2" : "flex flex-col gap-1.5"}
      data-testid="control-toggle"
    >
      {isEnvLocked ? (
        <Badge tone="warn" title={TOOLTIP_ENV_LOCKED} data-testid="control-pill-env">
          env-locked
        </Badge>
      ) : effectiveState === "controlled" ? (
        <Badge tone="accent" title="Session is under panel control" data-testid="control-pill-controlled">
          controlled
        </Badge>
      ) : (
        <Badge tone="neutral" title="Session is observed only" data-testid="control-pill-observer">
          observer
        </Badge>
      )}

      {/* Take / Release affordances — env-locked rows show no button (only the pill's tooltip
          explains what to do). */}
      {!isEnvLocked ? (
        effectiveState === "controlled" ? (
          <Button
            size="sm"
            variant="outline"
            onClick={onRelease}
            disabled={busy}
            title={TOOLTIP_RELEASE}
            data-testid="control-release-btn"
          >
            {releaseControl.isPending ? "Releasing…" : "Release control"}
          </Button>
        ) : (
          <Button
            size="sm"
            variant="outline"
            onClick={onTake}
            disabled={busy || !shimReg}
            title={shimReg ? TOOLTIP_TAKE : TOOLTIP_NO_SHIM}
            data-testid="control-take-btn"
          >
            {takeControl.isPending ? "Taking…" : "Take control"}
          </Button>
        )
      ) : null}
    </div>
  );
}
