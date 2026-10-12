"""The add-on's own screen text, in Anki's interface language (issue #123).

Why this file exists and why it looks the way it does.

Anki's interface strings live in Fluent ``.ftl`` files that are compiled into
the Rust backend when Anki itself is built, and ``aqt.utils.tr`` is a facade
generated from them at that moment. Its method set is frozen at compile time,
the translation RPC carries ``(module_index, message_index)`` integer pairs
rather than key strings or resource text, and no language hook exists in
``docs-site/addons/hooks-reference.mdx``. An add-on therefore cannot add its own
strings to Anki's catalogue, and this has been the documented position for
years: see the "Add-ons" section of Anki's translation guide,
<https://translating.ankiweb.net/anki/developers.html#add-ons>, which says
"Fluent is not currently recommended for add-ons" and tells add-on authors to
keep their strings in a dict of their own and pick the table by looking at the
interface language. That is what this module is: one dict per language, and a
lookup that asks Anki which language is active.

The language comes from ``anki.lang.current_lang``, the module global Anki
itself reads (``qt/aqt/preferences.py`` derives the Preferences language
dropdown from it, and ``qt/aqt/__init__.py`` sets it at startup). It holds a
disk-normalised code such as ``ja``, ``en`` or ``en-GB``, but
``ProfileManager.setLang()`` passes the raw code through, so ``ja_JP`` can
arrive mid-session. :func:`current_lang` therefore compares on the primary
subtag alone, which is what decides Japanese versus everything else anyway.

Two languages ship, matching ADR-0012: Japanese and English. Anything Anki is
running in that is not Japanese reads as English, so a French or German user
gets a readable screen instead of a Japanese one. Nothing here changes what the
add-on *does* -- only the words on the buttons.
"""

import re

#: The two languages this add-on ships. ADR-0012 fixes the product at
#: Japanese and English; the table below is the only place either is written.
JA = "ja"
EN = "en"

DEFAULT_LANG = EN

#: Anki's own codes are locale-shaped (``ja``, ``ja_JP``, ``ja-JP``,
#: ``en-GB``...). Only the primary subtag decides the language.
_SUBTAG_RE = re.compile(r"[-_]")

TEXT = {
    JA: {
        "title": "umeboshi-ask: ノートタイプ",
        "button": "umeboshi-ask: ask を配置",
        "intro": (
            "ask パネルを載せるノートタイプにチェックして「適用」。"
            "チェックを外して「適用」を押すと注入だけを解除します。"
        ),
        "column": "型",
        "all": "全て",
        "apply": "適用",
        "close": "閉じる",
        "update_title": "umeboshi-ask: 更新しました",
        "update_body": (
            "ask パネルを最新の形に書き換えました。"
            "配置を開くで入り先を確かめられます。"
            "元に戻すで書き換え前の形に戻ります"
            "（取り消し操作でも戻せます）。"
        ),
        "update_open": "配置を開く",
        "update_undo": "元に戻す",
        "update_disable": "自動更新を切る",
        "auto_upgrade": "起動時に古い ask を直す",
        "result_title": "umeboshi-ask: 結果",
        "result_nothing": "変更なし",
        "applied": "適用",
        "unchanged": "変化なし",
        "dropped": "脱落",
        "failed": "失敗",
        "error": "エラー",
        "cards": "%s — %d 枚 — %s",
        "state_plain": "未注入",
        "state_injected": "注入済み",
        "state_native": "ask 付き / 対象外",
        "state_partial": "印が壊れている / 対象外",
    },
    EN: {
        "title": "umeboshi-ask: Note types",
        "button": "umeboshi-ask: Inject ask",
        "intro": (
            "Tick the note types that should carry ask and press Apply. "
            "Unticking one and pressing Apply removes the panel again."
        ),
        "column": "Note type",
        "all": "All",
        "apply": "Apply",
        "close": "Close",
        "update_title": "umeboshi-ask: Updated",
        "update_body": (
            "The ask panel was rewritten to its latest shape. "
            "Open layout to check where it went. "
            "Undo restores the shape from before the rewrite"
            " (the undo shortcut works too)."
        ),
        "update_open": "Open layout",
        "update_undo": "Undo",
        "update_disable": "Turn off auto update",
        "auto_upgrade": "Fix old ask panels at startup",
        "result_title": "umeboshi-ask: Result",
        "result_nothing": "Nothing changed",
        "applied": "applied",
        "unchanged": "unchanged",
        "dropped": "dropped",
        "failed": "failed",
        "error": "error",
        "cards": "%s — %d cards — %s",
        "state_plain": "Not injected",
        "state_injected": "Injected",
        "state_native": "Already has ask / out of scope",
        "state_partial": "Broken marker / out of scope",
    },
}

