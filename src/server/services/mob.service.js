'use strict';

// ---- Mob service ------------------------------------------------------------
// Server-authoritative combat mobs. Exactly ONE mob is alive at a time (the
// coin model, but it moves): the server picks a mob by WEIGHTED random from the
// scene's spawners, runs its AI here every tick, and broadcasts its position so
// viewer.html AND overlay.html render the same creature in the same place. When
// it dies (a player punched it to death) the server picks the next one.
//
// Only the geometry/tuning the SERVER needs lives here — no sprites. The client
// (public/js/game/mobs.js) mirrors the type ids and renders them.

const fs = require('fs');
const { SCENE_PATH } = require('../config/paths');
const { WORLD_WIDTH, WORLD_HEIGHT } = require('../config/gameConfig');
// Shared navigation + AI brain (identical logic runs in the browser Test Draft).
const MobNav = require('../../../public/js/game/mobNav.js');

// Per-type tuning. Keep ids AND numbers in sync with the client MOB_TYPES in
// public/js/game/mobs.js. These are the physics/combat/AI numbers only; the
// client owns how each looks. `jumpSpeed`/`airSpeed` feed the navigation graph:
// how high the mob can jump and how fast it steers in the air.
const MOB_TYPES = {
  slime: {
    width: 30, height: 24,
    patrolSpeed: 42, chaseSpeed: 66,
    detectRange: 160, attackRange: 46, attackHitRange: 56,
    damage: 1, knockbackX: 165, knockbackY: 190,
    health: 3, gravity: 900, maxFall: 720,
    jumpSpeed: 430, airSpeed: 120,
  },
  water: {
    width: 30, height: 24,
    patrolSpeed: 40, chaseSpeed: 62,
    detectRange: 175, attackRange: 48, attackHitRange: 60,
    damage: 1, knockbackX: 330, knockbackY: 330,   // hits like a wave
    health: 3, gravity: 900, maxFall: 720,
    jumpSpeed: 430, airSpeed: 115,
  },
  electric: {
    width: 30, height: 24,
    patrolSpeed: 44, chaseSpeed: 70,
    detectRange: 200, attackRange: 62, attackHitRange: 74,
    damage: 2, knockbackX: 150, knockbackY: 170,
    health: 3, gravity: 900, maxFall: 720,
    jumpSpeed: 450, airSpeed: 130,
    chain: true, chainRadius: 95,                  // arcs to nearby players
    teleport: true, teleportRange: 120, teleportCooldownMs: 4200, teleportMinGap: 70,
  },
  // The devil does NOT swing. It winds up, then RAMS. `damage` is the base the
  // charge multiplies: x1 if you are hit as it sets off, x2 at half speed, x3
  // at full speed (thresholds live in MobNav's AI.CHARGE_*_RATIO). With
  // chargeAccel 340 / chargeSpeed 330 that works out to roughly the first 35 px
  // of the dash for 1, out to ~110 px for 2, and beyond that for 3.
  devil: {
    width: 30, height: 24,
    patrolSpeed: 46, chaseSpeed: 74,
    detectRange: 210, attackRange: 52, attackHitRange: 60,
    damage: 1, knockbackX: 210, knockbackY: 200,
    health: 4, gravity: 900, maxFall: 720,
    jumpSpeed: 440, airSpeed: 135,
    charge: true,
    chargeRange: 200,          // starts a charge from this far away
    chargeWindupMs: 420,       // rooted tell before it sets off
    chargeStartSpeed: 60,      // speed the dash begins at
    chargeSpeed: 330,          // top speed of the dash
    chargeAccel: 340,          // px/s^2 ramp from start speed to top speed
    chargeMaxMs: 1600,         // give up if it connects with nothing
    chargeHitRange: 34,        // contact reach during the dash
    chargeCooldownMs: 2600,
  },
};
// The graph cache keys on type.id, so stamp each type with its own id.
for (const k in MOB_TYPES) MOB_TYPES[k].id = k;
const DEFAULT_MOB_TYPE = 'slime';

