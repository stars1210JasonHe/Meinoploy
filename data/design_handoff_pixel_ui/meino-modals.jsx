// Meinopoly — modals: Lore, Trade, Auction, Event card
const { useState: useStateM } = React;

const BIOS = {
  'albert-victor': 'Once the Council\u2019s chief financier, Albert reads a balance sheet like scripture. He bankrolled three colony charters before anyone learned his real name \u2014 and he intends to buy the rest.',
  'lia-startrace': 'A pioneer who mapped jump-gates no one else dared chart. Lia builds where others see void, turning raw stations into thriving holdings overnight.',
  'marcus-grayline': 'Every vote has a price; Marcus simply knows it first. The Council runs on his quiet favours and quieter debts.',
  'evelyn-zero': 'She calls it probability. The houses she\u2019s bankrupted call it something else. Evelyn never draws a card she hasn\u2019t already counted.',
  'knox-ironlaw': 'Order is a product, and Knox sells it at a premium. Mark a district \u201cregulated\u201d and the tariffs write themselves.',
  'sophia-ember': 'Crisis is just liquidity with the lights off. Sophia profits the instant a rival folds, rebuilding from the ashes for less.',
  'cassian-echo': 'Information is the only currency that never inflates. Cassian sees the next card, the hidden ledger, the deal before it\u2019s spoken.',
  'mira-dawnlight': 'An idealist among sharks \u2014 and somehow still solvent. Mira believes a fairer Council is also a richer one, and keeps proving it past GO.',
  'renn-chainbreaker': 'Monopolies are chains, and Renn breaks chains. Where others squeeze, he undercuts \u2014 on principle, and on margin.',
  'ophelia-nightveil': 'No one knows what Ophelia is worth, which is exactly the point. Her victory may already be decided in the dark.',
};

function Modal({ children, onClose, wide }) {
  return (
    <div className="modal__scrim" onClick={onClose}>
      <div className={`modal ${wide ? 'modal--wide' : ''}`} onClick={(e) => e.stopPropagation()}>
        {children}
      </div>
    </div>
  );
}

// ---------- LORE ----------
function LoreModal({ char, onClose }) {
  return (
    <Modal onClose={onClose} wide>
      <div className="lore">
        <div className="lore__left">
          <Portrait id={char.id} size={150} color={char.color} selected />
          <div className="lore__name" style={{ color: char.color }}>{char.name}</div>
          <div className="lore__title">{char.title}</div>
          <div className="lore__stats">
            {STAT_KEYS.map(s => <StatRow key={s.key} label={s.label} value={char.stats[s.key]} color={char.color} />)}
          </div>
        </div>
        <div className="lore__right">
          <div className="lore__sectlabel">PASSIVE &middot; {char.passiveName}</div>
          <div className="lore__passive">{char.passive}</div>
          <div className="lore__sectlabel">DOSSIER</div>
          <p className="lore__body">{BIOS[char.id]}</p>
          <div className="lore__sectlabel">STARTING CAPITAL</div>
          <div className="lore__money"><Money amount={char.money} /></div>
          <div className="lore__close"><PixelButton variant="primary" onClick={onClose}>CLOSE</PixelButton></div>
        </div>
      </div>
    </Modal>
  );
}

// ---------- EVENT CARD ----------
function EventCardModal({ card, deck, onClose }) {
  return (
    <Modal onClose={onClose}>
      <div className={`evcard evcard--${card.kind}`}>
        <div className="evcard__deck">{deck === 'chance' ? 'CHANCE' : 'COMMUNITY CHEST'}</div>
        <div className="evcard__glyph"><span className={`glyph glyph--${deck === 'chance' ? 'q' : 'chest'}`} /></div>
        <div className="evcard__text">{card.text}</div>
        <div className={`evcard__tag evcard__tag--${card.kind}`}>{card.kind === 'good' ? 'FORTUNE' : card.kind === 'bad' ? 'HAZARD' : 'EVENT'}</div>
        <PixelButton variant="primary" onClick={onClose}>OK</PixelButton>
      </div>
    </Modal>
  );
}

// ---------- TRADE ----------
function TradeSide({ player, props, offerCash, picks, onTogglePick, onCash, accent }) {
  return (
    <div className="trade__side">
      <div className="trade__sidehead">
        <Token color={player.color} n={player.n} />
        <span style={{ color: player.color }}>{player.name}</span>
      </div>
      <div className="trade__proplist">
        {props.length === 0 && <div className="trade__empty">No deeds to offer</div>}
        {props.map(p => (
          <button key={p.id}
            className={`trade__prop ${picks.includes(p.id) ? 'on' : ''}`}
            onClick={() => onTogglePick(p.id)}>
            <span className="trade__propbar" style={{ background: GROUP_COLORS[p.group] || 'var(--ink-dim)' }} />
            <span className="trade__propname">{p.name}</span>
            <span className="trade__propprice">${p.price}</span>
          </button>
        ))}
      </div>
      <div className="trade__cash">
        <span>CASH</span>
        <div className="trade__cashctl">
          <button onClick={() => onCash(-50)}>&minus;</button>
          <span className="trade__cashval">${offerCash}</span>
          <button onClick={() => onCash(50)}>+</button>
        </div>
      </div>
    </div>
  );
}

