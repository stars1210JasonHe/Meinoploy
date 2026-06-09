// Meinopoly — root app: navigation, game state, in-game HUD
const { useState: useStateA, useEffect: useEffectA, useRef: useRefA, useCallback } = React;

const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "palette": "council",
  "scanlines": true,
  "crt": true,
  "uiScale": 1
}/*EDITMODE-END*/;

const PLAYER_COLORS = ['#e9b23c', '#5cc6e8'];

// ---------- PLAYER PANEL (HUD left) ----------
function PlayerPanel({ p, active, viewerIsSelf, onTrade }) {
  const hideMoney = p.hidden && !viewerIsSelf;
  return (
    <div className={`pcard ${active ? 'pcard--active' : ''}`} style={{ '--pc': p.color }}>
      <div className="pcard__head">
        <Portrait id={p.id} size={48} color={p.color} selected={active} />
        <div className="pcard__id">
          <span className="pcard__name" style={{ color: p.color }}>{p.name}</span>
          <span className="pcard__title">{p.title}</span>
        </div>
        {active && <span className="pcard__turn">TURN</span>}
      </div>
      <div className="pcard__money"><Money amount={p.money} hidden={hideMoney} /></div>
      <div className="pcard__meta">
        <span><Token color={p.color} n={p.n} small /> {p.props.length} DEEDS</span>
        <span className="pcard__passive">{p.passiveName}</span>
      </div>
    </div>
  );
}

// ---------- GAME SCREEN ----------
function GameScreen(props) {
  const { players, cur, owned, season, seasonTurn, log, dice, rolling, prompt, event,
          onRoll, onBuy, onAuction, onPass, onUpgrade, onEndTurn, onTrade, onLore,
          onTileClick, onConcede, closeEvent } = props;
  const current = players[cur];
  const canRoll = !rolling && !prompt && !props.rolledThisTurn;

  return (
    <div className="screen screen--game">
      <div className="game__left">
        <div className="game__panels-title">COUNCIL</div>
        {players.map((p, i) => (
          <PlayerPanel key={p.n} p={p} active={i === cur} viewerIsSelf={i === cur} />
        ))}
        <div className="game__leftfoot">
          <PixelButton variant="ghost" size="sm" full onClick={onConcede}>END MATCH</PixelButton>
        </div>
      </div>

      <div className="game__center">
        <Board players={players} owned={owned} season={season} seasonTurn={seasonTurn} onTileClick={onTileClick}>
          <div className="centerslot">
            <div className="centerslot__dice">
              <Die value={dice[0]} /><Die value={dice[1]} />
            </div>
            {prompt && prompt.type === 'buy' && (
              <div className="centerslot__prompt">
                <div className="cp__name">{prompt.space.name}</div>
                <div className="cp__price">PRICE <Money amount={prompt.space.price} /></div>
                <div className="cp__btns">
                  <PixelButton variant="primary" size="sm" onClick={onBuy}>BUY</PixelButton>
                  <PixelButton variant="ghost" size="sm" onClick={onAuction}>AUCTION</PixelButton>
                  <PixelButton variant="ghost" size="sm" onClick={onPass}>PASS</PixelButton>
                </div>
              </div>
            )}
            {prompt && prompt.type === 'manage' && (
              <div className="centerslot__prompt">
                <div className="cp__name">{prompt.space.name}</div>
                <div className="cp__price">YOUR DEED &middot; LV {prompt.level}/4</div>
                <div className="cp__btns">
                  <PixelButton variant="primary" size="sm" disabled={prompt.level >= 4} onClick={onUpgrade}>UPGRADE</PixelButton>
                  <PixelButton variant="ghost" size="sm" onClick={onPass}>DONE</PixelButton>
                </div>
              </div>
            )}
            {prompt && prompt.type === 'info' && (
              <div className="centerslot__prompt">
                <div className="cp__name">{prompt.title}</div>
                <div className="cp__info">{prompt.text}</div>
                <PixelButton variant="ghost" size="sm" onClick={onPass}>OK</PixelButton>
              </div>
            )}
            {!prompt && !rolling && (
              <div className="centerslot__hint">{props.rolledThisTurn ? 'END TURN WHEN READY' : 'ROLL TO MOVE'}</div>
            )}
            {rolling && <div className="centerslot__hint">{'ROLLING\u2026'}</div>}
          </div>
        </Board>
      </div>

      <div className="game__right">
        <div className="turnbox">
          <div className="turnbox__who">
            <Token color={current.color} n={current.n} />
            <span style={{ color: current.color }}>{current.name}</span>
          </div>
          <PixelButton variant="primary" size="lg" full disabled={!canRoll} onClick={onRoll}>
            ROLL DICE
          </PixelButton>
          <div className="turnbox__btnrow">
            <PixelButton variant="default" size="sm" onClick={onTrade}>TRADE</PixelButton>
            <PixelButton variant="default" size="sm" disabled={!props.rolledThisTurn} onClick={onEndTurn}>END TURN</PixelButton>
          </div>
        </div>
        <div className="logbox">
          <div className="logbox__title">EVENT LOG</div>
          <div className="logbox__list">
            {log.map((l, i) => (
              <div key={i} className={`logline logline--${l.kind || 'neutral'}`}>{l.text}</div>
            ))}
          </div>
        </div>
      </div>

      {event && <EventCardModal card={event.card} deck={event.deck} onClose={closeEvent} />}
    </div>
  );
}

