// Meinopoly — full screens: Title/Lobby, Character Select, Results
const { useState: useStateS } = React;

// ---------- TITLE / LOBBY ----------
function TitleScreen({ onStart, players }) {
  return (
    <div className="screen screen--title">
      <div className="title__art">
        <div className="title__logo">
          <span className="title__logo-line">MEINOPOLY</span>
        </div>
        <div className="title__tag">DOMINION · MULTI-DIMENSIONAL WORLD PROPERTY COUNCIL</div>
      </div>

      <Panel className="lobby" title="NEW GAME">
        <div className="lobby__row">
          <span className="lobby__key">MODE</span>
          <span className="lobby__val">2-PLAYER HOTSEAT</span>
        </div>
        <div className="lobby__row">
          <span className="lobby__key">BOARD</span>
          <span className="lobby__val">CLASSIC COUNCIL · 40 SPACES</span>
        </div>
        <div className="lobby__row">
          <span className="lobby__key">SEASONS</span>
          <span className="lobby__val">ON · CYCLE EVERY 10 TURNS</span>
        </div>
        <div className="lobby__seats">
          {players.map((p, i) => (
            <div className="lobby__seat" key={i}>
              <Token color={p.color} n={p.n} />
              <span>PLAYER {p.n}</span>
              <span className="lobby__ready">READY</span>
            </div>
          ))}
        </div>
      </Panel>

      <div className="title__start">
        <PixelButton variant="primary" size="lg" onClick={onStart}>START GAME</PixelButton>
        <div className="title__press">&#9656; PRESS START</div>
      </div>

      <div className="title__foot">v0.4 &middot; 10 CHARACTERS &middot; 4-TIER BUILDING &middot; TRADE &amp; AUCTION</div>
    </div>
  );
}

// ---------- CHARACTER CARD ----------
function CharCard({ char, selected, taken, onSelect, onLore }) {
  return (
    <div className={`charcard ${selected ? 'charcard--sel' : ''} ${taken ? 'charcard--taken' : ''}`}
         onClick={taken ? null : () => onSelect(char)}>
      <div className="charcard__top">
        <Portrait id={char.id} size={72} color={char.color} selected={selected} />
        <div className="charcard__id">
          <span className="charcard__name" style={{ color: char.color }}>{char.name}</span>
          <span className="charcard__title">{char.title}</span>
          <span className="charcard__money">START&nbsp;<Money amount={char.money} /></span>
        </div>
      </div>
      <div className="charcard__stats">
        {STAT_KEYS.map(s => (
          <StatRow key={s.key} label={s.label} value={char.stats[s.key]} color={char.color} />
        ))}
      </div>
      <div className="charcard__passive">
        <span className="charcard__passive-name">{char.passiveName}</span>
        <span className="charcard__passive-desc">{char.passive}</span>
      </div>
      <div className="charcard__foot">
        <button className="charcard__lore" onClick={(e) => { e.stopPropagation(); onLore(char); }}>VIEW LORE</button>
        {taken && <span className="charcard__takentag">TAKEN</span>}
        {selected && <span className="charcard__seltag">SELECTED</span>}
      </div>
    </div>
  );
}

function CharSelectScreen({ playerNo, takenId, picked, onPick, onLore, onConfirm, onBack }) {
  return (
    <div className="screen screen--select">
      <div className="select__head">
        <div className="select__heading">
          <span className="select__p">PLAYER {playerNo}</span>
          <span className="select__h">CHOOSE YOUR CHARACTER</span>
        </div>
        <div className="select__sub">Each councillor carries unique stats and a passive edge.</div>
      </div>
      <div className="select__grid">
        {CHARACTERS.map(c => (
          <CharCard
            key={c.id}
            char={c}
            selected={picked && picked.id === c.id}
            taken={takenId === c.id}
            onSelect={onPick}
            onLore={onLore}
          />
        ))}
      </div>
      <div className="select__bar">
        <PixelButton variant="ghost" onClick={onBack}>BACK</PixelButton>
        <div className="select__chosen">
          {picked ? (
            <React.Fragment>
              <Portrait id={picked.id} size={40} color={picked.color} />
              <span style={{ color: picked.color }}>{picked.name}</span>
              <span className="select__chosen-title">{picked.title}</span>
            </React.Fragment>
          ) : <span className="select__chosen-empty">Select a councillor to continue</span>}
        </div>
        <PixelButton variant="primary" disabled={!picked} onClick={onConfirm}>
          {playerNo === 1 ? 'NEXT PLAYER \u25b8' : 'BEGIN GAME \u25b8'}
        </PixelButton>
      </div>
    </div>
  );
}

// ---------- RESULTS ----------
function ResultsScreen({ standings, onReplay }) {
  const winner = standings[0];
  return (
    <div className="screen screen--results">
      <div className="results__crown"><span className="glyph glyph--crown" /></div>
      <div className="results__victory">VICTORY</div>
      <Portrait id={winner.id} size={120} color={winner.color} selected />
      <div className="results__winner" style={{ color: winner.color }}>{winner.name}</div>
      <div className="results__sub">{winner.title} controls the Council.</div>

      <Panel className="results__table" title="FINAL STANDINGS">
        {standings.map((p, i) => (
          <div className={`standrow ${i === 0 ? 'standrow--win' : ''}`} key={p.n}>
            <span className="standrow__rank">{i + 1}</span>
            <Token color={p.color} n={p.n} />
            <span className="standrow__name" style={{ color: p.color }}>{p.name}</span>
            <span className="standrow__props">{p.props} PROPS</span>
            <span className="standrow__net"><Money amount={p.net} /></span>
          </div>
        ))}
      </Panel>

      <PixelButton variant="primary" size="lg" onClick={onReplay}>PLAY AGAIN</PixelButton>
    </div>
  );
}

Object.assign(window, { TitleScreen, CharSelectScreen, ResultsScreen });
