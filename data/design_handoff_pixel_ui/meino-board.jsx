// Meinopoly — board grid + tiles
const { useState: useStateB } = React;

function tileGlyph(type) {
  switch (type) {
    case 'go': return 'arrow';
    case 'chance': return 'q';
    case 'community': return 'chest';
    case 'tax': return 'coin';
    case 'railroad': return 'rail';
    case 'utility': return 'bolt';
    case 'jail': return 'bars';
    case 'goToJail': return 'cuff';
    case 'parking': return 'park';
    default: return null;
  }
}

function BoardTile({ space, owner, level, players, onClick }) {
  const edge = boardEdge(space.id);
  const isCorner = edge === 'corner';
  const groupColor = space.group ? GROUP_COLORS[space.group] : null;
  const g = tileGlyph(space.type);

  const tokens = players.filter(p => p.pos === space.id);

  const barClass = `tile__bar tile__bar--${edge}`;

  return (
    <div
      className={`tile tile--${edge} ${isCorner ? 'tile--corner' : ''} ${owner ? 'tile--owned' : ''} ${onClick ? 'tile--click' : ''}`}
      style={{ gridRow: boardGridPos(space.id).r, gridColumn: boardGridPos(space.id).c }}
      onClick={onClick ? () => onClick(space) : null}
    >
      {groupColor && <div className={barClass} style={{ background: groupColor }} />}
      <div className="tile__inner">
        {g && <span className={`glyph glyph--${g}`} />}
        <span className="tile__name">{space.name}</span>
        {space.price > 0 && <span className="tile__price">${space.price}</span>}
      </div>
      {owner && (
        <div className="tile__owner" style={{ '--ocol': owner }}>
          {Array.from({ length: level || 1 }).map((_, i) => <span key={i} className="tile__house" />)}
        </div>
      )}
      {tokens.length > 0 && (
        <div className="tile__tokens">
          {tokens.map(p => <Token key={p.n} color={p.color} n={p.n} small />)}
        </div>
      )}
    </div>
  );
}

function Board({ players, owned = {}, onTileClick, season = 'Summer', seasonTurn = 1, children, compact }) {
  return (
    <div className={`board ${compact ? 'board--compact' : ''}`}>
      <div className="board__grid">
        {BOARD_SPACES.map(sp => (
          <BoardTile
            key={sp.id}
            space={sp}
            owner={owned[sp.id] ? owned[sp.id].color : null}
            level={owned[sp.id] ? owned[sp.id].level : 0}
            players={players}
            onClick={onTileClick}
          />
        ))}
        <div className="board__center">
          <div className="board__logo">
            <span className="board__logo-main">MEINOPOLY</span>
            <span className="board__logo-sub">DOMINION · COUNCIL OF WORLDS</span>
          </div>
          <div className="board__season">
            <span className="board__season-label">SEASON</span>
            <span className="board__season-val">{season}</span>
            <span className="board__season-turns">Cycle {seasonTurn}/10</span>
          </div>
          <div className="board__centerslot">{children}</div>
        </div>
      </div>
    </div>
  );
}

Object.assign(window, { Board, BoardTile });
