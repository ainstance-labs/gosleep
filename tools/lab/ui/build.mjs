// =============================================================================
// gosleep lab — the UI build. STDIN: render_bundle.json. STDOUT: {"ok":true,"pages":{...}}.
//
// It writes NOTHING to the repo. Not the pages, not a directory, not a lockfile. Python takes the
// map this prints and writes each page through tools/lab/lab-write.sh (temp + rename), which is the
// only writer in the laboratory that cannot leave a torn file behind. A node process killed halfway
// through page five therefore cannot corrupt a dashboard: it just fails, and the previous pages —
// whole, stale, and honestly labelled as stale — stay on disk.
//
// The ONE exception is .build/, a scratch dir beside this file (gitignored): esbuild has to put the
// compiled renderer somewhere before node can import it. It is outside --repo on purpose, so a
// chronicler pass against a throwaway repo (smoke.sh does exactly that) cannot litter it.
//
// Two esbuild passes, because the two outputs run in different places:
//   src/render.tsx  -> .build/render.mjs   (platform:node — runs HERE, once, to make the HTML)
//   src/client.ts   -> a JS string         (platform:browser — runs in the OWNER'S browser, inlined)
// =============================================================================

import { build } from "esbuild";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const BUILD_DIR = join(HERE, ".build");

const COMMON = {
  bundle: true,
  format: "esm",
  target: "es2022",
  logLevel: "silent",
  jsx: "automatic",
  jsxImportSource: "preact",
};

async function readStdin() {
  const chunks = [];
  for await (const c of process.stdin) chunks.push(c);
  return Buffer.concat(chunks).toString("utf8");
}

async function main() {
  const raw = await readStdin();
  if (!raw.trim()) throw new Error("empty stdin: expected render_bundle.json");
  const bundle = JSON.parse(raw);

  mkdirSync(BUILD_DIR, { recursive: true });

  // The owner's browser gets this verbatim, inlined into every page. NOT minified on purpose: it is
  // a couple of KB, it ships inside a file the owner may well read, and smoke.sh asserts against its
  // source. A minifier that renamed `getElementById("stale-verdict")`'s caller would save 400 bytes
  // and cost us the one test that proves the page cannot lie about being alive.
  const client = await build({
    ...COMMON,
    entryPoints: [join(HERE, "src", "client.ts")],
    platform: "browser",
    write: false,
    minify: false,
  });
  const clientJs = client.outputFiles[0].text;

  const renderOut = join(BUILD_DIR, "render.mjs");
  await build({
    ...COMMON,
    entryPoints: [join(HERE, "src", "render.tsx")],
    platform: "node",
    outfile: renderOut,
    // preact ships ESM; bundling it in keeps .build/ self-contained and import-able without a
    // resolution walk back up into node_modules at import time.
    packages: "bundle",
  });

  const { renderAll } = await import(pathToFileURL(renderOut).href);
  const pages = renderAll(bundle, clientJs);

  process.stdout.write(
    JSON.stringify({
      ok: true,
      renderer: "preact-render-to-string (esbuild SSG)",
      pages,
      screens: Object.keys(pages),
    }),
  );
}

main().catch((err) => {
  process.stdout.write(JSON.stringify({ ok: false, error: String(err && err.message ? err.message : err) }));
  process.exitCode = 1;
});
