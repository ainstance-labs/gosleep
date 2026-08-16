#!/usr/bin/env node
// One-shot Node script — reads payload.json + templates and writes index.html + ru/index.html.
// Kept in the run folder so the render is reproducible.

import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const HERE = path.dirname(new URL(import.meta.url).pathname);
const SKILL = "/Users/romanlidovskyi/.claude/skills/agentic-report-creator/templates";

const payload = JSON.parse(readFileSync(path.join(HERE, "payload.json"), "utf8"));
// Strip the leading HTML comment block from each template — it contains literal
// {{SLOT}} tokens used as doc that would otherwise be substituted a second time.
// The comment appears AFTER `<!doctype html>` on the second line, so match after it.
const stripDocComment = (s) => s.replace(/<!--[\s\S]*?-->/, "");
const enTmpl = stripDocComment(readFileSync(path.join(SKILL, "dashboard.html"), "utf8"));
const ruTmpl = stripDocComment(readFileSync(path.join(SKILL, "ru-shell.html"), "utf8"));

const esc = (s) =>
  String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

// Simple, safe Markdown-lite → HTML for the descriptions. Handles:
//   - fenced ```code``` blocks
//   - inline `code`
//   - paragraphs on blank lines
//   - simple - / * bullet lists
// Everything else escapes to text.
function mdish(src) {
  if (!src) return "";
  const parts = [];
  const chunks = String(src).split(/```/);
  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    if (i % 2 === 1) {
      parts.push(`<pre><code>${esc(chunk)}</code></pre>`);
      continue;
    }
    const paras = chunk.split(/\n\s*\n/);
    for (const p of paras) {
      const trimmed = p.trim();
      if (!trimmed) continue;
      const lines = trimmed.split(/\n/);
      const bullets = lines.every((l) => /^\s*[-*]\s+/.test(l));
      if (bullets) {
        parts.push(
          "<ul>" +
            lines
              .map(
                (l) =>
                  "<li>" +
                    inlineMd(l.replace(/^\s*[-*]\s+/, "")) +
                  "</li>",
              )
              .join("") +
            "</ul>",
        );
      } else {
        parts.push("<p>" + inlineMd(trimmed).replace(/\n/g, "<br>") + "</p>");
      }
    }
  }
  return parts.join("\n");
}
function inlineMd(s) {
  // Escape first, then patch inline code + bold.
  let out = esc(s);
  out = out.replace(/`([^`]+)`/g, (_m, code) => `<code>${code}</code>`);
  out = out.replace(/\*\*([^*]+)\*\*/g, (_m, b) => `<strong>${b}</strong>`);
  return out;
}

const bandFor = (score) =>
  score == null ? "warning" : score >= 80 ? "good" : score >= 40 ? "warning" : "critical";

function renderSummary(p, lang) {
  const { verdict, meta } = p;
  const c = verdict.counts;
  const total = (c.critical || 0) + (c.major || 0) + (c.minor || 0);
  const pct = (n) => (total === 0 ? 0 : Math.round((n / total) * 100));
  const band = verdict.band || bandFor(verdict.score);
  const t = lang === "ru"
    ? { total: "Всего", lead: verdict.summary }
    : { total: "Total", lead: verdict.summary };
  return `<div class="card hero">
  ${verdict.score != null ? `<div class="score-ring" style="--score: ${verdict.score}" data-band="${band}">
    <svg viewBox="0 0 120 120" aria-hidden="true">
      <circle class="track" cx="60" cy="60" r="52"></circle>
      <circle class="value" cx="60" cy="60" r="52"></circle>
    </svg>
    <div class="num"><b>${verdict.score}</b><span>/ 100</span></div>
  </div>` : ""}
  <div>
    <h1>${esc(meta.title)}</h1>
    <p class="lead">${mdish(t.lead)}</p>
    <div class="verdict-row">
      <span class="level-pill">${esc(verdict.level)}</span>
      <div class="counts">
        <div class="count-tile" data-severity="CRITICAL"><span class="n">${c.critical || 0}</span><span class="k">CRITICAL</span></div>
        <div class="count-tile" data-severity="MAJOR"><span class="n">${c.major || 0}</span><span class="k">MAJOR</span></div>
        <div class="count-tile"><span class="n">${c.minor || 0}</span><span class="k">MINOR</span></div>
        <div class="count-tile"><span class="n">${total}</span><span class="k">${t.total}</span></div>
      </div>
    </div>
    <div class="dist" role="img" aria-label="Severity distribution">
      <span class="seg-critical" style="width:${pct(c.critical || 0)}%"></span>
      <span class="seg-major" style="width:${pct(c.major || 0)}%"></span>
      <span class="seg-minor" style="width:${pct(c.minor || 0)}%"></span>
    </div>
  </div>
</div>`;
}

function renderFinding(f, lang) {
  const jiraUrl = f.jira
    ? `https://ainstance-labs.atlassian.net/browse/${encodeURIComponent(f.jira)}`
    : null;
  const shots = (f.screenshots || [])
    .map(
      (s) => `<figure class="shot">
      <img class="shot-img" src="assets/${esc(path.basename(s.src))}"
           alt="${esc(s.caption)}"
           data-lightbox-group="finding-${f.number}"
           data-caption="${esc(s.caption)}">
      <figcaption class="shot-cap">${esc(s.caption)}</figcaption>
    </figure>`,
    )
    .join("\n");
  const refs = [];
  if (f.design_ref) refs.push(`<div class="ref-row"><span class="ref-k">${lang === "ru" ? "Дизайн" : "Design"}</span><span class="ref-v">${esc(f.design_ref)}</span></div>`);
  if (f.shipped_ref) refs.push(`<div class="ref-row"><span class="ref-k">${lang === "ru" ? "Код" : "Shipped"}</span><span class="ref-v">${esc(f.shipped_ref)}</span></div>`);
  if (f.technique) refs.push(`<div class="ref-row"><span class="ref-k">${lang === "ru" ? "Техника" : "Technique"}</span><span class="ref-v">${esc(f.technique)}</span></div>`);
  return `<article class="card finding" id="finding-${f.number}">
  <div class="finding-head">
    <span class="finding-index">${f.number}</span>
    ${jiraUrl ? `<a class="jira-chip" href="${jiraUrl}" target="_blank" rel="noopener">${esc(f.jira)}</a>` : `<span class="jira-chip">${esc(f.jira || "—")}</span>`}
    <span class="badge" data-severity="${esc(f.severity)}">${esc(f.severity)}</span>
    <span class="area-tag">${esc(f.area || "")}</span>
    ${f.lane ? `<span class="lane-tag">${esc(f.lane)}</span>` : ""}
  </div>
  <h3>${esc(f.title)}</h3>
  <div class="finding-body">${mdish(f.description)}</div>
  ${refs.length ? `<div class="refs">${refs.join("")}</div>` : ""}
  ${shots ? `<div class="shots">${shots}</div>` : ""}
</article>`;
}

function renderArch(p, lang) {
  const notes = p.architecture_notes || [];
  if (notes.length === 0) return "";
  const title = lang === "ru" ? "Заметки по архитектуре" : "Architecture notes";
  const cards = notes
    .map(
      (n) => `<article class="card arch-note">
  <h3>${esc(n.title)}</h3>
  ${n.body ? `<div class="arch-body">${mdish(n.body)}</div>` : ""}
  ${n.diagram_svg ? `<div class="diagram">${n.diagram_svg}</div>` : ""}
  ${n.diagram_mermaid ? `<pre>${esc(n.diagram_mermaid)}</pre>` : ""}
</article>`,
    )
    .join("\n");
  return `<section aria-labelledby="arch-h">
  <h2 class="section-title" id="arch-h">${title}</h2>
  ${cards}
</section>`;
}

function renderExtras(p, lang) {
  const extras = (p.meta && p.meta.extras) || {};
  const rows = Object.entries(extras)
    .map(([k, v]) => `<div class="ref-row"><span class="ref-k">${esc(k)}</span><span class="ref-v">${esc(v)}</span></div>`)
    .join("");
  if (!rows) return "";
  const title = lang === "ru" ? "Контекст запуска" : "Run context";
  return `<article class="card"><h3>${title}</h3><div class="refs">${rows}</div></article>`;
}

function fill(tmpl, values) {
  let out = tmpl;
  for (const [k, v] of Object.entries(values)) {
    out = out.split(`{{${k}}}`).join(v);
  }
  return out;
}

const generatedAt = process.env.GENERATED_AT || new Date().toISOString().replace("T", " ").slice(0, 16) + " UTC";

// English
{
  const summary = renderSummary(payload, "en");
  const extras = renderExtras(payload, "en");
  const findings = payload.findings.map((f) => renderFinding(f, "en")).join("\n");
  const arch = renderArch(payload, "en");
  const values = {
    LANG: payload.meta.lang || "en",
    TITLE: esc(payload.meta.title),
    SUBTITLE: esc(payload.meta.subtitle || ""),
    DATE: esc(payload.meta.date),
    EPIC: esc(payload.meta.epic || ""),
    ASSETS_PATH: "assets/",
    SUMMARY_HTML: summary + "\n" + extras,
    FINDINGS_HTML: findings,
    ARCHITECTURE_HTML: arch,
    AUDITOR: esc(payload.meta.auditor || "agentic-report-creator"),
    SHIPPED_AT: esc(payload.meta.shipped_at || "—"),
    GENERATED_AT: esc(generatedAt),
  };
  writeFileSync(path.join(HERE, "index.html"), fill(enTmpl, values));
}

// Russian shell (all English fallback + Russian chrome; asset path adjusted)
{
  const summary = renderSummary(payload, "ru");
  const extras = renderExtras(payload, "ru");
  const findings = payload.findings.map((f) => renderFinding(f, "ru")).join("\n").replace(/src="assets\//g, 'src="../assets/');
  const arch = renderArch(payload, "ru");
  const values = {
    LANG: "ru",
    TITLE: esc(payload.meta.title),
    SUBTITLE: esc(payload.meta.subtitle || ""),
    DATE: esc(payload.meta.date),
    EPIC: esc(payload.meta.epic || ""),
    ASSETS_PATH: "../assets/",
    SUMMARY_HTML: summary + "\n" + extras,
    FINDINGS_HTML: findings,
    ARCHITECTURE_HTML: arch,
    AUDITOR: esc(payload.meta.auditor || "agentic-report-creator"),
    SHIPPED_AT: esc(payload.meta.shipped_at || "—"),
    GENERATED_AT: esc(generatedAt),
  };
  writeFileSync(path.join(HERE, "ru", "index.html"), fill(ruTmpl, values));
}

console.log("wrote index.html + ru/index.html");