// ---------- ROOT APP ----------
function makePlayer(n, char) {
  return {
    n, color: PLAYER_COLORS[n - 1], id: char.id, name: char.name, title: char.title,
    passiveName: char.passiveName, money: char.money, pos: 0, props: [],
    hidden: char.id === 'ophelia-nightveil',
  };
}

function App() {
  const [t, setTweak] = useTweaks(TWEAK_DEFAULTS);
  const [screen, setScreen] = useStateA('title');     // title | select | game | results
  const [selectStep, setSelectStep] = useStateA(1);
  const [picks, setPicks] = useStateA({});            // {1: char, 2: char}
  const [pending, setPending] = useStateA(null);      // current pick before confirm
  const [loreChar, setLoreChar] = useStateA(null);
  const [showTrade, setShowTrade] = useStateA(false);

  // game state
  const [players, setPlayers] = useStateA([]);
  const [cur, setCur] = useStateA(0);
  const [owned, setOwned] = useStateA({});
  const [season, setSeason] = useStateA('Summer');
  const [seasonTurn, setSeasonTurn] = useStateA(1);
  const [turnCount, setTurnCount] = useStateA(0);
  const [log, setLog] = useStateA([]);
  const [dice, setDice] = useStateA([1, 1]);
  const [rolling, setRolling] = useStateA(false);
  const [prompt, setPrompt] = useStateA(null);
  const [event, setEvent] = useStateA(null);
  const [auction, setAuction] = useStateA(null);
  const [rolledThisTurn, setRolled] = useStateA(false);

  const pushLog = (text, kind) => setLog(l => [{ text, kind }, ...l].slice(0, 40));

  // ----- selection flow -----
  const startSelect = () => { setScreen('select'); setSelectStep(1); setPicks({}); setPending(null); };
  const confirmPick = () => {
    if (!pending) return;
    const np = { ...picks, [selectStep]: pending };
    setPicks(np);
    if (selectStep === 1) { setSelectStep(2); setPending(null); }
    else { beginGame(np); }
  };
  const beginGame = (np) => {
    const ps = [makePlayer(1, np[1]), makePlayer(2, np[2])];
    setPlayers(ps); setCur(0); setOwned({}); setLog([]);
    setSeason('Summer'); setSeasonTurn(1); setTurnCount(0);
    setDice([1, 1]); setPrompt(null); setRolled(false);
    pushLog(`${ps[0].name} opens the session. ${ps[0].name} rolls first.`, 'good');
    setScreen('game');
  };

  // ----- game actions -----
  const landOn = (player, idx, ps) => {
    const sp = BOARD_SPACES[idx];
    if (sp.type === 'property' || sp.type === 'railroad' || sp.type === 'utility') {
      const own = owned[idx];
      if (!own) { setPrompt({ type: 'buy', space: sp }); return; }
      if (own.n === player.n) { setPrompt({ type: 'manage', space: sp, level: own.level }); return; }
      // pay rent
      const rent = Math.round((sp.rent || 25) * (1 + 0.5 * ((own.level || 1) - 1)));
      setPlayers(prev => prev.map(p => {
        if (p.n === player.n) return { ...p, money: p.money - rent };
        if (p.n === own.n) return { ...p, money: p.money + rent };
        return p;
      }));
      pushLog(`${player.name} pays $${rent} rent on ${sp.name}.`, 'bad');
      setRolled(true);
      return;
    }
    if (sp.type === 'chance' || sp.type === 'community') {
      const deck = sp.type === 'chance' ? 'chance' : 'community';
      const pool = deck === 'chance' ? CHANCE_CARDS : COMMUNITY_CARDS;
      const card = pool[Math.floor(Math.random() * pool.length)];
      setEvent({ deck, card });
      pushLog(`${player.name} draws ${deck === 'chance' ? 'Chance' : 'Community Chest'}: ${card.text}`, card.kind);
      setRolled(true);
      return;
    }
    if (sp.type === 'tax') {
      setPlayers(prev => prev.map(p => p.n === player.n ? { ...p, money: p.money - sp.rent } : p));
      pushLog(`${player.name} pays $${sp.rent} ${sp.name}.`, 'bad');
      setRolled(true);
      return;
    }
    if (sp.type === 'goToJail') {
      setPlayers(prev => prev.map(p => p.n === player.n ? { ...p, pos: 10 } : p));
      pushLog(`${player.name} is sent to Jail.`, 'bad');
      setRolled(true);
      return;
    }
    if (sp.type === 'parking') { pushLog(`${player.name} rests at Free Parking.`, 'neutral'); setRolled(true); return; }
    if (sp.type === 'jail') { pushLog(`${player.name} is just visiting.`, 'neutral'); setRolled(true); return; }
    if (sp.type === 'go') { pushLog(`${player.name} lands on GO.`, 'good'); setRolled(true); return; }
    setRolled(true);
  };

  const doRoll = () => {
    if (rolling || rolledThisTurn || prompt) return;
    setRolling(true);
    let ticks = 0;
    const iv = setInterval(() => {
      setDice([1 + Math.floor(Math.random() * 6), 1 + Math.floor(Math.random() * 6)]);
      if (++ticks > 8) {
        clearInterval(iv);
        const d = [1 + Math.floor(Math.random() * 6), 1 + Math.floor(Math.random() * 6)];
        setDice(d);
        const steps = d[0] + d[1];
        const player = players[cur];
        const from = player.pos;
        const to = (from + steps) % 40;
        const passedGo = to < from;
        // animate stepping
        let step = 0;
        const mv = setInterval(() => {
          step++;
          const np = (from + step) % 40;
          setPlayers(prev => prev.map((p, i) => i === cur ? { ...p, pos: np } : p));
          if (step >= steps) {
            clearInterval(mv);
            setRolling(false);
            let bonus = 0;
            if (passedGo) {
              bonus = 200 + (player.id === 'mira-dawnlight' ? 50 : 0);
              setPlayers(prev => prev.map((p, i) => i === cur ? { ...p, money: p.money + bonus } : p));
              pushLog(`${player.name} passes GO (+$${bonus}).`, 'good');
            }
            pushLog(`${player.name} rolls ${d[0]}+${d[1]} = ${steps}.`, 'neutral');
            landOn({ ...player, pos: to }, to, players);
          }
        }, 110);
      }
    }, 70);
  };

  const buyCurrent = () => {
    const sp = prompt.space;
    const player = players[cur];
    const disc = player.id === 'albert-victor' ? 0.9 : 1;
    const cost = Math.round(sp.price * disc);
    setPlayers(prev => prev.map((p, i) => i === cur ? { ...p, money: p.money - cost, props: [...p.props, sp.id] } : p));
    setOwned(prev => ({ ...prev, [sp.id]: { color: player.color, n: player.n, level: 1 } }));
    pushLog(`${player.name} buys ${sp.name} for $${cost}.`, 'good');
    setPrompt(null); setRolled(true);
  };
  const openAuction = () => { setAuction({ space: prompt.space }); setPrompt(null); setRolled(true); };
  const passBuy = () => { setPrompt(null); setRolled(true); };
  const upgrade = () => {
    const sp = prompt.space;
    const player = players[cur];
    const lvl = (owned[sp.id].level || 1) + 1;
    const cost = Math.round(sp.price * 0.5 * (player.id === 'lia-startrace' ? 0.8 : 1));
    setOwned(prev => ({ ...prev, [sp.id]: { ...prev[sp.id], level: lvl } }));
    setPlayers(prev => prev.map((p, i) => i === cur ? { ...p, money: p.money - cost } : p));
    pushLog(`${player.name} upgrades ${sp.name} to Lv ${lvl} (-$${cost}).`, 'good');
    setPrompt(p => ({ ...p, level: lvl }));
  };

  const endTurn = () => {
    const nextTurn = turnCount + 1;
    setTurnCount(nextTurn);
    let st = seasonTurn + 1;
    if (st > 10) {
      st = 1;
      const si = (SEASONS.indexOf(season) + 1) % 4;
      setSeason(SEASONS[si]);
      pushLog(`Season turns to ${SEASONS[si]}.`, 'neutral');
    }
    setSeasonTurn(st);
    setCur(c => (c + 1) % players.length);
    setPrompt(null); setRolled(false);
  };

  const tileClick = (sp) => {
    const own = owned[sp.id];
    if (own && own.n === players[cur].n && !rolling) {
      setLoreChar(null);
      setPrompt({ type: 'manage', space: sp, level: own.level });
    }
  };

  const concede = () => {
    const standings = players.map(p => ({
      ...p,
      props: p.props.length,
      net: p.money + p.props.reduce((s, id) => s + (BOARD_SPACES[id].price || 0), 0),
    })).sort((a, b) => b.net - a.net);
    setStandings(standings);
    setScreen('results');
  };
  const [standings, setStandings] = useStateA([]);

  const replay = () => { setScreen('title'); };

  // ----- palette CSS vars -----
  const pal = PALETTES[t.palette] || PALETTES['council'];
  const rootStyle = {
    '--bg': pal.bg, '--bg2': pal.bg2, '--bg3': pal.bg3,
    '--ink': pal.ink, '--ink-dim': pal.inkDim, '--accent': pal.accent,
    '--accent2': pal.accent2, '--line': pal.line, '--good': pal.good, '--bad': pal.bad,
    '--ui-scale': t.uiScale,
  };

  // build trade props for modal
  const me = players[cur];
  const opp = players[(cur + 1) % (players.length || 1)];
  const propsOf = (pl) => pl ? pl.props.map(id => BOARD_SPACES[id]) : [];

  return (
    <div className={`app palette--${t.palette} ${t.scanlines ? 'app--scan' : ''} ${t.crt ? 'app--crt' : ''}`} style={rootStyle}>
      <div className="app__frame">
        {screen === 'title' && (
          <TitleScreen players={[{ n: 1, color: PLAYER_COLORS[0] }, { n: 2, color: PLAYER_COLORS[1] }]} onStart={startSelect} />
        )}
        {screen === 'select' && (
          <CharSelectScreen
            playerNo={selectStep}
            takenId={selectStep === 2 && picks[1] ? picks[1].id : null}
            picked={pending}
            onPick={setPending}
            onLore={setLoreChar}
            onConfirm={confirmPick}
            onBack={() => selectStep === 2 ? (setSelectStep(1), setPending(picks[1])) : setScreen('title')}
          />
        )}
        {screen === 'game' && players.length > 0 && (
          <GameScreen
            players={players} cur={cur} owned={owned} season={season} seasonTurn={seasonTurn}
            log={log} dice={dice} rolling={rolling} prompt={prompt} event={event}
            rolledThisTurn={rolledThisTurn}
            onRoll={doRoll} onBuy={buyCurrent} onAuction={openAuction} onPass={passBuy}
            onUpgrade={upgrade} onEndTurn={endTurn} onTrade={() => setShowTrade(true)}
            onTileClick={tileClick} onConcede={concede} closeEvent={() => setEvent(null)}
          />
        )}
        {screen === 'results' && <ResultsScreen standings={standings} onReplay={replay} />}
      </div>

      {loreChar && <LoreModal char={loreChar} onClose={() => setLoreChar(null)} />}
      {showTrade && players.length > 0 && (
        <TradeModal
          me={{ ...me, net: me.money }} opp={{ ...opp, net: opp.money }}
          myProps={propsOf(me)} oppProps={propsOf(opp)}
          onClose={() => setShowTrade(false)} />
      )}
      {auction && (
        <AuctionModal space={auction.space} players={players} onClose={() => setAuction(null)} />
      )}

      <TweaksPanel>
        <TweakSection label="Palette" />
        <TweakRadio label="Theme" value={t.palette}
          options={['council', 'verdant', 'arcade']}
          onChange={(v) => setTweak('palette', v)} />
        <TweakSection label="CRT" />
        <TweakToggle label="Scanlines" value={t.scanlines} onChange={(v) => setTweak('scanlines', v)} />
        <TweakToggle label="Screen glow" value={t.crt} onChange={(v) => setTweak('crt', v)} />
        <TweakSection label="Layout" />
        <TweakSlider label="UI scale" value={t.uiScale} min={0.85} max={1.15} step={0.05}
          onChange={(v) => setTweak('uiScale', v)} />
      </TweaksPanel>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
