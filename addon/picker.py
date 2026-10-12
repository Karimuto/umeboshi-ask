"""The note type picker: the only UI issue #106 adds (design §5.1).

Anki's add-on settings screen cannot host this. ``ConfigEditor`` in
``qt/aqt/addons.py`` shows ``config.json`` as raw JSON, and the only two hooks
that touch it (``addon_config_editor_will_display_json`` and
``addon_config_editor_will_update_json``) pass a string, so there is nowhere to
put a check box (design §4.11). The Note Types screen's list is single-select
with no check boxes either (§4.8). So the picker is a dialog of our own, opened
from a button on either screen:

- ``models_did_init_buttons`` adds a button to the Note Types screen.
- ``addons_dialog_will_show`` adds a button to the Add-ons screen.

Both open the same dialog, and the dialog owns its own Apply / Remove buttons.
``docs/setup.html`` §3 describes this screen, not a settings form.

Only :func:`open_dialog`, :func:`run` and the ``_``-prefixed helpers touch Qt,
and they import it inside the function: this module is loaded by
``addon/test_inject.py`` with no Anki and no Qt present.
"""

import traceback

try:
    from . import inject as _inject
except ImportError:  # pragma: no cover - loader ran us as a bare module
    import importlib.util as _ilu
    import os as _os

    _spec = _ilu.spec_from_file_location(
        "umeboshi_ask_inject",
        _os.path.join(_os.path.dirname(_os.path.abspath(__file__)), "inject.py"),
    )
    _inject = _ilu.module_from_spec(_spec)
    _spec.loader.exec_module(_inject)

try:
    from . import i18n as _i18n
except ImportError:  # pragma: no cover - loader ran us as a bare module
    import importlib.util as _ilu
    import os as _os

    _ispec = _ilu.spec_from_file_location(
        "umeboshi_ask_i18n",
        _os.path.join(_os.path.dirname(_os.path.abspath(__file__)), "i18n.py"),
    )
    _i18n = _ilu.module_from_spec(_ispec)
    _ispec.loader.exec_module(_i18n)


# Which language a raw code string names (UM3 notify path reuses this so the
# startup notice and the picker never disagree on ja-vs-en).
def notify_lang(code=None, lang=None):
    """The language the startup notice draws in.

    UM3 (#185): ``lang`` wins when given (tests). Otherwise a code string
    (the profile's own defaultLang, e.g. ``ja_JP``) decides via the table's
    own rule; an empty code reads Anki's live language. Anything the table
    does not know reads as English, matching the picker's fallback.
    """
    if lang in (_i18n.JA, _i18n.EN):
        return lang
    if code:
        return _i18n._resolve(code)
    return _i18n.current_lang()


# Which i18n key names the notice's buttons. The dialog returns the key
# itself (``update_open`` / ``update_undo`` / ``update_disable``), never a
# translated label, so comparing the answer needs no language lookup.
NOTIFY_BUTTON_KEYS = ("update_open", "update_undo", "update_disable")

# Every user-visible string below is drawn from addon/i18n.py, which picks the
# table from Anki's own interface language (#123).
def _t(key, lang=None):
    return _i18n.t(key, lang)

def _read_auto_upgrade():
    """The startup switch, read without importing the Anki runtime at load.

    UM3 (#185): ``open_dialog`` runs inside Anki, but this module is also
    loaded bare by the tests. The owner of the value is
    ``addon/__init__.py`` (``AddonManager.getConfig`` merged over
    ``config.json``); here it is reached lazily so a bare import never
    touches ``aqt``. Anything unreadable reads as on.
    """
    try:
        from aqt import mw

        manager = getattr(mw, "addonManager", None) if mw is not None else None
        if manager is not None:
            try:
                name = (__package__ or "").split(".")[0] or "umeboshi_ask_companion"
                config = manager.getConfig(name)
            except Exception:
                config = None
            if isinstance(config, dict) and "auto_upgrade" in config:
                return bool(config["auto_upgrade"])
    except Exception:
        pass
    try:
        import json as _json
        import os as _os2

        with open(_os2.path.join(_os2.path.dirname(_os2.path.abspath(__file__)),
                                 "config.json"), encoding="utf-8") as handle:
            data = _json.load(handle)
        if isinstance(data, dict) and "auto_upgrade" in data:
            return bool(data["auto_upgrade"])
    except (OSError, ValueError):
        pass
    return True


