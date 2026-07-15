/**
 * @jest-environment jsdom
 */
// src/__tests__/i18n.test.js — spec 2026-07-15-localization-design.md §1, task-1-brief.md.
//
// jsdom is required for the real localStorage roundtrip tests (mirrors audio.test.js's
// reasoning for the same jsdom docblock). The "guarded for non-browser" tests below don't
// rely on jsdom's jsdom-ness — they simulate a non-browser environment by removing
// `window.localStorage` for the duration of one test and restoring it after.
//
// i18n.js is a module-level singleton (by design — see its file header), so every test
// resets the module registry via jest.resetModules() + a fresh require() in beforeEach.
// That gives each test its own `_locale`/`_listeners`/`_warned` state while still sharing
// jsdom's real (persistent) localStorage across tests in the same file — exactly what the
// persist/restore roundtrip test needs (a "fresh module" simulates an app reload; a "fresh
// localStorage" simulates a first-ever boot).

describe('i18n', () => {
  let i18n;

  beforeEach(() => {
    localStorage.clear();
    jest.resetModules();
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    i18n = require('../i18n');
  });

  afterEach(() => {
    console.warn.mockRestore();
  });

  test('defaults to zh with no persisted locale', () => {
    expect(i18n.initLocale()).toBe('zh');
    expect(i18n.getLocale()).toBe('zh');
  });

  test('t() resolves real topbar keys in both locales', () => {
    i18n.initLocale();
    expect(i18n.t('topbar.save')).toBe('存档');
    i18n.setLocale('en');
    expect(i18n.t('topbar.save')).toBe('SAVE');
  });

  test('topbar.lang shows the TARGET locale label (toggle semantics)', () => {
    i18n.setLocale('zh');
    expect(i18n.t('topbar.lang')).toBe('EN');
    i18n.setLocale('en');
    expect(i18n.t('topbar.lang')).toBe('中文');
  });

  test('interpolates {name}-style params', () => {
    i18n.STRINGS.zh['test.greet'] = '你好，{name}！你有 {count} 条消息';
    i18n.setLocale('zh');
    expect(i18n.t('test.greet', { name: 'Ada', count: 3 })).toBe('你好，Ada！你有 3 条消息');
  });

  test('interpolation leaves unmatched placeholders untouched', () => {
    i18n.STRINGS.zh['test.partial'] = 'Hi {name}, {missing}';
    i18n.setLocale('zh');
    expect(i18n.t('test.partial', { name: 'Bo' })).toBe('Hi Bo, {missing}');
  });

  test('missing key in zh falls back to the en table', () => {
    i18n.STRINGS.en['test.enOnly'] = 'English only string';
    delete i18n.STRINGS.zh['test.enOnly'];
    i18n.setLocale('zh');
    expect(i18n.t('test.enOnly')).toBe('English only string');
  });

  test('key missing from both tables falls back to the literal key (never blank)', () => {
    i18n.setLocale('zh');
    expect(i18n.t('test.totallyMissing')).toBe('test.totallyMissing');
    i18n.setLocale('en');
    expect(i18n.t('test.totallyMissing')).toBe('test.totallyMissing');
  });

  test('warns once per missing key per session, not on every call', () => {
    i18n.setLocale('zh');
    i18n.t('test.warnOnce');
    i18n.t('test.warnOnce');
    i18n.t('test.warnOnce');
    expect(console.warn).toHaveBeenCalledTimes(1);
  });

  test('warns once even when the EN fallback resolves the string (zh gap still flagged)', () => {
    i18n.STRINGS.en['test.zhGap'] = 'fallback value';
    i18n.setLocale('zh');
    i18n.t('test.zhGap');
    i18n.t('test.zhGap');
    expect(console.warn).toHaveBeenCalledTimes(1);
  });

  test('different missing keys each warn independently', () => {
    i18n.setLocale('zh');
    i18n.t('test.missingA');
    i18n.t('test.missingB');
    expect(console.warn).toHaveBeenCalledTimes(2);
  });

  test('setLocale persists to localStorage["meinopoly_locale"]; initLocale restores it after reload', () => {
    i18n.setLocale('en');
    expect(localStorage.getItem('meinopoly_locale')).toBe('en');

    // Simulate an app reload: fresh module instance, same (real) localStorage.
    jest.resetModules();
    const reloaded = require('../i18n');
    expect(reloaded.initLocale()).toBe('en');
    expect(reloaded.getLocale()).toBe('en');
  });

  test('setLocale ignores invalid locales (no-op, current locale unchanged)', () => {
    i18n.setLocale('zh');
    i18n.setLocale('fr');
    expect(i18n.getLocale()).toBe('zh');
  });

  test('onLocaleChange fires with the new locale on setLocale; unsubscribe stops delivery', () => {
    const seen = [];
    const unsubscribe = i18n.onLocaleChange(l => seen.push(l));
    i18n.setLocale('en');
    i18n.setLocale('zh');
    unsubscribe();
    i18n.setLocale('en');
    expect(seen).toEqual(['en', 'zh']);
  });

  test('a throwing onLocaleChange listener does not block other listeners or setLocale', () => {
    const seen = [];
    i18n.onLocaleChange(() => { throw new Error('boom'); });
    i18n.onLocaleChange(l => seen.push(l));
    expect(() => i18n.setLocale('en')).not.toThrow();
    expect(seen).toEqual(['en']);
    expect(i18n.getLocale()).toBe('en');
  });

  test('guarded for non-browser environments: no throw and in-memory locale still works when localStorage is unavailable', () => {
    const real = window.localStorage;
    Object.defineProperty(window, 'localStorage', { value: undefined, configurable: true });
    try {
      expect(() => i18n.initLocale()).not.toThrow();
      expect(i18n.getLocale()).toBe('zh');
      expect(() => i18n.setLocale('en')).not.toThrow();
      expect(i18n.getLocale()).toBe('en'); // in-memory state still updates
      expect(() => i18n.t('topbar.save')).not.toThrow();
    } finally {
      Object.defineProperty(window, 'localStorage', { value: real, configurable: true });
    }
  });

  test('guarded against a throwing localStorage (private mode / quota / disabled storage)', () => {
    jest.spyOn(window.localStorage.__proto__, 'setItem').mockImplementation(() => { throw new Error('quota'); });
    jest.spyOn(window.localStorage.__proto__, 'getItem').mockImplementation(() => { throw new Error('denied'); });
    try {
      expect(() => i18n.setLocale('en')).not.toThrow();
      expect(i18n.getLocale()).toBe('en');
      expect(() => i18n.initLocale()).not.toThrow();
    } finally {
      window.localStorage.__proto__.setItem.mockRestore();
      window.localStorage.__proto__.getItem.mockRestore();
    }
  });
});
