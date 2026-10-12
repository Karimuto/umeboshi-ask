"""Attach the ask panel to note types the user already owns (issue #106).

The design lived at ``docs/design/ask-injection.md`` (deleted 2026-10-09, #214);
the policy that forbids bundling anyone else's assets is
``docs/adr/0026-an-king-compat-without-redistribution.md``.
This module is that design's code and nothing else.

Five decisions from the design are load-bearing, and every one of them exists
because the opposite breaks a user's collection rather than our card:

1. **The answer template only.** ``qfmt`` is never written.
   ``rslib/src/notetype/schemachange.rs::update_cards_for_changed_templates``
   regenerates a note type's cards when the *question* side changed, so writing
   there rebuilds somebody else's cards.

2. **No field is added, removed, reordered or renamed.** Two measured
   mechanisms punish it: ``set_schema_modified`` turns the next save into a
   full sync (``rslib/src/sync/collection/status.rs``), and
   ``Collection::merge_notetypes`` answers ``ResyncRequired`` -- "notetype
   schema changed" -- on every other device
   (``rslib/src/sync/collection/changes.rs``). Both look at counts only, so
   editing template text alone is safe and changing the field set is not.

3. **The block is delimited by its own HTML comments.** They survive a
   template round trip (``rslib/src/template.rs`` keeps ``Comment`` nodes), so
   removal is exact instead of approximate. Presence or absence of the pair is
   the only state we store; there is no side file.

4. **Undo is one step.** ``Collection::update_notetype`` does record an undo
   entry per note type (``rslib/src/notetype/undo.rs``), so injecting into ten
   note types would otherwise cost ten Ctrl+Z presses against a 30-step
   history. ``add_custom_undo_entry`` + ``merge_undo_entries`` collapse it.

5. **A note type that fails is left alone.** We build every string first, drop
   what cannot be built, then write. A write that raises leaves that note type
   untouched and does not roll the others back.

Pure module: no ``aqt`` import at module level, so ``addon/test_inject.py``
runs with a fake collection and no Anki.
"""

import json
import os
import re
import time

# The injected range, in this order. ``v1`` is frozen (UM1 #183/spec #188):
# it tells injected apart from plain, and bumping it would silently re-version
# peers mid-sync. `upgrade` rewrites only the inside, so the note travels with
# the inside, and old-vs-new is decided by comparing that inside against the
# bundled panel below -- there is no version to read here.
BEGIN_MARK = "<!-- umeboshi-ask:begin v1 -->"
END_MARK = "<!-- umeboshi-ask:end -->"

# Present in any template that already draws the panel, injected or native.
# Used only to tell "this note type already draws the panel, leave it alone"
# (state `native`) apart from "this note type is someone else's, we may write
# here". (`native` is legacy: #180 retired the bundled note type, so no live
# note type draws the panel without our markers. The state stays so an old
# collection still reads as "already has ask" instead of "injectable".)
PANEL_MARK = 'id="umeboshi-ask"'

# What a completed single-target call reports, per mode. `inject` and
# `uninject` are past participles; `upgrade` is not "upgradeed".
DONE_ACTION = {
    "inject": "injected",
    "uninject": "uninjected",
    "upgrade": "upgraded",
}

# The three states `list_note_types` reports, plus `partial` for a note type
# whose templates disagree with each other. `partial` is never written to.
# (`native` is legacy — see PANEL_MARK above. It stays so an old collection
# with the retired note type still lists as "already has ask".)
STATE_INJECTED = "injected"
STATE_NATIVE = "native"
STATE_PLAIN = "plain"
STATE_PARTIAL = "partial"

UNDO_NAME_INJECT = "umeboshi-ask: inject"
UNDO_NAME_UNINJECT = "umeboshi-ask: uninject"

_TEMPLATES_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "templates")
_PANEL_FILE = "inject.html"