def _write_auto_upgrade(value):
    """Store the startup switch; False when Anki is unavailable (tests)."""
    try:
        from aqt import mw

        manager = getattr(mw, "addonManager", None) if mw is not None else None
        if manager is None:
            return False
        name = (__package__ or "").split(".")[0] or "umeboshi_ask_companion"
        try:
            config = manager.getConfig(name)
        except Exception:
            config = None
        if not isinstance(config, dict):
            config = {}
        else:
            config = dict(config)
        config["auto_upgrade"] = bool(value)
        manager.writeConfig(name, config)
        return True
    except Exception:
        return False


# Every user-visible string below is drawn from addon/i18n.py, which picks the
# table from Anki's own interface language (#123). Nothing on this screen may
# carry both languages at once: the old "適用 / Apply" shape put a Japanese and
# an English word on the same button, which read as a mistake on a screen that
# is otherwise in one language.
# Which i18n key names each injection state. `native` and `partial` are drawn
# but cannot be ticked: one already draws the panel, the other has half a
# marker pair in it and is not ours to interpret.
STATE_KEYS = {
    _inject.STATE_PLAIN: "state_plain",
    _inject.STATE_INJECTED: "state_injected",
    _inject.STATE_NATIVE: "state_native",
    _inject.STATE_PARTIAL: "state_partial",
}

TICKABLE = (_inject.STATE_PLAIN, _inject.STATE_INJECTED)


def title(lang=None):
    """The dialog's window title, in Anki's language."""
    return _t("title", lang)


def button_label(lang=None):
    """The label of the button that opens this dialog, in Anki's language."""
    return _t("button", lang)


def state_text(state, lang=None):
    """The word drawn in the state column for ``state``, in Anki's language."""
    return _t(STATE_KEYS.get(state, "state_partial"), lang)


def rows(col, lang=None):
    """One row per note type, for the dialog. Reads the collection only."""
    out = []
    for row in _inject.list_note_types(col):
        out.append({
            "name": row["name"],
            "state": row["state"],
            "checked": row["state"] == _inject.STATE_INJECTED,
            "tickable": row["state"] in TICKABLE,
            "label": _t("cards", lang) % (row["name"], row["cards"],
                                          state_text(row["state"], lang)),
        })
    return out



def all_row_state(rows_):
    """Tri-state for the "all" row: ``True``, ``False``, or ``None`` (partial).

    Computed over the tickable rows only, so a note type nobody can write never
    makes "all" look partly done.
    """
    states = {row["checked"] for row in rows_ if row["tickable"]}
    if not states:
        return False
    if len(states) == 1:
        return states.pop()
    return None


def plan(rows_, checked_names):
    """Turn a ticked selection into ``(name, mode)`` entries.

    A ``plain`` note type becomes ``inject``. An ``injected`` one that stays
    ticked becomes ``upgrade``; one that was unticked becomes ``uninject``.
    Choosing on the tick rather than on a separate mode is what lets the dialog
    get away with two buttons.
    """
    chosen = set(checked_names)
    entries = []
    for row in rows_:
        if not row["tickable"]:
            continue
        if row["name"] in chosen:
            entries.append((row["name"],
                            "upgrade" if row["state"] == _inject.STATE_INJECTED else "inject"))
        elif row["state"] == _inject.STATE_INJECTED:
            entries.append((row["name"], "uninject"))
    return entries


def report_lines(report, lang=None):
    """The four result groups as display lines (design §5.6).

    ``errors`` carries anything that escaped while applying. It is not one of
    the four groups: nothing was reported about the note types themselves, so
    it goes on the end under its own heading rather than being mixed in with
    a note type that did fail (#119).
    """
    lines = []
    for name in report["applied"]:
        lines.append("%s: %s" % (_t("applied", lang), name))
    for name in report["unchanged"]:
        lines.append("%s: %s" % (_t("unchanged", lang), name))
    for row in report["dropped"]:
        lines.append("%s: %s — %s" % (_t("dropped", lang), row["name"],
                                      _i18n.reason(row["reason"], lang)))
    for row in report["failed"]:
        lines.append("%s: %s — %s" % (_t("failed", lang), row["name"],
                                      _i18n.reason(row["reason"], lang)))
    for text in report["errors"]:
        lines.append("%s: %s" % (_t("error", lang), text))
    return lines


EMPTY_REPORT = {"applied": [], "unchanged": [], "dropped": [], "failed": [],
                "errors": []}


def _empty_report(errors=()):
    """A report with nothing in it but fresh lists.

    ``dict(EMPTY_REPORT)`` would share the four lists, so appending to one
    call's report would corrupt every later one.
    """
    report = {key: list(value) for key, value in EMPTY_REPORT.items()}
    report["errors"] = list(errors)
    return report



# ---------------------------------------------------------------- Qt from here


