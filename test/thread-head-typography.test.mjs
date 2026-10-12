import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// #93 保存済み解説の見出し行（▶/▼ の行）の文字サイズと左端の固定。
// Anki 本体の card CSS（_aqt/data/web/css/reviewer.css と webview.css）には
// .isWin button{font-size:12px} と button{margin:1em .5em} が入る。
// class 1個 (0,1,0) の指定は必ず負けるので、ID を含むセレクタであること、
// margin を 0 にしていること、rem ではなく em で本文比に紐づけていること、
// 見出しが本文 16px から +10〜+15% であることを生成済み Back Template で固定する。
// 変異注入（ID を外す / em を px にする / margin を消す）で赤くなることを実測済み。

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, "..");
const FILE = process.env.BACK_TEMPLATE_FILE
  ? path.resolve(process.env.BACK_TEMPLATE_FILE)
  : path.join(REPO, "addon/templates/inject.html");
const HTML = fs.readFileSync(FILE, "utf8");
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function decls(selector) {
  const re = new RegExp("(?:^|\\n)\\s*" + escapeRe(selector) + "\\s*\\{([^}]*)\\}");
  const m = re.exec(HTML);
  assert.ok(m, "生成物にセレクタ [" + selector + "] がある");
  return m[1];
}

function value(css, prop) {
  const m = new RegExp("(?:^|;)\\s*" + prop + "\\s*:\\s*([^;]+)").exec(css);
  assert.ok(m, prop + " が宣言されている");
  return m[1].trim();
}

// Anki の card CSS に対して class 1個 (0,1,0) で負けるのが本次不具合の原因。
const HEAD_SELECTOR = "#umeboshi-ask .umeboshi-ask-thread-head";
const HEAD = decls(HEAD_SELECTOR);

describe("#93 保存済み解説の見出し", () => {
  it("Anki の button ルールより強いセレクタで指定している", () => {
    assert.ok(
      HTML.includes(HEAD_SELECTOR + " {"),
      "見出しは #umeboshi-ask を含むセレクタで指定する（class 1個では .isWin button に負ける）",
    );
  });

  it("Anki の button{margin:1em .5em} を上書きして左端を本文にそろえる", () => {
    assert.equal(value(HEAD, "margin"), "0");
    const pad = value(HEAD, "padding").split(/\s+/);
    // shorthand が 2 値（上下 左右）なら左右は同じ値。
    const sides = pad.length === 2 ? [pad[1], pad[1]] : [pad[1], pad[3]];
    assert.deepEqual(sides, ["0", "0"], "左右 padding は 0");
  });

  it("rem ではなく em で本文比に紐づけている（Anki の html は 15px）", () => {
    const size = value(HEAD, "font-size");
    assert.match(size, /^[\d.]+em$/, "font-size は em 単位（例: 1.15em）");
  });

  it("本文 16px の +10〜+15% で出る", () => {
    const body = parseFloat(value(decls("#umeboshi-ask"), "font-size"));
    const ratio = parseFloat(value(HEAD, "font-size"));
    const pct = Math.round((ratio - 1) * 1000) / 10;
    assert.ok(pct >= 10 && pct <= 15, "見出しは本文の +10〜+15%（実測 " + pct + "%）");
  });
});

describe("#93 操作ボタン（Edit/Delete）", () => {
  const ROW = ".umeboshi-ask-thread-body .umeboshi-ask-row button, .umeboshi-ask-msg .umeboshi-ask-row button";

  it("本文と同じ行に両方のCSSが当たっている", () => {
    assert.ok(HTML.includes(ROW + " {"));
  });

  it("margin を 0 にして本文と同じ左端にそろえる", () => {
    assert.equal(value(decls(ROW), "margin"), "0");
  });
});

describe("#93 案B（行頭記号を溝に退避）", () => {
  const MARK = ".umeboshi-ask-thread-head-mark";
  const BODY = ".umeboshi-ask-thread-body";

  it("▶/▼ は幅一定の溝に収めて flex で伸びないようにしている", () => {
    assert.equal(value(decls(MARK), "width"), "1.5rem");
    assert.equal(value(decls(MARK), "flex"), "none");
  });

  it("本文・操作ボタンの字下げが見出しの文字位置と一致する", () => {
    const gutter = parseFloat(value(decls(MARK), "width"));
    const gap = parseFloat(value(decls(HEAD_SELECTOR), "gap"));
    const indent = parseFloat(value(decls(BODY), "padding-left"));
    assert.equal(gutter + gap, indent, "溝 + gap = 字下げ（" + gutter + " + " + gap + " = " + indent + "）");
  });

  it("溝も字下げも rem（端末の html 基準が変わっても比率が保たれる）", () => {
    assert.match(value(decls(MARK), "width"), /rem$/);
    assert.match(value(decls(BODY), "padding-left"), /rem$/);
  });
});
