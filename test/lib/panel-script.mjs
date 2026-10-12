// panel の script 本文を組み立てる。
//
// 候補2（architecture review）: renderer は `src/components/askRenderer.ejs`
// に切り出されており、`askScaffold.ejs` は `<%- include('./askRenderer.ejs') -%>`
// でそれを差し込む。vm 駆動のテストは script 本文が必要なので、scaffold と
// partial を include 順に連結して返す。renderer は script タグ無しの生 JS なので、
// 連結後の本文に EJS タグは残らない（s13-dod の FAIL-A 走査対象にも renderer が残る）。
//
// `from` は差し替え口。実機のテンプレ（AnkiConnect採取）など rendered HTML を
// 渡すと、そのファイルをそのまま読んで <script> 本文を返す。

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { injectModule, loadModule } from "../../addon/inject-build.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const REPO = path.resolve(__dirname, "..", "..");

const SCAFFOLD = "src/components/askScaffold.ejs";
const RENDERER = "src/components/askRenderer.ejs";

const SCRIPT_TAG = /<script>([\s\S]*?)<\/script>/g;
/** scaffold の renderer include。1つ目のグループは `-%>` の slurp 印。 */
const INCLUDE_TAG = /<%[-=]?\s*include\(['"]\.\/askRenderer\.ejs['"]\)\s*([-_])?%>/;

function scriptBody(src) {
  const m = [...src.matchAll(SCRIPT_TAG)];
  if (m.length < 1) throw new Error("script を抽出できない");
  return m.map((x) => x[1]).join("\n");
}

/** partial 本文。最終行の改行は持たない（include 位置の改行は scaffold 側が持つ）。 */
function rendererSource() {
  return fs.readFileSync(path.join(REPO, RENDERER), "utf8").replace(/\r?\n$/, "");
}

/** scaffold の include 1本を partial 本文で置き換える。EJS タグは残らない。 */
function expandRenderer(src) {
  const m = INCLUDE_TAG.exec(src);
  if (!m) return src;
  let end = m.index + m[0].length;
  // EJS の `-%>` はタグ直後の改行を1本落とす（ejs.js の `^(?:\r\n|\r|\n)`）。
  // helper も同じだけ落とすので、連結結果は build 出力の本文と byte 一致する。
  if (m[1] === "-") {
    if (src.startsWith("\r\n", end)) end += 2;
    else if (/^[\r\n]/.test(src.slice(end, end + 1))) end += 1;
  }
  return src.slice(0, m.index) + rendererSource() + src.slice(end);
}

/**
 * scaffold + partial を include 順に連結したテンプレート本文。
 * `module: true` は host build と同じ注入を通す（OS5a）。注入関数は
 * addon/inject-build.mjs の 1 本を build とテストで共有する。
 */
export function panelSource({ from, module: withModule = false } = {}) {
  const src = from
    ? fs.readFileSync(path.resolve(from), "utf8")
    : fs.readFileSync(path.join(REPO, SCAFFOLD), "utf8");
  const expanded = expandRenderer(src);
  return withModule ? injectModule(expanded, loadModule(REPO)) : expanded;
}

/** vm に流す script 本文（scaffold の <script> を1本に連結したもの）。 */
export function panelScript({ from, module: withModule = false } = {}) {
  return scriptBody(panelSource({ from, module: withModule }));
}
