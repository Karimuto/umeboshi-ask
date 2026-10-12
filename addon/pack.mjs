#!/usr/bin/env node
// Deterministic .ankiaddon packer (issue #54).
//
// Why this exists instead of `python -m zipfile`: the runner that builds the
// file is throwaway, so the human cannot reproduce a checksum computed there.
// This packer is pure Node (no Python, no bash), and it writes STORED entries
// with a fixed DOS timestamp, so the same sources always yield the same bytes
// and therefore the same sha256 on every machine.
//
// AnkiWeb rules this enforces (https://addon-docs.ankiweb.net/sharing.html):
// the zip must be flat (no wrapping top-level folder) and must not contain
// __pycache__. Anki's installer copies zip entries straight into
// <addons>/<package>/, so the entry names are the installed layout.

import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..");

// Entry name inside the zip -> source path in the repo. Order is fixed so the
// central directory (and thus the checksum) is stable.
export const ENTRIES = [
  ["__init__.py", "addon/__init__.py"],
  ["manifest.json", "addon/manifest.json"],
  // #180: the bundled note type is gone (Q4=A: injection only). The add-on
  // no longer ships or installs a note type, so there are no templates to
  // carry. `npm run build` must still run before `npm run build:addon`
  // because templates/inject.html is a build output of
  // src/components/askScaffold.ejs (test/addon-package.test.mjs fails otherwise).
  // #106: the panel that gets appended to note types the user already owns,
  // and the two modules that write it and draw the screen.
  ["inject.py", "addon/inject.py"],
  ["picker.py", "addon/picker.py"],
  // #123: the picker's screen text, one table per language, picked from
  // Anki's own interface language at open time.
  ["i18n.py", "addon/i18n.py"],
  // UM3 (#185): the startup switch default. Anki merges config.json under
  // the meta.json "config" entry (getConfig), and the notice writes back
  // through writeConfig; without this file a fresh install reads as on
  // only via the code fallback.
  ["config.json", "addon/config.json"],
  ["templates/inject.html", "addon/templates/inject.html"],
];
export const OUT_PATH = "umeboshi-ask-companion.ankiaddon";

const SIG_LOCAL = 0x04034b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_EOCD = 0x06054b50;

// 1980-01-01 00:00:00, the earliest timestamp the DOS format can express.
const DOS_TIME = 0;
const DOS_DATE = 0x0021;

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let c = i;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c;
  }
  return table;
})();

export function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i += 1) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function localHeader(name, data) {
  const nameBuf = Buffer.from(name, "utf8");
  const head = Buffer.alloc(30);
  head.writeUInt32LE(SIG_LOCAL, 0);
  head.writeUInt16LE(20, 4); // version needed
  head.writeUInt16LE(0, 6); // flags
  head.writeUInt16LE(0, 8); // method 0 = stored, so output is byte-stable
  head.writeUInt16LE(DOS_TIME, 10);
  head.writeUInt16LE(DOS_DATE, 12);
  head.writeUInt32LE(crc32(data), 14);
  head.writeUInt32LE(data.length, 18); // compressed size
  head.writeUInt32LE(data.length, 22); // uncompressed size
  head.writeUInt16LE(nameBuf.length, 26);
  head.writeUInt16LE(0, 28); // extra length
  return Buffer.concat([head, nameBuf]);
}

function centralHeader(name, data, offset) {
  const nameBuf = Buffer.from(name, "utf8");
  const head = Buffer.alloc(46);
  head.writeUInt32LE(SIG_CENTRAL, 0);
  head.writeUInt16LE(0x031e, 4); // made by: UNIX, zip 3.0
  head.writeUInt16LE(20, 6); // version needed
  head.writeUInt16LE(0, 8);
  head.writeUInt16LE(0, 10);
  head.writeUInt16LE(DOS_TIME, 12);
  head.writeUInt16LE(DOS_DATE, 14);
  head.writeUInt32LE(crc32(data), 16);
  head.writeUInt32LE(data.length, 20);
  head.writeUInt32LE(data.length, 24);
  head.writeUInt16LE(nameBuf.length, 28);
  head.writeUInt16LE(0, 30); // extra
  head.writeUInt16LE(0, 32); // comment
  head.writeUInt16LE(0, 34); // disk number
  head.writeUInt16LE(0, 36); // internal attrs
  head.writeUInt32LE((0o100644 << 16) >>> 0, 38); // external attrs: -rw-r--r--
  head.writeUInt32LE(offset, 42);
  return Buffer.concat([head, nameBuf]);
}

/**
 * Read a package entry's bytes with LF line endings.
 *
 * Git checks out text files with the line endings of the machine: this PC
 * hands us CRLF, a Linux clone hands us LF. Packing the raw bytes therefore
 * made the sha256 depend on the OS of whoever ran the build, which defeats
 * the whole point of the checksum in addon/PUBLISH.md §5 — the human would
 * get a different number than we printed and conclude the file is corrupt.
 * Normalising here keeps the promise "same sources, same bytes" true across
 * machines. Python does not care; it parses CRLF and LF alike.
 */
function readEntry(repoRoot, rel) {
  return readFileSync(path.join(repoRoot, rel)).toString("latin1").replace(/\r\n/g, "\n");
}

/** Build the .ankiaddon bytes from the repo sources. Pure: no fs writes. */
export function buildAddon(repoRoot = REPO) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const [name, rel] of ENTRIES) {
    const data = Buffer.from(readEntry(repoRoot, rel), "latin1");
    const local = localHeader(name, data);
    locals.push(local, data);
    centrals.push(centralHeader(name, data, offset));
    offset += local.length + data.length;
  }
  const central = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(SIG_EOCD, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(ENTRIES.length, 8);
  eocd.writeUInt16LE(ENTRIES.length, 10);
  eocd.writeUInt32LE(central.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);
  return Buffer.concat([...locals, central, eocd]);
}

export function sha256(buf) {
  return createHash("sha256").update(buf).digest("hex");
}

function main() {
  const repoRoot = process.env.ADDON_REPO_ROOT
    ? path.resolve(process.env.ADDON_REPO_ROOT)
    : REPO;
  const outPath = process.env.ADDON_OUT
    ? path.resolve(process.env.ADDON_OUT)
    : path.join(repoRoot, OUT_PATH);
  const buf = buildAddon(repoRoot);
  mkdirSync(path.dirname(outPath), { recursive: true });
  writeFileSync(outPath, buf);
  const manifest = JSON.parse(readFileSync(path.join(repoRoot, "addon/manifest.json"), "utf8"));
  process.stdout.write(
    `${path.relative(repoRoot, outPath) || outPath}\n` +
      `  bytes  ${buf.length}\n` +
      `  sha256 ${sha256(buf)}\n` +
      `  entries ${ENTRIES.map(([name]) => name).join(", ")}\n` +
      `  package ${manifest.package}\n`,
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
