"""Behavioral tests for ask injection (issue #106).

The design is ``docs/design/ask-injection.md``. Six properties are pinned here,
each because breaking it damages a user's collection rather than our card:

1. **Only where there is no marker.** A template with no ``umeboshi-ask``
   marker is not ours to write into, and injecting twice adds one pair, not two.
2. **Removal is byte-exact.** After uninject, the answer template is the string
   it was before inject -- not "equivalent", the same string.
3. **Fields are never touched.** Field count, names and order, template count
   and the question side all survive, because a field-set change forces a full
   sync locally and ``ResyncRequired`` on every other device.
4. **The user's own template is not damaged.** Everything outside the marker
   pair comes back unchanged, including the parts we never understood.
5. **Undo is one step.** ``update_dict`` records a step per note type, so a
   batch must collapse them with add_custom_undo_entry/merge_undo_entries or a
   ten-note-type injection costs ten Ctrl+Z presses.
6. **A failure is a failure, not a rollback.** A note type that cannot be
   written stays exactly as it was, and the report says why.

A fake collection stands in for ``anki.collection.Collection``: it implements
only what the module calls and records every write, so "wrote once" and
"wrote nothing" are observable.

``PickerScreen`` goes one step further and drives the dialog with real Qt
widgets offscreen (#119), because the fake collection cannot show that a row
is not painted or that a button does not emit. It skips itself when PyQt6 is
not installed, so everything above it still runs on the standard library
alone.

Run: py addon/test_inject.py
"""

import ast
import copy
import inspect
import os
import re
import sys
import traceback
import types
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path:
    sys.path.insert(0, HERE)

import inject  # noqa: E402
import i18n as _i18n  # noqa: E402  (#123: the text the picker puts on screen)
import picker  # noqa: E402


def _has_cjk(text):
    """True when the string contains kana or a CJK ideograph."""
    return any("぀" <= ch <= "ヿ" or "一" <= ch <= "鿿" for ch in text)


def _has_latin(text):
    """True when the string contains a Latin letter."""
    return any("A" <= ch <= "Z" or "a" <= ch <= "z" for ch in text)


# The product's own name is Latin in both languages -- it is a package name, not
# a translated word -- and a row also carries the user's own note type name, so
# neither may be counted as "English text on a Japanese screen".
_BRAND = "umeboshi-ask"


def _translatable(text):
    """The part of a string that is ours to translate.

    Drops the product's own name (Latin in both languages -- it is a package
    name, not a translated word) and the ``%s``/``%d`` placeholders a format
    string carries, neither of which is language.
    """
    return re.sub(r"%[sd]", " ", str(text)).replace(_BRAND, " ").replace("ask", " ")


def _string_literals(tree):
    """Every string constant in ``tree`` that is not a docstring.

    Docstrings are prose for whoever edits the file, not text a user sees, so
    the source is allowed to be written in either language. A docstring is
    always the first statement of a module, class or function body, which is
    how they are told apart from real screen text here.
    """
    docstrings = set()
    for node in ast.walk(tree):
        if isinstance(node, (ast.Module, ast.ClassDef, ast.FunctionDef,
                             ast.AsyncFunctionDef)):
            body = getattr(node, "body", None)
            if (body and isinstance(body[0], ast.Expr)
                    and isinstance(body[0].value, ast.Constant)
                    and isinstance(body[0].value.value, str)):
                docstrings.add(id(body[0].value))
    return [child.value for child in ast.walk(tree)
            if isinstance(child, ast.Constant) and isinstance(child.value, str)
            and id(child) not in docstrings]


PANEL = '<div id="umeboshi-ask"><script>var a=1;</script></div>'

# A third party's answer template: its own body, its own field names, its own
# CSS. None of this is ours and all of it has to survive.
FOREIGN_AFMT = (
    '{{FrontSide}}\n'
    '<div class="card">\n'
    '  <div id="q">{{Question}}</div>\n'
    '  {{#Answer}}<div id="a">{{Answer}}</div>{{/Answer}}\n'
    '</div>\n'
    '<style>.card { color: #111; }</style>'
)


def foreign_notetype(ntid=7, name="Someone Else", fields=None, afmt=FOREIGN_AFMT):
    """A legacy note type dict shaped like Anki's, carrying somebody's card."""
    if fields is None:
        fields = ["Front", "Question", "Answer", "Extra"]
    return {
        "id": ntid,
        "name": name,
        "type": 0,
        "mod": 0,
        "usn": -1,
        "sortf": 0,
        "did": None,
        "tmpls": [{
            "name": "Card 1",
            "ord": 0,
            "qfmt": "{{Front}}\n<hr id=\"answer\">\n{{Answer}}",
            "afmt": afmt,
            "bqfmt": "",
            "bafmt": "",
            "did": None,
            "bfont": "Arial",
            "bsize": 12,
        }],
        "flds": [
            {"name": field, "ord": index, "sticky": False, "rtl": False,
             "font": "Arial", "size": 18, "media": [], "tag": index,
             "preventDeletion": False}
            for index, field in enumerate(fields)
        ],
        "css": ".card {}",
        "latexPre": "",
        "latexPost": "",
        "latexsvg": False,
        "req": [[0, "any", [0, 4]]],
        "vers": [],
        "tags": [],
    }


def ours_notetype(ntid=1, name="umeboshi-ask"):
    """Our own note type: it already draws the panel, without our markers."""
    nt = foreign_notetype(ntid=ntid, name=name, fields=["Text", "Back Extra"])
    nt["type"] = 1
    nt["tmpls"][0].update({
        "name": "Cloze",
        "qfmt": "{{cloze:Text}}",
        "afmt": '<div id="text">{{cloze:Text}}</div>\n' + PANEL,
    })
    return nt


class FakeModels:
    """Duck-typed like anki.models.ModelManager for the calls we make."""

    def __init__(self, col):
        self.col = col
        self._all = []
        self.writes = []

    def add(self, nt):
        self._all.append(copy.deepcopy(nt))
        return nt["id"]

    def all(self):
        return [copy.deepcopy(nt) for nt in self._all]

    def get(self, ntid):
        for nt in self._all:
            if nt["id"] == ntid:
                return copy.deepcopy(nt)
        return None

    def nids(self, ntid):
        return [1] * 3

    def update_dict(self, nt):
        # A cached dict handed to us and written to would poison the cache
        # (design §4.1), so store a copy and prove the caller's copy is free.
        for index, existing in enumerate(self._all):
            if existing["id"] == nt["id"]:
                self._all[index] = copy.deepcopy(nt)
                self.writes.append(copy.deepcopy(nt))
                return
        raise ValueError("no such note type: %r" % (nt["id"],))