// One attack every 3 seconds. Movement is NOT gated by this — a cooling-down
// mob keeps chasing, it just can't swing.
const ATTACK_COOLDOWN_MS = 3000;
const ATTACK_DURATION_MS = 640;   // matches the client's 10-frame attack clip
const ATTACK_HIT_AT = 0.45;       // fraction through the swing where it lands
const RESPAWN_DELAY_MS = 3000;    // after a death, before the next mob appears

// Recoil applied to the mob when a player's swing lands (kept in sync with the
// client local sim in public/js/game/mobs.js). The AI is staggered for
// MOB_STAGGER_MS so it rides the knockback out instead of instantly re-closing.
const MOB_HIT_KB_X = 190;
const MOB_HIT_KB_Y = 240;
const MOB_STAGGER_MS = 360;

// Knock the mob away from an attacker swinging in `dir`. Broadcast happens on
// the next mob tick (the loop always emits mob-move), so all clients see it.
function knockbackMob(mob, dir, now) {
  MobNav.hitKnockback(mob, dir >= 0 ? 1 : -1, now, MOB_HIT_KB_X, MOB_HIT_KB_Y, MOB_STAGGER_MS);
}

// ---- Scene geometry (loaded once at startup) --------------------------------
function loadMobScene() {
  const out = {
    world: { width: WORLD_WIDTH, height: WORLD_HEIGHT },
    boxes: [],
    zones: [],
    spawners: [],
  };
  try {
    const scene = JSON.parse(fs.readFileSync(SCENE_PATH, 'utf8'));
    if (scene && scene.world && Number.isFinite(Number(scene.world.width)) && Number.isFinite(Number(scene.world.height))) {
      out.world = { width: Number(scene.world.width), height: Number(scene.world.height) };
    }
    if (Array.isArray(scene.hitboxes)) {
      out.boxes = scene.hitboxes
        .filter(b => b && Number.isFinite(Number(b.x)) && Number.isFinite(Number(b.y)))
        .map(b => ({ x: +b.x, y: +b.y, width: +b.width || 20, height: +b.height || 20 }));
    }
    if (Array.isArray(scene.mobZones)) {
      out.zones = scene.mobZones
        .filter(z => z && Number.isFinite(Number(z.x)) && Number.isFinite(Number(z.y)))
        .map(z => ({ x: +z.x, y: +z.y, width: Math.max(1, +z.width || 1), height: Math.max(1, +z.height || 1) }));
    }
    if (Array.isArray(scene.spawners)) {
      out.spawners = scene.spawners
        .filter(s => s && Number.isFinite(Number(s.x)) && Number.isFinite(Number(s.y)))
        .map(s => ({
          x: +s.x, y: +s.y, width: Math.max(1, +s.width || 1), height: Math.max(1, +s.height || 1),
          mob: MOB_TYPES[s.mob] ? s.mob : DEFAULT_MOB_TYPE,
          // `chance` is the relative selection WEIGHT (labelled "Weight" in the
          // editor). Damage overrides the type's base if set.
          weight: Math.max(0, Number(s.chance == null ? 100 : s.chance)),
          damage: Number(s.damage) > 0 ? Math.round(Number(s.damage)) : null,
        }));
    }
  } catch (e) {
    console.warn('[mob] could not load mob scene data:', e.message);
  }
  return out;
}

let scene = loadMobScene();
// Bumped on every scene reload so the navigation-graph cache (keyed by version)
// is transparently rebuilt from the new geometry.
let sceneVersion = 1;
console.log(`[mob] loaded ${scene.spawners.length} spawner(s), ${scene.zones.length} zone(s)`);

// The physics/geometry environment a mob is stepped in. Includes the cached
// navigation graph for its type + zone (MobNav caches by version/type/zone, so
// after the first call per scene this is a map lookup — never rebuilt per tick).
function envFor(mob, type) {
  const env = {
    world: scene.world, boxes: scene.boxes, zone: mob.zone || null, version: sceneVersion,
  };
  env.graph = MobNav.buildGraph(env, type);
  return env;
}

function hasSpawners() { return scene.spawners.length > 0; }

function pointInRect(px, py, r) {
  return px >= r.x && px <= r.x + r.width && py >= r.y && py <= r.y + r.height;
}

let mobSerial = 1;

