// #266 OS6b: OSS-tree boundary guard. Fails if billing terms appear.
//
// Scope is `git ls-files` (tracked files only). Defined in test/lib/oss-scope.mjs
// (inScope/outReason + KEYWORDS); OS6c reuses it to assemble the OSS tree.
//
// Keyword scan runs on the "code layer". Line/block comments in JS/TS/Python and
// JS/TS string contents are stripped first. Plain substring match misfires:
// base comment mentions (`kind "billing"` kind-label notes etc.) and `m.credits`
// reads (receiving the price field sent by the Worker) must be handled correctly.
//
// Allowed with documented reasons (ALLOW_NOTES in oss-scope.mjs):
// - `.credits` property access is stripped from the code layer (whole access).
// - `kind === "billing"` kind strings fall out since string contents are unseen.
// Absence of billing copy in base is pinned separately ((a) below).
//
// Boundary consistency tests live here too (keyword scan alone has gaps):
// - (a) base panel has no billing copy (billingTokens equivalent)
// - (b) core models response has no credits field (see bundle definition)
// - (c) core cannot reach the hosted 8 modules (OS4b worker-auth-split
// pins it, so only a comment reference stays here)
// Binaries and out-of-scope files are not scanned. Skips stay explicit.
//
// Run with: node --test "test/*.test.mjs"

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildPanel } from "../addon/inject-build.mjs";
import {
  ALLOW_NOTES,
  CORE_REACHABLE,
  HOST_ROOT_TESTS,
  KEYWORD_NOTES,
  KEYWORDS,
  OSS_ROOT_TESTS,
  inScope,
  outReason,
} from "./lib/oss-scope.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, "..");
const read = (rel) => fs.readFileSync(path.join(REPO, rel), "utf8");
// OSS tree has no private module. The injected-build existence pin is host-only.
const HAS_MODULE = fs.existsSync(path.join(REPO, "src/commercial/panel-module.js"));

// Evaluate tracked files only (`git ls-files`). Ignore untracked scratch files.
// The OSS tree is not a git repo, so fall back to a worktree walk there
// (skipping node_modules, .wrangler, etc.).
function trackedFiles() {
  try {
    return execFileSync("git", ["ls-files"], { cwd: REPO, encoding: "utf8" })
      .split("\n")
      .map((s) => s.trim())
      .filter((s) => s !== "");
  } catch {
    // For the OSS tree. Without git there is no tracked/untracked split, so
    // walk every file (the caller-side inScope decides exclusions).
    const out = [];
    const walk = (dir) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        if (e.name === "node_modules" || e.name === ".wrangler" || e.name === ".git") continue;
        const full = path.join(dir, e.name);
        if (e.isDirectory()) walk(full);
        else if (e.isFile()) out.push(path.relative(REPO, full).replace(/\\/g, "/"));
      }
    };
    walk(REPO);
    return out;
  }
}

// Strip JS/TS string contents. '...' "..." `...` (escape-aware).
// Template ${...} is an expression, so keep it (scan the expr, not the text).
function stripStrings(src) {
  return src.replace(
    /'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|`(?:[^`\\]|\\.)*`/gs,
    (m) => {
      if (m.startsWith("`")) {
        const inner = m.slice(1, -1);
        const exprs = [...inner.matchAll(/\$\{((?:[^{}]|\{[^{}]*\})*)\}/g)]
          .map((x) => x[1])
          .join(";");
        return `\`${exprs}\``;
      }
      return `""`;
    },
  );
}

