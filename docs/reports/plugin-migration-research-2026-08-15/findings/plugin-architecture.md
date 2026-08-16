# Claude Code Plugins & Marketplaces — Authoritative Reference

**Author:** res-plugin-arch (gosleep worker)
**Date:** 2026-08-15
**Purpose:** Ground truth for GSL-174 skills-management strategy — whether to migrate gosleep's
seven owned skills (`~/.claude/skills/{orchestrating-delivery-agents, delivery-workflow, handoff,
using-jira, writing-prds, remote-control, tmux-agents-orchestration}/`) into first-class Claude
Code plugins to get versioning + provenance the loose-skill layout lacks.

**Evidence sources**
- Official docs (fetched 2026-08-15): `https://code.claude.com/docs/en/plugins`,
  `.../plugins-reference`, `.../plugin-marketplaces`.
- On-disk introspection of this machine:
  - `~/.claude/plugins/installed_plugins.json`, `known_marketplaces.json`, `marketplaces/**`,
    `cache/**`, `data/**`.
  - `~/.claude/settings.json`.
  - `~/.claude/skills/gstack/` (loose-skill tree — see §8.1).
  - Real plugin manifests: `superpowers` (v6.2.0), `context7` (unknown version).
- Live CLI: `claude 2.1.233 (Claude Code)` — every `claude plugin …` and
  `claude plugin marketplace …` subcommand ran read-only.

**Where docs and disk disagreed:** noted inline. Disk wins where they conflict.

---

## 1. What a plugin IS, concretely

### 1.1 Component inventory

A plugin is a self-contained directory. Every component below is optional; a plugin can be
one skill and nothing else. From
`https://code.claude.com/docs/en/plugins-reference` § "Standard Plugin Directory Layout" and
§ "File Locations Reference":

| Directory / file             | Purpose                                                                                     | Default path             |
| ---------------------------- | ------------------------------------------------------------------------------------------- | ------------------------ |
| `.claude-plugin/plugin.json` | Plugin manifest (optional if components use default locations)                              | `.claude-plugin/`        |
| `skills/<name>/SKILL.md`     | **Skills** — model-invoked, progressive-disclosure                                          | `skills/`                |
| `commands/*.md`              | Legacy flat-file "commands" (equivalent to skills). "Use `skills/` for new plugins" (docs). | `commands/`              |
| `agents/*.md`                | Subagent definitions                                                                        | `agents/`                |
| `hooks/hooks.json`           | Event handlers                                                                              | `hooks/`                 |
| `.mcp.json`                  | MCP server definitions                                                                      | plugin root              |
| `.lsp.json`                  | LSP server configurations                                                                   | plugin root              |
| `monitors/monitors.json`     | Background monitors (stdout → session notifications)                                        | `monitors/`              |
| `workflows/`                 | Workflow scripts                                                                            | `workflows/`             |
| `output-styles/`             | Output style definitions                                                                    | `output-styles/`         |
| `themes/`                    | Color themes                                                                                | `themes/` (experimental) |
| `bin/`                       | Executables added to Bash tool's `PATH` while plugin is enabled                             | `bin/`                   |
| `settings.json`              | Default settings — only `agent` and `subagentStatusLine` keys read                          | plugin root              |
| `channels/`                  | Notification-channel wiring (via `channels[]` in manifest)                                  | manifest field           |

