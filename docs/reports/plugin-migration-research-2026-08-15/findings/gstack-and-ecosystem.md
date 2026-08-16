# gstack and the Claude Code plugin ecosystem — research findings

**Author:** res-gstack (research worker)
**Date:** 2026-08-15
**Scope:** Dissect the gstack install on this machine as a living plugin-pattern
reference; survey the wider Claude Code plugin/marketplace ecosystem; extract
patterns for a soft migration of gosleep's 7 owned skills to plugins.
**Read-only:** no writes anywhere except this file; nothing touched under `~/.claude/**`.

---

## TL;DR

**gstack is NOT a Claude Code plugin.** It's a git-clone-of-a-monorepo installed at
`~/.claude/skills/gstack/` (origin `https://github.com/garrytan/gstack.git`, HEAD
`c118e24`, VERSION `1.64.1.0`). It surfaces its skills to Claude by creating one
shim directory per skill under `~/.claude/skills/<name>/` whose `SKILL.md` is a
**symlink** back into the monorepo. Updates are self-managed: every skill's
preamble bash runs `bin/gstack-update-check` on session start, and `/gstack-upgrade`
is a skill that runs `git fetch && git reset --hard origin/main && ./setup`.

The official plugin/marketplace system is separate and stronger: `.claude-plugin/plugin.json`
+ `.claude-plugin/marketplace.json`, pinnable to a commit SHA per plugin, with a
first-party CLI (`claude plugin validate`, `claude plugin install`, `/plugin`) and
a documented version-cascade rule. gosleep's 7 skills are today in the same
shape as gstack (global skill directories under `~/.claude/skills/`, no version
manifest, no provenance) — the migration target is the plugin/marketplace model,
which is a strict superset of what gstack does today and gets us the versioning +
provenance we don't have.

---

## 1. What gstack IS on this machine

### 1.1 Install location & authoritative source

```
$ ls -la ~/.claude/skills/gstack/.git       # a full git repo, not a copy
drwxr-xr-x@ 15 romanlidovskyi ...  15 серп. 20:28 .git
$ cd ~/.claude/skills/gstack && git remote -v
origin  https://github.com/garrytan/gstack.git (fetch)
$ git rev-parse HEAD
c118e2402efbc661411f43606b1a84dc2295e5ef
$ cat VERSION
1.64.1.0
```

`~/.claude/skills/gstack/` is the source-of-truth checkout. `package.json`
declares `"name": "gstack", "version": "1.64.1.0"` — but this is the **repo's**
version, not a plugin manifest. There is **no `.claude-plugin/plugin.json`** in
the tree (grep-verified: gstack has zero files under `.claude-plugin/`).

### 1.2 How its skills surface to Claude Code — via symlinks

Every gstack skill is exposed by creating a plain directory under
`~/.claude/skills/<name>/` containing a single symlink named `SKILL.md` that
points into the monorepo:

```
$ ls -la ~/.claude/skills/browse/
lrwx------ SKILL.md -> /Users/romanlidovskyi/.claude/skills/gstack/browse/SKILL.md

$ ls -la ~/.claude/skills/_gstack-command/
lrwx------ SKILL.md -> /Users/romanlidovskyi/.claude/skills/gstack/SKILL.md

$ ls -la ~/.claude/skills/ship/
lrwx------ SKILL.md   -> /Users/romanlidovskyi/.claude/skills/gstack/ship/SKILL.md
lrwx------ sections   -> /Users/romanlidovskyi/.claude/skills/gstack/ship/sections
```

The router skill `_gstack-command` (frontmatter `name: gstack`, `preamble-tier: 1`)
is the entry point when the user just types `/gstack`. The wrapping directory
is created by `./setup`, not by Claude Code — Claude simply discovers whatever
lives under `~/.claude/skills/<name>/SKILL.md` and treats it as a global skill.

**Consequence for gosleep:** this is exactly the same "unversioned skill directory"
world our 7 skills live in today. Nothing about gstack's mechanism gives it
version-per-skill; the whole monorepo moves together.