class FakeCollection:
    """Duck-typed like anki.collection.Collection, recording undo calls."""

    def __init__(self, note_types=(), fail_on=()):
        models_class = FailingModels if fail_on else FakeModels
        self.models = models_class(self)
        for nt in note_types:
            self.models.add(nt)
        self.undo_entries = []
        self.merges = []
        self.fail_on = set(fail_on)

    def add_custom_undo_entry(self, name):
        self.undo_entries.append(name)
        return 1000 + len(self.undo_entries)

    def merge_undo_entries(self, target):
        self.merges.append(target)
        return None

    def afmt(self, name):
        for nt in self.models.all():
            if nt["name"] == name:
                return nt["tmpls"][0]["afmt"]
        raise KeyError(name)

    def notetype(self, name):
        for nt in self.models.all():
            if nt["name"] == name:
                return nt
        raise KeyError(name)

    def names(self):
        return [nt["name"] for nt in self.models.all()]


class FailingModels(FakeModels):
    """A collection whose update refuses for named note types."""

    def update_dict(self, nt):
        name = next(n["name"] for n in self._all if n["id"] == nt["id"])
        if name in self.col.fail_on:
            raise ValueError("notetype schema changed")
        super().update_dict(nt)


class MarkerPresence(unittest.TestCase):
    """1. Only unmarked templates are written, and only once."""

    def test_inject_adds_one_pair(self):
        col = FakeCollection([foreign_notetype()])
        result = inject.inject(col, "Someone Else", PANEL)
        self.assertEqual(result["action"], "injected")
        afmt = col.afmt("Someone Else")
        self.assertEqual(afmt.count(inject.BEGIN_MARK), 1)
        self.assertEqual(afmt.count(inject.END_MARK), 1)

    def test_second_inject_writes_nothing(self):
        col = FakeCollection([foreign_notetype()])
        inject.inject(col, "Someone Else", PANEL)
        once = col.afmt("Someone Else")
        writes = len(col.models.writes)
        result = inject.inject(col, "Someone Else", PANEL)
        self.assertEqual(result["action"], "unchanged")
        self.assertEqual(col.afmt("Someone Else"), once)
        self.assertEqual(len(col.models.writes), writes,
                         "a no-op inject must not bump mod/usn and force a full sync")

    def test_our_own_note_type_is_never_written(self):
        col = FakeCollection([ours_notetype()])
        result = inject.inject(col, "umeboshi-ask", PANEL)
        self.assertEqual(result["action"], "unchanged")
        self.assertEqual(col.models.writes, [])
        self.assertNotIn(inject.BEGIN_MARK, col.afmt("umeboshi-ask"))

    def test_a_half_written_marker_is_left_alone(self):
        broken = FOREIGN_AFMT + "\n" + inject.BEGIN_MARK + "\n<div>half"
        col = FakeCollection([foreign_notetype(afmt=broken)])
        result = inject.inject(col, "Someone Else", PANEL)
        self.assertEqual(result["action"], "failed")
        self.assertIn("marker", result["reason"])
        self.assertEqual(col.models.writes, [])
        self.assertEqual(col.afmt("Someone Else"), broken)

    def test_list_reports_the_three_states(self):
        col = FakeCollection([
            ours_notetype(),
            foreign_notetype(ntid=7, name="Plain"),
            foreign_notetype(ntid=8, name="Injected", afmt=FOREIGN_AFMT + "\n"
                             + inject.BEGIN_MARK + "\nX\n" + inject.END_MARK),
            foreign_notetype(ntid=9, name="Broken",
                             afmt=FOREIGN_AFMT + "\n" + inject.END_MARK),
        ])
        states = {row["name"]: row["state"] for row in inject.list_note_types(col)}
        self.assertEqual(states, {
            "umeboshi-ask": inject.STATE_NATIVE,
            "Plain": inject.STATE_PLAIN,
            "Injected": inject.STATE_INJECTED,
            "Broken": inject.STATE_PARTIAL,
        })


class ExactRemoval(unittest.TestCase):
    """2 and 4. Removal is byte-exact; the rest of the template is untouched."""

    def test_uninject_restores_the_original_bytes(self):
        for original in (
            FOREIGN_AFMT,
            "",
            FOREIGN_AFMT + "\n",
            "no trailing newline",
            "trailing newline\n",
            "\nleading newline\n",
        ):
            with self.subTest(original=original[-20:]):
                col = FakeCollection([foreign_notetype(afmt=original)])
                inject.inject(col, "Someone Else", PANEL)
                self.assertNotEqual(col.afmt("Someone Else"), original)
                result = inject.uninject(col, "Someone Else")
                self.assertEqual(result["action"], "uninjected")
                self.assertEqual(col.afmt("Someone Else"), original)

    def test_the_users_template_body_survives(self):
        col = FakeCollection([foreign_notetype()])
        inject.inject(col, "Someone Else", PANEL)
        afmt = col.afmt("Someone Else")
        self.assertTrue(afmt.startswith(FOREIGN_AFMT),
                        "their answer template must come first, untouched")
        for fragment in ("{{FrontSide}}", "id=\"q\"", "{{#Answer}}", ".card { color: #111; }"):
            self.assertIn(fragment, afmt)
        inject.uninject(col, "Someone Else")
        self.assertEqual(col.afmt("Someone Else"), FOREIGN_AFMT)

    def test_uninject_on_a_clean_template_writes_nothing(self):
        col = FakeCollection([foreign_notetype()])
        result = inject.uninject(col, "Someone Else")
        self.assertEqual(result["action"], "unchanged")
        self.assertEqual(col.models.writes, [])

    def test_upgrade_replaces_only_the_inside(self):
        col = FakeCollection([foreign_notetype()])
        inject.inject(col, "Someone Else", PANEL)
        first = col.afmt("Someone Else")
        col2 = FakeCollection([foreign_notetype()])
        inject.inject(col2, "Someone Else", '<div id="umeboshi-ask">old</div>')
        result = inject.upgrade(col2, "Someone Else", PANEL)
        self.assertEqual(result["action"], "upgraded")
        after = col2.afmt("Someone Else")
        self.assertNotEqual(after, first)
        self.assertTrue(after.startswith(FOREIGN_AFMT))
        self.assertEqual(after.count(inject.BEGIN_MARK), 1)
        self.assertNotIn("old", after)
        # And the upgraded template still removes cleanly.
        inject.uninject(col2, "Someone Else")
        self.assertEqual(col2.afmt("Someone Else"), FOREIGN_AFMT)


