# Changelog

## 1.7.0 (2026-11-09)

Changes since `v1.6.0`. The AnkiWeb upload for this release is the Muse-side
step; this repo carries the built package, the version bumps, and these notes.

### Versions

- Package (`package.json`, `claudeflare/package.json`): `1.6.0` -> `1.7.0`
- Panel note (`umeboshi-ask:panel-version`): `1.4.2` -> `1.5.0`
- Add-on (`addon/manifest.json` `human_version`): `1.0.2` -> `1.1.0`
- `min_point_version` stays `250902` (Anki Desktop 25.09.2+).

### Added

- Card-context switch (#317, #12, #14). One iOS-style toggle by Send,
  default ON. ON keeps today's behavior (card context attached). OFF sends
  the display question verbatim: zero context chars, no images, and
  `includeCardContext:false`. The Worker accepts the key additively and
  never rejects on it, so old panels keep working.
- Same-card conversation history (#15). Follow-up asks on one card carry
  the live session turns as chat `history` (up to 10 turns, 20000 chars
  per turn, oldest trimmed first). First sends stay single-shot.
  Saved Messages never ride (ADR 0006); the session clears on card turn.
- Package version guard (#322, #13). Root and Worker core `package.json`
  must carry the same SemVer.

### Compatibility

- Worker `history` and `includeCardContext` keys are additive. Missing
  reads empty; single-shot sends are unchanged.

### Add-on package

- File: `umeboshi-ask-companion.ankiaddon` (repo root)
- Bytes: `326526`
- SHA-256: `ebe22d521a3ffaa23e1df6451b583e474c5231204514e11e2a628f4dbdbd7609`
- Entries (flat, no `__pycache__`): `__init__.py`, `manifest.json`,
  `inject.py`, `picker.py`, `i18n.py`, `config.json`,
  `templates/inject.html`
- Package: `umeboshi_ask_companion`
- Rebuild: `npm run build` then `npm run build:addon`. The packer is
  deterministic (STORED entries, fixed timestamp), so the same sources
  always yield the same bytes and SHA-256.

### AnkiWeb handoff (Muse side)

- Upload `umeboshi-ask-companion.ankiaddon` from the repo root.
- Version to set: `1.1.0`. Minimum Anki: 25.09.2.
- GitHub tag `v1.7.0` trips the release-vessel workflow, which opens an
  empty release; paste the notes above into it.