def _checked_state(value):
    from aqt.qt import Qt

    return {
        True: Qt.CheckState.Checked,
        False: Qt.CheckState.Unchecked,
        None: Qt.CheckState.PartiallyChecked,
    }[value]


def _refresh_all(all_item):
    """Keep the "all" row's tri-state in step with its children.

    A ``QTreeWidgetItem`` is not a ``QObject``: it has no ``blockSignals``, and
    calling one raises ``AttributeError`` out of the slot, which is what put
    "Anki encountered a problem" on the screen (#119). ``itemChanged`` is
    emitted by the view, so the blocker belongs on the tree.
    """
    from aqt.qt import Qt, QSignalBlocker

    states = set()
    for index in range(all_item.childCount()):
        child = all_item.child(index)
        if not (child.flags() & Qt.ItemFlag.ItemIsUserCheckable):
            continue
        states.add(child.checkState(0) == Qt.CheckState.Checked)
    value = states.pop() if len(states) == 1 else None
    with QSignalBlocker(all_item.treeWidget()):
        all_item.setCheckState(0, _checked_state(value))


def open_dialog(parent=None, lang=None):
    """Open the picker. Returns the report dict, or None when cancelled."""
    from aqt.qt import Qt, QCheckBox, QDialog, QDialogButtonBox, QLabel, QTreeWidget, QTreeWidgetItem, QVBoxLayout

    from aqt import mw

    if mw is None or getattr(mw, "col", None) is None:
        return None

    # Read Anki's language once, here, and pass it down: the screen must not
    # change language halfway through being drawn (#123).
    lang = _i18n.current_lang() if lang is None else lang

    col = mw.col
    items = rows(col, lang)

    dlg = QDialog(parent if parent is not None else mw)
    dlg.setWindowTitle(_t("title", lang))
    layout = QVBoxLayout(dlg)

    intro = QLabel(_t("intro", lang))
    intro.setWordWrap(True)
    layout.addWidget(intro)

    tree = QTreeWidget()
    # `setHeaderLabels` widens the view to the number of labels it is given,
    # so passing two of them after `setColumnCount(1)` produced a second,
    # always-empty header section. One column, one label.
    tree.setColumnCount(1)
    tree.setHeaderLabels([_t("column", lang)])
    tree.setRootIsDecorated(False)

    all_item = QTreeWidgetItem(tree)
    all_item.setText(0, _t("all", lang))
    all_item.setFlags(Qt.ItemFlag.ItemIsEnabled | Qt.ItemFlag.ItemIsUserCheckable)
    all_item.setData(0, Qt.ItemDataRole.UserRole, None)

    for row in items:
        item = QTreeWidgetItem(all_item)
        item.setText(0, row["label"])
        flags = Qt.ItemFlag.ItemIsEnabled
        if row["tickable"]:
            flags |= Qt.ItemFlag.ItemIsUserCheckable
            item.setData(0, Qt.ItemDataRole.UserRole, row["name"])
        item.setFlags(flags)
        item.setCheckState(0, _checked_state(row["checked"]))
    all_item.setCheckState(0, _checked_state(all_row_state(items)))
    # A QTreeWidgetItem starts collapsed, and a collapsed row has no rows at
    # all: the view then paints only the "all" line, so the note types are
    # there but invisible (#119). setRootIsDecorated(False) also takes away the
    # branch arrow, so nothing else would ever expand it.
    all_item.setExpanded(True)
    def on_changed(item, column):
        if column != 0:
            return
        if item is all_item:
            if all_item.checkState(0) == Qt.CheckState.PartiallyChecked:
                return
            want = all_item.checkState(0) == Qt.CheckState.Checked
            for index in range(all_item.childCount()):
                child = all_item.child(index)
                if child.data(0, Qt.ItemDataRole.UserRole) is None:
                    continue
                child.setCheckState(0, _checked_state(want))
            return
        _refresh_all(all_item)

    tree.itemChanged.connect(on_changed)
    layout.addWidget(tree)

    auto_box = QCheckBox(_t("auto_upgrade", lang))
    auto_box.setChecked(_read_auto_upgrade())
    auto_box.toggled.connect(lambda checked: _write_auto_upgrade(bool(checked)))
    layout.addWidget(auto_box)

    box = QDialogButtonBox(
        QDialogButtonBox.StandardButton.Apply | QDialogButtonBox.StandardButton.Close
    )
    apply_button = box.button(QDialogButtonBox.StandardButton.Apply)
    close_button = box.button(QDialogButtonBox.StandardButton.Close)
    apply_button.setText(_t("apply", lang))
    close_button.setText(_t("close", lang))
    state = {"report": None}

    def on_apply():
        # Qt routes a slot exception to `sys.excepthook`, which on Anki is
        # "Anki encountered a problem" with no idea which note type or which
        # line was at fault. Both halves are caught and put in the result
        # window instead (#119).
        try:
            report = run(col, items, _checked_names(all_item))
        except Exception:
            report = _empty_report([traceback.format_exc()])
        try:
            items[:] = _redraw(col, all_item, lang)
        except Exception:
            # The writes are already on disk, so the report of them stands and
            # the reason the screen could not be refreshed is added to it.
            report["errors"].append(traceback.format_exc())
        state["report"] = report
        _show_report(report, dlg, lang)

    # QDialogButtonBox.accepted() is emitted for AcceptRole and YesRole only.
    # An Apply button carries ApplyRole, so connecting accepted() left the one
    # button this dialog exists for doing nothing at all (#119).
    apply_button.clicked.connect(on_apply)
    close_button.clicked.connect(dlg.reject)
    layout.addWidget(box)
    dlg.exec()
    return state["report"]


