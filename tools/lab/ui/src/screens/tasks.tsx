import type { VNode } from "preact";
import type { EpicRollup, RenderBundle, TaskRow } from "../types.js";
import { Age, BlindSpots, Empty, Unknown } from "../components.js";

/**
 * Screen 3 of PRD R5.2, and F5-S3's acceptance: rows keyed by Jira, links to Jira / GH / commit /
 * dev_history, the epic folding up its tasks and showing its PR — and NO LINK THAT LEADS NOWHERE.
 *
 * That last clause is the whole design. Every identifier on this page is either a link that resolves
 * or a stated absence; there is no third state. The temptations are specific and each one is refused:
 *
 *   · a task with a commit and no Jira status is `unknown`, not `Done`. The commit witnesses that code
 *     landed. It says nothing about what the tracker thinks, and the tracker is the only thing the
 *     status column claims to report. 92 of 101 rows are `unknown` — that is the state of the poll
 *     (C1: no Jira credentials, fed by hand), and a board that dressed it up as Done would be lying
 *     about the one column the owner reads to decide whether he can sleep.
 *   · an epic with no PR says so. It does not borrow its GitHub ISSUE number: issues and PRs share a
 *     numbering space, so the wrong link would not 404 — it would RESOLVE, on a real page that is not
 *     the thing the owner clicked. That is the worst failure mode available here.
 *   · the epic's task list comes from git topology (merge commit / branch), never from the PR body's
 *     checklist. Prose reports the epic we meant to ship; the topology reports the one we did.
 */

function PrChip({ e }: { e: EpicRollup }): VNode {
  // `data-pr` is the assertion surface: "none" is a claim the page makes out loud, so a test can hold
  // it to it. An epic that quietly rendered no PR cell would look identical to one whose PR we forgot.
  if (!e.pr || !e.pr.url || e.pr.number == null) {
    return (
      <span class="dim" data-pr="none">
        no PR — {e.pr_why ?? "none names this epic"}
      </span>
    );
  }
  const state = (e.pr.state ?? "").toLowerCase();
  return (
    <span data-pr={String(e.pr.number)}>
      <a href={e.pr.url}>#{e.pr.number}</a> <span class={"tag pr-" + (state || "unknown")}>{e.pr.state ?? "state unknown"}</span>
    </span>
  );
}

function Epic({ e, known, built }: { e: EpicRollup; known: Set<string>; built: number }): VNode {
  const counts = Object.entries(e.by_status);
  return (
    <details class="epic" data-epic={e.key} data-membership={e.membership} open={!e.merged}>
      <summary>
        <a href={e.jira_url}>{e.key}</a>{" "}
        {e.gh_url && e.gh_number != null ? (
          <a class="mono dim" href={e.gh_url}>
            #{e.gh_number}
          </a>
        ) : null}{" "}
        <span class="epic-sum">{e.summary ?? <span class="dim">no summary — the tracker has never been polled for this epic</span>}</span>{" "}
        <PrChip e={e} />
        <span class="dim">
          {" · "}
          {e.task_count} task{e.task_count === 1 ? "" : "s"}
          {counts.length > 0 ? " · " : ""}
          {counts.map(([k, v]) => `${v} ${k}`).join(" · ")}
        </span>
      </summary>

      {e.tasks.length === 0 ? (
        <Empty>
          No task commit is attributable to this epic. {e.membership_why}.
        </Empty>
      ) : (
        <p class="mono">
          {e.tasks.map((k, i) => (
            <span key={k}>
              {i > 0 ? " · " : ""}
              {/* Only keys that HAVE a row are linked. An anchor to a row that does not exist is a link
                  that leads nowhere, which this screen is not allowed to ship. */}
              {known.has(k) ? <a href={"#task-" + k}>{k}</a> : <span class="dim">{k}</span>}
            </span>
          ))}
        </p>
      )}
      <p class="dim">
        {e.commits} commit{e.commits === 1 ? "" : "s"} · membership {e.membership_why}.
      </p>
    </details>
  );
}

/* Spec section 7.2 ("Цветные — только оценка") grants judgement colour to exactly three Jira
   statuses: Done → --ok, To Do → --warn, In Progress → --info. Anything else a tracker may carry
   (In Review, Blocked…) is not in the table and stays neutral — colour is earned, never default.
   The tone rides a scoped "st" class (mirroring the sev badge idiom) so that .tag.info can never
   exist as a bare pair and leak onto the timeline's sev column, which spec 7.2 keeps neutral. */
const STATUS_TONE: Record<string, string> = {
  Done: "ok",
  "To Do": "warn",
  "In Progress": "info",
};

