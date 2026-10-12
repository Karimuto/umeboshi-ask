"""Umeboshi Ask companion add-on: the bridge and the note type picker.

Three jobs, all for Desktop:

1. **Keep the login Refresh across restarts**. The bridge injects a
   localStorage-like object at ``window.__umeboshiAddonStore`` exposing three
   synchronous functions: ``getItem`` / ``setItem`` / ``removeItem``. The card
   reads/writes the single Refresh key through it. Injection happens on
   reviewer webview load, before the card calls ``tryAddonRestore()`` at the
   head of ``silentRefresh()``. The store is version-loose: newer cards must
   keep working with older add-ons. Storage is one JSON file in the active
   profile directory, ``umeboshi_ask.json`` with shape
   ``{"refresh": "<30d JWT>"}``, mode 0600, no encryption, per-profile, outside
   Anki sync/collisions. Only three operations exist: read (inject),
   write-through, clear. The add-on never touches the card DOM beyond the
   injected store.

2. **Attach ask to note types the user already owns** (issue #106).
   ``addon/inject.py`` owns the writing and ``addon/picker.py`` owns the
   screen; this module only opens it from the Note Types and Add-ons screens.
   Design: ``docs/design/ask-injection.md`` (deleted 2026-10-09, #214).

3. **Refresh stale panels on boot** (UM2 #184). Still in the same
   ``profile_did_open`` pass: every injected note type whose inside differs
   from the bundled panel is rewritten with the existing ``upgrade`` path, as
   one undo step, silently (the notice is UM3's job). A failing note type
   keeps its old inside for the next boot. Nothing here reaches the network:
   the panel is the bundle this add-on ships.

   (#180 retired the bundled note type installer: the add-on no longer ships
   or installs a note type. Ask reaches cards by injection only.)
 """

import json
import os

try:
    from aqt import gui_hooks, mw
except Exception:  # pragma: no cover - Anki runtime only
    gui_hooks = None
    mw = None

try:
    from . import inject as _inject
    from . import picker as _picker
except ImportError:  # pragma: no cover - loader ran us as a bare module
    # Anki imports an add-on as a package: ``__import__(addon.dir_name)`` in
    # qt/aqt/addons.py's AddonManager.loadAddons, with addons21/ on sys.path.
    # The relative import above is the real path. A harness that execs this
    # file directly (test/addon-bridge.test.mjs) has no package, so load the
    # siblings by path rather than failing the whole add-on over one import.
    import importlib.util as _ilu

    def _load_sibling(stem):
        spec = _ilu.spec_from_file_location(
            "umeboshi_ask_" + stem,
            os.path.join(os.path.dirname(os.path.abspath(__file__)), stem + ".py"),
        )
        module = _ilu.module_from_spec(spec)
        spec.loader.exec_module(module)
        return module

    _inject = _load_sibling("inject")
    _picker = _load_sibling("picker")

ADDON_CODE = "umeboshi_ask_companion"
FILE_NAME = "umeboshi_ask.json"
STORE_KEY = "umeboshi-ask:refresh:v1"
BRIDGE_NAME = "__umeboshiAddonStore"

#: Startup auto upgrade switch (UM3 #185, spec #188). The add-on's own
#: config screen is a JSON text editor (design §4.11), so the toggle lives
#: in the picker dialog; this file only reads and writes the value.
#: ``True`` (the default) rewrites stale insides at boot; ``False`` keeps
#: the picker manual path only. The config file itself is Anki's
#: ``meta.json`` ``config`` entry (AddonManager.getConfig/writeConfig),
#: merged over this file's own ``config.json`` default.
AUTO_UPGRADE_KEY = "auto_upgrade"


def _addon_module_name():
    """This add-on's folder name, so getConfig/writeConfig find our entry.

    UM3 (#185): inside Anki this module is imported as the folder name
    (``__import__(addon.dir_name)``), so ``__name__`` minus the trailing
    ``.__init__``-style suffix is the folder. A bare exec (tests) has no
    package, so fall back to the manifest's ``package`` name.
    """
    name = (__name__ or "").split(".")[0]
    if name and name != "__main__":
        return name
    return ADDON_CODE