def load_panel(templates_dir=None):
    """Read the bundled panel. Pure: no Anki dependency.

    This is `src/components/askScaffold.ejs` as the build renders it, minus the
    card body and with its CSS custom properties moved off ``:root`` onto the
    three ids we own (design 7). The package carries it as
    ``templates/inject.html``.
    """
    base = templates_dir or _TEMPLATES_DIR
    with open(os.path.join(base, _PANEL_FILE), encoding="utf-8") as fh:
        return fh.read()


def needs_startup_upgrade(afmt, panel, field_names=None):
    """True when the injected block's inside differs from the bundled panel.

    UM2 (#184): old-vs-new is decided by comparing the inside, never by the
    version note alone. A note-less v1 block predates UM1 and reads as older
    than anything whenever the bundle moved; a block whose inside already
    matches writes nothing, which is what makes a second boot a no-op (no
    mod/usn bump, no full sync). Returns False for anything without a
    complete marker pair: that template is plain, native, partial, or
    half-written, and never ours to rewrite. `field_names` is the note type's
    live field list; when omitted the block's own context is read back, which
    keeps the upgrade byte-stable when the field set did not change.
    """
    bounds = _pair_bounds(afmt or "")
    if bounds is None:
        return False
    names = list(field_names) if field_names is not None else _field_names_from_afmt(afmt or "")
    try:
        want = block_inner(build_block(names, panel))
    except Exception:
        return False
    inner_start = (afmt or "").index(BEGIN_MARK) + len(BEGIN_MARK)
    inner_end = (afmt or "").index(END_MARK)
    return (afmt or "")[inner_start:inner_end] != want


def _field_names_from_afmt(afmt):
    """Field names referenced by the injected block's context div.

    UM2 rebuilds the block the same way `inject` did, so the context div has
    to name the same fields. The block already carries them as
    ``{{#Name}}`` sections; reading them back keeps the upgrade byte-stable
    when the note type's field set did not change. A block whose context
    cannot be read keeps its old inside: failing to parse is a reason to
    leave the note type alone, never to write a half-known panel.
    """
    bounds = _pair_bounds(afmt or "")
    if bounds is None:
        return []
    start, end = bounds
    inner = (afmt or "")[start:end]
    names = []
    for match in re.finditer(r"\{\{#([^{}]+)\}\}", inner):
        name = match.group(1)
        if name not in names:
            names.append(name)
    return names


def plan_startup_upgrade(col, panel=None):
    """Names of injected note types whose inside differs from the bundle.

    UM2 (#184): Back Template only (the writer below only touches afmt), the
    marker pair stays v1 (upgrade rewrites the inside only), failures stay on
    the old inside for the next boot (apply_batch reports them, we do not
    roll back), and one Ctrl+Z undoes the whole batch (apply_batch merges).
    A missing bundled panel is not a plan: without the bundle there is
    nothing correct to write, so every note type is left alone.
    """
    try:
        bundle = panel if panel is not None else load_panel()
    except Exception:
        return []
    names = []
    for nt in col.models.all() or []:
        if not nt:
            continue
        templates = nt.get("tmpls") or []
        if not templates:
            continue
        states = [_afmt_state(t.get("afmt", "") or "") for t in templates]
        if any(state != STATE_INJECTED for state in states):
            continue
        try:
            fields = [f.get("name", "") for f in nt.get("flds") or []]
            current = [t.get("afmt", "") or "" for t in templates]
            wanted = []
            for afmt in current:
                block = build_block(fields, bundle)
                new_afmt = upgrade_afmt(afmt, block)
                wanted.append(new_afmt)
        except Exception:
            continue
        if any(new is None for new in wanted):
            continue
        if any(new != old for new, old in zip(wanted, current)):
            names.append(nt.get("name"))
    return sorted(name for name in names if name)


