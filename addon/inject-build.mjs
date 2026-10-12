#!/usr/bin/env node
// Build `addon/templates/inject.html` — the panel we append to note types the
// user already owns (issue #106, design docs/design/ask-injection.md §6.2,
// deleted 2026-10-09 by #214).
//
// Two inputs, one output:
//
// - `src/components/askScaffold.ejs` rendered by EJS. That is the same scaffold
//   the built note type includes, so the panel a third party's note type gets
//   is the panel we ship, not a fork of it.
// - the card body is NOT included. Our own Back Template draws the card and
//   then includes the scaffold; a target note type already draws its own card,
//   and design §6.5 says we append at the end of its answer template and draw
//   nothing of our own.
//
// One rewrite happens on the way out. `askScaffold.ejs` declares its CSS
// custom properties on `:root`, which is fine on a page we own and wrong on
// somebody else's: the injected template may already define `--ask-*` for its
// own reasons, and a page-level block is the widest possible way to collide.
// Design §7 requires the three ids we own instead, in the same order the #82
// defensive rules already use.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..");

export const SCAFFOLD_REL = "src/components/askScaffold.ejs";
export const OUT_REL = "addon/templates/inject.html";

// Same three ids, same order, as the `:where()` defensive rules in the
// scaffold (issue #82). Keeping one list means the panel cannot defend half of
// itself.
export const OWN_IDS = ["#umeboshi-ask", "#umeboshi-ask-settings-modal", "#umeboshi-ask-consent-modal"];