class PanelVersionNote(unittest.TestCase):
    """The marker stays frozen; no Worker-facing version compare survives."""

    def test_marker_is_still_v1(self):
        self.assertEqual(inject.BEGIN_MARK, "<!-- umeboshi-ask:begin v1 -->")
        self.assertEqual(inject.END_MARK, "<!-- umeboshi-ask:end -->")

    def test_no_version_compare_helper_survives(self):
        # spec #252 Q21: reading a panel's version note and comparing it
        # against the Worker's release was dead code -- nothing on the
        # add-on's paths ever called it. It is gone, and this keeps it from
        # growing back.
        for name in ("panel_version", "compare_versions", "block_inner_version",
                     "should_pick_up", "is_official_api_base"):
            self.assertFalse(hasattr(inject, name),
                             "inject.py grew %s back" % name)
        self.assertFalse(hasattr(inject, "OFFICIAL_API_BASE"),
                         "inject.py grew the official Worker domain back")

    def test_startup_upgrade_takes_no_worker_address(self):
        # Same removal, from the caller's side: the pass that rewrites stale
        # insides from the bundled panel never asks whose Worker it is.
        parameters = inspect.signature(inject.startup_upgrade).parameters
        self.assertNotIn("api_base", parameters)

class StartupUpgrade(unittest.TestCase):
    """UM2 (#184). Boot rewrites stale insides from the bundled panel."""

    OLD = '<div id="umeboshi-ask">old</div>'
    NEW = '<div id="umeboshi-ask">new</div>'

    def _stale_col(self, panel=None, **kwargs):
        col = FakeCollection([foreign_notetype()], **kwargs)
        inject.inject(col, "Someone Else", panel or self.OLD)
        col.models.writes.clear()
        col.undo_entries.clear()
        col.merges.clear()
        return col

    def test_stale_inside_becomes_the_bundled_panel(self):
        col = self._stale_col()
        report = inject.startup_upgrade(col, self.NEW)
        self.assertEqual(report["applied"], ["Someone Else"])
        self.assertIn("new", col.afmt("Someone Else"))
        self.assertNotIn("old", col.afmt("Someone Else"))

    def test_outside_the_markers_survives_byte_for_byte(self):
        col = self._stale_col()
        inject.startup_upgrade(col, self.NEW)
        afmt = col.afmt("Someone Else")
        self.assertTrue(afmt.startswith(FOREIGN_AFMT))
        self.assertEqual(afmt.count(inject.BEGIN_MARK), 1)
        self.assertEqual(afmt.count(inject.END_MARK), 1)
        self.assertIn("{{FrontSide}}", afmt)
        self.assertIn(".card { color: #111; }", afmt)

    def test_marker_stays_v1_and_back_template_only(self):
        col = self._stale_col()
        before = col.notetype("Someone Else")
        inject.startup_upgrade(col, self.NEW)
        after = col.notetype("Someone Else")
        self.assertIn(inject.BEGIN_MARK, col.afmt("Someone Else"))
        self.assertEqual(after["tmpls"][0]["qfmt"], before["tmpls"][0]["qfmt"])
        self.assertEqual([f["name"] for f in after["flds"]],
                         [f["name"] for f in before["flds"]])

    def test_second_boot_writes_nothing(self):
        col = self._stale_col()
        inject.startup_upgrade(col, self.NEW)
        writes = len(col.models.writes)
        report = inject.startup_upgrade(col, self.NEW)
        self.assertEqual(report["applied"], [])
        self.assertEqual(len(col.models.writes), writes)

    def test_failing_note_type_keeps_its_old_inside(self):
        col = FakeCollection(
            [foreign_notetype(ntid=7, name="Good"),
             foreign_notetype(ntid=8, name="Bad")])
        inject.apply_batch(
            col, [("Good", "inject"), ("Bad", "inject")], self.OLD)
        failing = FakeCollection(
            [foreign_notetype(ntid=7, name="Good"),
             foreign_notetype(ntid=8, name="Bad")],
            fail_on=["Bad"])
        for nt in col.models.all():
            for index, existing in enumerate(failing.models._all):
                if existing["id"] == nt["id"]:
                    import copy as _copy
                    failing.models._all[index] = _copy.deepcopy(nt)
        report = inject.startup_upgrade(failing, self.NEW)
        self.assertEqual(report["applied"], ["Good"])
        self.assertEqual([row["name"] for row in report["failed"]], ["Bad"])
        bad = next(nt for nt in failing.models.all() if nt["name"] == "Bad")
        self.assertIn("old", bad["tmpls"][0]["afmt"])
        self.assertNotIn("new", bad["tmpls"][0]["afmt"])

    def test_a_version_note_inside_does_not_decide(self):
        # The panel-version note inside the block is inert on this path: what
        # decides old-vs-new is the inside versus the bundled panel. So a
        # 9.9.9 note riding along a stale inside does not keep it stale.
        col = self._stale_col(
            '<div id="umeboshi-ask">old</div>\n'
            '<!-- umeboshi-ask:panel-version 9.9.9 -->')
        report = inject.startup_upgrade(col, self.NEW)
        self.assertEqual(report["applied"], ["Someone Else"])
        self.assertIn("new", col.afmt("Someone Else"))
        self.assertNotIn("old", col.afmt("Someone Else"))

    def test_an_old_note_never_forces_a_rewrite(self):
        # The other side of the same rule: a 0.0.1 note on an inside that
        # already matches the bundle is not "older", so a second boot writes
        # nothing.
        bundled = self.NEW + '<!-- umeboshi-ask:panel-version 0.0.1 -->'
        col = self._stale_col(bundled)
        inject.startup_upgrade(col, bundled)
        writes = len(col.models.writes)
        report = inject.startup_upgrade(col, bundled)
        self.assertEqual(report["applied"], [])
        self.assertEqual(len(col.models.writes), writes)

    def test_batch_is_one_undo_step(self):
        col = FakeCollection(
            [foreign_notetype(ntid=7, name="A"),
             foreign_notetype(ntid=8, name="B"),
             foreign_notetype(ntid=9, name="C")])
        inject.apply_batch(
            col, [("A", "inject"), ("B", "inject"), ("C", "inject")], self.OLD)
        col.undo_entries.clear()
        col.merges.clear()
        report = inject.startup_upgrade(col, self.NEW)
        self.assertEqual(sorted(report["applied"]), ["A", "B", "C"])
        self.assertEqual(len(col.undo_entries), 1)
        self.assertEqual(len(col.merges), 1)

    def test_plain_native_and_partial_are_never_planned(self):
        col = FakeCollection([
            foreign_notetype(ntid=7, name="Plain"),
            ours_notetype(ntid=1, name="umeboshi-ask"),
            foreign_notetype(ntid=9, name="Broken",
                             afmt=FOREIGN_AFMT + "\n" + inject.END_MARK),
        ])
        self.assertEqual(inject.plan_startup_upgrade(col, self.NEW), [])
        report = inject.startup_upgrade(col, self.NEW)
        self.assertEqual(report["applied"], [])
        self.assertEqual(col.models.writes, [])