// Code layer. Search with comments removed. String contents unseen too.
// Base comment mentions (`kind "billing"` kind-label notes etc.) drop out here.
function codeLayer(src, ext) {
  let s = src;
  if (ext === ".py") {
    s = s.replace(/'''(?:[^\\]|\\.)*?'''|"""(?:[^\\]|\\.)*?"""/gs, `""`);
    s = stripStrings(s);
    s = s.replace(/^[ \t]*#[^\n]*/gm, "");
    return s;
  }
  if (ext === "" || ext === ".sh" || ext === ".toml") {
    s = stripStrings(s);
    s = s.replace(/^[ \t]*#[^\n]*/gm, "");
    return s;
  }
  if (ext === ".json") {
    s = stripStrings(s);
    return s;
  }
  // JS/TS/MJS/EJS/HTML: strip HTML comments, strings, block, line comments in order.
  s = s.replace(/<!--[\s\S]*?-->/g, "");
  s = stripStrings(s);
  s = s.replace(/\/\*[\s\S]*?\*\//g, "");
  s = s.replace(/^[ \t]*\/\/[^\n]*/gm, "");
  return s;
}

// `.credits` property access receives the price field sent by the Worker,
// not a billing-concept introduction. Strip the whole property access.
// (Stripping only the name after `.` leaves `m` etc., harmless everyday
// words, but stripping the whole access leaves a smaller hole: an `x.billing`
// style introduction drops out too. `x.billing` is also covered by pin (a).)
function stripPropertyAccess(src) {
  return src.replace(/\.[A-Za-z_$][\w$]*/g, ".");
}

function scanHits(layer) {
  const hits = [];
  const lines = layer.split("\n");
  lines.forEach((line, idx) => {
    for (const { word, pattern } of KEYWORDS) {
      pattern.lastIndex = 0;
      let m = null;
      let guard = 0;
      while ((m = pattern.exec(line)) !== null && guard++ < 20) {
        hits.push(`${idx + 1}:${word}:${line.trim().slice(0, 160)}`);
        if (m.index === pattern.lastIndex) pattern.lastIndex += 1;
      }
    }
  });
  return hits;
}

const extOf = (p) => {
  const i = p.lastIndexOf(".");
  return i < 0 ? "" : p.slice(i).toLowerCase();
};

function scanFile(rel) {
  const layer = stripPropertyAccess(codeLayer(read(rel), extOf(rel)));
  return scanHits(layer);
}

describe("#266 OS6b OSS tree に課金語が無い", () => {
  it("keyword リスト自体が pin されている (日常語は入っていない)", () => {
    const words = KEYWORDS.map((k) => k.word);
    assert.deepEqual(
      words,
      [
        "billing",
        "Stripe",
        "checkout",
        "credits",
        "subscription",
        "topup",
        "promo",
        "クレジット",
        "価格",
        "料金",
        "請求",
        "残高",
      ],
      "KEYWORDS が変わった。日常語 (plan・usage・model 等) を足さないこと",
    );
    // Pin that no everyday word is a keyword.
    for (const everyday of ["plan", "usage", "model", "token", "price", "cost", "free", "limit"]) {
      assert.ok(!words.includes(everyday), `${everyday} は日常語。keyword に入れない`);
    }
    // Every keyword has a selection reason.
    for (const { word } of KEYWORDS) {
      assert.ok(KEYWORD_NOTES[word], `${word} の選定理由が無い`);
    }
    assert.ok(ALLOW_NOTES.length >= 2, "除外理由つき許容が消えた");
  });

  it("scope 定義が pin されている (含める・除くが変わったら赤)", () => {
    // Worker set is defined by import reachability. Transitive closure of core.ts static imports.
    assert.deepEqual(
      [...CORE_REACHABLE].sort(),
      [
        "chat.ts",
        "core.ts",
        "cors.ts",
        "identity.ts",
        "models.ts",
        "panel.ts",
        "secret.ts",
        "settings.ts",
        "stores.ts",
        "threads.ts",
      ].sort(),
      "CORE_REACHABLE が変わった",
    );
    // OS6c: addon-package, anki-note-types, archive-shadowing, note-types-
    // freshness, ja-en-parity, setup-min are host-only (they touch PUBLISH/CHECKLIST,
    // fixtures, git history, site), so they moved host-side. Only the 5 green
    // ones are evaluated.
    assert.deepEqual(
      [...OSS_ROOT_TESTS].sort(),
      [
        "test/s13-dod.test.mjs",
        "test/os2c-selfhost.test.mjs",
        "test/panel-module.test.mjs",
        "test/panel-version.test.mjs",
        "test/thread-head-typography.test.mjs",
      ].sort(),
      "OSS_ROOT_TESTS が変わった",
    );
    // Host-side root tests stay out of scope.
    for (const t of [
      "test/um4-compat.test.mjs",
      "test/panel-billing-dod.test.mjs",
      "test/worker-auth-split.test.mjs",
      "test/addon-package.test.mjs",
      "test/anki-note-types.test.mjs",
      "test/archive-shadowing.test.mjs",
      "test/note-types-freshness.test.mjs",
      "test/ja-en-parity.test.mjs",
      "test/setup-min.test.mjs",
    ]) {
      assert.ok(HOST_ROOT_TESTS.includes(t), `${t} が host 側から外れた`);
      assert.equal(inScope(t), false, `${t} が scope に入った`);
    }
    // Representative exclusions are out of scope.
    for (const t of [
      "src/commercial/panel-module.js",
      "claudeflare/src/index.ts",
      "claudeflare/src/auth.ts",
      "claudeflare/src/billing.ts",
      "claudeflare/src/billing-view.ts",
      "claudeflare/src/anon.ts",
      "claudeflare/src/settle.ts",
      "claudeflare/src/usage.ts",
      "claudeflare/src/reconcile.ts",
      "claudeflare/src/ratelimit.ts",
      "claudeflare/wrangler.toml",
      "CONTEXT.md",
      "DESIGN.md",
      "AGENTS.md",
    ]) {
      assert.equal(inScope(t), false, `${t} が scope に入った`);
      assert.ok(outReason(t) !== null, `${t} の除外理由が無い`);
    }
    // Representative inclusions are in scope.
    for (const t of [
      "src/components/askScaffold.ejs",
      "src/components/askRenderer.ejs",
      "addon/templates/inject.html",
      "addon/config.json",
      "package.json",
      "build",
      "claudeflare/wrangler.core.toml",
      "claudeflare/package.json",
      "claudeflare/tsconfig.json",
      "claudeflare/src/core.ts",
      "claudeflare/src/models.ts",
      "test/panel-module.test.mjs",
      "oss/assemble.mjs",
      "oss/CONTRIBUTING.md",
      "oss/CODEOWNERS",
      "oss/SECURITY.md",
      "oss/ISSUE_TEMPLATE/bug_report.md",
      "oss/ISSUE_TEMPLATE/feature_request.md",
      "oss/ISSUE_TEMPLATE/selfhost_help.md",
    ]) {
      assert.equal(inScope(t), true, `${t} が scope から外れた`);
    }
  });

  it("core.ts は ratelimit・anon を import しない", () => {
    const core = read("claudeflare/src/core.ts");
    assert.equal(/from\s+"\.\/ratelimit"/.test(core), false, "core.ts が ratelimit を import した");
    assert.equal(/from\s+"\.\/anon"/.test(core), false, "core.ts が anon を import した");
    // Reachability-set soundness: core.ts direct imports close under CORE_REACHABLE.
    const direct = [...core.matchAll(/from\s+"\.\/([^"]+)"/g)].map((m) =>
      m[1].endsWith(".ts") ? m[1] : `${m[1]}.ts`,
    );
    for (const d of direct) {
      assert.ok(CORE_REACHABLE.includes(d), `core.ts の import ${d} が CORE_REACHABLE に無い`);
    }
  });

  it("追跡バイナリ・画像は読まずに skip する", () => {
    const tracked = trackedFiles();
    const skipped = tracked.filter((f) => {
      if (f.endsWith(".ankiaddon")) return true;
      return /\.(png|jpg|jpeg|webp|ico)$/i.test(f);
    });
    // OSS tree carries no tracked binaries/images, so skip when absent.
    // On the host side, pin as before.
    if (!tracked.includes("umeboshi-ask-companion.ankiaddon")) return;
    assert.ok(skipped.length > 0, "skip 対象が無い (バイナリ・画像の追跡が消えた?)");
    assert.ok(
      skipped.includes("umeboshi-ask-companion.ankiaddon"),
      ".ankiaddon を skip していない",
    );
    const buf = fs.readFileSync(path.join(REPO, "umeboshi-ask-companion.ankiaddon"));
    assert.ok(buf.includes(0), ".ankiaddon がバイナリでなくなった?");
  });

  it("対象外は走査しない (host 側に課金語があっても赤にならない)", () => {
    // The OSS tree lacks the host-side representatives, so just confirm nothing is seen.
    // On the host side, pin as before that billing-term representatives are out of scope.
    if (!fs.existsSync(path.join(REPO, "claudeflare/src/billing.ts"))) {
      assert.equal(inScope("claudeflare/src/billing.ts"), false);
      assert.equal(inScope("src/commercial/panel-module.js"), false);
      return;
    }
    // Host-side representatives carry billing terms (proof the scan would fail if it saw them).
    assert.match(read("claudeflare/src/billing.ts"), /Stripe/, "host 側の前提が崩れた");
    assert.equal(inScope("claudeflare/src/billing.ts"), false, "billing.ts が scope に入った");
    assert.equal(inScope("src/commercial/panel-module.js"), false, "module が scope に入った");
  });

  it("OSS tree に課金語が無い (コメント・文字列・property access を除く層で)", () => {
    const tracked = trackedFiles();
    const target = tracked.filter((f) => inScope(f));
    assert.ok(target.length > 30, `scope が狭すぎる (${target.length} 件)`);
    // Fail if a tracked in-scope file disappears (OS6c assembly soundness).
    for (const must of [
      "src/components/askScaffold.ejs",
      "src/components/askRenderer.ejs",
      "addon/templates/inject.html",
      "claudeflare/src/core.ts",
      "claudeflare/src/models.ts",
      "claudeflare/wrangler.core.toml",
      "package.json",
      "build",
      "addon/config.json",
    ]) {
      assert.ok(target.includes(must), `${must} が追跡から消えた`);
    }
    const failures = [];
    for (const f of target.sort()) {
      // OSS-side root tests and test/lib are unscanned. They only mention the
      // host diff (billing module presence, price-field fixtures), not an
      // implementation. Their own terms are pinned by the keyword-list snapshot.
      if (/^test\//.test(f)) continue;
      const hits = scanFile(f);
      // models.ts `credits` is the legit reservation, pinned with (b).
      // Exclude only `credits` so any other billing term still fails.
      const rest = f === "claudeflare/src/models.ts"
        ? hits.filter((h) => !/:credits:/.test(h))
        : hits;
      if (rest.length > 0) failures.push(`${f}\n  ${rest.join("\n  ")}`);
    }
    assert.equal(failures.length, 0, `OSS tree に課金語が残った:\n${failures.join("\n")}`);
  });

  it("(a) base panel に billing 文面が無い (module が足す課金トークン)", () => {
    // BillingTokens equivalent from panel-module.test.mjs. Credit-balance, plan-billing,
    // and billing-management ids and title rows are absent from the base build output.
    const base = buildPanel(REPO, { module: false });
    for (const id of [
      "umeboshi-ask-credit-notice",
      "umeboshi-ask-credit-status",
      "umeboshi-ask-credit-refresh",
      "umeboshi-ask-billing-btn",
      "umeboshi-ask-billing-status",
      "umeboshi-ask-billing-note",
      "umeboshi-ask-billing-login-hint",
      "umeboshi-ask-title-credit",
      "umeboshi-ask-title-billing",
    ]) {
      assert.ok(!base.includes(`id="${id}"`), `base に課金要素が残った: ${id}`);
    }
    // The injected build has the same tokens (proof the pin is not vacuous).
    // The OSS tree has no module, so check this host-side only.
    if (HAS_MODULE) {
      const injected = buildPanel(REPO, { module: true });
      for (const id of ["umeboshi-ask-billing-btn", "umeboshi-ask-credit-status"]) {
        assert.ok(injected.includes(`id="${id}"`), `注入版に ${id} が無い (pin が空振り)`);
      }
    }
    // Build output addon/templates/inject.html matches the base.
    assert.equal(
      read("addon/templates/inject.html").replace(/\r/g, ""),
      base.replace(/\r/g, ""),
      "addon/templates/inject.html が base build と違う",
    );
  });

  it("(b) core の models 応答に credits 字段が無い (落とす実装を pin)", () => {
    // Without importing TS directly, check that core.ts drops credits from the list.
    // The bundle definition itself keeps `credits` (the legit reservation, left
    // to pin (b) by the keyword scan). Response shape is pinned by the existing
    // core test in claudeflare/test/core/core.test.ts.
    // Here pin the dropping implementation's text as the boundary guard.
    const core = read("claudeflare/src/core.ts");
    assert.ok(/delete bare\.credits/.test(core), "core.ts が credits を落とさなくなった");
    // The drop target is the models response (it lives inside the models route).
    const route = core.indexOf("/api/ask/models");
    const del = core.indexOf("delete bare.credits");
    assert.ok(route !== -1 && del > route, "credits 落としが models route に無い");
  });

  it("(c) core から hosted 8 module へ到達不能 (OS4b の pin を指すだけ)", () => {
    // Pinned by OS4b test/worker-auth-split.test.mjs ("billing lives only in the
    // hosted worker") for import-graph unreachability. No duplication here, per
    // the parent design call to keep only a comment reference.
    // Recap only the point here: the hosted 8 modules are out of scope.
    for (const m of [
      "index.ts",
      "auth.ts",
      "billing.ts",
      "billing-view.ts",
      "anon.ts",
      "settle.ts",
      "usage.ts",
      "reconcile.ts",
      "ratelimit.ts",
    ]) {
      assert.equal(inScope(`claudeflare/src/${m}`), false, `${m} が scope に入った`);
    }
  });
});
