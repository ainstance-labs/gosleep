import type { VNode } from "preact";
import type { RenderBundle } from "../types.js";
import { BlindSpots, Empty, Unknown } from "../components.js";

/**
 * Screen 3 of PRD R5.2. F5-S3 (rows keyed by Jira, links to Jira / GH / commit / dev_history) is
 * GSL-96's acceptance; this is the board it lands on.
 *
 * Every cell here is EARNED. The GH column is absent — not blank-because-lazy, absent-on-purpose:
 * no machine-readable source on disk maps a Jira key to a GitHub issue number (the mirror lives in
 * handoff prose). A plausible link to the wrong issue is worse than no link at all, because the
 * owner clicks it once, lands somewhere wrong, and stops trusting the column that WAS right.
 */
export function Tasks({ b }: { b: RenderBundle }): VNode {
  const t = b.tasks;

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
          it for exactly this reason. */}
      {t.tracker_stale ? (
        <div class="card">
          <span class="stale-note">Tracker statuses are stale.</span>{" "}
          {t.tracker_last_polled ? (
            <>
              Last polled <b>{t.tracker_age_human}</b> ago ({t.tracker_last_polled}).
            </>
          ) : (
            <>The tracker has never been polled on this machine.</>
          )}{" "}
          The status column below is whatever Jira said <i>then</i> — the laboratory holds no Jira
          credentials (C1), so <code>poll-fill</code> is fed by hand. Commits and dev_history are read
          from the repository and are current.
        </div>
      ) : null}

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
              <th>status</th>
              <th>summary</th>
              <th>commits</th>
              <th>dev_history</th>
              <th>pr</th>
            </tr>
            {t.rows.map((r) => (
              <tr key={r.key}>
                <td class="mono">
                  <a href={r.jira_url}>{r.key}</a>
                </td>
                <td>
                  {r.status ? (
                    <span class="tag">{r.status}</span>
                  ) : (
                    <Unknown why="no tracker.issue.updated event has ever carried a status for this key" />
                  )}
                </td>
                <td>{r.summary ?? ""}</td>
                <td class="mono">
                  {r.commits.length === 0
                    ? ""
                    : r.commits.map((c, i) => (
                        <span key={c.sha}>
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
                  {r.prs.map((p) => (
                    <a key={p.number} href={p.url}>
                      #{p.number}
                    </a>
                  ))}
                </td>
              </tr>
            ))}
          </table>
        </div>
      )}

      <BlindSpots items={[t.gh_why]} />
    </>
  );
}
