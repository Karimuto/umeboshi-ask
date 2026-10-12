import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { buildPanel, injectModule, loadModule } from "../addon/inject-build.mjs";
import { panelSource, panelScript } from "./lib/panel-script.mjs";

// OS5a (#261): the billing panel is a build mode, not a fork. Two artefacts and
// two harnesses answer to one injector:
//
//   base    — `src/components/askScaffold.ejs` as committed. Every billing seam
//             is present and empty, so a grep for billing words finds nothing.
//   injected— base plus `src/commercial/panel-module.js`, spliced through the
//             same function the build uses.
//
// The fixture `test/fixtures/panel-before-oss.html` is the committed
// `addon/templates/inject.html` taken before the extraction. Comparing the
// injected panel to it is what proves the extraction moved the billing UI
// instead of rewriting it: the panel a paying user sees must be the panel they
// were already seeing.
//
// Run with: node --test "test/*.test.mjs"

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, "..");
const read = (rel) => fs.readFileSync(path.join(REPO, rel), "utf8");
// OSS tree には host 側の module と fixture が無い。あるときだけ読む。
// host 側では従来どおり両方ある。
const HAS_MODULE = fs.existsSync(path.join(REPO, "src/commercial/panel-module.js"));
const HAS_FIXTURE = fs.existsSync(path.join(REPO, "test/fixtures/panel-before-oss.html"));

const BASE = buildPanel(REPO, { module: false });
const INJECTED = buildPanel(REPO, { module: HAS_MODULE });
const FIXTURE = HAS_FIXTURE ? read("test/fixtures/panel-before-oss.html") : "";
const SCAFFOLD = read("src/components/askScaffold.ejs");
const MODULE_PATH = "src/commercial/panel-module.js";

// Billing vocabulary the base panel must not carry. Kept as one list because
// the OS6b boundary guard is going to grep the public tree with it, and a word
// that survives here is a word that will fail there.
const BILLING_WORDS = [
  "credit",
  "billing",
  "credits",
  "請求",
  "残高",
  "残量",
  "課金",
  "料金",
  "購入管理",
  "サブスク",
  "upgrade",
  "StatusSpent",
  "noBalance",
];

const norm = (s) => s.replace(/\r/g, "");
const lines = (s) => norm(s).split("\n");