class FieldsUntouched(unittest.TestCase):
    """3. Field count, names, order and template count never move."""

    def test_schema_is_identical_before_and_after(self):
        col = FakeCollection([foreign_notetype()])
        before = col.notetype("Someone Else")
        inject.inject(col, "Someone Else", PANEL)
        inject.upgrade(col, "Someone Else", PANEL)
        after = col.notetype("Someone Else")
        self.assertEqual([f["name"] for f in after["flds"]],
                         [f["name"] for f in before["flds"]])
        self.assertEqual([f["ord"] for f in after["flds"]],
                         [f["ord"] for f in before["flds"]])
        self.assertEqual(len(after["flds"]), len(before["flds"]))
        self.assertEqual(len(after["tmpls"]), len(before["tmpls"]))
        self.assertEqual(after["tmpls"][0]["qfmt"], before["tmpls"][0]["qfmt"],
                         "the question side must never be written")

    def test_many_fields_keep_their_order_in_the_context(self):
        names = ["Front", "Back", "Extra", "Word", "Sentence", "Image", "Source"]
        col = FakeCollection([foreign_notetype(fields=names)])
        inject.inject(col, "Someone Else", PANEL)
        afmt = col.afmt("Someone Else")
        positions = [afmt.index("{{%s}}" % name) for name in names]
        self.assertEqual(positions, sorted(positions),
                         "the card truncates at 2000 chars, so field order decides what survives")
        for name in names:
            self.assertIn("{{#%s}}{{%s}}{{/%s}}" % (name, name, name), afmt)

    def test_a_field_nobody_can_reference_is_reported_not_written(self):
        col = FakeCollection([foreign_notetype(fields=["Front", "Bro{ken"])])
        report = inject.apply_batch(col, [("Someone Else", "inject")], PANEL)
        self.assertEqual(report["applied"], [])
        self.assertEqual(len(report["dropped"]), 1)
        self.assertIn("Bro{ken", report["dropped"][0]["reason"])
        self.assertEqual(col.models.writes, [])
        self.assertEqual(col.afmt("Someone Else"), FOREIGN_AFMT)

    def test_a_note_type_with_no_fields_is_reported_not_written(self):
        col = FakeCollection([foreign_notetype(fields=[])])
        report = inject.apply_batch(col, [("Someone Else", "inject")], PANEL)
        self.assertEqual(report["applied"], [])
        self.assertEqual(len(report["dropped"]), 1)
        self.assertEqual(col.models.writes, [])

    def test_every_template_of_a_multi_template_type_is_marked(self):
        nt = foreign_notetype()
        second = copy.deepcopy(nt["tmpls"][0])
        second.update({"name": "Card 2", "ord": 1, "afmt": "<p>{{Front}}</p>"})
        nt["tmpls"].append(second)
        col = FakeCollection([nt])
        inject.inject(col, "Someone Else", PANEL)
        stored = col.notetype("Someone Else")
        for tmpl in stored["tmpls"]:
            self.assertIn(inject.BEGIN_MARK, tmpl["afmt"])
        inject.uninject(col, "Someone Else")
        stored = col.notetype("Someone Else")
        self.assertEqual([t["afmt"] for t in stored["tmpls"]],
                         [FOREIGN_AFMT, "<p>{{Front}}</p>"])

    def test_a_half_marked_multi_template_note_type_is_refused(self):
        # One template carries the block and the other does not. Removing from
        # the one and leaving the other is a half-applied state, and reporting
        # "unchanged" while a block survives would be a lie, so this is refused
        # and the reason is said out loud.
        nt = foreign_notetype()
        nt["tmpls"][0]["afmt"] = inject.inject_afmt(FOREIGN_AFMT, inject.build_block(
            ["Front", "Question", "Answer", "Extra"], PANEL))
        nt["tmpls"].append({
            "name": "Card 2", "ord": 1, "qfmt": "{{Front}}",
            "afmt": "<p>{{Front}}</p>",
        })
        col = FakeCollection([nt])

        report = inject.apply_batch(col, [("Someone Else", "uninject")])
        self.assertEqual(report["applied"], [])
        self.assertEqual(col.models.writes, [])
        self.assertEqual([row["name"] for row in report["dropped"]], ["Someone Else"])
        self.assertIn("some of this note type", report["dropped"][0]["reason"])
        self.assertEqual(inject.list_note_types(col)[0]["state"], inject.STATE_PARTIAL)


class OneUndoStep(unittest.TestCase):
    """5. A batch is one Ctrl+Z, not one per note type."""

    def test_batch_takes_one_undo_entry_and_merges_it(self):
        col = FakeCollection([
            foreign_notetype(ntid=7, name="A"),
            foreign_notetype(ntid=8, name="B"),
            foreign_notetype(ntid=9, name="C"),
        ])
        report = inject.apply_batch(
            col, [("A", "inject"), ("B", "inject"), ("C", "inject")], PANEL)
        self.assertEqual(sorted(report["applied"]), ["A", "B", "C"])
        self.assertEqual(len(col.undo_entries), 1)
        self.assertEqual(col.merges, [col.undo_entries and 1001])
        self.assertEqual(len(col.models.writes), 3,
                         "one update_dict per note type, and no more")

    def test_a_no_op_batch_takes_no_undo_entry(self):
        col = FakeCollection([foreign_notetype()])
        inject.apply_batch(col, [("Someone Else", "inject")], PANEL)
        col.undo_entries.clear()
        col.merges.clear()
        report = inject.apply_batch(col, [("Someone Else", "inject")], PANEL)
        self.assertEqual(report["unchanged"], ["Someone Else"])
        self.assertEqual(col.undo_entries, [])
        self.assertEqual(col.merges, [])

    def test_unticking_is_one_undo_step_too(self):
        col = FakeCollection([foreign_notetype(ntid=7, name="A"),
                              foreign_notetype(ntid=8, name="B")])
        inject.apply_batch(col, [("A", "inject"), ("B", "inject")], PANEL)
        col.undo_entries.clear()
        col.merges.clear()
        report = inject.apply_batch(col, [("A", "uninject"), ("B", "uninject")])
        self.assertEqual(sorted(report["applied"]), ["A", "B"])
        self.assertEqual(col.undo_entries, [inject.UNDO_NAME_UNINJECT])
        self.assertEqual(col.afmt("A"), FOREIGN_AFMT)
        self.assertEqual(col.afmt("B"), FOREIGN_AFMT)