function Row({ r, built, gh }: { r: TaskRow; built: number; gh: boolean }): VNode {
  return (
    <tr id={"task-" + r.key}>
      <td class="mono">
        <a href={r.jira_url}>{r.key}</a>
      </td>
      <td class="mono">
        {r.gh_url && r.gh_number != null ? (
          <a href={r.gh_url}>#{r.gh_number}</a>
        ) : gh ? (
          // The mirror WAS read, and this key is not in it: the issue was never opened. An empty cell
          // is the honest report of that; a link would have to be invented to fill it.
          <span class="dim" title="no GitHub issue mirrors this key">
            —
          </span>
        ) : (
          ""
        )}
      </td>
      <td>
        {r.status ? (
          <span class={STATUS_TONE[r.status] ? `tag st ${STATUS_TONE[r.status]}` : "tag"}>
            {r.status}
          </span>
        ) : (
          <Unknown why="no tracker.issue.updated event has ever carried a status for this key — and a commit is not a status" />
        )}{" "}
        {r.status_ts ? <Age ts={r.status_ts} built={built} /> : null}
      </td>
      <td>{r.summary ?? ""}</td>
      <td class="mono">
        {r.commits.map((c, i) => (
          <span key={c.sha} title={c.subject}>
            {i > 0 ? " " : ""}
            {c.url ? <a href={c.url}>{c.sha}</a> : c.sha}
          </span>
        ))}
      </td>
      <td class="mono">
        {r.dev_history.map((d, i) => (
          <span key={d.href}>
            {i > 0 ? <br /> : null}
            <a href={d.href}>{d.name.replace(/\.md$/, "")}</a>
          </span>
        ))}
      </td>
      <td class="mono">
        {/* GSL-130: the bundle lists a task's merge PR twice (same url, same number), so this column
            rendered #134#134 — one token to the eye, with no space between the two anchors and so no
            soft-wrap point either, the same adjacency hazard GSL-100 measured on the nav. De-duped by
            url, an identical PR is shown once; a genuine second PR would still render, separated. The
            bundle keeps its duplicate — this is the view refusing to repeat one identical link, not a
            data edit (the data layer is out of the reface's scope). */}
        {[...new Map(r.prs.map((p) => [p.url, p])).values()].map((p, i) => (
          <span key={p.url}>
            {i > 0 ? " " : ""}
            <a href={p.url}>#{p.number}</a>
          </span>
        ))}
      </td>
    </tr>
  );
}

export function Tasks({ b }: { b: RenderBundle }): VNode {
  const t = b.tasks;
  const built = Date.parse(b.generated_at);
  const known = new Set(t.rows.map((r) => r.key));

  return (
    <>
      <div class="grid">
        {Object.entries(t.by_status).map(([k, v]) => (
          <div class="kpi" key={k}>
            <b>{v}</b>
            <span>{k}</span>
          </div>
        ))}
      </div>

      {/* The board is only as true as its last poll. Saying "3 To Do" over data from last Tuesday is
          a number from the past wearing the present tense — and GSL-94's work-remaining clock refuses
          it for exactly this reason. The age below KEEPS AGING while the page is open (F5-S3), because
          a staleness figure frozen at build time understates itself by however long the owner slept. */}
      {t.tracker_stale ? (
        <div class="card">
          <span class="stale-note">Tracker statuses are stale.</span>{" "}
          {t.tracker_last_polled ? (
            <>
              {/* GSL-132: this slot follows a verb, so it takes "ago" — "Last polled 7d 20h old" was
                  the one place the default suffix produced a sentence no one would say. The mobile
                  projection already wrote "ago" for the same fact. */}
              Last polled <Age ts={t.tracker_last_polled} built={built} suffix="ago" /> (
              {t.tracker_last_polled}).
            </>
          ) : (
            <>The tracker has never been polled on this machine.</>
          )}{" "}
          The status column below is whatever Jira said <i>then</i> — the laboratory holds no Jira
          credentials (C1), so <code>poll-fill</code> is fed by hand. Commits and dev_history are read
          from the repository and are current. <b>A commit is never read as a status:</b> a row with a
          commit and no poll stays <code>unknown</code>.
        </div>
      ) : null}

      <h2>Epics — {t.epics.length}</h2>
      {t.epics.length === 0 ? (
        <Empty>
          Git shows no epic branch and no epic merge commit, so there is nothing to roll up. (One
          branch per epic is the invariant this rollup reads; without it, membership is not knowable.)
        </Empty>
      ) : (
        t.epics.map((e) => <Epic key={e.key} e={e} known={known} built={built} />)
      )}

      <h2>Board — {t.rows.length} tasks</h2>
      {t.rows.length === 0 ? (
        <Empty>
          No task has ever reached the event log. Either nothing has been delivered, or nothing polls
          the tracker.
        </Empty>
      ) : (
        <div class="wrap">
          <table>
            <tr>
              <th>key</th>
              <th>gh</th>
              <th>status</th>
              <th>summary</th>
              <th>commits</th>
              <th>dev_history</th>
              <th>pr</th>
            </tr>
            {t.rows.map((r) => (
              <Row key={r.key} r={r} built={built} gh={t.gh_issue_links} />
            ))}
          </table>
        </div>
      )}

      {t.gh_issue_links ? null : <BlindSpots items={[t.gh_why]} />}
    </>
  );
}
