"""Behavioral tests for the companion add-on (issue #15).

Seams under test (agreed via the #15 agent brief):
- File contract: profile dir / umeboshi_ask.json / JSON single key / 0600 /
  per-profile separation / no sharing.
- Bridge contract: localStorage-like store with getItem / setItem /
  removeItem on the fixed Refresh key, injected before tryAddonRestore.
- Hook wiring: reviewer screens get the bridge, other screens do not;
  pycmd write-through persists, logout clears.

Run: py addon/test_addon.py (stdlib only, no Anki needed).
"""
import importlib.util
import json
import os
import sys
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
INIT_PATH = os.path.join(HERE, "__init__.py")
STORE_KEY = "umeboshi-ask:refresh:v1"


def load_addon(fake_aqt=None):
    """Execute addon/__init__.py fresh; with fake_aqt, hooks get recorded.

    Anki imports an add-on as a package, not as a bare module:
    ``__import__(addon.dir_name)`` in ``qt/aqt/addons.py``'s
    ``AddonManager.loadAddons``, with ``addons21/`` on ``sys.path``. That is
    what lets ``__init__.py`` reach a sibling module with a relative import.
    The harness mirrors it by giving the spec a submodule search location, so
    ``from . import inject`` resolves here exactly as it does in Anki.
    """
    if fake_aqt is not None:
        sys.modules["aqt"] = fake_aqt
        needs_cleanup = True
    else:
        sys.modules.pop("aqt", None)
        needs_cleanup = False
    try:
        name = "umeboshi_addon_under_test_%d" % len(sys.modules)
        spec = importlib.util.spec_from_file_location(
            name, INIT_PATH, submodule_search_locations=[HERE]
        )
        assert spec is not None and spec.loader is not None
        mod = importlib.util.module_from_spec(spec)
        sys.modules[name] = mod
        try:
            spec.loader.exec_module(mod)
        finally:
            sys.modules.pop(name, None)
        return mod
    finally:
        if needs_cleanup:
            sys.modules.pop("aqt", None)


class FakeHook(list):
    pass


class FakeGuiHooks:
    def __init__(self):
        self.recorded = {}

    def __getattr__(self, name):
        return self.recorded.setdefault(name, FakeHook())


class FakeClipboard:
    """Stand-in for Qt's QClipboard: records writes, can fail or misreport."""

    def __init__(self, read_back=None, boom=False):
        self.written = ""
        self._read_back = read_back
        self._boom = boom

    def setText(self, text):
        if self._boom:
            raise RuntimeError("clipboard unavailable")
        self.written = text

    def text(self):
        if self._boom:
            raise RuntimeError("clipboard unavailable")
        return self._read_back if self._read_back is not None else self.written


class FakeAqt:
    def __init__(self, profile_dir, clipboard=None):
        from types import SimpleNamespace

        self.gui_hooks = FakeGuiHooks()
        self.mw = SimpleNamespace(
            pm=SimpleNamespace(profileFolder=lambda: profile_dir),
            app=SimpleNamespace(clipboard=lambda: clipboard or FakeClipboard()),
        )


class Reviewer:
    """Duck-typed like aqt.reviewer.Reviewer: owns a web view, advances cards."""

    def __init__(self):
        self.web = object()
        self.mw = object()

    def _showQuestion(self):
        pass

    def nextCard(self):
        pass


class ReviewerBottomBar:
    """Shares the name prefix but has no web view: must stay excluded."""

    def __init__(self):
        self.web = None
        self.mw = object()


class FakeWebContent:
    def __init__(self):
        self.head = ""
        self.body = ""