function TradeModal({ me, opp, myProps, oppProps, onClose }) {
  const [myPicks, setMyPicks] = useStateM([]);
  const [oppPicks, setOppPicks] = useStateM([]);
  const [myCash, setMyCash] = useStateM(0);
  const [oppCash, setOppCash] = useStateM(0);
  const toggle = (setter) => (id) => setter(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  const clampCash = (setter, max) => (d) => setter(v => Math.max(0, Math.min(max, v + d)));
  const fair = myPicks.length + (myCash / 100) - oppPicks.length - (oppCash / 100);
  return (
    <Modal onClose={onClose} wide>
      <div className="trade">
        <div className="trade__head">PROPOSE TRADE</div>
        <div className="trade__cols">
          <TradeSide player={me} props={myProps} offerCash={myCash} picks={myPicks}
            onTogglePick={toggle(setMyPicks)} onCash={clampCash(setMyCash, me.net)} accent={me.color} />
          <div className="trade__swap"><span className="glyph glyph--swap" /></div>
          <TradeSide player={opp} props={oppProps} offerCash={oppCash} picks={oppPicks}
            onTogglePick={toggle(setOppPicks)} onCash={clampCash(setOppCash, opp.net)} accent={opp.color} />
        </div>
        <div className="trade__bal">
          <span>BALANCE</span>
          <span className={`trade__balval ${fair > 0.5 ? 'pos' : fair < -0.5 ? 'neg' : 'even'}`}>
            {fair > 0.5 ? 'IN YOUR FAVOUR' : fair < -0.5 ? 'FAVOURS RIVAL' : 'ROUGHLY EVEN'}
          </span>
        </div>
        <div className="trade__actions">
          <PixelButton variant="ghost" onClick={onClose}>CANCEL</PixelButton>
          <PixelButton variant="primary" onClick={onClose}>PROPOSE &#9656;</PixelButton>
        </div>
      </div>
    </Modal>
  );
}

// ---------- AUCTION ----------
function AuctionModal({ space, players, onClose }) {
  const [bid, setBid] = useStateM(Math.max(10, Math.round(space.price * 0.5 / 10) * 10));
  const [leader, setLeader] = useStateM(0);
  const [passed, setPassed] = useStateM([]);
  const active = players.filter(p => !passed.includes(p.n));
  const raise = () => { setBid(b => b + 10); setLeader(l => (l + 1) % players.length); };
  const pass = (n) => setPassed(prev => prev.includes(n) ? prev : [...prev, n]);
  const done = active.length <= 1;
  return (
    <Modal onClose={onClose}>
      <div className="auction">
        <div className="auction__head">AUCTION</div>
        <div className="auction__lot">
          <span className="auction__bar" style={{ background: GROUP_COLORS[space.group] || 'var(--accent)' }} />
          <div className="auction__lotname">{space.name}</div>
          <div className="auction__listed">Listed ${space.price}</div>
        </div>
        <div className="auction__bidbox">
          <span className="auction__bidlabel">CURRENT BID</span>
          <span className="auction__bidval">${bid}</span>
          <span className="auction__leader">
            {done ? 'SOLD TO' : 'HIGH BIDDER'}&nbsp;
            <Token color={players[leader].color} n={players[leader].n} small />
          </span>
        </div>
        <div className="auction__bidders">
          {players.map(p => (
            <div key={p.n} className={`auction__bidder ${passed.includes(p.n) ? 'out' : ''} ${leader === (p.n - 1) ? 'lead' : ''}`}>
              <Token color={p.color} n={p.n} small />
              <span>{p.name}</span>
              <span className="auction__bstate">{passed.includes(p.n) ? 'PASS' : leader === (p.n - 1) ? 'LEADS' : 'IN'}</span>
            </div>
          ))}
        </div>
        {done ? (
          <PixelButton variant="primary" full onClick={onClose}>CLOSE LOT</PixelButton>
        ) : (
          <div className="auction__actions">
            <PixelButton variant="ghost" onClick={() => pass(active[0].n)}>PASS</PixelButton>
            <PixelButton variant="primary" onClick={raise}>BID +$10</PixelButton>
          </div>
        )}
      </div>
    </Modal>
  );
}

Object.assign(window, { Modal, LoreModal, EventCardModal, TradeModal, AuctionModal });
