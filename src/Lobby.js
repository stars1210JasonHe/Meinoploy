// Meinopoly — Online Lobby UI
// Uses boardgame.io v0.45 REST API for match management

import { t } from './i18n';

export class Lobby {
  constructor(rootElement, serverUrl, onJoin) {
    this.rootElement = rootElement;
    this.serverUrl = serverUrl;
    this.onJoin = onJoin; // callback(gameID, playerID, credentials, numPlayers)
    this.playerName = '';
    this.render();
    this.refreshMatches();
  }

  async refreshMatches() {
    try {
      const res = await fetch(`${this.serverUrl}/games/monopoly`);
      const data = await res.json();
      const all = data.matches || [];
      // Hide matches where no one has joined yet (stale/orphaned)
      this.matches = all.filter(m => m.players.some(p => p.name));
    } catch (e) {
      this.matches = [];
    }
    this.render();
  }

  async createMatch(numPlayers) {
    try {
      const res = await fetch(`${this.serverUrl}/games/monopoly/create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // enforceSeats: online matches require the acting seat to match the
        // authorizing client (Task 9) — hot-seat's Client() has no setupData
        // channel, so this flag only ever reaches online matches.
        body: JSON.stringify({ numPlayers, setupData: { enforceSeats: true } }),
      });
      const data = await res.json();
      // Auto-join as player 0
      await this.joinMatch(data.matchID, '0');
    } catch (e) {
      console.error('Failed to create match:', e);
    }
  }

  async joinMatch(matchID, playerID) {
    // Wire default: boardgame.io persists playerName into shared match metadata that every
    // client renders — this value is DATA, not UI copy, so locale must never cross the
    // client boundary here (a zh-default client would otherwise mint "玩家 1" into state
    // that an en client then has to display). Keep this a fixed English string, not t().
    // The input placeholder below (~line 101 originally) stays localized — that's UI-local,
    // never sent over the wire.
    const name = this.playerName || `Player ${parseInt(playerID) + 1}`;
    try {
      const res = await fetch(`${this.serverUrl}/games/monopoly/${matchID}/join`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ playerID, playerName: name }),
      });
      const data = await res.json();
      if (data.playerCredentials) {
        // Get match details for numPlayers
        const matchRes = await fetch(`${this.serverUrl}/games/monopoly/${matchID}`);
        const matchData = await matchRes.json();
        this.onJoin(matchID, playerID, data.playerCredentials, matchData.players.length);
      }
    } catch (e) {
      console.error('Failed to join match:', e);
    }
  }

  render() {
    let matchRows = '';
    if (!this.matches || this.matches.length === 0) {
      matchRows = `<div class="lobby2__empty">${t('lobby.noGames')}</div>`;
    } else {
      this.matches.forEach(match => {
        const joinedCount = match.players.filter(p => p.name).length;
        const totalPlayers = match.players.length;
        const isFull = joinedCount >= totalPlayers;
        const openSlots = match.players.filter(p => !p.name).map(p => p.id);
        const seats = match.players.map(p =>
          p.name
            ? `<span class="lobby2__seat joined">${p.name}</span>`
            : `<span class="lobby2__seat open">${t('lobby.slotWord')} ${p.id}</span>`
        ).join('');
        matchRows += `
          <div class="lobby2__matchrow">
            <div>
              <div class="lobby2__matchid">${t('lobby.gameWord')} ${match.matchID.substring(0, 8)}</div>
              <div class="lobby2__matchmeta">${joinedCount}/${totalPlayers} ${t('lobby.joined')}</div>
              <div class="lobby2__seats">${seats}</div>
            </div>
            ${!isFull && openSlots.length > 0
              ? `<button class="pix-btn pix-btn--success pix-btn--sm btn-join-match" data-match="${match.matchID}" data-slot="${openSlots[0]}">${t('lobby.join')}</button>`
              : `<span class="lobby2__seat">${t('lobby.full')}</span>`}
          </div>`;
      });
    }

    const html = `
      <div><div class="menu__heading">${t('lobby.heading')}</div><div class="menu__sub">${t('lobby.subheading')}</div></div>
      <div class="lobby2">
        <div class="pix-panel"><div class="pix-panel__titlebar"><span class="pix-panel__title">${t('lobby.yourName')}</span></div>
          <div class="pix-panel__body lobby2__nameinput">
            <input type="text" id="lobby-player-name" value="${this.playerName}" placeholder="${t('lobby.namePlaceholder')}" />
          </div>
        </div>
        <div class="pix-panel"><div class="pix-panel__titlebar"><span class="pix-panel__title">${t('lobby.createGame')}</span></div>
          <div class="pix-panel__body lobby2__createrow">
            <select id="lobby-player-count">
              ${[2, 3, 4, 5, 6, 7, 8, 9, 10].map(n => `<option value="${n}">${n} ${t('lobby.playersOption')}</option>`).join('')}
            </select>
            <button id="btn-create-match" class="pix-btn pix-btn--primary">${t('lobby.create')}</button>
          </div>
        </div>
        <div class="pix-panel"><div class="pix-panel__titlebar"><span class="pix-panel__title">${t('lobby.availableGames')}</span><button id="btn-refresh" class="pix-panel__right" style="cursor:pointer;">${t('lobby.refresh')}</button></div>
          <div class="pix-panel__body">${matchRows}</div>
        </div>
        <button id="btn-lobby-back" class="pix-btn pix-btn--ghost">&#9666; ${t('lobby.backToMenu')}</button>
      </div>`;

    this.rootElement.innerHTML = html;

    // Event listeners
    const nameInput = document.getElementById('lobby-player-name');
    if (nameInput) {
      nameInput.onchange = (e) => { this.playerName = e.target.value; };
    }

    const createBtn = document.getElementById('btn-create-match');
    if (createBtn) {
      createBtn.onclick = async () => {
        const count = parseInt(document.getElementById('lobby-player-count').value);
        await this.createMatch(count);
      };
    }

    const refreshBtn = document.getElementById('btn-refresh');
    if (refreshBtn) {
      refreshBtn.onclick = () => this.refreshMatches();
    }

    const backBtn = document.getElementById('btn-lobby-back');
    if (backBtn) {
      backBtn.onclick = () => {
        if (this.onBack) this.onBack();
      };
    }

    this.rootElement.querySelectorAll('.btn-join-match').forEach(btn => {
      btn.onclick = () => {
        this.joinMatch(btn.dataset.match, btn.dataset.slot);
      };
    });
  }
}
