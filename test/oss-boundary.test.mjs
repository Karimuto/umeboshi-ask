// #266 OS6b: OSS tree の境界ガード。課金語が現れたら失敗する。
//
// 対象範囲は `git ls-files` (追跡ファイルのみ)。定義は test/lib/oss-scope.mjs
// (IN_SCOPE・KEYWORDS) に置き、OS6c が OSS tree 組み立てに使い回す。
//
// keyword 走査は「コード層」で行う。JS/TS/Python の行・ブロックコメントと
// JS/TS 文字列の中身は除外して走査する。単純な部分一致では誤爆する:
// base のコメント言及 (`kind "billing"` の種別子の説明等) と `m.credits` の
// 読取 (Worker が送る価格字段の受取) が正しく扱われる設計にする。
//
// 除外理由つき許容 (oss-scope.mjs の ALLOW_NOTES):
// - `.credits` の property access はコード層から外す (property access 丸ごと)。
// - `kind === "billing"` の kind 文字列は文字列の中身を見ないので外れる。
// base に billing 文面が無いことは別 pin (下の (a)) で見る。
//
// 境界整合テストも同じファイルに足す (keyword 走査だけでは穴になるため):
// - (a) base panel に billing 文面が無い (billingTokens 相当)
// - (b) core の models 応答に credits 字段が無い (bundle 定義を見る)
// - (c) core から hosted 8 module へ到達不能 (OS4b の worker-auth-split の
// pin があるので、ここでは参照をコメントに残すだけ)
// バイナリと対象外は走査しない。skip したことを明示する。
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
// OSS tree には private module が無い。注入版の存在 pin は host 側だけ。
const HAS_MODULE = fs.existsSync(path.join(REPO, "src/commercial/panel-module.js"));

