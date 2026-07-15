// src/i18n.js — locale core (spec 2026-07-15-localization-design.md §1).
//
// Flat string tables per locale (`STRINGS.zh` / `STRINGS.en`), a pure `t(key, params)`
// lookup with `{name}`-style interpolation, and a tiny locale-change pub/sub so UI owners
// (App.js today; game-chrome.js/entry-ui.js/Lobby.js in later tasks) can react when the
// user flips LANG. Missing-key policy: current-locale table -> EN table -> the key itself
// literally (NEVER blank), with one console.warn per missing key per session (dev aid, not
// user-facing).
//
// Module-level singleton state (by design — many call sites import `t` directly, mirroring
// game-chrome.js's existing `esc()` convention: a small pure helper imported everywhere
// rather than threaded through every function signature). localStorage access is guarded
// exactly like audio.js's mute persistence (`typeof localStorage` check + try/catch): under
// Jest's default 'node' testEnvironment (no jsdom, no docblock) `localStorage` doesn't
// exist at all, and even where it does exist it can throw (private browsing, quota, disabled
// storage) — either way i18n must keep working in-memory rather than crash the app.

const STORAGE_KEY = 'meinopoly_locale';
const DEFAULT_LOCALE = 'zh';

// Seed set (Task 1 proof set): the topbar buttons this task migrates. Later tasks append
// keys here screen-by-screen — see docs/superpowers/plans/2026-07-15-localization.md.
export const STRINGS = {
  zh: {
    'topbar.load': '读档',
    'topbar.ai': 'AI',
    'topbar.snd': '音效',
    'topbar.muted': '静音',
    'topbar.save': '存档',
    'topbar.exit': '退出',
    'topbar.full': '全屏',
    'topbar.fullExit': '退出全屏',
    // The LANG button shows the locale it will SWITCH TO, not the active one — so this
    // value (read while zh is active) is deliberately the English label 'EN'.
    'topbar.lang': 'EN',
  },
  en: {
    'topbar.load': 'LOAD',
    'topbar.ai': 'AI',
    'topbar.snd': 'SND',
    'topbar.muted': 'MUTED',
    'topbar.save': 'SAVE',
    'topbar.exit': 'EXIT',
    'topbar.full': 'FULL',
    'topbar.fullExit': 'EXIT FS',
    // Symmetric with zh.topbar.lang above: read while en is active, so it's the target
    // locale's own name, written in that locale's script.
    'topbar.lang': '中文',
  },
};

let _locale = DEFAULT_LOCALE;
const _listeners = [];
const _warned = new Set(); // missing keys already console.warn'd this session

function _hasStorage() {
  return typeof localStorage !== 'undefined';
}

function _readPersistedLocale() {
  if (!_hasStorage()) return null;
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved === 'zh' || saved === 'en' ? saved : null;
  } catch (e) {
    return null; // storage present but inaccessible (private mode, disabled, etc.)
  }
}

// Reads the persisted locale (default 'zh' if absent/invalid/unavailable). Call once at
// app boot, before the first render, so the very first paint is already in the right
// language.
export function initLocale() {
  _locale = _readPersistedLocale() || DEFAULT_LOCALE;
  return _locale;
}

export function getLocale() {
  return _locale;
}

// Sets the active locale, persists it (best-effort), and notifies every registered
// onLocaleChange listener synchronously. Invalid locales are ignored (no-op, current
// locale returned unchanged) rather than throwing — callers toggling via a button never
// need to validate first.
export function setLocale(locale) {
  if (locale !== 'zh' && locale !== 'en') return _locale;
  _locale = locale;
  if (_hasStorage()) {
    try { localStorage.setItem(STORAGE_KEY, _locale); } catch (e) { /* best-effort persist */ }
  }
  _listeners.slice().forEach(cb => {
    try { cb(_locale); } catch (e) { /* one bad listener must not break the others */ }
  });
  return _locale;
}

// Registers a callback invoked with the new locale on every setLocale(). Returns an
// unsubscribe function.
export function onLocaleChange(cb) {
  _listeners.push(cb);
  return () => {
    const idx = _listeners.indexOf(cb);
    if (idx !== -1) _listeners.splice(idx, 1);
  };
}

function _interpolate(str, params) {
  if (!params) return str;
  return str.replace(/\{(\w+)\}/g, (match, name) => (
    Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : match
  ));
}

// Looks up `key` in the active locale's table; missing -> EN table -> the key itself
// (never blank). `params` interpolates `{name}` placeholders. Warns once per missing key
// per session regardless of whether the EN fallback resolved it — a zh gap is worth
// flagging even though the user never sees a blank string.
//
// T1-review Finding 2: a table value of '' (empty string) is treated exactly like a
// missing key, not just `undefined`. The original fallback chain only triggered on
// `undefined`, so a plausible copy-paste gap during the 400-key migration (a key present
// in the table but accidentally seeded with '') would render silently blank with no warn —
// violating the "never blank" guarantee just as badly as a missing key would. `_isBlank`
// is factored out so both the current-locale lookup and the EN-fallback lookup apply the
// same undefined-or-empty test.
function _isBlank(v) {
  return v === undefined || v === '';
}
export function t(key, params) {
  const table = STRINGS[_locale] || {};
  let str = table[key];
  if (_isBlank(str)) {
    if (!_warned.has(key)) {
      _warned.add(key);
      console.warn(`[i18n] missing key "${key}" for locale "${_locale}"`);
    }
    const enStr = STRINGS.en && STRINGS.en[key];
    str = !_isBlank(enStr) ? enStr : key;
  }
  return _interpolate(str, params);
}
