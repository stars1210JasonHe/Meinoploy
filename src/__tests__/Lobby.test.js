/**
 * @jest-environment jsdom
 */
// src/__tests__/Lobby.test.js — post-merge localization ticket 1: the online-lobby
// screen used to lose its typed player name (and already-fetched match list) on every
// LANG flip, because App.js's onLocaleChange handler re-ran showOnlineLobby(), which
// unconditionally constructed a BRAND-NEW Lobby instance. The fix is Lobby.refreshLocale()
// (called by App on the EXISTING instance instead of reconstructing) — these tests cover
// that method directly, the testable seam of the fix. The App.js-side wiring (caching
// this._lobbyInstance, clearing it in _showScreen, preferring it in onLocaleChange) is
// plain control flow with no existing App.js test harness in this codebase (App.js is
// DOM/boardgame.io-client-heavy and has no App.test.js anywhere) — verified by reading.

import { Lobby } from '../Lobby';

describe('Lobby.refreshLocale', () => {
  let root;

  beforeEach(() => {
    root = document.createElement('div');
    document.body.appendChild(root);
    global.fetch = jest.fn(() => Promise.resolve({ json: () => Promise.resolve({ matches: [] }) }));
  });

  afterEach(() => {
    document.body.removeChild(root);
    delete global.fetch;
    jest.restoreAllMocks();
  });

  test('reads the live DOM value before rebuilding, so text typed but not yet blurred survives', () => {
    const lobby = new Lobby(root, 'http://example.test', () => {});
    const input = document.getElementById('lobby-player-name');
    // Simulate typing WITHOUT firing 'change' (no blur/Enter yet) — this.playerName is
    // still its constructor default, exactly the pre-blur state a real LANG click could
    // land on mid-keystroke.
    input.value = 'Ada';
    expect(lobby.playerName).toBe('');

    lobby.refreshLocale();

    expect(lobby.playerName).toBe('Ada');
    const rebuiltInput = document.getElementById('lobby-player-name');
    expect(rebuiltInput).not.toBeNull();
    expect(rebuiltInput.value).toBe('Ada');
  });

  test('preserves an already-committed name (post-blur) across the rebuild too', () => {
    const lobby = new Lobby(root, 'http://example.test', () => {});
    const input = document.getElementById('lobby-player-name');
    input.value = 'Grace';
    input.dispatchEvent(new Event('change')); // commits via the wired onchange handler
    expect(lobby.playerName).toBe('Grace');

    lobby.refreshLocale();

    expect(lobby.playerName).toBe('Grace');
    expect(document.getElementById('lobby-player-name').value).toBe('Grace');
  });

  test('re-renders the SAME instance in place (no state reset) — preserves already-fetched matches', () => {
    const lobby = new Lobby(root, 'http://example.test', () => {});
    lobby.matches = [{ matchID: 'abc12345', players: [{ id: 0, name: 'Bob' }, { id: 1 }] }];

    lobby.refreshLocale();

    expect(root.textContent).toContain('Bob');
    expect(lobby.matches).toHaveLength(1); // untouched, not refetched/reset
  });

  test('is implemented as a plain render(), not a reconstruction (one call, same object)', () => {
    const lobby = new Lobby(root, 'http://example.test', () => {});
    const renderSpy = jest.spyOn(lobby, 'render');

    lobby.refreshLocale();

    expect(renderSpy).toHaveBeenCalledTimes(1);
  });

  test('no-ops the DOM read when the name input is absent (defensive — never throws)', () => {
    const lobby = new Lobby(root, 'http://example.test', () => {});
    root.innerHTML = ''; // simulate a mid-teardown call with nothing mounted
    expect(() => lobby.refreshLocale()).not.toThrow();
  });
});