def _checked_names(all_item):
    """The note type names currently ticked under the "all" row.

    A row with no name in ``UserRole`` is one we are not allowed to write --
    our own note type, or one whose marker is broken -- so it is skipped
    whatever its tick says.
    """
    from aqt.qt import Qt

    checked = set()
    for index in range(all_item.childCount()):
        child = all_item.child(index)
        name = child.data(0, Qt.ItemDataRole.UserRole)
        if name is not None and child.checkState(0) == Qt.CheckState.Checked:
            checked.add(name)
    return checked


def _redraw(col, all_item, lang=None):
    """Re-read the collection and redraw: the marks are on disk now.

    Returns the fresh rows so the next Apply plans against what is really
    there, not against the states read when the dialog opened.
    """
    from aqt.qt import Qt

    fresh = rows(col, lang)
    by_name = {row["name"]: row for row in fresh}
    for index in range(all_item.childCount()):
        child = all_item.child(index)
        name = child.data(0, Qt.ItemDataRole.UserRole)
        if name is None or name not in by_name:
            continue
        row = by_name[name]
        child.setText(0, row["label"])
        child.setCheckState(
            0, _checked_state(row["state"] == _inject.STATE_INJECTED))
    _refresh_all(all_item)
    return fresh


def run(col, items, checked_names):
    """Apply the selection and return the report. Showing it is the caller's."""
    entries = plan(items, checked_names)
    if not entries:
        return _empty_report()
    return _inject.apply_batch(col, entries)


def _show_report(report, parent=None, lang=None):
    from aqt.qt import QMessageBox

    box = QMessageBox(parent)
    box.setWindowTitle(_t("result_title", lang))
    box.setText("\n".join(report_lines(report, lang)) or _t("result_nothing", lang))
    box.open()

def notify_text(report, lang=None):
    """The lines the startup notice shows for ``report``.

    UM3 (#185): one title line is not part of this (``update_title`` is
    drawn by the dialog itself); the body names what was applied and
    appends the failures, mirroring :func:`report_lines` so a broken
    note type is named, not hidden. An empty report reads as the
    unchanged line, so the dialog never opens on an empty body.
    """
    lines = []
    for name in report.get("applied", []):
        lines.append("%s: %s" % (_t("applied", lang), name))
    for row in report.get("failed", []):
        lines.append("%s: %s — %s" % (_t("failed", lang), row["name"],
                                      _i18n.reason(row["reason"], lang)))
    for text in report.get("errors", []):
        lines.append("%s: %s" % (_t("error", lang), text))
    return lines


def notify_updated(report, parent=None, code=None, lang=None, ask=None):
    """Show the startup notice once; return what the user picked.

    UM3 (#185): Desktop only, once per boot, only when ``report`` says a
    note type was applied. Returns one of ``update_open`` /
    ``update_undo`` / ``update_disable`` / ``None`` (closed without
    picking). The screen text comes from the i18n table (``update_*``);
    ``ask`` is the seam tests drive (it receives ``(text, buttons)``
    and returns the picked button label or ``None``).
    """
    chosen_lang = notify_lang(code, lang)
    if not report.get("applied"):
        return None
    labels = [_t(key, chosen_lang) for key in NOTIFY_BUTTON_KEYS]
    text = "%s\n%s" % (_t("update_body", chosen_lang),
                       "\n".join(notify_text(report, chosen_lang)))
    if ask is None:
        from aqt.utils import askUserDialog

        def ask(text, buttons):
            return askUserDialog(text, buttons, parent, title=_t("update_title", chosen_lang)).run()
    picked = ask(text, labels)
    for key, label in zip(NOTIFY_BUTTON_KEYS, labels):
        if picked == label:
            return key
    return None