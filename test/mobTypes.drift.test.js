'use strict';

// ---- Server/client mob type drift -------------------------------------------
// The mob AI runs on the SERVER (src/server/services/mob.service.js) but is
// RENDERED by the client (public/js/game/mobs.js and public/js/overlay/mobs.js),
// and the two keep separate copies of the type table. gameConfig.js documents
// this duplication as intentional, but nothing enforced it.
//
// Drift in the ids is the dangerous case: the server spawns a type the client
// has never heard of and the mob simply fails to render, or renders as the
// wrong creature, for every player at once.
//
// The client files are classic scripts with no exports, so the ids are read
// straight out of the source rather than by requiring them. Only the KEYS are
// parsed — simple identifiers — which keeps this robust. The numeric tuning is
// still duplicated by hand; see HARDENING_PLAN.md item T4.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

/** Pull the top-level keys out of a `const <tableName> = { ... }` declaration. */
function mobTypeIdsFrom(file, tableName) {
  const src = fs.readFileSync(path.join(ROOT, file), 'utf8');
  const start = src.search(new RegExp('const\\s+' + tableName + '\\s*=\\s*\\{'));
  assert.notStrictEqual(start, -1, `${tableName} not found in ${file}`);

  // Walk braces from the opening one to find the matching close, so nested
  // per-type objects don't end the scan early.
  const open = src.indexOf('{', start);
  let depth = 0;
  let end = -1;
  for (let i = open; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') {
      depth--;
      if (depth === 0) { end = i; break; }
    }
  }
  assert.notStrictEqual(end, -1, `unbalanced braces in ${file}`);

  const body = src.slice(open + 1, end);
  const ids = new Set();
  let depth2 = 0;
  for (const line of body.split(/\r?\n/)) {
    // Only keys at nesting depth 0 within the table are type ids.
    if (depth2 === 0) {
      const m = /^\s*([A-Za-z_$][\w$]*)\s*:\s*\{/.exec(line);
      if (m) ids.add(m[1]);
    }
    for (const ch of line) {
      if (ch === '{') depth2++;
      else if (ch === '}') depth2--;
    }
  }
  return ids;
}

test('every mob type the server can spawn is renderable by the game client', () => {
  const serverTypes = new Set(
    Object.keys(require('../src/server/services/mob.service').MOB_TYPES)
  );
  const clientTypes = mobTypeIdsFrom('public/js/game/mobs.js', 'MOB_TYPES');

  assert.ok(serverTypes.size > 0, 'server should define at least one mob type');

  const missing = [...serverTypes].filter((id) => !clientTypes.has(id));
  assert.deepStrictEqual(
    missing,
    [],
    `server can spawn mob types the game client cannot render: ${missing.join(', ')}`
  );
});

test('every mob type the server can spawn is renderable by the stream overlay', () => {
  const serverTypes = new Set(
    Object.keys(require('../src/server/services/mob.service').MOB_TYPES)
  );
  const overlayTypes = mobTypeIdsFrom('public/js/overlay/mobs.js', 'OVERLAY_MOB_TYPES');

  const missing = [...serverTypes].filter((id) => !overlayTypes.has(id));
  assert.deepStrictEqual(
    missing,
    [],
    `server can spawn mob types the overlay cannot render: ${missing.join(', ')}`
  );
});