def read_auto_upgrade(default=True):
    """True unless the stored config says otherwise (UM3 #185).

    Pure over ``mw.addonManager``: the default file (``config.json`` next
    to this file) is merged under the user's ``meta.json`` entry, exactly
    like ``AddonManager.getConfig`` does. Anything unreadable reads as
    ``default`` -- a broken config must never block boot, and the picker
    is the place that writes a clean value back.
    """
    try:
        manager = getattr(mw, "addonManager", None) if mw is not None else None
        if manager is not None:
            try:
                config = manager.getConfig(_addon_module_name())
            except Exception:
                config = None
            if isinstance(config, dict) and AUTO_UPGRADE_KEY in config:
                return bool(config[AUTO_UPGRADE_KEY])
    except Exception:
        pass
    try:
        with open(os.path.join(os.path.dirname(os.path.abspath(__file__)),
                               "config.json"), encoding="utf-8") as handle:
            data = json.load(handle)
        if isinstance(data, dict) and AUTO_UPGRADE_KEY in data:
            return bool(data[AUTO_UPGRADE_KEY])
    except (OSError, ValueError):
        pass
    return bool(default)


def write_auto_upgrade(value):
    """Store the startup auto upgrade switch (UM3 #185).

    Writes through ``mw.addonManager.writeConfig`` so the value lands in
    the ``meta.json`` ``config`` entry Anki merges on the next read.
    Returns True on success, False when Anki is unavailable (tests) --
    the caller (the notice's disable button) treats False as "kept on".
    """
    if mw is None:
        return False
    try:
        manager = getattr(mw, "addonManager", None)
        if manager is None:
            return False
        try:
            config = manager.getConfig(_addon_module_name())
        except Exception:
            config = None
        if not isinstance(config, dict):
            config = {}
        else:
            config = dict(config)
        config[AUTO_UPGRADE_KEY] = bool(value)
        manager.writeConfig(_addon_module_name(), config)
        return True
    except Exception:
        return False

_BRIDGE_JS_TEMPLATE = """(function () {
  try {
    if (window.__umeboshiAddonStore) return;
    var stored = %s;
    var cache = (stored === null || stored === undefined) ? null : String(stored);
    window.__umeboshiAddonStore = {
      getItem: function (k) {
        if (k !== %s) return null;
        try {
          if (typeof pycmd === "function") { pycmd("umeboshi-ask:addon-get"); }
        } catch (e) {}
        return cache;
      },
      setItem: function (k, v) {
        if (k !== %s) return;
        cache = String(v);
        try {
          if (typeof pycmd === "function") { pycmd("umeboshi-ask:addon-set:" + cache); }
        } catch (e) {}
      },
      removeItem: function (k) {
        if (k !== %s) return;
        cache = null;
        try {
          if (typeof pycmd === "function") { pycmd("umeboshi-ask:addon-clear"); }
        } catch (e) {}
      }
    };
  } catch (e) {}
})();"""


def _profile_dir():
    """Active profile directory; None when Anki is unavailable (tests)."""
    try:
        if mw is not None and getattr(mw, "pm", None) is not None:
            return mw.pm.profileFolder()
    except Exception:
        return None
    return None

def _on_profile_did_open():
    """Refresh stale injected panels in this profile (UM2 #184, UM3 #185).

    ``profile_did_open`` fires after the collection is loaded and migrated, and
    outside any exception guard, so ``mw.col`` is a live collection. It also
    fires on a profile switch, which is exactly when the check must re-run.

    Everything is wrapped: a broken upgrade must never keep Anki from opening
    its profile. Every injected note type whose inside differs from the
    bundled panel is rewritten with the existing ``upgrade`` path, as one undo
    step. The upgrade is content-idempotent too, so an already-new collection
    costs one scan and no writes. A failing note type is left on its old
    inside for the next boot.

    UM3 (#185) adds the notice: when the switch is on (the default) and the
    pass applied a note type, a Desktop dialog says so once, with three
    buttons -- open the picker, run undo, turn the switch off. When the
    switch is off, the pass is skipped entirely and the picker stays the
    only manual path.

    (#180 retired the #91 note type installer and the #120 seed deck: the
    hook no longer creates anything.)
    """
    if mw is None:
        return
    try:
        if not read_auto_upgrade():
            return
        report = _inject.startup_upgrade(mw.col)
        _maybe_notify(report)
    except Exception:  # pragma: no cover - Anki runtime only
        import traceback
        traceback.print_exc()