class FailureLeavesAlone(unittest.TestCase):
    """6. A failed write is not rolled back, and the rest still goes in."""

    def test_a_failing_write_does_not_stop_or_undo_the_batch(self):
        col = FakeCollection(
            [
                foreign_notetype(ntid=7, name="Good"),
                foreign_notetype(ntid=8, name="Bad"),
                foreign_notetype(ntid=9, name="AlsoGood"),
            ],
            fail_on=["Bad"],
        )
        report = inject.apply_batch(
            col, [("Good", "inject"), ("Bad", "inject"), ("AlsoGood", "inject")], PANEL)
        self.assertEqual(report["applied"], ["Good", "AlsoGood"])
        self.assertEqual([row["name"] for row in report["failed"]], ["Bad"])
        self.assertIn("notetype schema changed", report["failed"][0]["reason"])
        self.assertNotIn(inject.BEGIN_MARK, col.afmt("Bad"))
        self.assertIn(inject.BEGIN_MARK, col.afmt("Good"))
        self.assertEqual(len(col.merges), 1, "the batch still collapses to one step")

    def test_an_unknown_note_type_is_dropped_before_any_write(self):
        col = FakeCollection([foreign_notetype(name="Here")])
        report = inject.apply_batch(col, [("Here", "inject"), ("Gone", "inject")], PANEL)
        self.assertEqual(report["applied"], ["Here"])
        self.assertEqual([row["name"] for row in report["dropped"]], ["Gone"])
        self.assertEqual(len(col.undo_entries), 1)

    def test_an_untouched_note_type_keeps_its_bytes(self):
        col = FakeCollection([
            foreign_notetype(ntid=7, name="Target"),
            foreign_notetype(ntid=8, name="Bystander"),
        ])
        before = col.afmt("Bystander")
        inject.apply_batch(col, [("Target", "inject")], PANEL)
        self.assertEqual(col.afmt("Bystander"), before)


class PanelFromTheBuild(unittest.TestCase):
    """The packaged panel is the one the build produced."""

    def test_the_bundled_panel_is_usable_and_marker_free(self):
        panel = inject.load_panel()
        self.assertIn('<div id="umeboshi-ask"', panel)
        self.assertNotIn(inject.BEGIN_MARK, panel,
                         "the panel must not carry our marker; inject.py adds it")
        self.assertNotIn("{{cloze:", panel,
                         "the panel draws no card: the target's template already does")

    def test_the_panel_declares_its_variables_on_our_ids(self):
        panel = inject.load_panel()
        self.assertNotIn(":root", panel)
        self.assertIn("#umeboshi-ask, #umeboshi-ask-settings-modal, "
                      "#umeboshi-ask-consent-modal {", panel)

    def test_the_panel_reads_context_from_the_hidden_div(self):
        panel = inject.load_panel()
        self.assertIn('cardField("raw-text")', panel,
                      "the card reads #raw-text, which inject.py creates")


