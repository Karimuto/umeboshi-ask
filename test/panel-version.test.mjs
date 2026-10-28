import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// UM1 (#183/spec #188): the panel carries its own SemVer note inside, and the
// Worker answers version + stop flag without ever sending the body.
//
// Two artefacts must agree: the scaffold source and the built injection panel.
// (#180 retired the bundled note type, so there is no third "built card" to
// compare — the panel a third party's note type gets is the panel we ship.)
// The marker (`begin v1`) stays frozen — it tells injected apart from plain —
// so old-vs-new is decided by the inner note, never the marker string. The
// stop flag itself lives on the Worker (claudeflare/src/panel.ts
// `ask:panel:stop:v1`); here the contract is that the response shape has no
// body field to leak. The add-on reads none of it any more (spec #252 Q21):
// on the add-on side old-vs-new is the injected inside versus the bundle.
//
// Run with: node --test "test/*.test.mjs"

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => fs.readFileSync(path.join(REPO, rel), "utf8").replace(/\r/g, "");

const SCAFFOLD = "src/components/askScaffold.ejs";
const PANEL = "addon/templates/inject.html";
const WORKER = "claudeflare/src/panel.ts";
// OS6c: core.ts is the canonical route. With full index.ts present, check both.
const CORE_ROUTE = "claudeflare/src/core.ts";
const FULL_ROUTE = "claudeflare/src/index.ts";
const ADDON = "addon/inject.py";

const NOTE_RE = /<!-- umeboshi-ask:panel-version (\d+\.\d+\.\d+) -->/g;

function notesOf(text, rel) {
  const found = [...text.matchAll(NOTE_RE)].map((m) => m[1]);
  assert.equal(found.length, 1, `${rel} must carry exactly one panel-version note, found ${found.length}`);
  return found[0];
}

describe("UM1 (#183) the panel version note is one version everywhere", () => {
  it("scaffold and built panel agree on the version", () => {
    const scaffold = read(SCAFFOLD);
    const panel = read(PANEL);
    const v = notesOf(scaffold, SCAFFOLD);
    assert.equal(notesOf(panel, PANEL), v, "built panel drifted from the scaffold");
  });

  it("the note is SemVer and sits before the panel root", () => {
    const scaffold = read(SCAFFOLD);
    assert.match(scaffold, /<!-- umeboshi-ask:panel-version \d+\.\d+\.\d+ -->\n<div id="umeboshi-ask"/);
  });

  it("the injection marker stays frozen at v1", () => {
    assert.ok(read(ADDON).includes('BEGIN_MARK = "<!-- umeboshi-ask:begin v1 -->"'));
    for (const rel of [SCAFFOLD, PANEL]) {
      assert.ok(!read(rel).includes("begin v2"), `${rel} bumped the marker`);
    }
  });

  it("the Worker route answers version + flag, never the body", () => {
    const worker = read(WORKER);
    assert.ok(worker.includes("PANEL_RELEASE_KEY"), "panel.ts lost its release key");
    assert.ok(worker.includes("PANEL_STOP_KEY"), "panel.ts lost its stop key");
    const routes = [CORE_ROUTE];
    if (fs.existsSync(path.join(REPO, FULL_ROUTE))) routes.push(FULL_ROUTE);
    assert.ok(routes.length >= 1, "no panel route to check");
    for (const rel of routes) {
      const route = read(rel);
      assert.ok(route.includes('"/api/ask/panel"'), `${rel} lost the panel route`);
      const block = route.split('"/api/ask/panel"')[1].split("S8:")[0];
      assert.ok(block.includes("version"), `${rel} no longer answers version`);
      assert.ok(block.includes("stopped"), `${rel} no longer answers stopped`);
      assert.ok(!block.includes("panel:") && !block.includes("html"), `${rel} leaks the body`);
    }
  });

  it("the add-on carries no Worker-facing version compare", () => {
    // spec #252 Q21: the add-on helpers that read a panel's version note and
    // compared it against the Worker's release never ran, so they are gone.
    // Old-vs-new on the add-on side is the injected inside versus the bundled
    // panel, which is what the personal-use startup rewrite needs.
    const addon = read(ADDON);
    for (const name of ["def panel_version", "def compare_versions", "def should_pick_up", "def block_inner_version", "def is_official_api_base"]) {
      assert.ok(!addon.includes(name), `inject.py still defines ${name}`);
    }
    assert.ok(addon.includes("def needs_startup_upgrade"), "inject.py lost the inside compare");
    assert.ok(addon.includes("def plan_startup_upgrade"), "inject.py lost the inside compare plan");
  });
});

describe("package version is one version everywhere (#322)", () => {
  it("root and Worker core package.json agree on the version", () => {
    const root = JSON.parse(read("package.json"));
    const core = JSON.parse(read("claudeflare/package.json"));
    assert.match(root.version, /^\d+\.\d+\.\d+$/, "root package.json version is not SemVer");
    assert.equal(core.version, root.version, "Worker core version drifted from the root package");
  });
});