def _maybe_notify(report):
    """Show the UM3 startup notice once when the pass applied a note type.

    Desktop only (the add-on lives on Desktop; a synced mobile panel
    arrives via sync, never via this dialog), once per boot, only when
    ``report["applied"]`` is non-empty. The three buttons open the
    picker, run Anki undo, or turn the auto switch off. A broken dialog
    never blocks boot and never re-runs the pass.
    """
    try:
        if not report or not report.get("applied"):
            return None
        picked = _picker.notify_updated(report)
        if picked == "update_open":
            _open_picker()
        elif picked == "update_undo":
            _run_undo()
        elif picked == "update_disable":
            write_auto_upgrade(False)
        return picked
    except Exception:  # pragma: no cover - Anki runtime only
        import traceback
        traceback.print_exc()
        return None


def _run_undo():
    """Run Anki undo once (the UM3 notice's undo button).

    The startup pass merged its writes into one step, so one call walks
    the whole batch back. Never raises into Anki's UI.
    """
    try:
        if mw is None or getattr(mw, "col", None) is None:
            return False
        mw.col.undo()
        return True
    except Exception:  # pragma: no cover - Anki runtime only
        import traceback
        traceback.print_exc()
        return False


def _open_picker(*_args):
    """Open the note type picker. Never raises into Anki's UI."""
    try:
        _picker.open_dialog()
    except Exception:  # pragma: no cover - Anki runtime only
        import traceback
        traceback.print_exc()


def _on_models_did_init_buttons(buttons, models):
    """Add our button to the Note Types screen (design §5.1).

    That screen's list is single-select with no check boxes, so the hook can
    only contribute a button; the picker is the dialog it opens.
    """
    buttons.append((_picker.button_label(), _open_picker))
    return buttons


def _on_addons_dialog_will_show(dialog):
    """Add the same button to the Add-ons screen (design §5.1).

    The add-on config screen cannot host the picker: ConfigEditor edits
    config.json as text and both of its hooks pass a string (design §4.11).
    So the button goes in the dialog's own button column, beside Anki's.
    """
    try:
        from aqt.qt import QPushButton

        button = QPushButton(_picker.button_label(), dialog)
        button.clicked.connect(lambda _checked=False: _open_picker(dialog))
        dialog.form.verticalLayout.addWidget(button)
    except Exception:  # pragma: no cover - Anki runtime only
        import traceback
        traceback.print_exc()


def store_path(profile_dir=None):
    """Full path of the Refresh file. Outside tests the profile dir is used."""
    base = profile_dir if profile_dir is not None else _profile_dir()
    if base is None:
        return None
    return os.path.join(base, FILE_NAME)


def read_refresh(profile_dir=None):
    """Read the stored Refresh token; None when missing/invalid."""
    path = store_path(profile_dir)
    if not path:
        return None
    try:
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
    except (OSError, ValueError):
        return None
    value = data.get("refresh") if isinstance(data, dict) else None
    if not isinstance(value, str) or not value:
        return None
    return value


def write_refresh(value, profile_dir=None):
    """Write-through a Refresh token with mode 0600. Empty clears the file."""
    path = store_path(profile_dir)
    if not path:
        return False
    try:
        if not value:
            try:
                os.remove(path)
            except FileNotFoundError:
                pass
            except OSError:
                return False
            return True
        tmp = path + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump({"refresh": str(value)}, f)
        try:
            os.chmod(tmp, 0o600)
        except OSError:
            pass
        os.replace(tmp, path)
        try:
            os.chmod(path, 0o600)
        except OSError:
            pass
        return True
    except OSError:
        return False