class StoreTest(unittest.TestCase):
    def setUp(self):
        self.mod = load_addon()
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)

    def test_roundtrip_write_then_read(self):
        self.assertTrue(self.mod.write_refresh("tok-123", self.tmp.name))
        self.assertEqual(self.mod.read_refresh(self.tmp.name), "tok-123")
        with open(os.path.join(self.tmp.name, "umeboshi_ask.json"),
                  encoding="utf-8") as f:
            self.assertEqual(json.load(f), {"refresh": "tok-123"})

    def test_file_mode_0600_on_posix(self):
        if os.name != "posix":
            self.skipTest("mode bits are POSIX-only")
        self.mod.write_refresh("tok", self.tmp.name)
        mode = os.stat(os.path.join(self.tmp.name, "umeboshi_ask.json")).st_mode
        self.assertEqual(mode & 0o777, 0o600)

    def test_missing_corrupt_and_empty_all_read_none(self):
        self.assertIsNone(self.mod.read_refresh(self.tmp.name))
        bad = os.path.join(self.tmp.name, "umeboshi_ask.json")
        with open(bad, "w", encoding="utf-8") as f:
            f.write("not-json{{{")
        self.assertIsNone(self.mod.read_refresh(self.tmp.name))
        with open(bad, "w", encoding="utf-8") as f:
            json.dump({"refresh": ""}, f)
        self.assertIsNone(self.mod.read_refresh(self.tmp.name))
        with open(bad, "w", encoding="utf-8") as f:
            json.dump(["not", "a", "dict"], f)
        self.assertIsNone(self.mod.read_refresh(self.tmp.name))

    def test_clear_removes_file_and_missing_clear_is_ok(self):
        self.assertTrue(self.mod.clear_refresh(self.tmp.name))
        self.mod.write_refresh("tok", self.tmp.name)
        self.assertTrue(self.mod.clear_refresh(self.tmp.name))
        self.assertIsNone(self.mod.read_refresh(self.tmp.name))
        self.assertFalse(os.path.exists(
            os.path.join(self.tmp.name, "umeboshi_ask.json")))

    def test_profiles_are_separated(self):
        other = tempfile.TemporaryDirectory()
        self.addCleanup(other.cleanup)
        self.mod.write_refresh("aaa", self.tmp.name)
        self.mod.write_refresh("bbb", other.name)
        self.assertEqual(self.mod.read_refresh(self.tmp.name), "aaa")
        self.assertEqual(self.mod.read_refresh(other.name), "bbb")
        self.mod.clear_refresh(self.tmp.name)
        self.assertEqual(self.mod.read_refresh(other.name), "bbb")


class BridgeTest(unittest.TestCase):
    def setUp(self):
        self.mod = load_addon()

    def test_bridge_carries_store_shape_and_key(self):
        js = self.mod.bridge_js("tok")
        for needle in ("__umeboshiAddonStore", "getItem", "setItem",
                       "removeItem", STORE_KEY):
            self.assertIn(needle, js)

    def test_bridge_keeps_first_injection(self):
        js = self.mod.bridge_js("tok")
        self.assertIn("if (window.__umeboshiAddonStore) return;", js)

    def test_token_is_json_escaped(self):
        js = self.mod.bridge_js('a"b\\cあ')
        self.assertIn(json.dumps('a"b\\cあ'), js)

    def test_none_refresh_injects_empty_store(self):
        js = self.mod.bridge_js(None)
        self.assertIn("var stored = null;", js)


class HookTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.fake = FakeAqt(self.tmp.name)
        self.mod = load_addon(fake_aqt=self.fake)

    def test_card_will_show_injects_on_reviewer_kinds(self):
        out = self.mod._on_card_will_show("Q", object(), "reviewAnswer")
        self.assertIn("Q", out)
        self.assertIn("__umeboshiAddonStore", out)
        out_q = self.mod._on_card_will_show("Q", object(), "reviewQuestion")
        self.assertIn("__umeboshiAddonStore", out_q)

    def test_card_will_show_prepends_bridge_before_card_script(self):
        out = self.mod._on_card_will_show("CARD", object(), "reviewQuestion")
        self.assertLess(out.index("__umeboshiAddonStore"), out.index("CARD"))

    def test_card_will_show_passes_other_kinds_through(self):
        self.assertEqual(self.mod._on_card_will_show("Q", object(), "other"), "Q")

    def test_webview_content_injects_for_reviewer(self):
        wc = FakeWebContent()
        self.mod._on_webview_will_set_content(wc, Reviewer())
        self.assertIn("__umeboshiAddonStore", wc.head)

    def test_webview_content_skips_non_reviewer(self):
        wc = FakeWebContent()
        self.mod._on_webview_will_set_content(wc, object())
        self.assertEqual(wc.head, "")

    def test_webview_content_skips_reviewer_bottom_bar(self):
        wc = FakeWebContent()
        self.mod._on_webview_will_set_content(wc, ReviewerBottomBar())
        self.assertEqual(wc.head, "")

    def test_js_set_persists_and_clear_removes(self):
        handled = self.mod._on_js_message(False, "umeboshi-ask:addon-set:tok:1", None)
        self.assertEqual(handled, (True, None))
        self.assertEqual(self.mod.read_refresh(self.tmp.name), "tok:1")
        handled = self.mod._on_js_message(False, "umeboshi-ask:addon-clear", None)
        self.assertEqual(handled, (True, None))
        self.assertIsNone(self.mod.read_refresh(self.tmp.name))

    def test_js_get_and_foreign_messages_pass_through(self):
        sentinel = (False, "keep-me")
        self.assertEqual(
            self.mod._on_js_message(sentinel, "umeboshi-ask:addon-get", None),
            (True, None))
        self.assertEqual(
            self.mod._on_js_message(sentinel, "something-else", None), sentinel)

    def test_js_clipboard_writes_os_clipboard_and_reports_true(self):
        clip = FakeClipboard()
        self.fake.mw.app = type("A", (), {"clipboard": staticmethod(lambda: clip)})()
        handled = self.mod._on_js_message(
            False, "umeboshi-ask:addon-clipboard:https://example.com/a?b=c", None)
        self.assertEqual(handled, (True, True))
        self.assertEqual(clip.written, "https://example.com/a?b=c")

    def test_js_clipboard_read_back_mismatch_reports_false(self):
        clip = FakeClipboard(read_back="something else")
        self.fake.mw.app = type("A", (), {"clipboard": staticmethod(lambda: clip)})()
        handled = self.mod._on_js_message(
            False, "umeboshi-ask:addon-clipboard:https://example.com", None)
        self.assertEqual(handled, (True, False))

    def test_js_clipboard_write_raising_never_escapes(self):
        clip = FakeClipboard(boom=True)
        self.fake.mw.app = type("A", (), {"clipboard": staticmethod(lambda: clip)})()
        handled = self.mod._on_js_message(
            False, "umeboshi-ask:addon-clipboard:https://example.com", None)
        self.assertEqual(handled, (True, False))

    def test_js_clipboard_empty_text_reports_false(self):
        clip = FakeClipboard()
        self.fake.mw.app = type("A", (), {"clipboard": staticmethod(lambda: clip)})()
        handled = self.mod._on_js_message(
            False, "umeboshi-ask:addon-clipboard:", None)
        self.assertEqual(handled, (True, False))
        self.assertEqual(clip.written, "")

    def test_js_clipboard_prefix_alone_passes_through(self):
        sentinel = (False, "keep-me")
        self.assertEqual(
            self.mod._on_js_message(sentinel, "umeboshi-ask:addon-clipboard", None),
            sentinel)

    def test_all_three_hooks_are_registered(self):
        for name in ("card_will_show", "webview_will_set_content",
                     "webview_did_receive_js_message"):
            self.assertIn(name, self.fake.gui_hooks.recorded)
            self.assertEqual(len(self.fake.gui_hooks.recorded[name]), 1)


class ProfileDidOpenTest(unittest.TestCase):
    """#180: the boot hook installs nothing and redraws nothing.

    (#120's seed deck retired with addon/notetype.py. The hook now runs only
    the UM2 #184 startup upgrade, which never creates a deck -- so the deck
    browser it already rendered is never missing anything.)
    """

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.fake = FakeAqt(self.tmp.name)
        self.mod = load_addon(fake_aqt=self.fake)
        self.fake.mw.col = object()
        self.calls = []
        calls = self.calls

        class _Injector:
            def startup_upgrade(self, col, panel=None):
                calls.append(col)
                return {"applied": [], "unchanged": [], "dropped": [],
                        "failed": [], "errors": []}

        self.mod._inject = _Injector()
        self.mod._maybe_notify = lambda report: None

    def test_boot_runs_the_startup_upgrade(self):
        self.mod._on_profile_did_open()
        self.assertEqual(self.calls, [self.fake.mw.col])

    def test_boot_writes_nothing_of_its_own(self):
        self.mod._on_profile_did_open()
        self.assertEqual(self.calls, [self.fake.mw.col],
                         "the hook's only write path is the startup upgrade")

