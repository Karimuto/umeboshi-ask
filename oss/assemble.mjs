#!/usr/bin/env node
// OS7b (#271): community files join the same ROOT_FILES map.
// Templates land under `.github/ISSUE_TEMPLATE/`.
// Reads `git ls-files` (tracked files only), copies `inScope()` files to
// the destination root, and places the `oss/` manuscripts as the tree root
// files (LICENSE, README.md, AGENTS.md, package.json, CONTRIBUTING.md,
// CODEOWNERS, SECURITY.md, .github/ISSUE_TEMPLATE/*.md).
//
// Usage: node oss/assemble.mjs [dest]  (default: %TEMP%/252/oss-tree)

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { inScope } from "../test/lib/oss-scope.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..");
const dest = path.resolve(process.argv[2] ?? process.env.OSS_TREE
  ?? path.join(process.env.TEMP ?? "/tmp", "252", "oss-tree"));

const ROOT_FILES = new Map([
  ["oss/LICENSE", "LICENSE"],
  ["oss/README.md", "README.md"],
  ["oss/AGENTS.md", "AGENTS.md"],
  ["oss/package.json", "package.json"],
  ["oss/CONTRIBUTING.md", "CONTRIBUTING.md"],
  ["oss/CODEOWNERS", "CODEOWNERS"],
  ["oss/SECURITY.md", "SECURITY.md"],
  ["oss/ISSUE_TEMPLATE/bug_report.md", ".github/ISSUE_TEMPLATE/bug_report.md"],
  ["oss/ISSUE_TEMPLATE/feature_request.md", ".github/ISSUE_TEMPLATE/feature_request.md"],
  ["oss/ISSUE_TEMPLATE/selfhost_help.md", ".github/ISSUE_TEMPLATE/selfhost_help.md"],
]);

const tracked = execFileSync("git", ["ls-files"], { cwd: REPO, encoding: "utf8" })
  .split("\n").map((s) => s.trim()).filter((s) => s !== "");
const scope = tracked.filter(inScope);

for (const [src, out] of ROOT_FILES) {
  if (!fs.existsSync(path.join(REPO, src))) {
    throw new Error(`manuscript missing: ${src}`);
  }
}

// dest が既存 repo の clone の場合、.git を消さない。追跡外の一時物
// （node_modules・.wrangler・*.tgz）は持ち込まないので残っても無害だが、
// 古い複写が残らないよう scope 外の追跡ファイルを消すのは呼び側の仕事。
// ここでは .git/.github 以外を掃除してから複写する。
for (const e of fs.existsSync(dest) ? fs.readdirSync(dest) : []) {
  if (e === ".git") continue;
  fs.rmSync(path.join(dest, e), { recursive: true, force: true });
}
fs.mkdirSync(dest, { recursive: true });
for (const rel of scope) {
  if (rel === "package.json") continue; // tree root package comes from oss/.
  const from = path.join(REPO, rel);
  const to = path.join(dest, rel);
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to);
}
for (const [src, out] of ROOT_FILES) {
  const to = path.join(dest, out);
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(path.join(REPO, src), to);
}
// host の claudeflare/package.json は stripe 依存と test:full を含むので、
// そのまま持ち込まない。OSS 用に書き換える（版は host から読む）。
{
  const host = JSON.parse(fs.readFileSync(path.join(REPO, "claudeflare/package.json"), "utf8"));
  const keep = ["@cloudflare/workers-types", "typescript", "vitest", "wrangler"];
  const devDeps = {};
  for (const name of keep) {
    if (host.devDependencies?.[name]) devDeps[name] = host.devDependencies[name];
  }
  const ossWorker = {
    name: "@umeboshi/ask-worker-core",
    version: host.version,
    private: false,
    type: "module",
    scripts: {
      dev: "wrangler dev --config wrangler.core.toml",
      typecheck: "tsc --noEmit",
      test: "vitest run test/core",
      "test:core": "vitest run test/core",
    },
    devDependencies: devDeps,
  };
  fs.writeFileSync(
    path.join(dest, "claudeflare/package.json"),
    JSON.stringify(ossWorker, null, 2) + "\n",
  );
}
console.log(`assembled ${scope.length} scope files + ${ROOT_FILES.size} root files -> ${dest}`);
