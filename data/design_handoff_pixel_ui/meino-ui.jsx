// Meinopoly — shared pixel UI components
const { useState, useEffect, useRef } = React;

// ---- Beveled panel ----
function Panel({ title, right, children, className = '', style = {}, inset = false, accentBar }) {
  return (
    <div className={`pix-panel ${inset ? 'pix-panel--inset' : ''} ${className}`} style={style}>
      {accentBar && <div className="pix-panel__accent" style={{ background: accentBar }} />}
      {title && (
        <div className="pix-panel__titlebar">
          <span className="pix-panel__title">{title}</span>
          {right && <span className="pix-panel__right">{right}</span>}
        </div>
      )}
      <div className="pix-panel__body">{children}</div>
    </div>
  );
}

// ---- Pixel button ----
function PixelButton({ children, onClick, variant = 'default', disabled = false, full = false, size = 'md', title }) {
  return (
    <button
      className={`pix-btn pix-btn--${variant} pix-btn--${size} ${full ? 'pix-btn--full' : ''}`}
      onClick={onClick}
      disabled={disabled}
      title={title}
    >
      {children}
    </button>
  );
}

// ---- Segmented stat bar ----
function StatRow({ label, value, max = 10, color }) {
  const cells = [];
  for (let i = 0; i < max; i++) {
    cells.push(<span key={i} className={`statcell ${i < value ? 'on' : ''}`} style={i < value ? { background: color } : null} />);
  }
  return (
    <div className="statrow">
      <span className="statrow__label">{label}</span>
      <span className="statrow__cells">{cells}</span>
      <span className="statrow__val">{value}</span>
    </div>
  );
}

// ---- Framed pixel portrait ----
function Portrait({ id, size = 64, color = 'var(--accent)', selected = false, style = {} }) {
  return (
    <div
      className={`portrait ${selected ? 'portrait--sel' : ''}`}
      style={{ width: size, height: size, '--pcol': color, ...style }}
    >
      {id ? (
        <img src={PORTRAIT(id)} alt="" draggable="false" />
      ) : (
        <div className="portrait__empty">?</div>
      )}
    </div>
  );
}

// ---- Dice (pixel pips) ----
function Pip() { return <span className="pip" />; }
function Die({ value }) {
  // pip layout per value
  const layout = {
    1: [4], 2: [0, 8], 3: [0, 4, 8], 4: [0, 2, 6, 8],
    5: [0, 2, 4, 6, 8], 6: [0, 2, 3, 5, 6, 8],
  }[value] || [4];
  const cells = [];
  for (let i = 0; i < 9; i++) cells.push(<span key={i} className="die__cell">{layout.includes(i) ? <Pip /> : null}</span>);
  return <div className="die">{cells}</div>;
}

// ---- Player token ----
function Token({ color, n, small }) {
  return <span className={`token ${small ? 'token--sm' : ''}`} style={{ '--tcol': color }}>{n}</span>;
}

// ---- Money readout ----
function Money({ amount, hidden }) {
  return <span className="money">{hidden ? '$?,???' : '$' + amount.toLocaleString()}</span>;
}

// ---- Coin / pixel glyph icons (CSS drawn, no emoji) ----
function Glyph({ kind, color }) {
  return <span className={`glyph glyph--${kind}`} style={color ? { '--gcol': color } : null} />;
}

Object.assign(window, { Panel, PixelButton, StatRow, Portrait, Die, Token, Money, Glyph });
