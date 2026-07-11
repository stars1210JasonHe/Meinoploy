// src/mcp/index.js — the single entry the scoped esm shim loads (Task 1
// bootstrap). Re-exports everything the tool layer needs.
export { createSession, McpToolError } from './session';
export { stateView, stateDigest } from './view';
export { getLegalMoves } from './legal-moves';
export { MOVE_SCHEMAS, EXPECT_REQUIRED } from './move-schemas';