// Weighted-random pick of a spawner, then a mob positioned inside it.
function spawnMob() {
  if (!scene.spawners.length) return null;
  const total = scene.spawners.reduce((a, s) => a + (s.weight > 0 ? s.weight : 0), 0);
  let sp;
  if (total <= 0) {
    sp = scene.spawners[Math.floor(Math.random() * scene.spawners.length)];
  } else {
    let r = Math.random() * total;
    sp = scene.spawners[scene.spawners.length - 1];
    for (const cand of scene.spawners) {
      if (cand.weight <= 0) continue;
      if (r < cand.weight) { sp = cand; break; }
      r -= cand.weight;
    }
  }
  const type = MOB_TYPES[sp.mob] || MOB_TYPES[DEFAULT_MOB_TYPE];
  const cx = sp.x + sp.width / 2, cy = sp.y + sp.height / 2;
  const zone = scene.zones.find(z => pointInRect(cx, cy, z)) || null;
  return {
    id: `m${mobSerial++}`,
    type: sp.mob,
    width: type.width, height: type.height,
    x: sp.x + Math.random() * Math.max(1, sp.width - type.width),
    y: sp.y + Math.random() * Math.max(1, sp.height - type.height),
    vx: 0, vy: 0,
    facing: Math.random() < 0.5 ? -1 : 1,
    onGround: false,
    zone,
    patrolDir: Math.random() < 0.5 ? -1 : 1,
    damage: sp.damage || type.damage,
    health: type.health,
    maxHealth: type.health,
    state: 'idle',
    attacking: false,
    attackStartedAt: 0,
    attackHitDone: false,
    attackReadyAt: 0,
    chargePhase: 0, chargeStartedAt: 0,
    teleportReadyAt: Date.now() + Math.random() * 2000,
  };
}

// The public snapshot broadcast to clients (small — position + state only).
function snapshot(mob) {
  if (!mob) return null;
  return {
    id: mob.id, type: mob.type,
    x: Math.round(mob.x * 10) / 10, y: Math.round(mob.y * 10) / 10,
    facing: mob.facing, state: mob.state,
    health: mob.health, maxHealth: mob.maxHealth,
  };
}

// Player centre + feet points from the server's authoritative player records.
// Players are treated as a 20×20 box here (x+10/y+10 centre), so feet = y+20.
function playerTargets(players) {
  const out = [];
  for (const id in players) {
    const p = players[id];
    if (!p || p.invisible) continue;
    out.push({ id, cx: p.x + 10, cy: p.y + 10, feetY: p.y + 20 });
  }
  return out;
}

// Advance one mob by dt seconds. Returns an array of hit events:
// { playerId, damage, knockbackX, knockbackY, srcX, chained }.
//
// All the actual thinking (patrol/idle, wall pause+turn, target persistence,
// platform pathfinding, jump/drop trajectories, vertical-aware attacks and the
// electric blink) lives in the shared MobNav brain so the browser Test Draft
// behaves the same. We only translate its result into server hit events.
function stepMob(mob, players, dt, now) {
  const type = MOB_TYPES[mob.type] || MOB_TYPES[DEFAULT_MOB_TYPE];
  const targets = playerTargets(players);
  const env = envFor(mob, type);
  const res = MobNav.stepMob(mob, env, {
    type, targets, now, dt,
    attackDurationMs: ATTACK_DURATION_MS,
    attackHitAt: ATTACK_HIT_AT,
    attackCooldownMs: ATTACK_COOLDOWN_MS,
  });
  // MobNav reports hits with `targetId`; the socket handler emits by playerId.
  return res.hits.map(h => ({
    playerId: h.targetId,
    damage: h.damage,
    knockbackX: h.knockbackX, knockbackY: h.knockbackY,
    srcX: h.srcX, chained: h.chained,
  }));
}

module.exports = {
  MOB_TYPES,
  ATTACK_COOLDOWN_MS,
  RESPAWN_DELAY_MS,
  loadMobScene,
  hasSpawners,
  spawnMob,
  stepMob,
  knockbackMob,
  snapshot,
  reload() {
    scene = loadMobScene();
    // New geometry → rebuild navigation from the fresh hitboxes.
    sceneVersion++;
    MobNav.invalidate();
    return scene;
  },
};