def startup_upgrade(col, panel=None):
    """Rewrite stale injected insides from the bundled panel. Returns a report.

    UM2 (#184): runs once per profile open, silently (notification is UM3's).
    Everything flows through apply_batch as upgrade entries, so undo stays one
    step and a failing note type stays on its old inside for the next boot.
    The answer never depends on where the card sends its requests: the panel
    is the bundle this add-on ships, applied for personal use.
    """
    try:
        bundle = panel if panel is not None else load_panel()
    except Exception as exc:
        return {"applied": [], "unchanged": [], "dropped": [],
                "failed": [], "errors": [str(exc)]}
    names = plan_startup_upgrade(col, bundle)
    if not names:
        return {"applied": [], "unchanged": [], "dropped": [],
                "failed": [], "errors": []}
    return apply_batch(col, [(name, "upgrade") for name in names], bundle)


def _deep(obj):
    """Anki's `col.models.get()` hands back a cached object (design 4.1)."""
    return json.loads(json.dumps(obj))


def _bad_field(name):
    """True when a field name cannot be written as a conditional section.

    Anki renders an unknown ``{{Field}}`` as ``TemplateError::FieldNotFound``
    rather than as empty text (``rslib/src/template.rs::render_into``), which
    is why every field we write is wrapped in ``{{#Field}}…{{/Field}}``: a
    section over a field that was later deleted is simply false. A name that
    contains a brace would end that section early, so such a note type is
    reported as a failure instead of being written and breaking the card.
    """
    return "{" in name or "}" in name


def context_block(field_names):
    """The hidden div that exposes the target's own fields to our card.

    Our own Back Template names ``#raw-text`` and ``#extra``; a third party's
    template has neither, and the card reads context from those ids
    (``composeQuestion`` in ``src/components/askScaffold.ejs``). So we emit
    ``#raw-text`` ourselves, holding every field the target actually has, in
    the target's own order, each wrapped in a conditional section.

    Order is the target's, never sorted: the card truncates at 2000
    characters, so which field survives depends on position.
    """
    names = list(field_names)
    for name in names:
        if _bad_field(name):
            raise ValueError("field name cannot be written as a section: %r" % (name,))
    if not names:
        raise ValueError("note type has no fields")
    lines = ["<div hidden>", '  <span id="raw-text">']
    for index, name in enumerate(names):
        if index:
            # The separator sits outside the sections so it survives even when
            # every field is empty.
            lines.append("")
        lines.append("{{#%s}}{{%s}}{{/%s}}" % (name, name, name))
    lines.append("</span>")
    lines.append("</div>")
    return "\n".join(lines)


def build_block(field_names, panel):
    """The marked block: marker, context, panel, marker.

    Reversible by construction: `uninject_afmt` cuts exactly what this added,
    including the newline in front of it.
    """
    return "%s\n%s\n%s\n%s" % (BEGIN_MARK, context_block(field_names), panel, END_MARK)


def _pair_bounds(afmt):
    """(start, end) of the marked block including its leading newline, or None.

    The leading newline is part of the block: `inject_afmt` adds one, so
    cutting it here is what makes removal byte-exact. An unpaired marker is
    reported as None -- a half-written block is not ours to interpret.
    """
    if afmt.count(BEGIN_MARK) != 1 or afmt.count(END_MARK) != 1:
        return None
    begin = afmt.index(BEGIN_MARK)
    end = afmt.index(END_MARK)
    if end < begin:
        return None
    start = begin
    if start > 0 and afmt[start - 1] == "\n":
        start -= 1
    return start, end + len(END_MARK)


def inject_afmt(afmt, block):
    """Append the block, or return None when the template is not plain.

    "Not plain" means: the block is already there (idempotence), or a marker
    is unpaired, or the template already draws the panel natively. In all
    three cases we write nothing -- the design says a template without our
    markers is not ours to touch.
    """
    if _pair_bounds(afmt) is not None:
        return None
    if BEGIN_MARK in afmt or END_MARK in afmt:
        return None
    if PANEL_MARK in afmt:
        return None
    return afmt + "\n" + block


def uninject_afmt(afmt):
    """Remove the marked block, or return None when there is nothing to remove.

    Cutting the block plus the newline in front of it returns the template to
    the exact string it had before `inject_afmt`, which is acceptance
    criterion 3 in the design.
    """
    bounds = _pair_bounds(afmt)
    if bounds is None:
        return None
    start, end = bounds
    return afmt[:start] + afmt[end:]


