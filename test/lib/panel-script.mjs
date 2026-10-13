// Assemble the panel script body.
//
// Option 2 (architecture review): the renderer lives in
// `src/components/askRenderer.ejs`, included by `askScaffold.ejs` via
// `<%- include('./askRenderer.ejs') -%>`. VM-driven tests need the script body,
// so concatenate scaffold and partial in include order. The renderer is raw JS
// with no script tags, so no EJS tags remain after concat (renderer also stays
// in the s13-dod FAIL-A scan targets).
//
// `from` is the override slot. Pass rendered HTML such as a live template

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { injectModule, loadModule } from "../../addon/inject-build.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const REPO = path.resolve(__dirname, "..", "..");

const SCAFFOLD = "src/components/askScaffold.ejs";
const RENDERER = "src/components/askRenderer.ejs";

const SCRIPT_TAG = /<script>([\s\S]*?)<\/script>/g;
/** Scaffold renderer include. First group is the `-%>` slurp marker. */
const INCLUDE_TAG = /<%[-=]?\s*include\(['"]\.\/askRenderer\.ejs['"]\)\s*([-_])?%>/;

function scriptBody(src) {
  const m = [...src.matchAll(SCRIPT_TAG)];
  if (m.length < 1) throw new Error("script を抽出できない");
  return m.map((x) => x[1]).join("\n");
}

/** Partial body. No trailing newline (the scaffold side owns the include-site break). */
function rendererSource() {
  return fs.readFileSync(path.join(REPO, RENDERER), "utf8").replace(/\r?\n$/, "");
}

/** Replace the one scaffold include with the partial body. No EJS tags remain. */
function expandRenderer(src) {
  const m = INCLUDE_TAG.exec(src);
  if (!m) return src;
  let end = m.index + m[0].length;
  // EJS `-%>` drops one newline after the tag (ejs.js `^(?:\r\n|\r|\n)`).
  // The helper drops the same, so concat matches the build body byte-for-byte.
  if (m[1] === "-") {
    if (src.startsWith("\r\n", end)) end += 2;
    else if (/^[\r\n]/.test(src.slice(end, end + 1))) end += 1;
  }
  return src.slice(0, m.index) + rendererSource() + src.slice(end);
}

/**
 * Template body: scaffold + partial concatenated in include order.
 * `module: true` applies the same injection as the host build (OS5a). The
 * injector is the single addon/inject-build.mjs shared by build and tests.
 */
export function panelSource({ from, module: withModule = false } = {}) {
  const src = from
    ? fs.readFileSync(path.resolve(from), "utf8")
    : fs.readFileSync(path.join(REPO, SCAFFOLD), "utf8");
  const expanded = expandRenderer(src);
  return withModule ? injectModule(expanded, loadModule(REPO)) : expanded;
}

/** Script body fed to the VM (scaffold <script> concatenated into one). */
export function panelScript({ from, module: withModule = false } = {}) {
  return scriptBody(panelSource({ from, module: withModule }));
}