### 1.3 The install/setup script

`~/.claude/skills/gstack/setup` (bash) is the installer. Its job is to
`_link_or_copy` each subdirectory of the gstack repo into
`~/.claude/skills/<name>/` — symlink on macOS/Linux, real copy on Windows (no
Developer Mode assumed). Supports multiple hosts (Claude Code, Codex, Kiro,
Factory, Opencode, Cursor, Slate) and a `--team` mode that pushes gstack into
`.claude/skills/gstack/` inside the current repo with an auto-update hook. Flags:
`--host <name>`, `--prefix`/`--no-prefix` (adds a `gstack-` prefix to skill names
if wanted), `--team`/`--no-team`.

The setup script is **the primary reason gosleep's local CLAUDE.md hard-bans
`./install.sh` on the gosleep skill/ tree** (owner rule 2026-07-20): a
whole-tree rsync overwrote authoritative global copies. gstack has the same
shape of risk with the same mitigation — the team is expected to run `./setup`
knowingly.

### 1.4 gstack update flow — deep dive on `/gstack-upgrade`

Source of truth: `~/.claude/skills/gstack/gstack-upgrade/SKILL.md`
(v1.1.0). Auto-check source: `~/.claude/skills/gstack/bin/gstack-update-check`.

**Detection.** Every skill's preamble (tier-1 preamble is present in
`_gstack-command/SKILL.md`, `browse/SKILL.md`, etc.) opens with:

```bash
_UPD=$(~/.claude/skills/gstack/bin/gstack-update-check 2>/dev/null || ...)
[ -n "$_UPD" ] && echo "$_UPD" || true
```