def block_inner(block):
    """The part of a block between its two markers."""
    return block[len(BEGIN_MARK) + 1:-(len(END_MARK) + 1)]


def upgrade_afmt(afmt, block):
    """Replace only what is between the markers, or None when absent.

    The markers are copied through rather than rewritten: the revision lives
    in the marker on purpose, so an upgrade must not silently relabel a note
    type somebody is already syncing. Everything the user's own template says
    is outside the pair, and is copied through untouched.
    """
    bounds = _pair_bounds(afmt)
    if bounds is None:
        return None
    inner_start = afmt.index(BEGIN_MARK) + len(BEGIN_MARK)
    inner_end = afmt.index(END_MARK)
    return afmt[:inner_start] + block_inner(block) + afmt[inner_end:]


def _afmt_state(afmt):
    """STATE_* for one answer template."""
    has_pair = _pair_bounds(afmt) is not None
    if BEGIN_MARK in afmt or END_MARK in afmt:
        return STATE_PARTIAL if not has_pair else STATE_INJECTED
    if PANEL_MARK in afmt:
        return STATE_NATIVE
    return STATE_PLAIN


def list_note_types(col):
    """Every note type with its injection state, ordered by name.

    Three states the dialog acts on:

    - ``plain`` -- no panel and no markers: injectable.
    - ``injected`` -- the block is there: removable, upgradable.
    - ``native`` -- legacy (#180): the panel is already drawn without our
      markers (the retired bundled note type). Never written to; injecting
      there would draw the panel twice.

    ``partial`` -- a marker without its pair, or note types whose own
    templates disagree. Reported so the dialog can show it, never written to.
    """
    rows = []
    for nt in col.models.all() or []:
        if not nt:
            continue
        templates = nt.get("tmpls") or []
        if not templates:
            continue
        states = [_afmt_state(t.get("afmt", "") or "") for t in templates]
        if len(set(states)) > 1:
            state = STATE_PARTIAL
        else:
            state = states[0]
        rows.append({
            "id": nt["id"],
            "name": nt["name"],
            "state": state,
            "templates": len(templates),
            "cards": _card_count(col, nt["id"]),
        })
    rows.sort(key=lambda row: row["name"])
    return rows


def _card_count(col, ntid):
    try:
        return len(col.models.nids(ntid))
    except Exception:
        return 0


def _plan(nt, panel, mode):
    """Build the new note type dicts for one target, or raise.

    Returns None when the target needs no change, which is what makes a second
    run write nothing at all (an unconditional write bumps mod/usn and forces a
    full sync on every Anki start).
    """
    nt = _deep(nt)
    templates = nt.get("tmpls") or []
    if not templates:
        raise ValueError("note type has no card template")
    # `upgrade` needs the block too: it rewrites what is between the markers
    # from the same panel `inject` would have appended.
    block = None
    if mode != "uninject":
        field_names = [f.get("name", "") for f in nt.get("flds") or []]
        block = build_block(field_names, panel)

    new_templates = []
    changed = False
    touched = False
    for tmpl in templates:
        tmpl = _deep(tmpl)
        afmt = tmpl.get("afmt", "") or ""
        if mode == "inject":
            new_afmt = inject_afmt(afmt, block)
        elif mode == "uninject":
            new_afmt = uninject_afmt(afmt)
        elif mode == "upgrade":
            new_afmt = upgrade_afmt(afmt, block)
        else:
            raise ValueError("unknown mode: %r" % (mode,))
        if new_afmt is None:
            if mode == "inject":
                if _pair_bounds(afmt) is not None or PANEL_MARK in afmt:
                    # Already injected, or this is our own note type. Either
                    # way there is nothing to add and nothing to complain about.
                    return None
                raise ValueError("template carries an unpaired marker")
            # `uninject` and `upgrade` return None when a template has nothing
            # to change, which only means the same for the whole note type when
            # every template agrees. One template carrying the panel and one
            # not is not ours to interpret, so it is refused rather than
            # half-written or silently reported as unchanged.
            if touched:
                raise ValueError("only some of this note type's templates carry the panel")
            return None
        if new_afmt != afmt:
            changed = True
        tmpl["afmt"] = new_afmt
        new_templates.append(tmpl)
        touched = True

    if not changed:
        return None
    nt["tmpls"] = new_templates
    nt["mod"] = int(time.time())
    nt["usn"] = -1
    return nt