class ProfileDidOpenStartupUpgradeTest(unittest.TestCase):
    """UM2 (#184). The same boot pass also refreshes stale panels."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.fake = FakeAqt(self.tmp.name)
        self.mod = load_addon(fake_aqt=self.fake)
        self.fake.mw.col = object()
        self.calls = []
        calls = self.calls

        class _Injector:
            def startup_upgrade(self, col, panel=None):
                calls.append(col)
                return {"applied": [], "unchanged": [], "dropped": [],
                        "failed": [], "errors": []}

        self.mod._inject = _Injector()
        self.mod._maybe_notify = lambda report: None

    def test_boot_runs_the_startup_upgrade(self):
        self.mod._on_profile_did_open()
        self.assertEqual(self.calls, [self.fake.mw.col])

    def test_upgrade_failure_never_blocks_boot(self):
        class _Boom:
            def startup_upgrade(self, *args, **kwargs):
                raise RuntimeError("panel.html is missing")

        self.mod._inject = _Boom()
        try:
            self.mod._on_profile_did_open()
        except RuntimeError:
            self.fail("a broken panel must never keep Anki from opening")


class ProfileDidOpenNoticeTest(unittest.TestCase):
    """UM3 (#185). Boot shows the notice once; the buttons act; off skips."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.fake = FakeAqt(self.tmp.name)
        self.mod = load_addon(fake_aqt=self.fake)
        self.fake.mw.col = object()
        self.upgrades = []
        upgrades = self.upgrades

        class _Injector:
            def startup_upgrade(self, col, panel=None):
                upgrades.append(col)
                return {"applied": ["Someone Else"], "unchanged": [],
                        "dropped": [], "failed": [], "errors": []}

        self.mod._inject = _Injector()
        self.mod.read_auto_upgrade = lambda default=True: True
        self.notices = []
        notices = self.notices
        self.mod._picker = type("P", (), {
            "notify_updated": staticmethod(
                lambda report: notices.append(report) or "update_open"),
            "open_dialog": staticmethod(lambda *a: None),
        })
        self.mod._open_picker = lambda *a: notices.append("opened")

    def test_notice_opens_once_when_the_pass_applied(self):
        self.mod._on_profile_did_open()
        self.assertEqual(self.upgrades, [self.fake.mw.col])
        self.assertEqual(len(self.notices), 2)
        self.assertEqual(self.notices[0]["applied"], ["Someone Else"])
        self.assertEqual(self.notices[1], "opened")

    def test_no_notice_without_an_applied_note_type(self):
        class _Quiet:
            def startup_upgrade(self, col, panel=None):
                return {"applied": [], "unchanged": [], "dropped": [],
                        "failed": [], "errors": []}

        self.mod._inject = _Quiet()
        self.mod._on_profile_did_open()
        self.assertEqual(self.notices, [])

    def test_switch_off_skips_the_pass_entirely(self):
        self.mod.read_auto_upgrade = lambda default=True: False
        self.mod._on_profile_did_open()
        self.assertEqual(self.upgrades, [])
        self.assertEqual(self.notices, [])

    def test_undo_button_runs_undo_once(self):
        undos = []
        undos_append = undos.append

        class _Col:
            def undo(self):
                undos_append(1)

        self.fake.mw.col = _Col()
        self.mod._picker = type("P", (), {
            "notify_updated": staticmethod(lambda report: "update_undo"),
            "open_dialog": staticmethod(lambda *a: None),
        })
        self.mod._on_profile_did_open()
        self.assertEqual(undos, [1])

    def test_disable_button_turns_the_switch_off(self):
        written = []
        self.mod.write_auto_upgrade = lambda value: written.append(value)
        self.mod._picker = type("P", (), {
            "notify_updated": staticmethod(lambda report: "update_disable"),
            "open_dialog": staticmethod(lambda *a: None),
        })
        self.mod._on_profile_did_open()
        self.assertEqual(written, [False])

    def test_notice_failure_never_blocks_boot(self):
        class _Boom:
            def notify_updated(self, *args, **kwargs):
                raise RuntimeError("no Qt today")

        self.mod._picker = _Boom()
        try:
            self.mod._on_profile_did_open()
        except RuntimeError:
            self.fail("a broken notice must never keep Anki from opening")


class AutoUpgradeConfigTest(unittest.TestCase):
    """UM3 (#185). The auto switch reads merged config, defaults on."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.fake = FakeAqt(self.tmp.name)
        self.mod = load_addon(fake_aqt=self.fake)

    def test_default_is_on_with_no_anki(self):
        mod = load_addon()
        self.assertTrue(mod.read_auto_upgrade())

    def test_manager_false_wins_over_the_default_file(self):
        class _Manager:
            def getConfig(self, module):
                return {"auto_upgrade": False}

        self.fake.mw.addonManager = _Manager()
        self.assertFalse(self.mod.read_auto_upgrade())

    def test_manager_true_reads_as_on(self):
        class _Manager:
            def getConfig(self, module):
                return {"auto_upgrade": True}

        self.fake.mw.addonManager = _Manager()
        self.assertTrue(self.mod.read_auto_upgrade())

    def test_write_goes_through_the_manager(self):
        written = []

        class _Manager:
            def getConfig(self, module):
                return {}

            def writeConfig(self, module, conf):
                written.append((module, conf))

        self.fake.mw.addonManager = _Manager()
        self.assertTrue(self.mod.write_auto_upgrade(False))
        self.assertEqual(written[0][1], {"auto_upgrade": False})

    def test_write_without_anki_reports_failure(self):
        mod = load_addon()
        self.assertFalse(mod.write_auto_upgrade(False))

if __name__ == "__main__":
    unittest.main(verbosity=2)