# Reasons a note type was dropped or failed come out of addon/inject.py as
# English prose, because they are exception messages and an exception has to
# say something in every language at once. They still land on the same screen
# as the buttons, so they are translated here, at the point of display. The
# key is the English text inject.py raises with; anything not listed is an
# unexpected exception and is shown exactly as it came.
REASONS = {
    "note type not found": {
        JA: "ノートタイプが見つかりません",
        EN: "note type not found",
    },
    "template carries an unpaired marker": {
        JA: "印が対にならず壊れています",
        EN: "template carries an unpaired marker",
    },
    "only some of this note type's templates carry the panel": {
        JA: "一部のテンプレートだけ ask が入っています",
        EN: "only some of this note type's templates carry the panel",
    },
}


def current_lang():
    """Anki's active interface language, as one of :data:`JA` / :data:`EN`.

    Read live rather than cached at import time, so a user who changes the
    language in Preferences sees the new wording without reinstalling.

    There is no ``anki.lang.current_lang`` — the module publishes
    ``get_def_lang``/``set_lang`` and nothing that reports the *active* one, so
    a getattr on a name that does not exist silently answered "en" on every
    machine, which is exactly the case ``addon/test_inject.py`` ran and then
    asserted. Read the three places that do hold it, in order:

    1. ``mw.pm.meta["defaultLang"]`` — what ProfileManager.setLang writes when
       the user picks a language in Preferences (``qt/aqt/profiles.py``).
    2. ``anki.lang.get_def_lang()[1]`` — the language Anki resolves for this
       user/system.

    Returns :data:`EN` when Anki is not importable at all: this module is loaded
    by ``addon/test_inject.py`` with no Anki present, and by the bare-import
    path in ``picker.py``.
    """
    code = _from_profile_manager()
    if not code:
        code = _from_anki_lang()
    return _resolve(code) if code else DEFAULT_LANG


def _from_profile_manager():
    """The profile's configured UI language, or "" when unavailable."""
    try:
        from aqt import mw

        meta = getattr(getattr(mw, "pm", None), "meta", None) or {}
        return str(meta.get("defaultLang") or "")
    except Exception:
        return ""


def _from_anki_lang():
    """The language Anki resolves for this user, or "" when unavailable."""
    try:
        from anki.lang import get_def_lang

        return str(get_def_lang()[1] or "")
    except Exception:
        return ""


def _resolve(code):
    """Map an Anki language code onto the table we keep for it.

    Anki hands out locale-shaped codes. ``lang_to_disk_lang`` gives ``ja`` and
    ``en`` at startup and ``en-GB`` for British English, but
    ``ProfileManager.setLang`` passes the raw ``ja_JP`` through when the user
    changes it mid-session, so only the primary subtag is compared.
    """
    primary = _SUBTAG_RE.split(str(code).strip())[0].lower()
    if primary == JA:
        return JA
    return DEFAULT_LANG


def t(key, lang=None):
    """The string for ``key`` in Anki's language, or English if it is missing.

    ``lang`` overrides the detection, which is what the tests use to read both
    tables without an Anki to ask.
    """
    chosen = lang if lang in TEXT else current_lang()
    table = TEXT[chosen]
    if key in table:
        return table[key]
    # A key missing from one language falls back to English rather than raising
    # inside a Qt slot, where Anki would only report "a problem occurred".
    return TEXT[DEFAULT_LANG].get(key, key)


def reason(text, lang=None):
    """A drop/failure reason from :mod:`addon.inject`, in Anki's language."""
    entry = REASONS.get(str(text))
    if entry is None:
        # Not one of ours: a real exception message, shown as it came rather
        # than guessed at.
        return text
    chosen = lang if lang in TEXT else current_lang()
    return entry[chosen]