def _find(col, name):
    for nt in col.models.all() or []:
        if nt and nt.get("name") == name:
            return nt
    raise KeyError(name)


def inject(col, name, panel=None):
    """Attach the panel to one note type. Returns a status dict."""
    if panel is None:
        panel = load_panel()
    return _one(col, name, panel, "inject")


def uninject(col, name):
    """Remove the block from one note type. Returns a status dict."""
    return _one(col, name, None, "uninject")


def upgrade(col, name, panel=None):
    """Replace only the inside of the block in one note type."""
    if panel is None:
        panel = load_panel()
    return _one(col, name, panel, "upgrade")


def _one(col, name, panel, mode):
    try:
        nt = _find(col, name)
    except KeyError:
        return {"action": "failed", "name": name, "reason": "note type not found"}
    try:
        planned = _plan(nt, panel, mode)
    except Exception as exc:
        return {"action": "failed", "name": name, "reason": str(exc)}
    if planned is None:
        return {"action": "unchanged", "name": name, "id": nt["id"]}
    col.models.update_dict(planned)
    return {"action": DONE_ACTION[mode], "name": name, "id": nt["id"]}


def apply_batch(col, entries, panel=None):
    """Apply a batch of (name, mode) entries as ONE undo step.

    ``entries`` is a list of ``(name, mode)`` where mode is ``"inject"``,
    ``"uninject"`` or ``"upgrade"``. Design 6.4 fixes the order:

    1. build every new note type dict, dropping what cannot be built;
    2. take the custom undo entry;
    3. write one by one, recording failures and moving on;
    4. merge the undo entries;
    5. report applied / unchanged / dropped / failed.

    Nothing is rolled back on failure: a note type that could not be written
    stays untouched, and one Ctrl+Z undoes the whole batch (design 5.6).
    """
    if panel is None and any(mode != "uninject" for _, mode in entries):
        panel = load_panel()

    planned = []
    dropped = []
    unchanged = []
    for name, mode in entries:
        try:
            nt = _find(col, name)
        except KeyError:
            dropped.append({"name": name, "reason": "note type not found"})
            continue
        try:
            nt_new = _plan(nt, panel, mode)
        except Exception as exc:
            dropped.append({"name": name, "reason": str(exc)})
            continue
        if nt_new is None:
            unchanged.append(name)
            continue
        planned.append((name, nt_new))

    applied = []
    failed = []
    errors = []
    if planned:
        # The two undo calls sit either side of the writes, so an exception
        # from either used to reach Qt and become "Anki encountered a
        # problem" (#119). Taking the entry is what we cannot do without: if
        # it fails nothing may be written, because the writes would not be one
        # Ctrl+Z away. Merging is only tidying up after the fact, so a failure
        # there is reported and the batch stands.
        try:
            target = col.add_custom_undo_entry(_undo_name(entries))
        except Exception as exc:
            failed.extend({"name": name, "reason": str(exc)} for name, _ in planned)
        else:
            for name, nt_new in planned:
                try:
                    col.models.update_dict(nt_new)
                except Exception as exc:
                    failed.append({"name": name, "reason": str(exc)})
                    continue
                applied.append(name)
            try:
                col.merge_undo_entries(target)
            except Exception as exc:
                errors.append("undo entries not merged: %s" % exc)

    return {
        "applied": applied,
        "unchanged": unchanged,
        "dropped": dropped,
        "failed": failed,
        "errors": errors,
    }



def _undo_name(entries):
    modes = {mode for _, mode in entries}
    if modes == {"uninject"}:
        return UNDO_NAME_UNINJECT
    return UNDO_NAME_INJECT