const ROOT_RULE = /:root,\s*:root\[data-theme="light"\]\s*\{/g;

// OS5a (#261): the OSS panel ships as a base with empty seams, and the private
// billing module writes itself into them. Both modes go through this one file:
// the build and the vm test harness call the same injector, so a seam the tests
// cannot fill is a seam the build cannot fill either.
//
// A seam is a begin/end marker pair, the same idea as the note-type injection
// markers in addon/inject.py. The build replaces the whole pair (markers
// included) with the module's text for that seam; base leaves the pair empty.
// A lone marker — a begin without its end, or a name the module does not
// answer — is an error: silently shipping a panel whose billing half is missing
// is exactly the failure this split exists to prevent.
// A seam is a begin/end marker pair. The opener is `/*` inside <style>/<script>
// and `<!--` in markup. The body between markers must not contain another
// marker, so the split is unambiguous: with `[\s\S]*?` a seam could otherwise
// swallow the span to a later seam's end and leave the i18n seams invisible.
const NO_MARKER = "(?:(?!umeboshi-ask:module:)[\\s\\S])*?";
// Seam names are word characters plus the `:` that layers use (i18n:ja,
// css:a). `[\\w:.-]` rather than `[a-zA-Z:.-]`: the latter silently fails to
// match names containing a colon on some engines.
const SEAM_NAME = "[\\w:.-]+";
const SEAM_RE = new RegExp(
  "(?:\\/\\* umeboshi-ask:module:(" + SEAM_NAME + ") begin \\*\\/(" + NO_MARKER +
    ")\\/\\* umeboshi-ask:module:\\1 end \\*\\/" +
    "|<!-- umeboshi-ask:module:(" + SEAM_NAME + ") begin -->(" + NO_MARKER +
    ")<!-- umeboshi-ask:module:\\3 end -->)",
  "g",
);

/** Seam name of a SEAM_RE match (comment and markup kinds are positional). */
function seamName(m) {
  return m[1] !== undefined ? m[1] : m[3];
}
const MODULE_REL = "src/commercial/panel-module.js";

/**
 * eol for text that is about to be spliced into `source`.
 * The repo checks out with CRLF but the index holds LF, so a module authored
 * on either line ending has to match the file it lands in or the built panel
 * mixes the two. Returns the terminator `text` should use, or null to keep it.
 */
function eolOf(source, text) {
  const crlfIn = (s) => /\r\n/.test(s);
  const lfIn = (s) => /[^\r]\n/.test(s);
  if (crlfIn(source)) return lfIn(text) && !crlfIn(text) ? "\r\n" : null;
  return crlfIn(text) ? "\n" : null;
}

function toEol(text, eol) {
  return eol === null ? text : text.replace(/\r\n|\n/g, eol);
}

/**
 * The private module, or null when it is absent (the OSS tree).
 * Absence is the base build, not an error: `src/commercial/` is dropped when
 * OS6c assembles the public tree, and that build must still work.
 */
export function loadModule(repoRoot = REPO) {
  const p = path.join(repoRoot, MODULE_REL);
  if (!fs.existsSync(p)) return null;
  const require = createRequire(import.meta.url);
  return require(p).default ?? require(p);
}

/**
 * The indent the seam itself sits at is text *before* `begin`, so it survives
 * the replacement and lands in front of the payload's first line. A payload
 * written at its target depth would therefore double that indent on line one,
 * while its later lines need it. So strip only the first line's leading
 * whitespace: the seam's own indent then indents line one, and the payload's
 * own relative indentation carries every line after it.
 */
function dedent(text) {
  const nl = text.indexOf("\n");
  if (nl < 0) return text.replace(/^[ \t]+/, "");
  return text.slice(0, nl).replace(/^[ \t]+/, "") + text.slice(nl);
}

/**
 * Fill the module seams in `source`.
 *
 * Unknown seams (a begin/end pair the module does not answer) throw: a base
 * panel that stops telling modules where to write has to fail the build, not
 * quietly keep its own empty markers. `module === null` leaves every seam empty
 * and returns `source` unchanged, which is the base build.
 */
export function injectModule(source, module) {
  if (!module) return source;
  const answers = {};
  // markup / css / i18n are seam-name keyed tables; script is one whole payload
  // for the single script seam.
  const put = (name, text) => {
    if (name in answers) throw new Error(`module seam name repeats across layers: ${name}`);
    const payload = dedent(String(text));
    const eol = eolOf(source, payload);
    answers[name] = toEol(payload, eol);
  };
  for (const layer of ["markup", "css", "i18n"]) {
    const tbl = module[layer];
    if (!tbl) continue;
    for (const name of Object.keys(tbl)) put(name, tbl[name]);
  }
  if (module.script) put("script", module.script);
  const seen = new Set();
  const out = source.replace(SEAM_RE, (...args) => {
    // (match, ...groups, offset, string) — drop the trailing two.
    const m = args.slice(0, -2);
    const name = seamName(m);
    if (!(name in answers)) throw new Error(`base declares a seam the module does not answer: ${name}`);
    seen.add(name);
    return answers[name];
  });
  for (const name of Object.keys(answers)) {
    if (!seen.has(name)) throw new Error(`module answers a seam the base does not declare: ${name}`);
  }
  return out;
}

function renderScaffold(repoRoot) {
  const require = createRequire(import.meta.url);
  const ejs = require(path.join(repoRoot, "node_modules", "ejs"));
  const scaffoldPath = path.join(repoRoot, SCAFFOLD_REL);
  const html = ejs.render(fs.readFileSync(scaffoldPath, "utf8"), {}, {
    filename: scaffoldPath,
    views: [repoRoot],
  });

  const matches = html.match(ROOT_RULE);
  if (!matches || matches.length !== 1) {
    throw new Error(
      `${SCAFFOLD_REL} must declare its custom properties in exactly one ` +
        `':root, :root[data-theme="light"] {' rule; found ${matches ? matches.length : 0}. ` +
        "The injection build rewrites that rule onto the ids we own and cannot do it blind.",
    );
  }
  return html.replace(ROOT_RULE, `${OWN_IDS.join(", ")} {`);
}

/** The scaffold rendered, with the module injected when it exists. */
export function buildPanel(repoRoot = REPO, { module: withModule = true } = {}) {
  const html = renderScaffold(repoRoot);
  const mod = withModule ? loadModule(repoRoot) : null;
  return injectModule(html, mod);
}

/**
 * Render the scaffold and move the custom properties off `:root`.
 * Throws when the rule is absent or ambiguous: a silent no-op here ships a
 * panel that writes its variables onto somebody else's whole page.
 */
export function buildInjectPanel(repoRoot = REPO) {
  return buildPanel(repoRoot, { module: false });
}

function main() {
  // `--module` builds the host panel (base + private billing module). The
  // default is base, which is what the AnkiWeb add-on ships.
  const withModule = process.argv.includes("--module");
  const html = buildPanel(REPO, { module: withModule });
  const out = path.join(REPO, OUT_REL);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, html);
  console.log(`wrote ${OUT_REL} (${fs.statSync(out).size} bytes, ${withModule ? "base + module" : "base"})`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}