class Picker(unittest.TestCase):
    """The screen: three states, a tri-state "all", and a two-button plan."""

    def _col(self):
        return FakeCollection([
            ours_notetype(),
            foreign_notetype(ntid=7, name="Plain"),
            foreign_notetype(ntid=8, name="Injected", afmt=FOREIGN_AFMT + "\n"
                             + inject.BEGIN_MARK + "\nX\n" + inject.END_MARK),
        ])

    def test_rows_carry_state_and_lock_the_untouchable(self):
        rows = {row["name"]: row for row in picker.rows(self._col())}
        self.assertFalse(rows["umeboshi-ask"]["tickable"])
        self.assertTrue(rows["Plain"]["tickable"])
        self.assertTrue(rows["Injected"]["tickable"])
        self.assertTrue(rows["Injected"]["checked"])
        for row in rows.values():
            self.assertIn(row["state"], picker.STATE_KEYS)

    def test_the_all_row_is_partial_when_mixed(self):
        items = picker.rows(self._col())
        self.assertIsNone(picker.all_row_state(items))

        col = FakeCollection([foreign_notetype(ntid=7, name="A"),
                              foreign_notetype(ntid=8, name="B")])
        self.assertIs(picker.all_row_state(picker.rows(col)), False)

        inject.apply_batch(col, [("A", "inject")], PANEL)
        self.assertIsNone(picker.all_row_state(picker.rows(col)))

        inject.apply_batch(col, [("B", "inject")], PANEL)
        self.assertIs(picker.all_row_state(picker.rows(col)), True)

    def test_ticking_and_unticking_produce_the_right_modes(self):
        items = picker.rows(self._col())
        # Unticked and uninjected: nothing to do. Unticked and injected: remove.
        self.assertEqual(picker.plan(items, {"Injected"}), [("Injected", "upgrade")])
        self.assertEqual(picker.plan(items, set()), [("Injected", "uninject")])
        self.assertEqual(
            picker.plan(items, {"Plain", "Injected"}),
            [("Injected", "upgrade"), ("Plain", "inject")])
        self.assertEqual(picker.plan(items, {"Plain"}),
                         [("Injected", "uninject"), ("Plain", "inject")])

    def test_the_plan_never_touches_an_untouchable_row(self):
        items = picker.rows(self._col())
        for checked in (set(), {"Injected"}, {"umeboshi-ask"}, {"umeboshi-ask", "Plain"}):
            names = [name for name, _mode in picker.plan(items, checked)]
            self.assertNotIn("umeboshi-ask", names)

    def test_the_report_names_every_group(self):
        report = {"applied": ["A"], "unchanged": ["B"],
                  "dropped": [{"name": "C", "reason": "bad field"}],
                  "failed": [{"name": "D", "reason": "notetype schema changed"}],
                  "errors": ["undo entries not merged: closed"]}
        lines = picker.report_lines(report)
        self.assertEqual(len(lines), 5)
        self.assertTrue(any("C" in line and "bad field" in line for line in lines))
        self.assertTrue(any("notetype schema changed" in line for line in lines))
        self.assertTrue(any("undo entries not merged" in line for line in lines))
        self.assertEqual(picker.report_lines(picker.EMPTY_REPORT), [])

    # #123: every word this add-on paints used to carry a Japanese and an
    # English form side by side ("適用 / Apply"), so a screen in one language
    # had the other stapled to it. All of that text now lives in addon/i18n.py,
    # one table per language, so that table is where a mixed string would have
    # to be reintroduced -- and where these pin it out.
    #
    # The composed rows and result lines are not checked for mixing directly:
    # they concatenate a table entry with the user's own note type name, which
    # may be in any script. The last test below proves the composition reads the
    # table rather than hardcoding, so a correct table means a correct screen.
    def test_no_table_entry_shows_two_languages_at_once(self):
        for lang in ("ja", "en"):
            for key, text in _i18n.TEXT[lang].items():
                ours = _translatable(text)
                self.assertFalse(
                    _has_cjk(ours) and _has_latin(ours),
                    "the %s text for %r carries both languages: %r"
                    % (lang, key, text))

    def test_each_table_really_is_one_language(self):
        # The check above passes trivially on an empty table, so assert the
        # direction: Japanese text has kana, and no English entry has any.
        for lang in ("ja", "en"):
            for key, text in _i18n.TEXT[lang].items():
                ours = _translatable(text)
                if lang == "ja":
                    self.assertTrue(_has_cjk(ours),
                                    "expected Japanese for %r, got %r" % (key, text))
                else:
                    self.assertFalse(_has_cjk(ours),
                                     "English text for %r has Japanese in it: %r"
                                     % (key, text))

    def test_both_tables_answer_every_key_the_screen_asks_for(self):
        # The two tables must carry the same keys, or one language silently
        # falls back to English mid-screen (#123).
        self.assertEqual(sorted(_i18n.TEXT["ja"]), sorted(_i18n.TEXT["en"]),
                         "a key exists in one language only")
        for lang in ("ja", "en"):
            for key, text in _i18n.TEXT[lang].items():
                self.assertTrue(text.strip(), "%s has empty text for %r" % (lang, key))

    def test_rows_and_report_lines_come_from_the_table(self):
        # If any of these stopped reading the table, the table could be correct
        # and the screen still bilingual -- which is the bug this pins.
        for row in picker.rows(self._col(), "en"):
            self.assertTrue(
                row["label"].endswith(picker.state_text(row["state"], "en")),
                "the row state is not the table's: %r" % (row["label"],))
        self.assertEqual(picker.title("ja"), _i18n.t("title", "ja"))
        self.assertEqual(picker.title("en"), _i18n.t("title", "en"))
        self.assertNotEqual(picker.title("ja"), picker.title("en"))
        report = {"applied": ["A"], "unchanged": [], "dropped": [],
                  "failed": [], "errors": []}
        self.assertEqual(picker.report_lines(report, "en"),
                         ["%s: A" % _i18n.t("applied", "en")])
        self.assertEqual(picker.report_lines(report, "ja"),
                         ["%s: A" % _i18n.t("applied", "ja")])

    def test_the_language_follows_ankis_own_code(self):
        # Anki hands out locale-shaped codes and changes shape depending on
        # whether the value came from startup normalisation or from
        # ProfileManager.setLang, so both forms have to land on the right table.
        # Measured against anki.lang.lang_to_disk_lang upstream.
        for code in ("ja", "ja_JP", "JA", " ja_JP "):
            self.assertEqual(_i18n._resolve(code), "ja", code)
        for code in ("en", "en_US", "en-GB", "en_GB", "de", "fr_FR",
                     "zh-CN", "ko_KR", "pt-BR", ""):
            self.assertEqual(_i18n._resolve(code), "en", code)

    def test_it_reads_the_language_the_profile_manager_holds(self):
        # anki.lang has no current_lang — neither on 25.09.2 nor on main. The
        # profile's own meta does: ProfileManager.setLang writes
        # meta["defaultLang"]. The old code did a getattr on the missing name,
        # so it answered "en" on every machine and the next test asserted
        # exactly that: the picker was English-only for a Japanese Anki.
        import types as _types

        fake = _types.ModuleType("aqt")
        fake.mw = _types.SimpleNamespace(
            pm=_types.SimpleNamespace(meta={"defaultLang": "ja_JP"})
        )
        saved = sys.modules.get("aqt")
        sys.modules["aqt"] = fake
        try:
            self.assertEqual(_i18n.current_lang(), "ja")
            self.assertEqual(_i18n.t("apply"), _i18n.TEXT["ja"]["apply"])
        finally:
            if saved is None:
                sys.modules.pop("aqt", None)
            else:
                sys.modules["aqt"] = saved

    def test_it_falls_back_to_english_with_no_anki(self):
        # test_inject.py loads this module with no Anki present, and so does the
        # bare-import path in picker.py, so the lookup must not raise.
        self.assertEqual(_i18n.current_lang(), "en")
        self.assertEqual(_i18n.t("apply"), _i18n.TEXT["en"]["apply"])

    def test_no_screen_text_is_hardcoded_outside_the_table(self):
        # The table checks above only cover text that went through it. A
        # literal pasted into picker.py would draw the old bilingual button
        # again while every table stayed clean, so the source itself is
        # scanned: outside docstrings and comments, picker.py may not contain
        # user-visible Japanese. English survives there only as a format string
        # or the package name, both of which _translatable drops.
        with open(os.path.join(HERE, "picker.py"), encoding="utf-8") as handle:
            source = handle.read()
        code = "\n".join(line for line in source.splitlines()
                         if not line.lstrip().startswith("#"))
        for literal in _string_literals(ast.parse(code)):
            self.assertFalse(
                _has_cjk(_translatable(literal)),
                "picker.py hardcodes Japanese outside addon/i18n.py: %r"
                % (literal,))

    def test_a_failed_undo_entry_writes_nothing_and_says_so(self):
        col = FakeCollection([foreign_notetype(ntid=7, name="A"),
                              foreign_notetype(ntid=8, name="B")])
        col.add_custom_undo_entry = self._refuse
        report = inject.apply_batch(col, [("A", "inject"), ("B", "inject")], PANEL)
        self.assertEqual(report["applied"], [])
        self.assertEqual(col.models.writes, [])
        self.assertEqual(sorted(row["name"] for row in report["failed"]), ["A", "B"])

    @staticmethod
    def _refuse(_name):
        raise RuntimeError("collection is closing")