**Hard rule** (docs, "Common mistake" warning): `commands/`, `agents/`, `skills/`, `hooks/`
must be at the **plugin root**, never inside `.claude-plugin/`. Only `plugin.json` (and
optionally a marketplace's own `marketplace.json`) live inside `.claude-plugin/`.

**Verified on disk** — real superpowers plugin at
`~/.claude/plugins/cache/claude-plugins-official/superpowers/6.2.0/`:
```
├── .claude-plugin/
│   ├── plugin.json            ← manifest
│   └── marketplace.json       ← marketplace-of-one for standalone install
├── skills/                    ← 14 skills, each a folder with SKILL.md
│   ├── brainstorming/         ├── dispatching-parallel-agents/
│   ├── systematic-debugging/  ├── verification-before-completion/
│   └── … 10 more              …
├── hooks/hooks.json           ← SessionStart hook
├── hooks/run-hook.cmd         ← script it dispatches to
└── (README, tests/, docs/, .github/, no other Claude Code components)
```

### 1.2 Manifest schema — `.claude-plugin/plugin.json`

Complete field list from `plugins-reference` § "Plugin Manifest Schema":

**Required:** `name` (string, kebab-case, no spaces). This is the identifier that keys
`enabledPlugins` and `pluginConfigs`, and prefixes every skill (`plugin-name:skill-name`).

**Version & identity:**
- `version` (string, optional) — semver *string*, e.g. `"2.1.0"`. The docs don't force
  strict semver; anything unique works. Setting `version` **pins** the plugin: users only
  receive updates when this field is bumped. If omitted, the version comes from the next
  fallback in the version resolution chain (see § 3).
- `displayName` (string, optional, v2.1.143+) — human-readable name for UI. Not used for
  namespacing.

**Metadata:** `description`, `author {name, email?, url?}`, `homepage`, `repository`,
`license`, `keywords[]`, `metadata` (free-form, ignored by Claude Code),
`defaultEnabled` (default `true`).

**User configuration:** `userConfig` — declares per-option schema (`type`:
string/number/boolean/directory/file; `title`, `description`, `sensitive`, `required`,
`default`, `multiple`, `min`/`max`). Substituted as `${user_config.KEY}` in MCP/LSP configs,
hook commands, and non-sensitive uses in skill/agent bodies. Non-sensitive values stored
in `settings.json` under `pluginConfigs[<plugin-id>].options`; sensitive values go to the
macOS Keychain (or `~/.claude/.credentials.json` on other OSes).

**Component path overrides** (all paths must start with `./`; arrays allowed):
- `skills` — **adds to** the default `skills/` scan.
- `commands`, `agents`, `workflows`, `outputStyles`, `experimental.themes`,
  `experimental.monitors` — **replaces** the default.
- `hooks`, `mcpServers`, `lspServers` — own merge rules (config-shaped, not just paths).

**Dependencies:** `dependencies[]` — list of other plugins, optional semver range per
entry: `[{"name": "secrets-vault", "version": "~2.1.0"}]`.

**Channels:** `channels[]` — bind messaging surfaces to the plugin's MCP servers.

**Real manifest examples on disk:**

`~/.claude/plugins/cache/claude-plugins-official/superpowers/6.2.0/.claude-plugin/plugin.json`:
```json
{
  "name": "superpowers",
  "description": "Core skills library for Claude Code: TDD, debugging, collaboration patterns, and proven techniques",
  "version": "6.2.0",
  "author": {"name": "Jesse Vincent", "email": "jesse@fsck.com"},
  "homepage": "https://github.com/obra/superpowers",
  "repository": "https://github.com/obra/superpowers",
  "license": "MIT",
  "keywords": ["skills", "tdd", "debugging", "collaboration", "best-practices", "workflows"]
}
```

`~/.claude/plugins/cache/claude-plugins-official/context7/unknown/.claude-plugin/plugin.json`
(NB: no `version` field — hence the `unknown/` version segment in the cache path):
```json
{
  "name": "context7",
  "description": "Upstash Context7 MCP server for up-to-date documentation lookup. …",
  "author": {"name": "Upstash"}
}
```

### 1.3 Single-file shortcut

"If a plugin has no `skills/` directory and no `skills` manifest field, a `SKILL.md` at the
plugin root is loaded as a single skill." (`plugins-reference` § "Single-Skill Plugin
Shortcut".) Frontmatter `name` field controls the invocation name; without it, the fallback
is the install-directory name — which for marketplace installs is a version string that
*changes on every update* — so always set frontmatter `name` for single-skill plugins.

---

## 2. Marketplace

### 2.1 `.claude-plugin/marketplace.json` schema

From `plugin-marketplaces` §§ "Marketplace schema", "Plugin entries", "Plugin sources".

**Required:**
- `name` (string, kebab-case) — public-facing marketplace id; users install as
  `plugin@marketplace`. Reserved names blocked (see §7).
- `owner` — `{name, email?, url?}`.
- `plugins[]` — array of plugin entries.

**Optional top-level:** `$schema`, `description`, `version`, `metadata.pluginRoot`
(prepended to relative plugin sources), `allowCrossMarketplaceDependenciesOn[]`, `renames`
(migration map, v2.1.193+).

**Per-plugin entry** — any field from the plugin manifest plus marketplace-specific fields:
`source` (required), `category`, `tags[]`, `strict` (bool, default `true`), `relevance`,
`defaultEnabled`. Notably `version`, `description`, `author`, and component-path fields
(`skills`, `commands`, `agents`, `hooks`, `mcpServers`, `lspServers`) can *all* be declared
in the marketplace entry — enabling strict-false marketplaces to fully describe a plugin
whose source is just raw files with no `plugin.json`.

### 2.2 Plugin source types

Six variants (from `plugin-marketplaces` § "Plugin sources", cross-verified against a real
scan of the 285 entries in the official marketplace: 146 `url`, 84 `git-subdir`, 53
relative-path strings, 2 `github`, 0 `npm`/`archive`/`command` on disk today):

| Source          | Shape                                                                 | Pins                                       |
| --------------- | --------------------------------------------------------------------- | ------------------------------------------ |
| Relative path   | `"./plugins/foo"` (string)                                            | none                                       |
| `github`        | `{source, repo, ref?, sha?}`                                          | `ref` = branch/tag; `sha` = 40-char commit |
| `url`           | `{source, url, ref?, sha?}` — any git host                            | same                                       |
| `git-subdir`    | `{source, url, path, ref?, sha?}` — sparse clone of subdir            | same                                       |
| `npm`           | `{source, package, version?, registry?}`                              | `version` semver or range                  |
| `archive`       | `{source, url, sha256?}` — HTTPS zip; v2.1.224+; ≤256 MiB             | `sha256` digest                            |
| `command`       | `{source, command, timeout?, mode?}` — v2.1.229+; requires user `-y`  | none (re-runs each session)                |

**Marketplace source vs plugin source** are distinct concepts and are pinned independently:
the marketplace source (only `ref`, no `sha`) fetches the `marketplace.json` catalog; the
plugin source (both `ref` and `sha`) fetches each plugin.

### 2.3 How marketplaces are added

Three CLI paths, all `read-only` — none run on this session:
```
claude plugin marketplace add <source> [--scope user|project|local] [--sparse <paths…>]
claude plugin marketplace list [--json]
claude plugin marketplace remove <name> [--scope …]
claude plugin marketplace update [name]
```
Source forms accepted:
- GitHub shorthand: `owner/repo` or `owner/repo@ref`
- Git URL: `https://…/x.git` or `git@…:…`, optionally `#ref`
- Direct URL to a `marketplace.json` (relative-path plugin sources won't resolve — see §7)
- Local path: `./some-marketplace`

### 2.4 Private git-hosted marketplace mechanics

From `plugin-marketplaces` § "Private repositories":

**Commands you run** (`add`, `install`, `update`, `marketplace update`): use your git
credential helpers — HTTPS via `gh auth login` / macOS Keychain / `git-credential-store`;
SSH via `ssh-agent`. Works out of the box.

**Background auto-updates:** by default the background `git pull` **disables git credential
helpers**, so HTTPS-authenticated private repos fail silently. Two mitigations:
1. `CLAUDE_CODE_PLUGIN_KEEP_MARKETPLACE_ON_FAILURE=1` — keep the last clone on pull failure
   instead of re-cloning from scratch.
2. Global git URL rewrite that embeds a read-only token in the remote URL, e.g.
   ```
   git config --global url."https://x-access-token:TOKEN@github.com/acme/plugins".insteadOf \
     "https://github.com/acme/plugins"
   ```
   Scope the rewrite to the specific repo — a host-wide rewrite hijacks every fetch.

Alternative for teams on Anthropic Team/Enterprise: publish through **Organization settings >
Plugins** on `claude.ai`, which authenticates via the Claude GitHub App / GHE App and
bypasses per-user git credentials entirely (with a source-type restriction — see §6.2).

### 2.5 Pinning & distributing versions

Two patterns:
- **Per-plugin pinning** — set `version` in the plugin's `plugin.json` OR in the
  marketplace entry, and never bump it. Users only get updates when that field changes.
- **Release channels** — publish two marketplaces (`stable-tools`, `latest-tools`) pointing
  to different refs of the same repo. Assign each channel to a user group via
  `managed-settings.json`'s `extraKnownMarketplaces`. Requires each channel to resolve to a
  distinct version string (docs warn: identical version → treated as identical → skipped).

---

## 3. Versioning + update semantics

### 3.1 Version resolution precedence

From `plugins-reference` § "Version Management", verbatim order:
1. `version` field in the plugin's `plugin.json`
2. `version` field in the plugin's marketplace entry
3. Git commit SHA (for `github`, `url`, `git-subdir`, relative-path sources)
4. SHA-256 digest (for `archive` sources)
5. `unknown` (for `npm` sources or local directories with none of the above)

The resolved version *is* the cache path segment. Real example on disk:
```
~/.claude/plugins/cache/claude-plugins-official/superpowers/6.2.0/  ← version pinned
~/.claude/plugins/cache/claude-plugins-official/context7/unknown/   ← no version anywhere
```

**Docs warning** (worth internalizing): "Setting `version` pins the plugin for every source
type except `command`. If you declare `"version": "1.0.0"` in `plugin.json` and push new
commits without changing that string, existing users keep the cached copy, because Claude
Code sees the same version. Bump the field on every release, or omit it to fall back to the
resolved version." Also: **do not** set `version` in both `plugin.json` and the marketplace
entry — the manifest wins and can silently mask a bumped marketplace entry.

### 3.2 `claude plugin update`

`claude plugin update <plugin> [-s user|project|local|managed] [-y]` — fetches the plugin's
current source and installs it if the resolved version differs. **Restart required to apply**
(from `claude plugin update --help`). Interactive install; `-y` needed for a plugin whose
source is `command` (accepts a changed command string) and in non-TTY contexts.

### 3.3 Auto-update behavior

- Marketplaces refresh **in the background** on each Claude Code session start (subject to
  `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC`), then plugins update per their resolved
  version. This is the mechanism the docs call "auto-update."
- `command`-source plugins additionally re-run their command once per session (background)
  to pick up tool-side output changes.
- Users can pause with `CLAUDE_CODE_PLUGIN_KEEP_MARKETPLACE_ON_FAILURE=1` (keeps clone on
  pull failure) and can raise the 120 s git timeout via
  `CLAUDE_CODE_PLUGIN_GIT_TIMEOUT_MS`.

### 3.4 Pinning a version (i.e., locking)

- **Author side:** set `version` in `plugin.json` and never bump it (works for every source
  except `command`).
- **Consumer side:** pin the *plugin source* in the marketplace entry via `sha`
  (`github`/`url`/`git-subdir`) or `sha256` (`archive`). A pinned `sha` beats a moving
  `ref`. There is **no per-user lockfile** — the marketplace is the lockfile.
- Team-wide: check `.claude/settings.json` with `enabledPlugins` naming an
  `owner/repo@ref`-based marketplace whose entries carry `sha` pins.

### 3.5 Provenance recorded on install/update — live disk inspection

`~/.claude/plugins/installed_plugins.json` on this machine (verbatim, trimmed):
```json
{
  "version": 2,
  "plugins": {
    "context7@claude-plugins-official": [{
      "scope": "user",
      "installPath": "/Users/…/.claude/plugins/cache/claude-plugins-official/context7/unknown",
      "version": "unknown",
      "installedAt": "2026-04-19T19:04:06.157Z",
      "lastUpdated": "2026-08-11T12:39:49.447Z",
      "gitCommitSha": "30a213f9b39e3c40b0073bb5b41081da9f2b6634"
    }],
    "superpowers@claude-plugins-official": [{
      "scope": "user",
      "installPath": "/Users/…/.claude/plugins/cache/claude-plugins-official/superpowers/6.2.0",
      "version": "6.2.0",
      "installedAt": "2026-04-19T19:06:04.125Z",
      "lastUpdated": "2026-07-24T18:53:30.315Z",
      "gitCommitSha": "b55764852ac78870e65c6565fb585b6cd8b3c5c9"
    }],
    "nx@nx-claude-plugins": [{
      "scope": "project",
      "projectPath": "/Users/…/dev/ai-driven/agentic-flow-admin",
      "installPath": "…/nx-claude-plugins/nx/0.2.34",
      "version": "0.2.34",
      "installedAt": "2026-05-23T13:08:51.195Z",
      "lastUpdated": "2026-05-23T13:08:51.195Z"
    }]
  }
}
```

**What this proves:** every install records `scope` + optional `projectPath`, absolute
`installPath` (cache tree, versioned), resolved `version`, `installedAt`, `lastUpdated`,
and — for git-backed sources — the exact `gitCommitSha`. **This IS the provenance the loose
`~/.claude/skills/<name>/` layout lacks.** No such registry exists for loose skills; there
is no `installedAt`, no `lastUpdated`, no commit SHA — a loose skill is whatever bytes
happen to be at that path today.

**Marketplace registry** is a parallel file:
`~/.claude/plugins/known_marketplaces.json`:
```json
{
  "claude-plugins-official": {
    "source": {"source": "github", "repo": "anthropics/claude-plugins-official"},
    "installLocation": "…/marketplaces/claude-plugins-official",
    "lastUpdated": "2026-08-11T12:39:49.384Z"
  },
  "nx-claude-plugins": {
    "source": {"source": "github", "repo": "nrwl/nx-ai-agents-config"},
    "installLocation": "…/marketplaces/nx-claude-plugins",
    "lastUpdated": "2026-05-16T10:09:42.854Z"
  }
}
```

**Cache layout:** `~/.claude/plugins/cache/<marketplace>/<plugin>/<version>/…` (verified on
disk). Multiple versions of the same plugin can coexist. Uninstalling drops the version
directory; `--keep-data` preserves `~/.claude/plugins/data/{id}/` (the persistent
`${CLAUDE_PLUGIN_DATA}` dir plugins can use across updates).

---

## 4. Loading + precedence — CRITICAL for coexistence design

### 4.1 Namespacing rule

Plugin skills are **always** invoked as `plugin-name:skill-name` (colon-separated).
Verbatim from the docs (`plugins-reference` § "Component Namespacing"):

> "For example, in the UI, the agent `agent-creator` for the plugin with name `plugin-dev`
> will appear as `plugin-dev:agent-creator`."

And from the Quickstart on `plugins` page:

> "**Why namespacing?** Plugin skills are always namespaced (like `/my-first-plugin:hello`)
> to prevent conflicts when multiple plugins have skills with the same name."

Loose skills at `~/.claude/skills/<name>/` and project `.claude/skills/<name>/` keep their
**bare name** (no prefix).

### 4.2 Collision behavior — what actually wins

From the `plugins` doc migration section, verbatim:

> "Project and user `.claude/agents/` definitions **override** same-named plugin agents, so
> the plugin version only takes effect once the originals are removed. **Plugin skills are
> namespaced as `/plugin-name:skill-name`, so the original `/skill-name` and the plugin
> copy both remain available rather than one overriding the other.**"

**So for our skills specifically:**
- Loose skill `handoff` (invoked as `handoff`) coexists with plugin skill
  `gosleep-delivery:handoff` (invoked as `gosleep-delivery:handoff`) — **no collision, both
  callable, different names.**
- Agents are the *only* component where "user/project overrides plugin" is codified. Our
  case is skills, so the coexistence semantic is "both present under different names."

### 4.3 Enable/disable scope

Four scopes (`plugins-reference` § "Plugin Installation Scopes"):

| Scope     | Settings file                    | Use case                                        |
| --------- | -------------------------------- | ----------------------------------------------- |
| `user`    | `~/.claude/settings.json`        | Personal, all projects (default)                |
| `project` | `.claude/settings.json`          | Team-shared via git                             |
| `local`   | `.claude/settings.local.json`    | Project-specific, gitignored                    |
| `managed` | managed-settings.json (org)      | Read-only org policy                            |

Enable/disable keys in `enabledPlugins`:
```json
{
  "enabledPlugins": {
    "plugin-name": true,
    "plugin-name@marketplace-name": false
  }
}
```

**Live from this machine's `~/.claude/settings.json`:**
```json
"enabledPlugins": {
  "context7@claude-plugins-official": true,
  "superpowers@claude-plugins-official": true
}
```
(No `extraKnownMarketplaces`, no `pluginConfigs` on this machine.)

### 4.4 `--plugin-dir` local override

`claude --plugin-dir ./my-plugin` (or a `.zip`, or `--plugin-url https://…zip`) loads a
plugin for one session, and **takes precedence over the same-named installed plugin**
(useful for testing changes to an installed plugin without uninstalling). Exception: managed
force-enable / force-disable cannot be overridden this way. `--plugin-dir` is also the
gateway for team-shared unpublished plugins during migration.

### 4.5 Skills-directory shortcut (relevant to us)

Any folder under `~/.claude/skills/` (personal) or `<cwd>/.claude/skills/` (project) that
contains a `.claude-plugin/plugin.json` **auto-loads as `<name>@skills-dir` on the next
session** — no marketplace, no install command, no cache copy.

- Personal: loads in every project.
- Project scope: loads **only** after workspace-trust dialog; MCP servers gated per-server;
  LSP gated on trust; **background monitors do NOT load**. And — one gotcha — project-scope
  `@skills-dir` only scans the `.claude/skills/` of the directory where you *start* Claude
  Code; it doesn't walk up to the repo root (plain skills do).

`claude plugin init <name>` scaffolds one in `~/.claude/skills/<name>/`. This is by far the
**lightest migration path** for our case: keep the same directory tree, just add
`.claude-plugin/plugin.json` with a `version`, and the skill is now a plugin with
provenance and rename-safe namespacing (`<name>@skills-dir:<skill>`).

---

## 5. CLI surface — every subcommand, real output

Verified against `claude 2.1.233` on this machine. All read-only invocations succeeded.

### 5.1 `claude plugin` — 13 subcommands

```
claude plugin details <name>                    Show component inventory + token cost
claude plugin disable [plugin] [-a] [-s scope]  Disable enabled plugin (--all supported)
claude plugin enable <plugin> [-s scope]         Enable disabled plugin
claude plugin eval [target] [--ablation …]      Run eval cases (evals/**/case.yaml)
claude plugin init <name> [--with …]             Scaffold plugin at ~/.claude/skills/<name>/
claude plugin install <plugin> [-s scope] [-y]   Install from marketplace; --config for userConfig
claude plugin list [--available] [--json]        List installed plugins
claude plugin marketplace                        Manage marketplaces (subcommands below)
claude plugin prune [-s scope] [-y] [--dry-run]  Remove auto-installed deps no longer needed
claude plugin tag [path] [--push] [--dry-run]    Create {name}--v{version} git tag for release
claude plugin uninstall <plugin> [--keep-data]   Uninstall; --keep-data preserves data/{id}/
claude plugin update <plugin>                    Update to latest; restart required
claude plugin validate <path> [--strict]         Validate manifest / directory
```

### 5.2 `claude plugin marketplace` — 4 subcommands

```
claude plugin marketplace add <source> [--scope …] [--sparse <paths…>]
claude plugin marketplace list [--json]
claude plugin marketplace remove <name> [--scope …]     # aliased as `rm`
claude plugin marketplace update [name]
```

### 5.3 Real output from `claude plugin list`

```
Installed plugins:
  ❯ context7@claude-plugins-official     Version: unknown     Scope: user     ✔ enabled
  ❯ nx@nx-claude-plugins                 Version: 0.2.34      Scope: project  ✘ disabled
  ❯ superpowers@claude-plugins-official  Version: 6.2.0       Scope: user     ✔ enabled
```

### 5.4 Validation

`claude plugin validate <path>` — validates a marketplace directory OR a plugin directory
OR the skills/agents/commands within a directory. `--strict` treats warnings as errors
(exit 1) — use in CI. Warnings include non-kebab-case names, missing description, names
Claude Desktop won't accept. Fatal errors: missing `.claude-plugin/marketplace.json`,
invalid JSON, duplicate plugin names, source path containing `..`, malformed YAML
frontmatter in a skill.

### 5.5 Release tagging

`claude plugin tag [path] [-m msg] [--push] [--remote origin] [--dry-run]` — creates a
`{name}--v{version}` git tag from a plugin's `plugin.json`, cross-validating any enclosing
marketplace entry. This is the **canonical publish primitive** for a git-hosted plugin.

### 5.6 Eval

`claude plugin eval` runs eval cases (`evals/**/case.yaml` or `evals/**/prompt.md` +
`graders/*.md`) against a plugin. `--ablation with-without` runs a no-plugin baseline arm.
Publishes an HTML report to claude.ai by default. Judge model defaults to `haiku`. This
is how a team measures "did we regress the skill after that edit?" — the version-and-eval
loop that a loose skill literally cannot participate in.

---

## 6. Team / enterprise distribution

### 6.1 Settings-driven auto-install (checked into repo)

From `plugin-marketplaces` § "Require marketplaces for your team". Add to
`.claude/settings.json` in the repo:

```json
{
  "extraKnownMarketplaces": {
    "gosleep-plugins": {
      "source": {"source": "github", "repo": "ainstance-labs/gosleep-plugins"}
    }
  },
  "enabledPlugins": {
    "gosleep-delivery@gosleep-plugins": true,
    "gosleep-orchestrator@gosleep-plugins": true
  }
}
```

After a teammate trusts the project folder (workspace-trust dialog), Claude Code registers
the marketplace and enables the plugins with no manual step. `enabledPlugins` in
`.claude/settings.json` (project scope) is the same key format as user scope; it can also
be checked into `.claude/settings.local.json` (local scope) or delivered via managed
settings.

### 6.2 Enterprise-only paths

- **Anthropic Team/Enterprise Org settings > Plugins:** publishes a private marketplace
  through the Claude GitHub App / GHE App (bypasses per-user git creds). Restriction: each
  plugin source must be `github`, `url`, `git-subdir`, or a marketplace-relative path;
  cross-owner / other-host sources must be public. Recommended pattern: colocate every
  private plugin inside the marketplace repo and reference by relative path.
- **Managed settings** support: `strictKnownMarketplaces` (allowlist — `[]` = full
  lockdown; supports `hostPattern` / `pathPattern` regexes and owner-wildcards
  `owner/*`), `blockedMarketplaces` (blocklist), `disableSideloadFlags` (blocks
  `--plugin-dir`/`--plugin-url`/etc.), `disableCommandPluginSources`, `allowManagedHooksOnly`.
- **Seed dirs for containers/CI:** `CLAUDE_CODE_PLUGIN_SEED_DIR=/opt/seed` pre-populates
  marketplaces + caches at build time; read-only at runtime, layerable with `:` separators.

### 6.3 Release channels via managed settings

Publish `stable-tools` and `latest-tools` marketplaces pointing to different refs of the
same plugin repo. Assign each to a user group via that group's `managed-settings.json`
`extraKnownMarketplaces`. This is how the same plugin ships to "early access" vs "stable"
cohorts.

---

## 7. Limits, caveats, and gotchas

- **Reserved marketplace names** (blocked at runtime): `claude-code-marketplace`,
  `claude-code-plugins`, `claude-plugins-official`, `claude-plugins-community`,
  `claude-community`, `anthropic-marketplace`, `anthropic-plugins`, `agent-skills`,
  `anthropic-agent-skills`, `knowledge-work-plugins`, `life-sciences`, `claude-for-legal`,
  `claude-for-financial-services`, `financial-services-plugins`, `first-party-plugins`,
  `healthcare`, plus anything that impersonates them (e.g. `official-claude-plugins`).
  A pre-existing marketplace under a newly-reserved name **stops loading** and must be
  removed and re-added under a different name.
- **`version` in both `plugin.json` and marketplace entry:** the manifest wins silently.
  Pick one place.
- **`command`-source plugins re-run every session** in the background, and any command
  change re-triggers user acceptance. Not appropriate for a stable skill library.
- **Node deps auto-install** (frozen resolution via `bun install --frozen-lockfile`
  or `npm ci`, `--ignore-scripts`, 60 s timeout) — a plugin with `bun.lock` /
  `bun.lockb` / `npm-shrinkwrap.json` / `package-lock.json` will install deps automatically.
  No lockfile → no deps installed.
- **File resolution is copy-based** (except `command` link-mode): plugins can't reference
  files outside their own directory via `../shared-utils`. Use symlinks or restructure.
- **URL-hosted `marketplace.json` cannot use relative-path plugin sources** — Claude Code
  only downloads the JSON, not the plugin trees. Host the marketplace as a git repo, or
  switch entries to `github`/`url`/`archive` sources.
- **Background `git pull` disables credential helpers** — private-marketplace auto-updates
  fail silently over HTTPS unless you wire a URL rewrite or use SSH via `ssh-agent`.
- **Project `@skills-dir` plugins don't walk up** — start Claude Code from the repo root or
  they miss.
- **A "renamed" plugin key** in read-only settings (managed / `--add-dir`) shows the rename
  notice every session — only writable scopes get rewritten on migration.
- **`.claude-plugin/` layout mistake** is the top runtime pitfall — putting
  `commands/`, `agents/`, `skills/`, or `hooks/` inside `.claude-plugin/` (instead of at
  the plugin root) makes the components invisible to Claude Code.
- **256 MiB / 20,000-entry cap** on `archive` and `command`-copy sources.
- **`disable-model-invocation`** frontmatter and other boolean fields accept `yes`/`no`/
  `on`/`off`/`1`/`0` since v2.1.218; older versions require `true`/`false` only.
- **Skill discovery still needs `/reload-plugins`** on installs where the install summary
  says so — the plugin loads but skills aren't hooked up until reloaded.

---

## 8. Implications for gosleep migration

### 8.1 Fact-check on the briefing

The team-lead's briefing described "installed gstack = a real plugin suite." **Disk
disagrees.** `~/.claude/skills/gstack/` has no `.claude-plugin/plugin.json` — it is a plain
loose-skill tree (with its own subfolders like `browse/`, `qa/`, `ship/`, each carrying a
`SKILL.md`), not a plugin. `claude plugin list` on this machine reports only three plugins
and gstack isn't among them. gstack today has the **exact same problem** as our seven
skills: no version, no provenance, no rename safety. Whatever migration we design applies to
gstack too (out of scope for this research, but worth flagging for the strategy).

### 8.2 Where the versioning/provenance pain is actually solved

`installed_plugins.json` (§ 3.5) is the answer. Every plugin install writes:
- resolved `version` (from `plugin.json`, marketplace entry, git SHA, sha256, or `unknown`)
- `installedAt`, `lastUpdated`
- exact `gitCommitSha` for git sources
- `scope` (`user` / `project` / `local` / `managed`) + `projectPath` for project scope
- immutable, versioned `installPath` under `~/.claude/plugins/cache/<mkt>/<plugin>/<ver>/`

Loose skills get none of this — the "who changed what, when" question the owner asked
literally cannot be answered from `~/.claude/skills/*/` because there's no registry file,
no version segment in the path, and no commit SHA anywhere.

### 8.3 Coexistence design is trivial thanks to namespacing (§ 4.2)

Because plugin skills are **always** prefixed `plugin-name:skill-name` and loose skills keep
their bare name, both can live in the same session with no collision — the owner can:
- Keep `~/.claude/skills/handoff/` unchanged (bare `handoff` still resolves).
- Publish a `gosleep-delivery` plugin that includes a `handoff` skill (invoked as
  `gosleep-delivery:handoff`), pinned to `v0.1.0`, git-hashed and dated.
- Cut over one caller at a time — no big-bang switch, no `install.sh` conflict.

The only component where "user overrides plugin" bites is **agents**, not skills. We ship
zero owned agents inside these seven skill dirs, so that clause doesn't affect us.

### 8.4 The three viable migration ladders (design work — not decisions)

Ranked by ceremony, cheapest first:

1. **Skills-directory plugin** (§ 4.5) — add `.claude-plugin/plugin.json` with a `version`
   to each of the seven existing folders in place. Auto-loads as `<name>@skills-dir` next
   session. Provenance registry lights up, `plugin.json` version pins updates, install.sh
   flow still works (rsync of the directory), coexistence is free. **Same rsync-based sync
   pattern the owner banned `./install.sh` full-tree for continues to work per-skill** —
   just now with a manifest.
2. **Local marketplace** — create `skill/.claude-plugin/marketplace.json` in this repo
   listing the seven plugins by relative path; `claude plugin marketplace add ./skill` and
   `claude plugin install …`. Adds real install/uninstall, adds `enabledPlugins` gating,
   but adds an install step per machine.
3. **Private git marketplace** — publish `ainstance-labs/gosleep-plugins`, wire via
   `.claude/settings.json` `extraKnownMarketplaces` + `enabledPlugins`. Real team
   distribution, real version pinning via `sha`, real release channels via a `latest`
   marketplace. Adds background-update auth work for a private repo (§ 2.4).

Ladder 1 preserves everything the owner already likes (loose-skill layout, targeted rsync,
no `./install.sh` full-tree). Ladders 2 and 3 add distribution muscle.

### 8.5 What this research does NOT settle (open questions for the strategy)

- **Which of the seven skills need which components?** `orchestrating-delivery-agents` has
  `references/` under it; will those be preserved by every source type? (Answer per docs:
  yes for local + git sources; `archive` and `command` need explicit packaging.)
- **How does `orchestrating-delivery-agents` — where the **global copy is authoritative** —
  fit ladder 1?** The plugin manifest lives *inside* the directory, so it ships with the
  authoritative global copy; ladder 1 adds provenance without changing which copy is
  authoritative. But the reverse-sync guard the owner installed still needs to apply to the
  manifest itself.
- **Do we want per-skill plugins (seven plugins) or one grouped plugin (`gosleep-delivery`
  with seven skills inside)?** Grouping = one version, one install, one enable toggle.
  Splitting = independent versioning per skill, easier partial migration.
- **Publish channel.** Public marketplace submission (`claude-plugins-community`) vs.
  private org marketplace vs. a git-only marketplace we tell teammates to `add` manually.

These are for the strategy phase — this file is bounded to the architecture reference.

---

## Appendix A — key files inspected on this machine (2026-08-15)

```
~/.claude/plugins/installed_plugins.json          ← provenance registry, § 3.5
~/.claude/plugins/known_marketplaces.json         ← marketplace registry, § 3.5
~/.claude/plugins/marketplaces/…/marketplace.json ← 285-entry official catalog, § 2.2
~/.claude/plugins/cache/<mkt>/<plugin>/<ver>/…    ← installed plugin tree, § 3.1
~/.claude/plugins/data/<id>/                      ← ${CLAUDE_PLUGIN_DATA}, persistent
~/.claude/settings.json.enabledPlugins            ← user-scope enable map, § 4.3
~/.claude/skills/gstack/                          ← LOOSE skill tree (no manifest), § 8.1
```

## Appendix B — Anthropic doc pages fetched

- `https://code.claude.com/docs/en/plugins`
- `https://code.claude.com/docs/en/plugins-reference`
- `https://code.claude.com/docs/en/plugin-marketplaces`