def clear_refresh(profile_dir=None):
    """Remove the stored Refresh token (logout path)."""
    return write_refresh("", profile_dir)


def _js_escape(value):
    return json.dumps(value)


def bridge_js(refresh):
    """Reviewer injection snippet carrying the current Refresh value."""
    return _BRIDGE_JS_TEMPLATE % (
        _js_escape(refresh),
        _js_escape(STORE_KEY),
        _js_escape(STORE_KEY),
        _js_escape(STORE_KEY),
    )


def _is_reviewer(context):
    """True only for the reviewer screen.

    ``aqt.reviewer`` can be unimportable while Anki is still starting, and the
    gate also duck-types the object: the reviewer owns a ``web`` view and can
    advance cards. The reviewer bottom bar shares the name prefix but has no
    ``web`` view, so it stays excluded.
    """
    try:
        import aqt.reviewer as _reviewer_mod
        if isinstance(context, _reviewer_mod.Reviewer):
            return True
    except Exception:
        pass
    try:
        if context is None or type(context).__name__ != "Reviewer":
            return False
        if getattr(context, "web", None) is None:
            return False
        return hasattr(context, "_showQuestion") or hasattr(context, "nextCard")
    except Exception:
        return False


def _on_card_will_show(text, card, kind):
    """Q7/Q8a: reviewer HTML filter injecting the bridge before card JS runs."""
    if kind not in ("reviewQuestion", "reviewAnswer"):
        return text
    try:
        snippet = "<script>%s</script>" % bridge_js(read_refresh())
    except Exception:
        return text
    # PREPEND, not append: Anki sets the card HTML and re-runs <script> tags
    # in document order, so an appended bridge only exists after the card's own
    # silentRefresh() already looked for the store. Real-device only failure.
    try:
        return snippet + text
    except Exception:
        return text


def _on_webview_will_set_content(web_content, context):
    if not _is_reviewer(context):
        return
    try:
        web_content.head += "<script>%s</script>" % bridge_js(read_refresh())
    except Exception:
        return


def _copy_to_clipboard(text):
    """Put text on the OS clipboard (Anki Desktop bridge, #250).

    The reviewer's QtWebEngine page cannot copy from JavaScript alone: Anki
    never answers ``featurePermissionRequested`` (aqt/webview.py has no
    handler), so ``navigator.clipboard.writeText()``'s promise stays pending
    forever, and ``document.execCommand("copy")`` returns false. Measured
    with QtWebEngine 6.11.2 / Chromium 140 on a page served from
    ``http://127.0.0.1`` -- exactly how Anki serves the reviewer. Writing the
    clipboard from Python sidesteps the permission entirely.

    Returns True only when the text read back identical, so a failed write is
    reported to the panel instead of silently claiming success.
    """
    try:
        if mw is None or not text:
            return False
        clipboard = mw.app.clipboard()
        clipboard.setText(text)
        return clipboard.text() == text
    except Exception:
        import traceback
        traceback.print_exc()
        return False


def _on_js_message(handled, message, context):
    if not isinstance(message, str) or not message.startswith("umeboshi-ask:addon-"):
        return handled
    rest = message[len("umeboshi-ask:addon-"):]
    if rest == "get":
        return (True, None)
    if rest == "clear":
        clear_refresh()
        return (True, None)
    if rest.startswith("set:"):
        write_refresh(rest[len("set:"):])
        return (True, None)
    if rest.startswith("clipboard:"):
        return (True, _copy_to_clipboard(rest[len("clipboard:"):]))
    return handled


if gui_hooks is not None:  # pragma: no cover - Anki runtime only
    for _hook_name, _hook_fn in (
        ("card_will_show", _on_card_will_show),
        ("webview_will_set_content", _on_webview_will_set_content),
        ("webview_did_receive_js_message", _on_js_message),
        ("profile_did_open", _on_profile_did_open),
        ("models_did_init_buttons", _on_models_did_init_buttons),
        ("addons_dialog_will_show", _on_addons_dialog_will_show),
    ):
        try:
            getattr(gui_hooks, _hook_name).append(_hook_fn)
        except Exception:
            pass