// 追跡ファイルだけを評価する (`git ls-files`)。未追跡の一時物は見ない。
// OSS tree は git repo ではないので、そのときは作業ツリーの列挙に
// フォールバックする (node_modules・.wrangler 等は見ない)。
function trackedFiles() {
  try {
    return execFileSync("git", ["ls-files"], { cwd: REPO, encoding: "utf8" })
      .split("\n")
      .map((s) => s.trim())
      .filter((s) => s !== "");
  } catch {
    // OSS tree 用。git が無い場所では追跡の区別が付かないので、
    // 全ファイルを列挙する (除外は呼び側の inScope が決める)。
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

 // JS/TS 文字列の中身を外す。'...' "..." `...` (escape 対応)。
// template の ${...} は式なので残す (字面ではなく式だけ見る)。
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

// コード層。コメントを除いた層で探す。文字列の中身も見ない。
// base のコメント言及 (`kind "billing"` の種別子の説明等) はここで落ちる。
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
  // JS/TS/MJS/EJS/HTML: HTML コメント・文字列・ブロック・行コメントの順で外す。
  s = s.replace(/<!--[\s\S]*?-->/g, "");
  s = stripStrings(s);
  s = s.replace(/\/\*[\s\S]*?\*\//g, "");
  s = s.replace(/^[ \t]*\/\/[^\n]*/gm, "");
  return s;
}

// `.credits` の property access は Worker が送る価格字段の受取であり、
// 課金概念の導入ではない。property access 丸ごと外す。
// (`.` の後ろの名前だけ外すと `m` 等が残るが日常語なので誤爆しない。
// むしろ access 丸ごと外す方が穴が小さい: `x.billing` の形の導入も落ちる。
// ただし `x.billing` は別 pin (a) の billing トークンでも見る。)
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
    // 日常語が keyword に入っていないことの pin。
    for (const everyday of ["plan", "usage", "model", "token", "price", "cost", "free", "limit"]) {
      assert.ok(!words.includes(everyday), `${everyday} は日常語。keyword に入れない`);
    }
    // 語ごとの選定理由が全 keyword にあること。
    for (const { word } of KEYWORDS) {
      assert.ok(KEYWORD_NOTES[word], `${word} の選定理由が無い`);
    }
    assert.ok(ALLOW_NOTES.length >= 2, "除外理由つき許容が消えた");
  });

  it("scope 定義が pin されている (含める・除くが変わったら赤)", () => {
    // worker は import 到達で定義する。core.ts の静的 import の推移閉包。
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
    // OS6c: addon-package・anki-note-types・archive-shadowing・note-types-
    // freshness・ja-en-parity・setup-min は host 専用物（PUBLISH/CHECKLIST・
    // fixture・git 履歴・site）を参照するので host 側へ移した。OSS tree 内で
    // 緑になる 5 本だけを評価する。
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
    // host 側 root テストは対象外のまま。
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
    // 除くものの代表が scope に入っていないこと。
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
    // 含めるものの代表が scope に入っていること。
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
    // 到達集合の正しさ: core.ts の直接 import が CORE_REACHABLE に閉じる。
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
    // OSS tree には追跡バイナリ・画像を持ち込まないので、無ければ skip。
    // host 側では従来どおり pin する。
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
    // OSS tree には host 側の代表が無いので、何も見ないことを確認して終わる。
    // host 側では従来どおり、課金語のある代表が scope 外であることを pin する。
    if (!fs.existsSync(path.join(REPO, "claudeflare/src/billing.ts"))) {
      assert.equal(inScope("claudeflare/src/billing.ts"), false);
      assert.equal(inScope("src/commercial/panel-module.js"), false);
      return;
    }
    // host 側の代表に課金語があること (走査がそこを見たら赤になる証拠)。
    assert.match(read("claudeflare/src/billing.ts"), /Stripe/, "host 側の前提が崩れた");
    assert.equal(inScope("claudeflare/src/billing.ts"), false, "billing.ts が scope に入った");
    assert.equal(inScope("src/commercial/panel-module.js"), false, "module が scope に入った");
  });

  it("OSS tree に課金語が無い (コメント・文字列・property access を除く層で)", () => {
    const tracked = trackedFiles();
    const target = tracked.filter((f) => inScope(f));
    assert.ok(target.length > 30, `scope が狭すぎる (${target.length} 件)`);
    // scope にある追跡ファイルが消えたら赤 (OS6c の組み立ての正しさ)。
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
      // OSS 側 root テストと test/lib は走査対象外。host との差分を述べる言及
      // (billing module の有無・price 字段の fixture) であり、実装の導入では
      // ない。テスト自体の導入は keyword リストの snapshot で pin する。
      if (/^test\//.test(f)) continue;
      const hits = scanFile(f);
      // models.ts の `credits` は予約額の正であり (b) と組で pin。
      // 他の課金語が混ざったら赤になるよう `credits` だけ外す。
      const rest = f === "claudeflare/src/models.ts"
        ? hits.filter((h) => !/:credits:/.test(h))
        : hits;
      if (rest.length > 0) failures.push(`${f}\n  ${rest.join("\n  ")}`);
    }
    assert.equal(failures.length, 0, `OSS tree に課金語が残った:\n${failures.join("\n")}`);
  });

  it("(a) base panel に billing 文面が無い (module が足す課金トークン)", () => {
    // panel-module.test.mjs の billingTokens 相当。クレジット残量・プラン課金・
    // 請求管理の id やタイトル行が base の build 出力に無い。
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
    // 注入版には同じトークンがある (pin が空振りしていない証拠)。
    // OSS tree には module が無いので、host 側だけで見る。
    if (HAS_MODULE) {
      const injected = buildPanel(REPO, { module: true });
      for (const id of ["umeboshi-ask-billing-btn", "umeboshi-ask-credit-status"]) {
        assert.ok(injected.includes(`id="${id}"`), `注入版に ${id} が無い (pin が空振り)`);
      }
    }
    // build 出力の addon/templates/inject.html は base と一致する。
    assert.equal(
      read("addon/templates/inject.html").replace(/\r/g, ""),
      base.replace(/\r/g, ""),
      "addon/templates/inject.html が base build と違う",
    );
  });

  it("(b) core の models 応答に credits 字段が無い (落とす実装を pin)", () => {
    // TS を直接 import せず、core.ts が一覧から credits を落とす実装を持つ
    // ことを見る。bundle 定義自体は `credits` を持つ (予約額の正であり、
    // keyword 走査では (b) の pin に委ねる)。応答の pin は core 側の既存
    // テスト claudeflare/test/core/core.test.ts
    // ("モデル一覧は bundle のみで credits 字段も落ちる") が持つ。
    // ここでは境界ガードとして落とす実装の字面を pin する。
    const core = read("claudeflare/src/core.ts");
    assert.ok(/delete bare\.credits/.test(core), "core.ts が credits を落とさなくなった");
    // 落とす対象が models 応答であること (models route の中に居る)。
    const route = core.indexOf("/api/ask/models");
    const del = core.indexOf("delete bare.credits");
    assert.ok(route !== -1 && del > route, "credits 落としが models route に無い");
  });

  it("(c) core から hosted 8 module へ到達不能 (OS4b の pin を指すだけ)", () => {
    // OS4b の test/worker-auth-split.test.mjs ("billing lives only in the
    // hosted worker") が import グラフの到達不能を pin 済み。ここでは重複させ
    // ない。参照をコメントに残すだけでよい、という親の設計判断どおり。
    // 到達不能の要点だけ此处でもなぞる: hosted 8 module が scope に無い。
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
