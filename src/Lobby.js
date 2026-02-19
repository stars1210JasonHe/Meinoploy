// Meinopoly — Online Lobby UI
// Uses boardgame.io v0.45 REST API for match management

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
      this.matches = data.matches || [];
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
        body: JSON.stringify({ numPlayers }),
      });
      const data = await res.json();
      await this.refreshMatches();
      return data.matchID;
    } catch (e) {
      console.error('Failed to create match:', e);
      return null;
    }
  }

  async joinMatch(matchID, playerID) {
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
    let html = `
      <div class="lobby-container">
        <h2>Online Lobby</h2>
        <div class="lobby-name-input">
          <label>Your Name:
            <input type="text" id="lobby-player-name" value="${this.playerName}" placeholder="Enter your name" />
          </label>
        </div>

        <div class="lobby-create">
          <h3>Create New Game</h3>
          <div class="lobby-create-controls">
            <select id="lobby-player-count">
              ${[2, 3, 4, 5, 6, 7, 8, 9, 10].map(n =>
                `<option value="${n}">${n} Players</option>`
              ).join('')}
            </select>
            <button id="btn-create-match" class="btn btn-success">Create Game</button>
          </div>
        </div>

        <div class="lobby-matches">
          <h3>Available Games <button id="btn-refresh" class="btn-header">Refresh</button></h3>
          <div class="match-list">`;

    if (!this.matches || this.matches.length === 0) {
      html += '<p class="no-matches">No games available. Create one!</p>';
    } else {
      this.matches.forEach(match => {
        const joinedCount = match.players.filter(p => p.name).length;
        const totalPlayers = match.players.length;
        const isFull = joinedCount >= totalPlayers;
        const openSlots = match.players
          .filter(p => !p.name)
          .map(p => p.id);

        html += `
          <div class="match-entry">
            <div class="match-info">
              <div class="match-id">Game: ${match.matchID.substring(0, 8)}...</div>
              <div class="match-meta">${joinedCount}/${totalPlayers} players joined</div>
              <div class="match-players">
                ${match.players.map(p =>
                  p.name
                    ? `<span class="match-player joined">${p.name}</span>`
                    : `<span class="match-player open">Slot ${p.id}</span>`
                ).join('')}
              </div>
            </div>
            <div class="match-actions">
              ${!isFull && openSlots.length > 0
                ? `<button class="btn-small btn-upgrade btn-join-match" data-match="${match.matchID}" data-slot="${openSlots[0]}">Join</button>`
                : '<span class="match-full">Full</span>'
              }
            </div>
          </div>`;
      });
    }

    html += `</div></div>
      <div class="lobby-back">
        <button id="btn-lobby-back" class="btn btn-secondary">Back to Menu</button>
      </div>
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