class StartupNotice(unittest.TestCase):
    """UM3 (#185). The boot notice: once, Desktop only, three buttons."""

    def _report(self):
        return {"applied": ["Someone Else"], "unchanged": [], "dropped": [],
                "failed": [{"name": "Bad", "reason": "note type not found"}],
                "errors": []}

    def test_both_tables_carry_the_notice_words(self):
        # The ticket's acceptance: the sentence in both languages lives in
        # addon/i18n.py, so a missing key fails here, not on a real device.
        self.assertEqual(sorted(_i18n.TEXT["ja"]), sorted(_i18n.TEXT["en"]))
        for lang in ("ja", "en"):
            for key in ("update_title", "update_body", "update_open",
                        "update_undo", "update_disable", "auto_upgrade"):
                self.assertTrue(_i18n.TEXT[lang][key].strip(),
                                "%s has empty text for %r" % (lang, key))
        self.assertIn("更新しました", _i18n.TEXT["ja"]["update_title"])
        self.assertNotEqual(_i18n.t("update_open", "ja"),
                            _i18n.t("update_open", "en"))

    def test_no_notice_without_an_applied_note_type(self):
        for report in ({"applied": []}, picker.EMPTY_REPORT):
            seen = []
            result = picker.notify_updated(
                dict(report, unchanged=[], dropped=[], failed=[], errors=[]),
                lang="en", ask=lambda text, buttons: seen.append((text, buttons)))
            self.assertIsNone(result)
            self.assertEqual(seen, [])

    def test_the_notice_names_what_was_applied(self):
        seen = []
        result = picker.notify_updated(
            self._report(), lang="ja",
            ask=lambda text, buttons: seen.append((text, buttons)) or buttons[0])
        self.assertEqual(result, "update_open")
        self.assertEqual(len(seen), 1)
        text, buttons = seen[0]
        self.assertIn("Someone Else", text)
        self.assertIn("Bad", text)
        self.assertEqual(buttons, [_i18n.t(key, "ja")
                                   for key in picker.NOTIFY_BUTTON_KEYS])

    def test_each_button_maps_to_its_key_whatever_the_language(self):
        for lang in ("ja", "en"):
            labels = [_i18n.t(key, lang) for key in picker.NOTIFY_BUTTON_KEYS]
            for index, key in enumerate(picker.NOTIFY_BUTTON_KEYS):
                result = picker.notify_updated(
                    self._report(), lang=lang,
                    ask=lambda text, buttons, _i=index: buttons[_i])
                self.assertEqual(result, key)

    def test_closing_the_notice_picks_nothing(self):
        result = picker.notify_updated(
            self._report(), lang="en", ask=lambda text, buttons: None)
        self.assertIsNone(result)

    def test_the_notice_reads_the_profiles_language_code(self):
        self.assertEqual(picker.notify_lang("ja_JP"), "ja")
        self.assertEqual(picker.notify_lang("en-GB"), "en")
        self.assertEqual(picker.notify_lang(lang="ja"), "ja")

    def test_the_switch_reads_and_writes_through_the_manager(self):
        import types as _types

        store = {"auto_upgrade": False}
        fake = _types.ModuleType("aqt")
        manager = _types.SimpleNamespace(
            getConfig=lambda module: dict(store),
            writeConfig=lambda module, conf: store.update(conf),
        )
        fake.mw = _types.SimpleNamespace(addonManager=manager)
        saved = sys.modules.get("aqt")
        sys.modules["aqt"] = fake
        try:
            self.assertFalse(picker._read_auto_upgrade())
            self.assertTrue(picker._write_auto_upgrade(True))
            self.assertTrue(picker._read_auto_upgrade())
        finally:
            if saved is None:
                sys.modules.pop("aqt", None)
            else:
                sys.modules["aqt"] = saved

    def test_the_switch_reads_on_with_no_anki(self):
        saved = sys.modules.pop("aqt", None)
        try:
            self.assertTrue(picker._read_auto_upgrade())
            self.assertFalse(picker._write_auto_upgrade(False))
        finally:
            if saved is not None:
                sys.modules["aqt"] = saved

# ------------------------------------------------------------- the real screen

_QT_ENV = []


def _qt_env():
    """Real Qt plus a stand-in for Anki's ``aqt``, or None if PyQt6 is absent.

    ``qt/aqt/qt/qt6.py`` is ``from PyQt6.QtCore import *`` and the same for
    Gui and Widgets, and ``qt/aqt/qt/__init__.py`` re-exports that. The
    stand-in copies those names rather than listing them, so what picker.py
    is handed here is what it is handed inside Anki -- ``QSignalBlocker``
    included, which is imported from ``aqt.qt`` for exactly that reason.
    """
    if _QT_ENV:
        return _QT_ENV[0]
    os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")
    try:
        from PyQt6 import QtCore, QtGui, QtWidgets
    except ImportError:
        return None
    app = QtWidgets.QApplication.instance() or QtWidgets.QApplication([])
    # A stray quit from a closed window would end a nested loop mid-click.
    app.setQuitOnLastWindowClosed(False)
    aqt = types.ModuleType("aqt")
    aqt_qt = types.ModuleType("aqt.qt")
    for module in (QtCore, QtGui, QtWidgets):
        for name in dir(module):
            if not name.startswith("_"):
                setattr(aqt_qt, name, getattr(module, name))
    aqt.qt = aqt_qt
    sys.modules["aqt"] = aqt
    sys.modules["aqt.qt"] = aqt_qt
    _QT_ENV.append((QtCore, QtWidgets, app, aqt))
    return _QT_ENV[0]


