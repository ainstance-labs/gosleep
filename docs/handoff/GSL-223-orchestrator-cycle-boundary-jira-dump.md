# GSL-223 — cycle-boundary step for the orchestrator: a JQL dump for poll-fill

Prepared by impl-179 (epic GSL-179). The cycle-boundary checklist lives in the SOVEREIGN global
skill `orchestrating-delivery-agents` — workers are forbidden to edit it. This document is the
ready step text for the orchestrator/owner, after the GSL-195 errata template. The mechanics on
the repository side already work (poll-fill.py picks up the dump itself); what is missing is only
the habit of saving it.

## What to add to the cycle-boundary checklist (ready step text)

```
- Jira dump for poll-fill (GSL-223): save a fresh task dump into
  docs/lab/scratch/jira-poll.json — ONE Atlassian MCP call:
  searchJiraIssuesUsingJql(cloudId, jql="project = GSL ORDER BY key ASC",
  fields=["summary","status","updated"], maxResults=100, nextPageToken=<paginate to the end>),
  the result — a FLAT array [{"key","status","updated","summary"}] (raw REST form is also
  accepted). The file in scratch/ (gitignored) is a transport, not history; history is
  written by poll-fill with tracker.issue.updated events (src=poll-fill).
```

## Why this is the orchestrator's work

The lab holds no Jira keys (C1) and there is no Jira CLI on the machine — the tracker is
reachable only via MCP, which the orchestrator and workers have but the mechanical poll-fill does
not. Finding 12 (MAJOR): 152 of 161 tasks without a status, the tracker was not polled for 11
days, the whole Jira cross-check branch was built and simply was not wired to the data.

## What is already done on the repository side (GSL-223, branch GSL-179-token-ceiling)

- `poll-fill.py from_jira()`: three sources in order — `--jira-json FILE`, acli/jira CLI,
  **auto pickup of `docs/lab/scratch/jira-poll.json`**. The dump is used LOUDLY: the report
  carries `jira_feed` with the file's age ("scratch dump … (age 3.2h)") — "cross-checked with
  last Tuesday's dump" and "cross-checked with the tracker" do not look the same.
- The chronicler unchanged: its standard step 0 (poll-fill) gets the Jira branch automatically as
  soon as the dump is in place. The future GSL-176 tick — too, with no new code.

## Note on --no-poll in the gates (the second half of finding 12)

The shift gate run (`chronicler.sh --no-poll`) turns the cross-check off entirely. This is
intentional for worker commit gates (do not mutate the shared events log from under tasks), but
AT LEAST ONE standard pass on the orchestrator's cycle boundary must go WITHOUT `--no-poll` —
otherwise the dump lies there while the branch is not wired to it. Recommendation into the same
checklist: on the cycle boundary, after saving the dump, run `bash tools/lab/chronicler.sh`
(without --no-poll).

## Bootstrap caveat

By default poll-fill cuts off "prehistory" (facts older than the first line of the events log) —
counts aloud, does not write. If after the first dump the share of unknown on the Tasks screen
does not drop below 15 percent because of tasks whose last update is older than the log floor —
run `bash tools/lab/poll-fill.sh --prehistory` once (a one-time bootstrap, the flag exists
exactly for this).