`gstack-update-check` fetches
`https://raw.githubusercontent.com/garrytan/gstack/main/VERSION` (a bodyless
receipted curl with a 5-second timeout, fail-open), compares to local
`VERSION`, and prints `UPGRADE_AVAILABLE <old> <new>` or `JUST_UPGRADED <old> <new>`.
There is explicit hardening for a documented incident (issue #1974) where a
silent crash was indistinguishable from up-to-date, so `set -E` + a trap emits
`CHECK_FAILED …` on crash. Throttled to once/hour via `~/.gstack/last-update-check`,
with per-version snooze escalating 24h → 48h → 1 week, or permanently disabled
via `update_check false`.

**Prompt.** When `UPGRADE_AVAILABLE`, the skill either auto-upgrades
(if `~/.gstack/config.yaml` has `auto_upgrade: true` or env `GSTACK_AUTO_UPGRADE=1`)
or `AskUserQuestion`s: "Yes / Always / Not now / Never ask again". "Always" flips
the auto flag; "Never" disables the check entirely.

**Perform.** For a git install (our case):

```bash
cd "$INSTALL_DIR"
STASH_OUTPUT=$(git stash 2>&1)
git fetch origin
git reset --hard origin/main
./setup
```

Then runs version-tagged migrations from `gstack-upgrade/migrations/v*.sh` for
every version between old and new (idempotent bash scripts, sorted by
`sort -V`), and finally reads `CHANGELOG.md` to produce a 5–7 bullet
"what's new" summary. The `git stash` is a small footgun for a hacked-on
install; the skill emits a warning telling the user to `git stash pop` — but
per gosleep memory *no-git-stash-in-shared-tree* this pattern is exactly what
killed live orchestrator patches on 2026-07-13 in our repo. Note-to-self:
gstack's upgrade path is safe *for gstack itself* because the tree is a pristine
clone; adopting the same pattern for a tree with local edits would repeat that
incident.

**Provenance the user actually gets.** After upgrade you know:
- current version = contents of `~/.claude/skills/gstack/VERSION` (dotted, e.g.
  `1.64.1.0`)
- what changed = the CHANGELOG.md diff between old and new, summarised inline
  by the upgrade skill
- what's actually on disk = `git log`, `git rev-parse HEAD` in the checkout.

**Provenance you do NOT get:** which individual *skill file* changed (nothing is
versioned per-skill). If only `browse/SKILL.md` moved between 1.64.0.0 and
1.64.1.0, that's visible only via git log, not via any skill metadata surfaced
to Claude.

### 1.5 Slash commands & namespacing

Because every gstack skill is a plain top-level entry under `~/.claude/skills/`,
every skill is invocable as `/skillname` — `/browse`, `/ship`, `/qa`. The
`_gstack-command` router surfaces itself as `/gstack` (frontmatter `name: gstack`).

There is a `SKILL_PREFIX` toggle in gstack config (`~/.gstack/config.yaml`) that
tells `./setup` to write skill dirs as `~/.claude/skills/gstack-<name>/` so
commands become `/gstack-review`, `/gstack-ship`. Default is unprefixed. The
prefix mode is the workaround for collisions.

**Collision behaviour today (as configured on this machine).** Since
gstack lives at `~/.claude/skills/browse/`, any *local* skill you drop at
`~/.claude/skills/browse/SKILL.md` overwrites the symlink. There is no name
scoping — first-write-wins on the filesystem. This is also how gosleep's
`skill/handoff/`, `skill/using-jira/`, etc. get global-mode:
`rsync -a skill/<name>/ ~/.claude/skills/<name>/` writes the same flat namespace.

**Contrast with plugin-installed skills** (see section 3): a plugin named
`code-reviewer` shipping a `skills/audit/SKILL.md` is surfaced by Claude as
`/code-reviewer:audit`, **namespaced by plugin name**. That is precisely the
missing safety valve that would let global `/handoff` coexist with a plugin
`/gosleep-delivery:handoff`.

---

## 2. The Claude Code plugin system on this machine

### 2.1 Local footprint

`~/.claude/plugins/` state files (verified):

```
installed_plugins.json     — 3 installed: context7@claude-plugins-official (git SHA pinned),
                             superpowers@claude-plugins-official v6.2.0, nx@nx-claude-plugins v0.2.34
known_marketplaces.json    — 2 marketplaces: anthropics/claude-plugins-official (last upd
                             2026-08-11), nrwl/nx-ai-agents-config
cache/                     — installed plugins, versioned per install
marketplaces/              — cached clones of marketplace repos
data/                      — per-plugin persistent data (CLAUDE_PLUGIN_DATA)
```

Both installed plugin manifests record `gitCommitSha` alongside `version` +
`installedAt` + `lastUpdated` — exactly the provenance gstack lacks.

### 2.2 A plugin, dissected

`~/.claude/plugins/marketplaces/claude-plugins-official/plugins/plugin-dev/`:

```
plugin-dev/
├── .claude-plugin/
│   └── plugin.json          # {"name","description","author"} — no version required
├── agents/                  # subagent .md files
├── commands/                # slash commands as .md files
├── skills/                  # skills as <name>/SKILL.md dirs
├── LICENSE
└── README.md
```

Sample `plugin.json` (skill-creator):

```json
{
  "name": "skill-creator",
  "description": "Create new skills, improve existing skills, ...",
  "author": {"name": "Anthropic", "email": "support@anthropic.com"}
}
```

Sample marketplace entry with pinning (from
`~/.claude/plugins/marketplaces/claude-plugins-official/.claude-plugin/marketplace.json`):

```json
{
  "name": "42crunch-api-security-testing",
  "source": {
    "source": "git-subdir",
    "url": "https://github.com/42Crunch-AI/claude-plugins.git",
    "path": "plugins/api-security-testing",
    "ref": "v1.5.5",
    "sha": "30287f5e3f122a646d1ac5ca3ab96e130c52a3ad"
  }
}
```

Both `ref` (branch/tag) and `sha` (40-char commit) can pin — when both are set,
`sha` wins. Community-approved plugins are pinned by SHA and CI bumps the pin
on push (documented in the community README).

### 2.3 Layout at the plugin root

Docs (https://code.claude.com/docs/en/plugins) list what a plugin may contain
at its root — `skills/`, `commands/`, `agents/`, `hooks/hooks.json`, `.mcp.json`,
`.lsp.json`, `monitors/monitors.json`, `bin/` (added to PATH while enabled),
`settings.json` (limited to `agent` and `subagentStatusLine`). `plugin.json`
lives in `.claude-plugin/` and NOTHING ELSE goes there — a common mistake the
docs explicitly call out.

Two important subtleties:

- **Single-skill plugins** may put `SKILL.md` at the plugin root without a
  `skills/` directory. The `name` field in the SKILL.md frontmatter becomes
  the invocation name.
- **Skill-bundle plugins** (like the `anthropics/skills` monorepo) can list
  skills externally, marketplace-side, using `"strict": false` and an
  explicit `skills: ["./skill-a", "./skill-b"]` array — no per-skill
  `plugin.json` needed.

### 2.4 Slash commands: namespacing & collision

From the docs, verbatim: "Plugin skills are always namespaced (like
`/my-first-plugin:hello`) to prevent conflicts when multiple plugins have skills
with the same name." Anecdotal proof in this very session's skill listing:
`superpowers:brainstorming`, `superpowers:executing-plans`, etc.

Explicit collision rule (from the migration section of the docs):

> Project and user `.claude/agents/` definitions **override** same-named
> plugin agents, so the plugin version only takes effect once the originals
> are removed. Plugin skills are namespaced as `/plugin-name:skill-name`,
> so the original `/skill-name` and the plugin copy **both remain available**
> rather than one overriding the other.

**Implication for the soft migration.** If we ship a plugin `gosleep-delivery`
containing a skill `handoff`, then a session that ALSO has global
`~/.claude/skills/handoff/` gets **both** `/handoff` (global) AND
`/gosleep-delivery:handoff` (plugin). Coexistence is free; the cutover is a
separate step. Agents are the opposite — local wins — so any agent files we
ship in the plugin need to know the local shadow rule.

### 2.5 Version management (the doc-mandated cascade)

Version comes from the first source that has one, in this order (from the
docs; paraphrased):

1. `plugin.json`'s `version` field
2. The marketplace entry's `version` field
3. For `archive`: the `sha256`
4. For git sources with `sha` pinned: the SHA
5. For `command` sources: a content hash of the printed directory
6. Otherwise: undefined; users don't get update notifications

Users only receive an update when whatever field is authoritative changes. So
the two live conventions in the wild are:

- **Sha-pinned marketplace entries** (Anthropic official style). The plugin
  itself doesn't need `version` in plugin.json; the marketplace entry
  carries the `sha` and updates flow when the marketplace repo bumps the
  pin. Both plugin and marketplace repos can be bumped independently.
- **Semver in plugin.json** (nx style — `0.2.34` visible in
  `installed_plugins.json`). Simpler for humans, but requires committer
  discipline to bump the manifest on every release.

Auto-bump automation: on submission to `anthropics/claude-plugins-community`,
CI updates the pinned SHA in the community catalog nightly from each source
repo (per the community README). Private marketplaces implement this
themselves — a common pattern is a GitHub Action that runs `claude plugin
validate ./plugins/*` and then rewrites the `sha` in `marketplace.json`.

### 2.6 CLI, install, reload

- `claude plugin init <name>` — scaffolds a plugin under `~/.claude/skills/<name>/`
  with `.claude-plugin/plugin.json` + starter `SKILL.md` (a plain skills-directory
  plugin that auto-loads with no marketplace).
- `claude plugin validate ./path` — same validator the community pipeline runs.
  `--strict` treats warnings as errors. **CI-ready.**
- `claude --plugin-dir ./path` — dev mode; loads without install; a
  `--plugin-dir` copy takes precedence over an installed same-named plugin.
- `claude --plugin-url https://…/plugin.zip` — install from CI-built zip.
- `/plugin marketplace add owner/repo` — user-side install of a marketplace.
- `/plugin install <name>@<marketplace>` — pick a plugin from a registered
  marketplace.
- `/reload-plugins` — pick up in-place edits without a restart.

---

## 3. Marketplace schema — what a private team catalog looks like

Consolidated from `code.claude.com/docs/en/plugin-marketplaces` +
`anthropics/claude-plugins-official/.claude-plugin/marketplace.json` (both
verified in-tree copies).

### 3.1 Minimum viable marketplace.json

```json
{
  "$schema": "https://anthropic.com/claude-code/marketplace.schema.json",
  "name": "gosleep-plugins",
  "description": "gosleep team delivery skills",
  "owner": {"name": "gosleep", "email": "rommxx@gmail.com"},
  "plugins": [
    {
      "name": "gosleep-delivery",
      "source": "./plugins/gosleep-delivery",
      "description": "Epic+Task workflow, Jira, handoff, PRDs",
      "version": "0.1.0"
    }
  ]
}
```

Marketplace-level required fields: `name`, `owner`, `plugins`. Reserved names
that CANNOT be used (verbatim from the docs): `claude-code-marketplace`,
`claude-code-plugins`, `claude-plugins-official`, `claude-plugins-community`,
`claude-community`, `anthropic-marketplace`, `anthropic-plugins`,
`agent-skills`, `anthropic-agent-skills`, `knowledge-work-plugins`,
`life-sciences`, `claude-for-legal`, `claude-for-financial-services`,
`financial-services-plugins`, `first-party-plugins`, `healthcare`, plus
any name that "impersonates" (like `official-claude-plugins`).

### 3.2 Plugin source types (choose one per plugin entry)

| Source        | Fields                             | Best for                                          |
|:--------------|:-----------------------------------|:--------------------------------------------------|
| relative path | `"./plugins/<name>"`               | Monorepo layout: plugins live inside marketplace  |
| `github`      | `repo`, `ref?`, `sha?`             | One plugin per repo                               |
| `url`         | `url`, `ref?`, `sha?`              | GitLab / Bitbucket / self-hosted git              |
| `git-subdir`  | `url`, `path`, `ref?`, `sha?`      | Plugin lives in a subdir of a monorepo (sparse)   |
| `npm`         | `package`, `version?`, `registry?` | Distribute like any npm package                   |
| `archive`     | `url`, `sha256?`                   | No git/npm needed; zip on any static host (S3)    |
| `command`     | `command`, `timeout?`, `mode?`     | Directory produced by a local tool per session    |

For a **private team** (our case) the two natural choices are:

- **Relative-path monorepo** — one repo, `plugins/<name>/`, marketplace.json
  at repo root. Simplest; each plugin's `version` field pins updates.
- **git-subdir** — same repo but pinnable per plugin with `ref` + `sha`, and
  the marketplace repo can be a *catalog only* while the plugins live in the
  main app repo(s).

### 3.3 Private-repo & team-marketplace guidance from the docs

- Any git host works as long as `git clone` works in your terminal — SSH keys,
  PATs, `gh auth login`, credential helpers all pass through.
- Two settings recommended for private marketplaces:
  `disableAutoUpdate` (avoid background pulls choking on cred-helper
  disablement) and `pluginRefreshFrequency`.
- **Team enforcement pattern**: commit a `.claude/settings.json` in the
  application repo that lists the marketplace under `extraKnownMarketplaces`
  and marks required plugins under `enabledPlugins`. When a teammate first
  trusts the project folder, Claude Code auto-adds the marketplace with no
  extra prompt. This is the closest analogue to gstack's `--team` mode and
  strictly better (declarative, in-repo, version-pinnable).
- **CI seed pattern**: build-time env `CLAUDE_CODE_PLUGIN_SEED_DIR` points at
  a pre-populated plugins dir so container starts have plugins ready without
  cloning.
- **Community CI**: `claude plugin validate` runs on every submission with
  strict mode; recommended in your own CI for any team marketplace.

### 3.4 Ecosystem samples

- `anthropics/claude-plugins-official` (installed here) — big catalog, mix of
  first-party (`./plugins/...`) and third-party (`git-subdir` with SHA pins).
  Renames use a top-level `renames` map that transparently rewrites old
  slugs on user sync. External plugins live in an `external_plugins/`
  sibling directory (asana, github, gitlab, greptile, playwright, ...).
- `anthropics/skills` — the **skill-bundle** pattern: three plugins
  (`document-skills`, `example-skills`, `claude-api`) share `source: "./"`
  and list skills by path under a `strict: false` entry with a `skills`
  array. Marketplace-level `metadata.version: "1.0.0"` only; individual
  plugins have no `version` field, so upgrades ride the marketplace repo's
  HEAD. This is the direct opposite of the sha-pinned Anthropic style.
- `anthropics/claude-plugins-community` — public community catalog; pinned by
  SHA, CI-driven nightly bump; the review pipeline enforces `claude plugin
  validate --strict` plus automated safety screening.
- Community write-ups worth reading (found via WebSearch, not deeply audited):
  - dev.to/nagell — "Build Your Own Claude Code Marketplace: Scaffold,
    Structure, and Auto-Updates" (walks a private-marketplace scaffold).
  - medium `@automation.labs` — "Build a Private Claude Code Plugin
    Marketplace in 90 Minutes" (private-repo end-to-end).
  - `hesreallyhim/claude-code-json-schema` — unofficial JSON Schemas for
    plugin.json & marketplace.json, useful in CI + editor tooling.

---

## 4. Pitfalls observed

Verified in code or docs, not speculative.

1. **Silent-staleness classes.** gstack's `gstack-update-check` had exactly this
   bug once: a crash exited 0 and read as "up to date" for 45 releases
   (issue #1974). Fix was `set -E` + trap. Any custom updater we write in the
   gosleep plugin path must NEVER treat empty output as "current" — always
   emit `CHECK_FAILED` / `UNKNOWN` on error, never silence.
2. **git stash in the install tree.** gstack-upgrade Step 4 does `git stash`
   before `git reset --hard origin/main`. For a pristine clone this is fine;
   for any tree with local edits it is destructive-equivalent, precisely the
   incident we hit in gosleep on 2026-07-13. If we adopt any auto-update
   pattern for gosleep, do it on a tree the user is not editing (plugin cache),
   not on the working repo.
3. **`.claude-plugin/` misuse.** Docs explicitly warn: putting `skills/`,
   `commands/`, etc. inside `.claude-plugin/` is a common mistake — only
   `plugin.json` goes there. Everything else at plugin root.
4. **Marketplace name collisions.** Adding a second marketplace with the same
   name replaces the first — no merge. Also, ~15 marketplace names are
   reserved and a plugin marketplace registered under a newly reserved name
   stops loading with "untrusted source" (that pattern already burned users
   on `first-party-plugins` and `healthcare` before v2.1.205).
5. **Renames.** Plugin `name` is immutable once shipped. Rename requires a
   `renames: {"old": "new"}` map in `marketplace.json`; otherwise every
   existing install breaks with `plugin-not-found`.
6. **Cache invalidation on version bump.** For archive/zip sources with a
   `sha256` pin: if you change the zip contents you MUST bump `version` too,
   or users keep the cached copy. The digest alone isn't the update signal
   when a version is declared.
7. **Version cascade surprises.** If plugin.json omits `version` and the
   marketplace entry omits `version`, users get no update notifications
   at all (unless the source type itself carries a version like `archive`
   with `sha256` or a git `sha`). Setting *some* version explicitly is
   almost always the right call.
8. **Command sources have organisation kill-switch.** `disableCommandPluginSources`
   or `allowManagedHooksOnly` can block them entirely. Don't hard-depend on
   command sources in a team marketplace without checking managed settings.
9. **CI credentials for private marketplaces.** Background refresh disables
   git credential helpers on `git pull`, so private HTTPS remotes fail
   silently on auto-update; only SSH via `ssh-agent` works transparently.
   Set `disableAutoUpdate: true` + require explicit `/plugin marketplace update`,
   or use SSH throughout.

---

## 5. Patterns worth copying / avoiding for gosleep

### Worth copying

- **Marketplace-as-monorepo, one repo for all 7 skills.** Mirror our current
  `skill/<name>/` layout as `plugins/<name>/` inside a `gosleep-plugins` (or
  `ainstance-labs/gosleep-plugins`) private repo. `.claude-plugin/marketplace.json`
  at the root, `plugins/<name>/.claude-plugin/plugin.json` for each. Relative
  paths in the marketplace. That's ~30 minutes of restructure and is a strict
  superset of what `skill/` gives us today.
- **Semver in `plugin.json`** (the nx style, not the anthropics/skills style).
  Bump `version` per plugin on release; the marketplace catalog stays static.
  Gives us the versioning we don't have + a clean audit trail (each
  `installed_plugins.json` records `version` + `gitCommitSha` + `lastUpdated`).
- **Team enforcement via `.claude/settings.json`.** Commit
  `extraKnownMarketplaces` + `enabledPlugins` in the gosleep repo so first
  trust-of-folder auto-registers the marketplace. This is the correct
  replacement for gstack's `--team` mode, and it's declarative.
- **`claude plugin validate --strict` in CI.** Zero excuses — same validator
  Anthropic runs on community submissions. Wire it into any PR that touches
  `plugins/`.
- **Soft migration: coexistence.** Because plugin skills are namespaced
  `plugin:skill` and local skills stay as `/skill`, we can ship the plugin
  marketplace FIRST, let the team try `/gosleep-delivery:handoff` alongside
  `/handoff`, and only later remove `~/.claude/skills/handoff/`. No cutover
  cliff. (Note: agents are NOT namespaced this way — same-named local agent
  files shadow the plugin's; not our current problem but relevant if we
  ever ship subagents in a plugin.)
- **The `gstack-upgrade` UX shape** (Yes / Always / Not now / Never ask again,
  escalating snooze, "what's new" summary generated from CHANGELOG diff).
  For plugins we get most of this from `/plugin` for free, but the CHANGELOG
  diff summary is a nice touch we can bolt onto plugin.json's `homepage`.

### Worth avoiding

- **The gstack model itself — a git clone under `~/.claude/skills/`.** We
  already know it's fragile because we live with it: no per-skill version,
  no provenance, `install.sh` risk, `git stash` risk, install-side coupling
  to a repo tree. The plugin/marketplace world is a strict step up.
- **Skill-bundle mode with `strict: false`.** Tempting because it looks like
  our `skill/` monorepo, but it gives up per-skill `plugin.json` and thus
  per-skill versioning. Only appropriate if we want the whole bundle to move
  as one unit — for 7 skills we usually want the opposite.
- **`git stash` + `git reset --hard` on the install tree.** See pitfall 2 —
  never on a tree the user is editing.
- **Command sources** for our case. Overkill; runs a shell command on the
  user's machine every session and needs explicit acceptance handling. Only
  useful when a local tool must render the plugin.
- **Auto-upgrade without a snooze/opt-out.** gstack's snooze escalation
  (24h → 48h → 1 week) is there for a reason. For plugins, the equivalent
  is `disableAutoUpdate: true` + explicit `/plugin marketplace update` — do
  that for the gosleep marketplace so night-runs don't randomly bump plugins
  mid-shift.

---

## 6. Open questions / follow-ups worth an owner decision

1. **Marketplace name:** `gosleep-plugins` vs `ainstance-labs` vs
   `ainstance-delivery`. Must not collide with reserved names (safe list
   in section 3.1).
2. **One plugin or seven?** Options: (a) one plugin `gosleep-delivery`
   bundling all 7 skills — smallest surface, single version bump per
   release; (b) 7 separate plugins — max flexibility, per-skill versions,
   more marketplace-entry noise. Recommendation lean: (a) to start, split
   later only if a skill starts evolving on its own cadence.
3. **Repo layout:** dedicated `gosleep-plugins` repo (clean separation) vs
   `plugins/` folder inside the main gosleep repo (path-relative source).
   Dedicated repo wins for auth boundaries; monorepo wins for atomic
   PR-with-code-and-skill changes. Given our one-PR-per-Epic rule, monorepo
   may be more consistent with the delivery workflow.
4. **How to co-exist with gstack.** Since gstack owns global `/handoff` (no —
   verified above, `handoff` is NOT a gstack skill; gstack owns
   `/office-hours`, `/plan-*`, `/browse`, `/ship`, `/qa`, `/review`, ...),
   the collision surface with our skills is small: gstack has no `handoff`,
   no `delivery-workflow`, no `using-jira`, no `writing-prds`, no
   `orchestrating-delivery-agents`, no `remote-control`, no
   `tmux-agents-orchestration`. **Zero name overlap in the current global
   scope**, so a soft rollout without namespace collisions is realistic.
5. **Reverse-sync problem.** Today `install.sh` is guard-disabled because
   global `orchestrating-delivery-agents` is authoritative. In plugin
   world, per-skill provenance is per-`plugin.json` `version`, so this
   whole class of "which copy is newer" question dissolves — but we need to
   commit to plugin as source of truth on migration day, or we recreate it.

---

## Appendix A — key file paths verified

- `~/.claude/skills/gstack/.git` — active git checkout of `github.com/garrytan/gstack`
- `~/.claude/skills/gstack/VERSION` → `1.64.1.0`
- `~/.claude/skills/gstack/gstack-upgrade/SKILL.md` — the upgrade skill
- `~/.claude/skills/gstack/bin/gstack-update-check` — the polling script
- `~/.claude/skills/gstack/setup` — the installer (symlink-fanout)
- `~/.claude/skills/_gstack-command/SKILL.md` → symlink into gstack repo (router)
- `~/.claude/skills/browse/SKILL.md` → symlink into gstack repo
- `~/.claude/plugins/installed_plugins.json` — records version + gitCommitSha
- `~/.claude/plugins/known_marketplaces.json` — registered marketplaces
- `~/.claude/plugins/marketplaces/claude-plugins-official/.claude-plugin/marketplace.json`
- `~/.claude/plugins/marketplaces/claude-plugins-official/plugins/plugin-dev/` — reference plugin
- `~/.claude/plugins/cache/claude-plugins-official/superpowers/6.2.0/` — installed cached plugin

## Appendix B — sources

- [Create plugins — Claude Code Docs](https://code.claude.com/docs/en/plugins)
- [Create and distribute a plugin marketplace — Claude Code Docs](https://code.claude.com/docs/en/plugin-marketplaces)
- [claude-plugins-official/.claude-plugin/marketplace.json](https://github.com/anthropics/claude-plugins-official/blob/main/.claude-plugin/marketplace.json)
- [anthropics/skills marketplace.json](https://github.com/anthropics/skills/blob/main/.claude-plugin/marketplace.json)
- [anthropics/skills README](https://github.com/anthropics/skills/blob/main/README.md)
- [hesreallyhim/claude-code-json-schema](https://github.com/hesreallyhim/claude-code-json-schema) — unofficial JSON schemas
- [dev.to/nagell — Build Your Own Claude Code Marketplace](https://dev.to/nagell/build-your-own-claude-code-marketplace-scaffold-structure-and-auto-updates-4n3f)
- [medium @automation.labs — Build a Private Claude Code Plugin Marketplace in 90 Minutes](https://medium.com/@automation.labs/build-a-private-claude-code-plugin-marketplace-in-90-minutes-9bfc076feed7)
- Local: `~/.claude/skills/gstack/README.md`, `CHANGELOG.md`, `gstack-upgrade/SKILL.md`