class PickerScreen(unittest.TestCase):
    """The dialog itself, driven with real Qt widgets (issue #119).

    Every test above this one runs on a fake collection and never touches Qt,
    which is why neither symptom in #119 could be caught: a ``QTreeWidgetItem``
    starts collapsed, ``setHeaderLabels`` widens the view, ``QTreeWidgetItem``
    has no ``blockSignals``, and a button with ``ApplyRole`` emits neither
    ``accepted`` nor ``rejected``. All four are true of real Qt and of nothing
    else, so the dialog is opened here and read back from the view itself.
    """

    def setUp(self):
        env = _qt_env()
        if env is None:
            self.skipTest("PyQt6 is not installed; the screen needs real Qt")
        self.core, self.widgets, self.app, self.aqt = env
        self.leaked = []
        self._hook = sys.excepthook
        self.addCleanup(self._restore)
        # PyQt6 hands an exception from a slot to sys.excepthook and then
        # aborts the process, so this is the only thing standing between a
        # regression in the dialog and a test run that dies without a word.
        sys.excepthook = self._record

    def _record(self, etype, value, tb):
        self.leaked.append("".join(traceback.format_exception(etype, value, tb)))

    def _restore(self):
        sys.excepthook = self._hook

    def _pump(self, ms=200):
        """Spin the loop. QAbstractButton.click() defers through a 100ms timer."""
        loop = self.core.QEventLoop()
        self.core.QTimer.singleShot(ms, loop.quit)
        loop.exec()

    def _open(self, col, act, lang="ja"):
        """Open the real dialog; run ``act(dialog)`` inside its event loop."""
        mw = self.widgets.QMainWindow()
        mw.col = col
        self.addCleanup(mw.deleteLater)
        self.aqt.mw = mw
        seen = {}

        def fire():
            dlg = next(w for w in self.app.topLevelWidgets()
                       if isinstance(w, self.widgets.QDialog)
                       and w.windowTitle() == picker.title(lang))
            try:
                act(dlg, seen)
            finally:
                dlg.reject()

        self.core.QTimer.singleShot(0, fire)
        seen["report"] = picker.open_dialog(lang=lang)
        return seen

    def _tree(self, dlg):
        return dlg.findChild(self.widgets.QTreeWidget)

    def _apply(self, dlg):
        box = dlg.findChild(self.widgets.QDialogButtonBox)
        box.button(box.StandardButton.Apply).click()
        self._pump()

    def _col(self):
        return FakeCollection([
            ours_notetype(),
            foreign_notetype(ntid=7, name="Plain"),
            foreign_notetype(ntid=8, name="Injected", afmt=FOREIGN_AFMT + "\n"
                             + inject.BEGIN_MARK + "\nX\n" + inject.END_MARK),
            foreign_notetype(ntid=9, name="Other"),
        ])

    def test_every_note_type_is_a_row_the_view_actually_draws(self):
        col = self._col()
        seen = self._open(col, lambda dlg, seen: seen.update(
            tree=self._tree(dlg), rows=_labels(self._tree(dlg))))
        tree = seen["tree"]
        all_item = tree.topLevelItem(0)
        drawn = [all_item.child(i) for i in range(all_item.childCount())
                 if tree.visualItemRect(all_item.child(i)).isValid()]
        self.assertEqual(len(drawn), len(col.names()),
                         "a note type that is a child but not drawn is invisible")
        self.assertEqual(tree.columnCount(), 1)

    def test_ticking_all_and_applying_writes_the_markers(self):
        col = self._col()
        before = col.afmt("Plain")

        def act(dlg, seen):
            tree = self._tree(dlg)
            all_item = tree.topLevelItem(0)
            all_item.setCheckState(0, self.core.Qt.CheckState.Checked)
            self._pump(1)
            seen["ticked"] = _checked(self.core, all_item)
            self._apply(dlg)
            seen["after"] = _labels(tree)

        seen = self._open(col, act)
        self.assertEqual(seen["ticked"], {"Injected", "Other", "Plain"},
                         "our own note type is not ours to tick")
        self.assertEqual(seen["report"]["applied"], ["Injected", "Other", "Plain"])
        self.assertNotEqual(col.afmt("Plain"), before)
        self.assertEqual(col.afmt("Plain").count(inject.BEGIN_MARK), 1)
        self.assertEqual(col.afmt("Other").count(inject.END_MARK), 1)
        self.assertNotIn(inject.BEGIN_MARK, col.afmt("umeboshi-ask"))
        injected = picker.state_text(inject.STATE_INJECTED, "ja")
        self.assertTrue(all(injected in label for name, label in seen["after"].items()
                            if name != "umeboshi-ask"),
                        "the row has to be redrawn from disk, not left stale")
        self.assertEqual(self.leaked, [])

    def test_unticking_an_injected_row_takes_the_panel_back_out(self):
        col = self._col()
        self.assertIn(inject.BEGIN_MARK, col.afmt("Injected"))

        def act(dlg, seen):
            all_item = self._tree(dlg).topLevelItem(0)
            _row(self.core, all_item, "Injected").setCheckState(
                0, self.core.Qt.CheckState.Unchecked)
            self._pump(1)
            seen["all_state"] = all_item.checkState(0)
            self._apply(dlg)

        seen = self._open(col, act)
        self.assertEqual(seen["report"]["applied"], ["Injected"])
        self.assertEqual(col.afmt("Injected"), FOREIGN_AFMT,
                         "the pre-existing template comes back byte for byte")
        self.assertEqual(seen["all_state"], self.core.Qt.CheckState.Unchecked,
                         "the only ticked row went, so 'all' is unticked too")
        self.assertEqual(self.leaked, [])

    def test_a_failure_while_applying_is_reported_not_raised(self):
        # A missing packaged panel is the ordinary way `run` gives up, and it
        # gives up before anything is written.
        #
        # `picker._inject` is not the `inject` this file imports: a bare
        # `import picker` has no package, so picker.py's fallback loads
        # inject.py a second time under the name `umeboshi_ask_inject`. Inside
        # Anki the relative import wins and there is only one module, so the
        # dialog's copy is the one to patch here.
        target = picker._inject
        self.assertIsNot(target, inject)
        original = target.load_panel
        self.addCleanup(setattr, target, "load_panel", original)

        def boom():
            raise RuntimeError("panel.html is missing")

        target.load_panel = boom
        col = self._col()
        seen = self._open(col, lambda dlg, seen: self._apply(dlg))
        self.assertEqual(self.leaked, [],
                         "an exception here reaches Anki's handler, not ours")
        self.assertEqual(col.models.writes, [])
        self.assertEqual(seen["report"]["applied"], [])
        self.assertEqual(len(seen["report"]["errors"]), 1)
        self.assertIn("panel.html is missing", seen["report"]["errors"][0])

    def test_a_failure_while_redrawing_is_added_to_the_report(self):
        col = self._col()
        original = picker._redraw
        self.addCleanup(setattr, picker, "_redraw", original)

        def boom(_col_, _all_item, _lang=None):
            raise RuntimeError("no disk today")

        picker._redraw = boom
        seen = self._open(col, lambda dlg, seen: self._apply(dlg))
        self.assertEqual(self.leaked, [])
        self.assertEqual(seen["report"]["applied"], ["Injected"],
                         "the write happened before the redraw, so it is reported")
        self.assertEqual(len(seen["report"]["errors"]), 1)
        self.assertIn("no disk today", seen["report"]["errors"][0])

    def test_the_auto_checkbox_flips_the_switch(self):
        from PyQt6.QtWidgets import QCheckBox

        written = []
        original_read = picker._read_auto_upgrade
        original_write = picker._write_auto_upgrade
        self.addCleanup(setattr, picker, "_read_auto_upgrade", original_read)
        self.addCleanup(setattr, picker, "_write_auto_upgrade", original_write)
        picker._read_auto_upgrade = lambda: True
        picker._write_auto_upgrade = lambda value: written.append(value)

        def act(dlg, seen):
            box = dlg.findChild(QCheckBox)
            seen["label"] = box.text()
            seen["checked"] = box.isChecked()
            box.setChecked(False)

        seen = self._open(self._col(), act)
        self.assertEqual(self.leaked, [])
        self.assertEqual(seen["label"], picker._t("auto_upgrade", "ja"))
        self.assertTrue(seen["checked"])
        self.assertEqual(written, [False])


def _labels(tree):
    all_item = tree.topLevelItem(0)
    return {all_item.child(i).text(0).split(" — ")[0]: all_item.child(i).text(0)
            for i in range(all_item.childCount())}


def _checked(core, all_item):
    return {all_item.child(i).data(0, core.Qt.ItemDataRole.UserRole)
            for i in range(all_item.childCount())
            if all_item.child(i).checkState(0) == core.Qt.CheckState.Checked
            and all_item.child(i).data(0, core.Qt.ItemDataRole.UserRole)}


def _row(core, all_item, name):
    role = core.Qt.ItemDataRole.UserRole
    return next(all_item.child(i) for i in range(all_item.childCount())
                if all_item.child(i).data(0, role) == name)

if __name__ == "__main__":
    unittest.main(verbosity=2)