// The extracted part of a panel, compared as tokens rather than lines. A line
// diff cannot work here and should not: the base and the module legitimately
// group the same content differently — `TAB_ORDER` pushes "credit" at runtime
// instead of listing it, LOCALES rows are one-per-line in the module where the
// pre-extraction file packed three keys per line, and a branch the base used to
// own becomes a wrapper the module installs. None of that changes what a user
// sees. What must not change is the set of billing things: the labels, the
// selectors, the element ids, the strings.
function billingTokens(html) {
  const out = new Set();
  const add = (s) => { if (s && s.trim() !== "") out.add(s.trim()); };
  // i18n key/value pairs. `: ""` is a guard the base installs
  // (`t.tierNoBalance || ""`), not a locale entry.
  for (const m of html.matchAll(/([A-Za-z]\w*)\s*:\s*("(?:[^"\\]|\\.)*")/g)) {
    if (m[2] === '""') continue;
    if (/credit|billing|balance|upgrade|spent|noBalance/i.test(m[1])) add(`${m[1]}=${m[2]}`);
  }
  for (const m of html.matchAll(/(^|\s)([.#][\w-]*(?:credit|billing)[\w-]*)/gi)) add(m[2].toLowerCase());
  for (const m of html.matchAll(/id="(umeboshi-ask-(?:credit|billing)[\w-]*)"/g)) add(m[1]);
  for (const m of html.matchAll(/\b([A-Za-z_$][\w$]*(?:[Cc]redit|[Bb]illing|[Bb]alance|[Uu]pgrade|Spent)[\w$]*)\b/g)) {
    // The module's own wrapper variables (moduleApplyLang, moduleItemSub, …) are
    // how it extends a base function; they are plumbing, not content.
    if (m[1].startsWith("module")) continue;
    add(m[1]);
  }
  return [...out].sort();
}

describe("OS5a the billing panel is a build mode of the same source", () => {
  it("the module lives beside the OSS tree and is the only billing source", () => {
    // OSS tree には module が無い。base が単体で立つことを見て終わる。
    // host 側では従来どおり module がある。
    if (!HAS_MODULE) {
      assert.ok(BASE.length > 0, "base が空になった");
      return;
    }
    assert.ok(loadModule(REPO), `${MODULE_PATH} must load`);
    assert.ok(INJECTED.length > BASE.length, "注入版は base より大きい");
  });

  it("base carries no billing UI — no element, no CSS, no i18n, no wording", () => {
    for (const id of [
      "umeboshi-ask-credit-notice", "umeboshi-ask-credit-status",
      "umeboshi-ask-credit-refresh", "umeboshi-ask-billing-btn",
      "umeboshi-ask-billing-status", "umeboshi-ask-billing-note",
      "umeboshi-ask-billing-login-hint", "umeboshi-ask-title-credit",
      "umeboshi-ask-title-billing",
    ]) {
      assert.ok(!BASE.includes(`id="${id}"`), `base に課金要素が残った: ${id}`);
      assert.ok(!BASE.includes(`#${id}`), `base に課金 CSS が残った: ${id}`);
    }
    // No billing i18n key in either locale. Matched as a table definition
    // (`key: "…"`) rather than a bare `key:` — base still reads
    // `t.tierNoBalance` inside a guard, and a ternary's `:` must not read as a
    // definition.
    for (const key of [
      "tabCredit", "modelNoBalance", "tierNoBalance", "statusSpent", "noBalance",
      "noBalanceTitle", "creditShort", "creditTitle", "creditRefresh", "creditInit",
      "creditBusy", "creditFail", "creditFailFetch", "creditGone", "creditLeft",
      "creditOf", "creditUnit", "creditRestore", "creditWeekGone", "creditLoginHint",
      "billingTitle", "managePlanCredits", "billingLoginHint", "billingNote",
      "upgradeLink", "upgradeCopy", "upgradeCopied", "upgradeCopyFail",
      "billingOpenLogin", "billingOpening", "billingGone", "billingFailOpen",
      "billingFallbackNote", "billingCopy", "billingCopied", "billingCopyFail",
      "billingUrlAria",
    ]) {
      assert.ok(
        !new RegExp(`(^|[^.[:\\\\\\w])${key}\\s*:\\s*"`).test(BASE),
        `base に課金 i18n が残った: ${key}`,
      );
    }
    // Comments and the seam documentation are not UI. Strip every comment, then
    // check that base defines no billing UI: the reads that survive
    // (`txNow().noBalance`, `t.modelNoBalance`, `modelBalance()`) are all placed
    // behind guards, which is exactly what lets the module fill them.
    const code = BASE.replace(/\/\*[\s\S]*?\*\//g, "").replace(/<!--[\s\S]*?-->/g, "");
    for (const fn of [
      "showCreditNotice", "clearCreditNotice", "applyCreditBlock",
      "handlePaymentRequired", "renderUsage", "fetchUsage", "fetchUsageOnce",
      "openBillingPage", "billingMsg", "formatCountdown", "formatResetsJST",
    ]) {
      assert.ok(
        !new RegExp(`(?:function|var|let|const)\\s+${fn}\\b`).test(code),
        `base が課金 UI を定義した: ${fn}`,
      );
    }
    // The guards the seam contract depends on must survive.
    assert.ok(
      /typeof creditBlocked !== "undefined" && creditBlocked/.test(code),
      "base が残量ブロックのガードを落とした",
    );
    assert.ok(/typeof fetchUsage === "function"/.test(code), "base が残量取得のガードを落とした");
    assert.ok(/txNow\(\)\.statusSpent/.test(code), "base が消費表示のガードを落とした");
    assert.ok(/t\.modelNoBalance/.test(code) && /t\.tierNoBalance/.test(code),
      "base が残量不足の添え字のガードを落とした");
    assert.ok(/typeof lastUsage !== "undefined"/.test(code), "base が残量参照のガードを落とした");
    // `credits` is the per-model price field the Worker sends, not a label.
    assert.ok(/m\.credits/.test(BASE), "モデル価格の受取が消えた");
  });

  it("OS5c base carries no login UI — no element, no CSS, no i18n, no wording", () => {
    for (const id of [
      "umeboshi-ask-login-btn", "umeboshi-ask-logout-btn", "umeboshi-ask-redeem-btn",
      "umeboshi-ask-redeem-row", "umeboshi-ask-code-input", "umeboshi-ask-auth-status",
      "umeboshi-ask-account-status", "umeboshi-ask-account-email",
      "umeboshi-ask-account-email-row", "umeboshi-ask-account-email-label",
      "umeboshi-ask-account-state", "umeboshi-ask-title-account",
      "umeboshi-ask-migrate-login-hint", "umeboshi-ask-addon-guide",
    ]) {
      assert.ok(!BASE.includes(`id="${id}"`), `base にログイン要素が残った: ${id}`);
      assert.ok(!BASE.includes(`#${id}`), `base にログイン CSS が残った: ${id}`);
    }
    // addon-link の1行だけは base の汎用 CSS として残す（font-size のみ）。
    // 要素（id="…"）は module 側にしか無いことを別に見る。
    assert.ok(!BASE.includes(`id="umeboshi-ask-addon-link"`), "base にログイン要素が残った: umeboshi-ask-addon-link");
    for (const key of [
      "loginBtn", "logoutBtn", "redeemBtn", "redeemPh", "redeemAria",
      "addonGuide", "addonLink", "iconLogin", "iconLogout", "iconKey",
      "accountTitle", "accountState", "accountLoggedOut", "accountLoggedIn",
      "accountEmailLabel", "migrateBusyExport", "migrateDoneExport",
      "migrateExpired", "migrateFailExport", "migrateBusyImport",
      "migrateDoneImport", "migrateSavedAt", "migrateNoSettings",
      "migrateFailImport", "migrateLoginHint",
      "authNoFetch", "authNoUrl", "authStartFail", "authNeedCode",
      "loginFallbackNote", "loginCopy", "loginCopied", "loginCopyFail",
      "loginUrlAria", "authChecking", "authDesktopMemory", "authBadCode",
      "authRateLimited", "authCheckFail", "authExpired", "authLoggedOut",
      "threadNeedLogin", "threadNeedLoginShort", "threadSyncHint",
    ]) {
      assert.ok(
        !new RegExp(`(^|[^.[:\\\\\\w])${key}\\s*:\\s*"`).test(BASE),
        `base にログイン i18n が残った: ${key}`,
      );
    }
    // base はログイン導線の id・CSS・i18n 定義・login/redeem 関数定義が 0 であること。
    // 読むだけの typeof ガード（UmeboshiAskAuthGetToken・wireLoginBoot・
    // threadNeedLoginText 系）は残す。定義の有無だけを見る。
    const code = BASE.replace(/\/\*[\s\S]*?\*\//g, "").replace(/<!--[\s\S]*?-->/g, "");
    for (const fn of [
      "loginSilentRefresh", "loginSetLoggedIn",
      "loginFetchAccountEmail", "loginRenderAccountEmail",
      "loginPostJson", "loginHandleExpired",
      "wireLoginBoot", "wireAuthUI", "rateLimitMessage",
      "loginIsMemoryOk", "loginAddonStore",
      "loginIsAddonPresent", "loginTryAddonRestore",
      "loginAddonWriteThrough", "loginShowAddonGuide",
      "loginUpdateAddonGuide",
    ]) {
      assert.ok(
        !new RegExp(`(?:function|var|let|const)\\s+${fn}\\b`).test(code),
        `base がログイン関数を定義した: ${fn}`,
      );
    }
    // accessToken の実体は module の閉包だけ。base に var が残らないこと。
    assert.ok(!/(?:var|let|const)\s+accessToken\b/.test(code), "base に accessToken の実体が残った");
    assert.ok(!/(?:var|let|const)\s+loginAccessToken\b/.test(code), "base に loginAccessToken が漏れた");
    // 橋渡しのガードは残す（OS2c の自己ホスト保存が壊れないこと）。
    assert.ok(/typeof UmeboshiAskAuthGetToken === "function"/.test(code), "base が token 読口のガードを落とした");
    assert.ok(/typeof wireLoginBoot === "function"/.test(code), "base が login 起動のガードを落とした");
  });
  it("every seam in the scaffold is answered, and base leaves them empty", () => {
    const seams = [...SCAFFOLD.matchAll(/umeboshi-ask:module:([\w:.-]+) (begin|end)/g)];
    const names = [...new Set(seams.map((m) => m[1]))].sort();
    // 5 markup + 4 css + 2 i18n + 1 script: one per thing the module owns.
    // OS5b added markup:consent, markup:consent-item, css:d for the consent dialog.
    // OS5c added markup:auth, markup:account-item, markup:migrate-hint, css:e for login.
    assert.deepEqual(names, ["css:a", "css:b", "css:c", "css:d", "css:e", "i18n:en", "i18n:ja",
      "markup:account-item", "markup:auth", "markup:consent", "markup:consent-item",
      "markup:migrate-hint", "markup:notice", "markup:panel",
      "markup:tabs", "script"], "シームの構成が変わった");
    for (const n of names) {
      assert.ok(BASE.includes(`umeboshi-ask:module:${n} begin`), `base がシームを落とした: ${n}`);
      // OSS tree には module が無い。base の空シームだけ見て終わる。
      // host 側では従来どおり注入版にマーカーが残らない。
      if (HAS_MODULE) assert.ok(!INJECTED.includes(`umeboshi-ask:module:${n}`), `注入版にマーカーが残った: ${n}`);
    }
    // OSS tree には module が無いので、module を要する throw 検査は host 側だけ。
    // host 側では従来どおり両方投げる。
    if (!HAS_MODULE) return;
    // A begin without its end is a build that cannot be trusted to fill.
    assert.throws(() => injectModule("/* umeboshi-ask:module:css:a begin */", loadModule(REPO)));
    assert.throws(() => injectModule("<!-- umeboshi-ask:module:nope begin --><!-- umeboshi-ask:module:nope end -->", loadModule(REPO)));
  });

  it("注入版の課金部分は抽出前の成果物と一致する", () => {
    // OSS tree には module と fixture が無いので skip。
    // host 側では従来どおり注入版と fixture が一致する。
    if (!HAS_MODULE || !HAS_FIXTURE) return;
    const inj = billingTokens(INJECTED);
    const fix = billingTokens(FIXTURE);
    assert.deepEqual(inj, fix, "注入版の課金トークンが fixture と違う");
  });


  it("the billing seams land on the same elements the fixture pins", () => {
    // OSS tree には module と fixture が無いので skip。
    // host 側では従来どおり両方を見る。
    if (!HAS_MODULE || !HAS_FIXTURE) return;
    for (const frag of [
      'data-tab="credit"',
      'data-panel="credit" role="tabpanel"',
      'id="umeboshi-ask-credit-status"',
      'id="umeboshi-ask-credit-refresh"',
      'id="umeboshi-ask-billing-btn"',
      'id="umeboshi-ask-billing-login-hint"',
      'id="umeboshi-ask-billing-status"',
      'id="umeboshi-ask-billing-note"',
      'id="umeboshi-ask-credit-notice" role="status" aria-live="polite"',
      "#umeboshi-ask-credit-notice { display: flex;",
      "#umeboshi-ask-billing-btn[hidden] { display: none; }",
      "#umeboshi-ask-credit-status { white-space: pre-line; }",
    ]) {
      assert.ok(INJECTED.includes(frag), `注入版に無い: ${frag}`);
      assert.ok(FIXTURE.includes(frag), `fixture に無い: ${frag}`);
    }
  });

  it("the billing i18n keys are identical to the fixture's", () => {
    // OSS tree には module と fixture が無いので skip。
    // host 側では従来どおり両方を見る。
    if (!HAS_MODULE || !HAS_FIXTURE) return;
     // The injected panel carries each key twice: once spliced into LOCALES and
    // once inside addLocaleExtra, which the script seam calls. Both come from
    // the same table, so compare the distinct values, not the occurrences.
    const vals = (html, key) =>
      [...new Set([...html.matchAll(new RegExp(`${key}:\\s*("(?:[^"\\\\]|\\\\.)*")`, "g"))].map((x) => x[1]))].sort();
    for (const key of [
      "tabCredit", "creditTitle", "creditRefresh", "creditInit", "creditBusy", "creditFail",
      "creditFailFetch", "creditGone", "creditLeft", "creditOf", "creditUnit",
      "creditRestore", "creditWeekGone", "creditLoginHint", "creditShort",
      "noBalance", "noBalanceTitle", "billingTitle", "managePlanCredits",
      "billingLoginHint", "billingNote", "upgradeLink", "upgradeCopy",
      "upgradeCopied", "upgradeCopyFail", "billingOpenLogin", "billingOpening",
      "billingGone", "billingFailOpen", "billingFallbackNote", "billingCopy",
      "billingCopied", "billingCopyFail", "billingUrlAria", "statusSpent",
      "modelNoBalance", "tierNoBalance",
    ]) {
      assert.deepEqual(vals(INJECTED, key), vals(FIXTURE, key), `i18n ${key} が fixture と違う`);
    }
  });

  it("base and injected share one script body minus the payload", () => {
    const base = panelScript().replace(/^\s*/gm, "");
    // OSS tree には module が無い。base 側の不変だけ見て終わる。
    // host 側では従来どおり両方を見る。
    // base keeps only the `typeof fetchUsage === "function"` guard that calls it.
    assert.ok(!/function fetchUsage\(/.test(base), "base に fetchUsage の実体が残った");
    assert.ok(base.includes("addLocaleExtra"), "base が i18n の差し込み口を落とした");
    assert.ok(!base.includes("var lastUsage = null;"), "base に lastUsage が残った");
    if (!HAS_MODULE) return;
    const inj = panelScript({ module: true }).replace(/^\s*/gm, "");
    assert.ok(/function fetchUsage\(/.test(inj), "注入版に fetchUsage が無い");
    assert.ok(/function openBillingPage\(/.test(inj), "注入版に openBillingPage が無い");
    assert.ok(inj.includes("var lastUsage = null;"), "注入版に lastUsage が無い");
  });

  it("the vm harness can drive the injected panel", () => {
    // OSS tree には module が無いので skip。
    // host 側では従来どおり注入 script を見る。
    if (!HAS_MODULE) return;
    const src = panelScript({ module: true });
    for (const fn of ["fetchUsage", "showCreditNotice", "handlePaymentRequired", "openBillingPage"]) {
      assert.ok(new RegExp(`function ${fn}\\(`).test(src), `注入 script に ${fn} が無い`);
    }
  });

});
