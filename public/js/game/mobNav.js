/* ============================================================================
 *  mobNav.js — shared mob navigation + AI brain (server AND client).
 *
 *  This module is the SINGLE source of truth for how a combat mob thinks and
 *  moves, so the server-authoritative game (src/server/services/mob.service.js)
 *  and the editor Test Draft local simulation (public/js/game/mobs.js) behave
 *  identically. It is deliberately free of sprites, sockets and DOM: it only
 *  knows geometry, physics and decisions.
 *
 *  It is loaded two ways:
 *    • Node (server):  const MobNav = require('.../mobNav.js')
 *    • Browser:        <script src="/js/game/mobNav.js"></script>  → window.MobNav
 *
 *  What it provides:
 *    • buildGraph(env, type)   — a cached PLATFORM NAVIGATION GRAPH generated
 *                                from the live hitbox geometry (never hardcoded).
 *                                Nodes are exposed, merged, zone-clipped walkable
 *                                surfaces; edges are walk / jump / drop actions
 *                                proven reachable by trajectory simulation using
 *                                the mob's real gravity/jump/air-speed. Takeoff
 *                                points are SOLVED ballistically rather than
 *                                sampled blindly, so the narrow launch windows
 *                                that are often the only way onto a small ledge
 *                                are actually found.
 *    • findRoute(graph, a, b, approach)
 *                              — A* across that graph. With `approach`, an
 *                                unreachable goal returns the route to the best
 *                                surface that WAS reachable instead of nothing.
 *    • stepMob(mob, env, opts) — one AI+physics tick. Mutates the mob and returns
 *                                { hits, attack, fx, blinked } for the caller to
 *                                turn into damage/FX/broadcasts on its own side.
 *
 *  A mob is never allowed to simply stop under a player it cannot reach. If the
 *  graph has no proven route it falls back, in order, to a partial route that
 *  gains height, to improvised jumps simulated live from where it stands, and
 *  finally to walking its platform hunting a takeoff that works.
 *
 *  Everything is tuned around the server's 40 ms / 25 Hz tick so the same maths
 *  produce the same arcs on both ends.
 * ==========================================================================*/
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.MobNav = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ---- Behaviour tuning (shared so server & client can never drift) ---------
  const AI = {
    STOP_DISTANCE: 30,        // stop this far (horizontally) from the player centre
    FACING_DEADZONE: 12,      // don't flip facing for wobble smaller than this
    ATTACK_VERTICAL_TOL: 34,  // player must be within this |dy| to be attackable
    ARRIVE_X: 0.75,           // px tolerance for standing ON a takeoff point.
                              // Deliberately tiny: some of the only ways up a
                              // level are windows a couple of pixels wide, where
                              // launching six pixels early clips a ceiling
                              // instead of clearing it. The approach eases onto
                              // the exact spot rather than charging past it.

    IDLE_MIN_MS: 3000,        // random patrol idle length
    IDLE_MAX_MS: 6000,
    IDLE_GAP_MIN_MS: 7000,    // time between random idles
    IDLE_GAP_MAX_MS: 15000,

    BLOCK_PAUSE_MIN_MS: 2000, // pause after hitting a wall / edge before turning
    BLOCK_PAUSE_MAX_MS: 3500,
    BLOCK_WALKAWAY_MS: 1300,  // walk away from the obstacle for this long

    LOSE_TARGET_MULT: 1.8,    // keep a target out to detectRange * this
    LOSE_TARGET_ROUTE_MULT: 4,// ...but this much while committed to a route, because
                              // the way up is often a long walk AWAY from the player
    REPATH_MS: 900,           // periodic repath while chasing
    STUCK_MS: 650,            // grounded + trying to move + no progress = stuck
    STUCK_EPS: 3,             // px of progress that counts as "moving"

    // Reaching a player who is NOT on a surface we have a proven route to.
    GOAL_COLUMN_TOL: 12,      // px of slack when looking for the surface under a player
    GOAL_HEIGHT_WEIGHT: 1.7,  // height matters more than distance when judging a platform
    APPROACH_MIN_GAIN: 24,    // a partial route must close this much distance to be worth it
    CLIMB_MIN_RISE: 18,       // player must be this far above our feet to count as "above us"
    HOP_RETRY_MS: 400,        // gap between improvised (non-graph) jump attempts
    HOP_MIN_GAIN: 18,         // an improvised jump must improve our position by this much
    PROBE_FLIP_MS: 900,       // how long to hunt for a takeoff in one direction

    STAGGER_MS: 360,          // after a hit, the mob is staggered (no steering) this long
    STAGGER_FRICTION: 700,    // ground friction that slows the knockback slide

    // Charge attack (the devil type). The dash's damage scales with how fast
    // the mob is travelling when it connects, so these thresholds ARE the
    // 1 / 2 / 3 damage tiers: below half speed it is a shove, at half speed it
    // hurts, at (near) full speed it is a full-force ram.
    CHARGE_HALF_RATIO: 0.45,  // >= this fraction of top speed -> 2x damage
    CHARGE_FULL_RATIO: 0.82,  // >= this fraction of top speed -> 3x damage
  };

  const TICK = 0.04;          // physics timestep the graph is simulated at (25 Hz)
  const SIM_MAX_STEPS = 140;  // ~5.6 s cap per trajectory
  const SURF_TOL = 5;         // px: feet-to-surface tolerance for "standing on"
  const MIN_SURFACE_W = 10;   // ignore surfaces too thin to stand on

  // ---------------------------------------------------------------------------
  //  Interval helpers
  // ---------------------------------------------------------------------------
  function mergeIntervals(list, gap) {
    if (!list.length) return [];
    const s = list.slice().sort((a, b) => a[0] - b[0]);
    const out = [s[0].slice()];
    for (let i = 1; i < s.length; i++) {
      const cur = out[out.length - 1];
      if (s[i][0] <= cur[1] + gap) cur[1] = Math.max(cur[1], s[i][1]);
      else out.push(s[i].slice());
    }
    return out;
  }
  // Remove every `holes` interval from [a,b], returning the surviving pieces.
  function subtractIntervals(a, b, holes) {
    let pieces = [[a, b]];
    for (const h of holes) {
      const next = [];
      for (const [x1, x2] of pieces) {
        if (h[1] <= x1 || h[0] >= x2) { next.push([x1, x2]); continue; }
        if (h[0] > x1) next.push([x1, Math.min(h[0], x2)]);
        if (h[1] < x2) next.push([Math.max(h[1], x1), x2]);
      }
      pieces = next;
    }
    return pieces;
  }

  // ---------------------------------------------------------------------------
  //  Surface detection — the walkable nodes of the graph.
  //
  //  Every solid hitbox exposes its TOP edge; the world floor is a surface too.
  //  Tops at the same height are merged into continuous platforms, then the
  //  portions buried under another box are subtracted, then everything is
  //  clipped to the mob's zone (mobZones confine horizontally).
  // ---------------------------------------------------------------------------
  function buildSurfaces(env, mob) {
    const { world, boxes, zone } = env;
    const raw = [];
    for (const b of boxes) raw.push({ y: b.y, x1: b.x, x2: b.x + b.width });
    raw.push({ y: world.height, x1: 0, x2: world.width, floor: true });

    // Group tops by height (integer editor coords group exactly).
    const byY = new Map();
    for (const s of raw) {
      const key = Math.round(s.y);
      if (!byY.has(key)) byY.set(key, []);
      byY.get(key).push([s.x1, s.x2]);
    }

    const nodes = [];
    for (const [y, ivals] of byY) {
      for (const [mx1, mx2] of mergeIntervals(ivals, 1)) {
        // Subtract any box that occupies the space just above this top (i.e. a
        // box resting on it or a taller box spanning across it — that portion
        // is buried, its own top is the real surface).
        const holes = [];
        for (const b of boxes) {
          if (b.y < y - 0.5 && b.y + b.height > y - 1 &&
              b.x < mx2 && b.x + b.width > mx1) {
            holes.push([b.x, b.x + b.width]);
          }
        }
        for (const [x1, x2] of subtractIntervals(mx1, mx2, holes)) {
          let a = x1, c = x2;
          if (zone) { a = Math.max(a, zone.x); c = Math.min(c, zone.x + zone.width); }
          if (c - a < MIN_SURFACE_W) continue;
          nodes.push({ y, x1: a, x2: c, cx: (a + c) / 2 });
        }
      }
    }
    return nodes;
  }

  // Which surface node is a body (feet at feetY, centre at cx) standing on?
  function surfaceAt(nodes, cx, feetY) {
    let best = -1, bestDy = SURF_TOL + 0.001;
    for (let i = 0; i < nodes.length; i++) {
      const n = nodes[i];
      if (cx < n.x1 - 2 || cx > n.x2 + 2) continue;
      const dy = Math.abs(feetY - n.y);
      if (dy < bestDy) { bestDy = dy; best = i; }
    }
    return best;
  }

  // ---------------------------------------------------------------------------
  //  Trajectory simulation — the heart of jump/drop edge generation AND of
  //  runtime "can I actually reach that?" checks. Mirrors the mob physics: X
  //  and Y resolved separately against solid boxes, land on tops, bonk
  //  undersides, world floor grounds, zone confines horizontally.
  //
  //  Returns { ok, node, landX } on a clean landing, else { ok:false, why }.
  // ---------------------------------------------------------------------------
  function simulate(env, type, mob, startCx, feetY, vy0, dir, airSpeed, nodes) {
    const { world, boxes, zone } = env;
    const w = mob.width, h = mob.height;
    let x = startCx - w / 2;
    let y = feetY - h;
    let vy = vy0;

    for (let step = 0; step < SIM_MAX_STEPS; step++) {
      vy += type.gravity * TICK;
      if (vy > type.maxFall) vy = type.maxFall;

      // ---- X integrate + wall check ----
      const prevX = x;
      x += dir * airSpeed * TICK;
      if (x < 0 || x + w > world.width) return { ok: false, why: 'world' };
      if (zone && (x < zone.x || x + w > zone.x + zone.width)) return { ok: false, why: 'zone' };
      for (const b of boxes) {
        const vOverlap = y + h > b.y + 2 && y < b.y + b.height;
        if (!vOverlap) continue;
        if (!(x + w > b.x && x < b.x + b.width)) continue;
        if (dir > 0 && prevX + w <= b.x) return { ok: false, why: 'wall' };
        if (dir < 0 && prevX >= b.x + b.width) return { ok: false, why: 'wall' };
        // grazing a box we're already level with: treat as a wall too.
        return { ok: false, why: 'wall' };
      }

      // ---- Y integrate + land / ceiling check ----
      const prevY = y;
      y += vy * TICK;
      for (const b of boxes) {
        if (!(x + w > b.x && x < b.x + b.width)) continue;
        if (vy >= 0 && prevY + h <= b.y && y + h >= b.y) {
          const cx = x + w / 2;
          const idx = surfaceAt(nodes, cx, b.y);
          if (idx < 0) return { ok: false, why: 'buried' };
          return { ok: true, node: idx, landX: cx };
        }
        if (vy < 0 && prevY >= b.y + b.height && y < b.y + b.height) {
          return { ok: false, why: 'ceiling' };
        }
      }
      if (y + h >= world.height) {
        const cx = x + w / 2;
        const idx = surfaceAt(nodes, cx, world.height);
        if (idx < 0) return { ok: false, why: 'buried' };
        return { ok: true, node: idx, landX: cx };
      }
    }
    return { ok: false, why: 'timeout' };
  }

  // ---------------------------------------------------------------------------
  //  Ballistic takeoff solving.
  //
  //  Sampling a platform on a fixed stride finds almost nothing on a big map:
  //  landing on a 40 px ledge from a 2700 px floor needs a takeoff inside a
  //  window a few px wide, and a coarse stride steps straight over it. Because
  //  the jump speed and the air speed are both FIXED, the flight time to a
  //  given height is closed form, so the takeoff that lands on a chosen point
  //  is simply `landX - dir * airSpeed * t`. We solve that for every other
  //  surface and hand the answers to the same simulation as any other
  //  candidate — the maths only decides where to LOOK, walls and ceilings still
  //  get the final say.
  //
  //  Returns the time at which a jump from `y0` is falling back through
  //  `yTarget` (the descending root — the only one a landing can happen on),
  //  or -1 when the apex never gets that high.
  // ---------------------------------------------------------------------------
  function flightTime(type, y0, yTarget) {
    const g = type.gravity, jv = type.jumpSpeed;
    const disc = jv * jv - 2 * g * (y0 - yTarget);
    if (disc < 0) return -1;
    return (jv + Math.sqrt(disc)) / g;
  }

  // Takeoff points on `s` whose arc is predicted to land on some other surface.
  // The predicted x is offset by a small spread because the live physics is a
  // discrete 25 Hz integrator with a fall-speed clamp, so the closed-form arc
  // is close but not exact.
  const SEED_SPREAD = [0, -7, 7, -15, 15];
  function seedTakeoffs(type, mob, nodes, si) {
    const s = nodes[si], air = type.airSpeed, half = mob.width / 2;
    const seen = new Set(), seeds = [];
    for (let j = 0; j < nodes.length; j++) {
      if (j === si) continue;
      const n2 = nodes[j];
      const t = flightTime(type, s.y, n2.y);
      if (t <= 0 || t > SIM_MAX_STEPS * TICK) continue;
      const reach = air * t;
      // Aim at both usable ends and the middle of the target surface.
      const landXs = [n2.x1 + half + 1, (n2.x1 + n2.x2) / 2, n2.x2 - half - 1];
      for (const lx of landXs) {
        if (lx < n2.x1 || lx > n2.x2) continue;
        for (let d = 0; d < 2; d++) {
          const dir = d ? 1 : -1;
          for (const off of SEED_SPREAD) {
            const tx = lx - dir * reach + off;
            if (tx < s.x1 - 2 || tx > s.x2 + 2) continue;
            const x = Math.max(s.x1, Math.min(s.x2, tx));
            const key = dir + ':' + Math.round(x / 2);
            if (seen.has(key)) continue;
            seen.add(key);
            seeds.push({ x, dir });
          }
        }
      }
    }
    return seeds;
  }

  // ---------------------------------------------------------------------------
  //  Edge generation — for every pair of surfaces, prove (by simulation) which
  //  jumps and drops are physically possible and record the useful details.
  // ---------------------------------------------------------------------------
  function buildEdges(env, type, mob, nodes) {
    const edges = nodes.map(() => []);
    const consider = (from, res, kind, takeoffX, dir, airSpeed) => {
      if (!res.ok || res.node === from) return;
      const to = res.node, n = nodes[to];
      const cost = Math.abs(nodes[from].cx - nodes[to].cx) +
        Math.abs(nodes[from].y - nodes[to].y) +
        (kind === 'jump' ? 40 : kind === 'drop' ? 12 : 0);
      // Two takeoffs that both reach the same platform are NOT equally good: the
      // live mob leaves from within ARRIVE_X of the planned spot, so an arc that
      // clips the lip of a narrow ledge turns into a miss and a fall. Record how
      // much room the landing has to spare and keep the roomiest one.
      const margin = Math.min(res.landX - n.x1, n.x2 - res.landX);
      const existing = edges[from].find(e => e.to === to);
      if (existing) {
        if (existing.cost < cost) return;
        if (existing.cost === cost && existing.margin >= margin) return;
        Object.assign(existing, { kind, takeoffX, dir, airSpeed, landX: res.landX, cost, margin });
        return;
      }
      edges[from].push({ to, kind, takeoffX, dir, airSpeed, landX: res.landX, cost, margin });
    };

    const air = type.airSpeed, jv = type.jumpSpeed;
    for (let i = 0; i < nodes.length; i++) {
      const s = nodes[i];
      // Sample takeoff points ALONG the surface (both launch directions). A mob
      // can only steer at a fixed air speed, so a near-vertical hop onto a small
      // ledge is only found by launching from the spot whose horizontal drift
      // lands on it — sampling the surface is what discovers those takeoffs.
      const stepX = Math.max(14, (s.x2 - s.x1) / 40);
      const xs = [];
      for (let x = s.x1; x <= s.x2; x += stepX) xs.push(x);
      if (xs[xs.length - 1] !== s.x2) xs.push(s.x2);

      for (const x of xs) {
        consider(i, simulate(env, type, mob, x, s.y, -jv, -1, air, nodes), 'jump', x, -1, air);
        consider(i, simulate(env, type, mob, x, s.y, -jv, 1, air, nodes), 'jump', x, 1, air);
      }

      // Then the solved takeoffs — these are what actually connect a long floor
      // to the small ledges above it, which blind sampling almost always misses.
      for (const seed of seedTakeoffs(type, mob, nodes, i)) {
        consider(i, simulate(env, type, mob, seed.x, s.y, -jv, seed.dir, air, nodes),
                 'jump', seed.x, seed.dir, air);
      }

      // Deliberate walk-off drops leave from the two edges only (start just past
      // the lip so the body actually clears the platform instead of re-landing).
      const offL = s.x1 - mob.width / 2, offR = s.x2 + mob.width / 2;
      consider(i, simulate(env, type, mob, offL, s.y, 0, -1, air, nodes), 'drop', s.x1, -1, air);
      consider(i, simulate(env, type, mob, offR, s.y, 0, 1, air, nodes), 'drop', s.x2, 1, air);
    }
    return edges;
  }

  // ---------------------------------------------------------------------------
  //  Graph build + cache. Keyed by (version, type id, zone) so it is generated
  //  once per scene/type/zone and reused — never rebuilt every tick.
  // ---------------------------------------------------------------------------
  const graphCache = new Map();
  function zoneKey(z) { return z ? `${z.x},${z.y},${z.width},${z.height}` : 'none'; }

  function buildGraph(env, type) {
    const key = `${env.version || 0}|${type.id || type.name || 'mob'}|${zoneKey(env.zone)}`;
    const cached = graphCache.get(key);
    if (cached) return cached;
    const mob = { width: type.width, height: type.height };
    const nodes = buildSurfaces(env, mob);
    const edges = buildEdges(env, type, mob, nodes);
    const graph = { nodes, edges, key };
    graphCache.set(key, graph);
    return graph;
  }
  function invalidate() { graphCache.clear(); }

  // ---------------------------------------------------------------------------
  //  A* over the platform graph. Returns an array of edge steps, or null.
  //
  //  With `approach` set, an unreachable goal no longer means "give up": we keep
  //  the best surface the search DID settle on and return the route there. That
  //  is what stops a mob planting itself on the floor when the player is on a
  //  ledge it can only get halfway up — it climbs as far as the geometry allows
  //  and re-plans from the new vantage point, which is usually enough.
  // ---------------------------------------------------------------------------
  function findRoute(graph, start, goal, approach) {
    if (start < 0 || goal < 0) return null;
    if (start === goal) return [];
    const { nodes, edges } = graph;
    const H = (i) => Math.abs(nodes[i].cx - nodes[goal].cx) + Math.abs(nodes[i].y - nodes[goal].y);
    const g = new Array(nodes.length).fill(Infinity);
    const came = new Array(nodes.length).fill(null);
    g[start] = 0;
    const open = [start];
    const inOpen = new Set([start]);
    const trace = (end) => {
      const path = [];
      let n = end;
      while (came[n]) { path.unshift(came[n].edge); n = came[n].from; }
      return path;
    };
    // Best fallback so far. Seeded with where we already stand, so a partial
    // route is only ever returned when it genuinely gains ground.
    let bestNode = -1, bestH = H(start);
    while (open.length) {
      // pick lowest f (small graphs — linear scan is fine)
      let bi = 0, bf = Infinity;
      for (let k = 0; k < open.length; k++) { const f = g[open[k]] + H(open[k]); if (f < bf) { bf = f; bi = k; } }
      const cur = open.splice(bi, 1)[0];
      inOpen.delete(cur);
      if (cur === goal) return trace(goal);
      const h = H(cur);
      if (h < bestH - AI.APPROACH_MIN_GAIN) { bestH = h; bestNode = cur; }
      for (const e of edges[cur]) {
        const ng = g[cur] + e.cost;
        if (ng < g[e.to]) {
          g[e.to] = ng;
          came[e.to] = { from: cur, edge: e };
          if (!inOpen.has(e.to)) { open.push(e.to); inOpen.add(e.to); }
        }
      }
    }
    if (approach && bestNode >= 0) return trace(bestNode);
    return null;
  }

  // ---------------------------------------------------------------------------
  //  Goal resolution — "which platform is the player on?"
  //
  //  surfaceAt() only answers when the player's feet rest exactly on a known
  //  surface. A player who is mid-jump, standing on geometry too thin to be a
  //  node, or on a platform clipped out of this mob's zone used to resolve to
  //  -1 — and a -1 goal was precisely what made a mob abandon the chase and
  //  stand around underneath. So we degrade instead of failing:
  //    1. the surface directly under their feet,
  //    2. the first surface BELOW them in their own column (where a jumping
  //       player is about to land, or the platform holding a thin ledge),
  //    3. the nearest surface anywhere, height weighted so "the block they are
  //       on" beats "the floor a long way below them".
  // ---------------------------------------------------------------------------
  function resolveGoalNode(graph, goalCx, goalFeet) {
    const nodes = graph.nodes;
    if (!nodes.length) return -1;

    const exact = surfaceAt(nodes, goalCx, goalFeet);
    if (exact >= 0) return exact;

    let below = -1, belowDy = Infinity;
    for (let i = 0; i < nodes.length; i++) {
      const n = nodes[i];
      if (goalCx < n.x1 - AI.GOAL_COLUMN_TOL || goalCx > n.x2 + AI.GOAL_COLUMN_TOL) continue;
      const dy = n.y - goalFeet;
      if (dy < -SURF_TOL) continue;            // above their feet: not somewhere they can land
      if (dy < belowDy) { belowDy = dy; below = i; }
    }
    if (below >= 0) return below;

    let best = -1, bestD = Infinity;
    for (let i = 0; i < nodes.length; i++) {
      const d = goalScore(nodes[i], goalCx, goalFeet);
      if (d < bestD) { bestD = d; best = i; }
    }
    return best;
  }

  // How good a surface is as a place to stand, judged against the player.
  // Height is weighted so being ON their ledge always beats being under it.
  function goalScore(node, goalCx, goalFeet) {
    const dx = goalCx < node.x1 ? node.x1 - goalCx : goalCx > node.x2 ? goalCx - node.x2 : 0;
    return dx + Math.abs(node.y - goalFeet) * AI.GOAL_HEIGHT_WEIGHT;
  }

  // ---------------------------------------------------------------------------
  //  Runtime physics — identical integration used by both ends so the live mob
  //  moves exactly like the simulated trajectories that planned its route.
  // ---------------------------------------------------------------------------
  function resolveX(mob, env, prevX) {
    const z = mob.zone;
    mob.hitWall = 0;
    if (z) {
      if (mob.x < z.x) { mob.x = z.x; mob.hitWall = 1; }
      else if (mob.x + mob.width > z.x + z.width) { mob.x = z.x + z.width - mob.width; mob.hitWall = -1; }
    }
    if (mob.x < 0) { mob.x = 0; mob.hitWall = 1; }
    else if (mob.x + mob.width > env.world.width) { mob.x = env.world.width - mob.width; mob.hitWall = -1; }
    for (const b of env.boxes) {
      const vOverlap = mob.y + mob.height > b.y + 2 && mob.y < b.y + b.height;
      if (!vOverlap) continue;
      if (!(mob.x + mob.width > b.x && mob.x < b.x + b.width)) continue;
      if (prevX + mob.width <= b.x) { mob.x = b.x - mob.width; mob.hitWall = -1; }
      else if (prevX >= b.x + b.width) { mob.x = b.x + b.width; mob.hitWall = 1; }
      if (mob.onGround) mob.vx = 0;
    }
  }
  function resolveY(mob, env, prevY) {
    for (const b of env.boxes) {
      const hOverlap = mob.x + mob.width > b.x && mob.x < b.x + b.width;
      if (!hOverlap) continue;
      const wasAbove = prevY + mob.height <= b.y;
      if (mob.vy >= 0 && wasAbove && mob.y + mob.height >= b.y) { mob.y = b.y - mob.height; mob.vy = 0; mob.onGround = true; }
      else if (mob.vy < 0 && prevY >= b.y + b.height && mob.y < b.y + b.height) { mob.y = b.y + b.height; mob.vy = 10; }
    }
    if (mob.y + mob.height >= env.world.height) { mob.y = env.world.height - mob.height; mob.vy = 0; mob.onGround = true; }
  }
  function applyGravity(mob, env, type) {
    mob.vy = (mob.vy || 0) + type.gravity * mob._dt;
    if (mob.vy > type.maxFall) mob.vy = type.maxFall;
    const prevY = mob.y;
    mob.y += mob.vy * mob._dt;
    mob.onGround = false;
    resolveY(mob, env, prevY);
  }
  function integrateX(mob, env) {
    const prevX = mob.x;
    mob.x += mob.vx * mob._dt;
    resolveX(mob, env, prevX);
  }

  // ---------------------------------------------------------------------------
  //  Navigation state lives on the mob under `mob.nav` (lazily created).
  // ---------------------------------------------------------------------------
  function nav(mob, now) {
    if (!mob.nav) {
      mob.nav = {
        targetId: null, targetLostAt: 0,
        route: null, step: 0, goalNode: -1,
        repathAt: 0, airDir: 0, airSpeed: 0, airborne: false,
        stuckX: mob.x, stuckAt: now,
        idleUntil: 0, nextIdleAt: now + rand(AI.IDLE_GAP_MIN_MS, AI.IDLE_GAP_MAX_MS),
        blockUntil: 0, walkAwayUntil: 0,
        hopAt: 0, probeDir: 0, probeFlipAt: 0, dropping: false,
      };
    }
    return mob.nav;
  }
  function rand(a, b) { return a + Math.random() * (b - a); }

  // ---------------------------------------------------------------------------
  //  stepMob — one full AI + physics tick. Mutates `mob`; returns side effects.
  //    env  = { world, boxes, zone, graph, version }
  //    opts = { type, targets:[{id,cx,cy,local?}], now, dt }
  // ---------------------------------------------------------------------------
  function stepMob(mob, env, opts) {
    const { type, targets, now, dt } = opts;
    mob._dt = dt;
    const graph = env.graph;
    const st = nav(mob, now);
    const out = { hits: [], attack: null, fx: [], blinked: false };

    const mcx = mob.x + mob.width / 2, mcy = mob.y + mob.height / 2;
    const feetY = mob.y + mob.height;

    // ---- Knocked back: ride out the hit's momentum, no AI steering ----------
    // A player's swing sets vx/vy + staggerUntil (see hitKnockback). We keep
    // that velocity so the recoil is visible; on the ground friction slides it
    // to a stop instead of the AI instantly re-accelerating into the player.
    if (mob.staggerUntil && now < mob.staggerUntil) {
      if (mob.onGround) {
        const dec = AI.STAGGER_FRICTION * dt;
        if (mob.vx > 0) mob.vx = Math.max(0, mob.vx - dec);
        else if (mob.vx < 0) mob.vx = Math.min(0, mob.vx + dec);
      }
      finish(mob, env, type);
      mob.state = 'walk';
      return out;
    }

    // ---- Attack in progress: committed, rooted -------------------------------
    if (mob.attacking) {
      const elapsed = now - mob.attackStartedAt;
      if (!mob.attackHitDone && elapsed >= opts.attackDurationMs * opts.attackHitAt) {
        mob.attackHitDone = true;
        resolveAttack(mob, type, targets, out);
      }
      if (elapsed >= opts.attackDurationMs) { mob.attacking = false; mob.attackReadyAt = now + opts.attackCooldownMs; }
      mob.vx = 0;
      applyGravity(mob, env, type);
      mob.state = 'attack';
      return out;
    }

    // ---- Charge in progress: committed wind-up + dash ------------------------
    if (mob.chargePhase) {
      stepCharge(mob, env, type, targets, now, opts, out);
      return out;
    }

    // ---- Target acquisition with persistence ---------------------------------
    let target = null;
    if (st.targetId != null) {
      target = targets.find(t => t.id === st.targetId) || null;
      if (target) {
        // A climb usually starts by walking away from the player to reach a
        // takeoff point. Dropping the target halfway there is what turns a
        // perfectly good route into a mob wandering off, so while a route is in
        // flight we hold on much longer. Arriving ends the route, and the normal
        // radius takes over again.
        const routing = !!(st.route && st.route.length);
        const mult = routing ? AI.LOSE_TARGET_ROUTE_MULT : AI.LOSE_TARGET_MULT;
        const d = Math.hypot(target.cx - mcx, target.cy - mcy);
        if (d > type.detectRange * mult) target = null;
      }
    }
    if (!target) {
      let near = null, nd = Infinity;
      for (const t of targets) { const d = Math.hypot(t.cx - mcx, t.cy - mcy); if (d < nd) { nd = d; near = t; } }
      if (near && nd <= type.detectRange) { target = near; st.route = null; }
    }
    st.targetId = target ? target.id : null;
    const chasing = !!target;

    // ---- Airborne: preserve the planned trajectory, never re-steer -----------
    if (!mob.onGround) {
      if (st.airborne) mob.vx = st.airDir * st.airSpeed;
      if (st.dropping) {                       // the walk-off finally cleared the lip
        st.dropping = false;
        if (st.route) { st.step++; if (st.step >= st.route.length) st.route = null; }
      }
      integrateX(mob, env);
      applyGravity(mob, env, type);
      mob.state = 'walk';
      if (mob.onGround) { st.airborne = false; st.repathAt = 0; st.stuckAt = now; st.stuckX = mob.x; }
      // an electric mob may still blink mid-air toward its target
      maybeTeleport(mob, env, type, target, now, out);
      return out;
    }

    // ---- Grounded ------------------------------------------------------------
    const startNode = surfaceAt(graph.nodes, mcx, feetY);

    if (chasing) {
      st.idleUntil = 0; // detecting a player cancels any idle
      st.blockUntil = 0; st.walkAwayUntil = 0;
      st.nextIdleAt = now + rand(AI.IDLE_GAP_MIN_MS, AI.IDLE_GAP_MAX_MS);
      maybeTeleport(mob, env, type, target, now, out);

      // Attack takes priority over movement (needs horizontal AND vertical reach).
      // A charging type never uses the rooted swing — the dash IS its attack.
      if (type.charge) {
        if (shouldCharge(mob, type, target, now)) {
          beginCharge(mob, type, target, now);
          stepCharge(mob, env, type, targets, now, opts, out);
          return out;
        }
      } else if (shouldAttack(mob, type, target, now)) {
        mob.attacking = true; mob.attackStartedAt = now; mob.attackHitDone = false;
        mob.facing = (target.cx - mcx) >= 0 ? 1 : -1;
        mob.vx = 0; mob.state = 'attack';
        return out;
      }

      const goalFeet = Number.isFinite(target.feetY) ? target.feetY : target.cy + type.height / 2;
      // Always resolvable — a player mid-jump or on an unmapped ledge still
      // gives us a platform to head for instead of ending the chase.
      const goalNode = resolveGoalNode(graph, target.cx, goalFeet);

      // Same surface: no climbing needed, just run at them.
      const sameSurface = startNode >= 0 && startNode === goalNode;
      const needRepath = !st.route || now >= st.repathAt || st.goalNode !== goalNode ||
        (startNode >= 0 && st.route.length && st.expectFrom !== startNode);

      if (!sameSurface && goalNode >= 0 && startNode >= 0 && needRepath) {
        // `true` = take a partial route when the player's platform is not fully
        // reachable: get as close/high as the geometry allows, then re-plan.
        st.route = findRoute(graph, startNode, goalNode, true);
        st.step = 0; st.dropping = false; st.goalNode = goalNode; st.expectFrom = startNode;
        st.repathAt = now + AI.REPATH_MS;
      }

      if (!sameSurface && st.route && st.route.length) {
        followRoute(mob, env, type, st, now, out);
        finish(mob, env, type);
        return out;
      }

      // No route the graph can prove. If the player is ABOVE us, standing here
      // is the one thing guaranteed not to work, so improvise: simulate jumps
      // from where we actually stand, and if none of them gain ground, walk the
      // platform hunting a takeoff that does.
      if (!sameSurface && goalFeet < feetY - AI.CLIMB_MIN_RISE) {
        if (tryClimbHop(mob, env, type, graph, target, goalFeet, st, now)) {
          finish(mob, env, type);
          return out;
        }
        probeForTakeoff(mob, type, graph, target, st, now);
        finish(mob, env, type);
        return out;
      }

      // Same surface, or the player is at/below our level → straight chase.
      st.probeDir = 0;
      directChase(mob, type, target);
      if (progressStuck(mob, st, now)) { st.route = null; st.repathAt = 0; }
      finish(mob, env, type);
      return out;
    }

    // ---- Patrol (no target) --------------------------------------------------
    st.route = null; st.goalNode = -1; st.dropping = false; st.probeDir = 0;
    patrol(mob, type, st, now);
    finish(mob, env, type);
    return out;
  }

  // Integrate + resolve X and Y for a grounded decision.
  function finish(mob, env, type) {
    integrateX(mob, env);
    applyGravity(mob, env, type);
  }

  function directChase(mob, type, target) {
    const dx = target.cx - (mob.x + mob.width / 2);
    if (Math.abs(dx) > AI.FACING_DEADZONE) mob.facing = dx >= 0 ? 1 : -1;
    if (Math.abs(dx) > AI.STOP_DISTANCE) {
      mob.vx = mob.facing * type.chaseSpeed;
      mob.state = 'run';
    } else {
      mob.vx = 0;
      mob.state = 'idle';
    }
  }

  function followRoute(mob, env, type, st, now, out) {
    // A DROP is committed by walking off the lip, which takes several ticks with
    // the body still grounded. Re-deciding during them made the mob step back on
    // and jitter on the edge forever, so once a drop is committed we keep
    // pushing the same way until the ground actually runs out.
    if (st.dropping) {
      mob.facing = st.airDir;
      mob.vx = st.airDir * st.airSpeed;
      mob.state = 'walk';
      if (progressStuck(mob, st, now)) { st.dropping = false; st.route = null; st.repathAt = 0; }
      return;
    }

    const step = st.route[st.step];
    if (!step) { st.route = null; return; }
    const mcx = mob.x + mob.width / 2;
    const dx = step.takeoffX - mcx;

    if (Math.abs(dx) > AI.ARRIVE_X) {
      // Walk to the takeoff point, easing over the last stride so we finish
      // standing exactly on it: the planned arc assumes we leave from there, and
      // at full chase speed one tick carries us several px past.
      if (Math.abs(dx) > AI.FACING_DEADZONE) mob.facing = dx >= 0 ? 1 : -1;
      const dir = dx >= 0 ? 1 : -1;   // steer on the true sign, don't flicker facing
      mob.vx = dir * Math.min(type.chaseSpeed, Math.abs(dx) / Math.max(mob._dt, 0.001));
      mob.state = 'run';
      if (progressStuck(mob, st, now)) { st.route = null; st.repathAt = 0; }
      return;
    }

    {
      // Standing on the takeoff point: commit the action, lock the air trajectory.
      st.airDir = step.dir; st.airSpeed = step.airSpeed; st.airborne = true;
      mob.facing = step.dir;
      mob.vx = step.dir * step.airSpeed;
      mob.state = 'walk';
      if (step.kind === 'jump') {
        mob.vy = -type.jumpSpeed; mob.onGround = false;
        // advance the step pointer; landing detection will repath if we miss.
        st.step++;
        if (st.step >= st.route.length) { st.route = null; }
      } else {
        st.dropping = true;   // step forward once we are actually falling
      }
    }
  }

  // ---------------------------------------------------------------------------
  //  Improvised climbing — the runtime counterpart to the pre-built graph.
  //
  //  The graph only knows about surfaces that exist as nodes and edges proven
  //  between them. It cannot help with a player standing on a ledge too small to
  //  be a node, on geometry outside this mob's zone, or hanging in mid-air. So
  //  when there is no route and the player is overhead, the mob jumps for it: a
  //  handful of takeoffs are run through the SAME trajectory simulation the
  //  graph is built from, using this mob's real gravity/jump/air speed, and the
  //  best landing that actually improves its position is committed to. Nothing
  //  is guessed — a jump is only taken once it has been proven to land.
  // ---------------------------------------------------------------------------
  function tryClimbHop(mob, env, type, graph, target, goalFeet, st, now) {
    if (!mob.onGround || now < st.hopAt) return false;
    st.hopAt = now + AI.HOP_RETRY_MS;

    const nodes = graph.nodes;
    if (!nodes.length) return false;
    const mcx = mob.x + mob.width / 2, feetY = mob.y + mob.height;
    const here = surfaceAt(nodes, mcx, feetY);
    const base = here >= 0
      ? goalScore(nodes[here], target.cx, goalFeet)
      : Math.abs(target.cx - mcx) + Math.abs(feetY - goalFeet) * AI.GOAL_HEIGHT_WEIGHT;

    // A short, nearly-vertical hop is what gets a mob onto a block it is already
    // standing against; the faster drifts cover ledges further out. Both
    // directions are tried because the way up is often behind it.
    const air = type.airSpeed;
    const toward = target.cx >= mcx ? 1 : -1;
    const tries = [
      { dir: toward, speed: air },
      { dir: toward, speed: air * 0.55 },
      { dir: toward, speed: air * 0.18 },
      { dir: -toward, speed: air * 0.55 },
      { dir: -toward, speed: air },
    ];

    let best = null, bestScore = base - AI.HOP_MIN_GAIN;
    for (const t of tries) {
      const res = simulate(env, type, mob, mcx, feetY, -type.jumpSpeed, t.dir, t.speed, nodes);
      if (!res.ok || res.node === here) continue;
      const score = goalScore(nodes[res.node], target.cx, goalFeet);
      if (score < bestScore) { bestScore = score; best = t; }
    }
    if (!best) return false;

    st.airborne = true; st.airDir = best.dir; st.airSpeed = best.speed;
    st.route = null; st.repathAt = 0; st.probeDir = 0;
    mob.facing = best.dir;
    mob.vy = -type.jumpSpeed;
    mob.onGround = false;
    mob.vx = best.dir * best.speed;
    mob.state = 'walk';
    return true;
  }

  // Nothing jumpable from this exact spot — so stop standing on it. Close the
  // horizontal gap first (often enough on its own for a route to appear), and
  // once underneath the player sweep along the platform so the next attempt is
  // launched from somewhere new. Turns at the lip so it never sweeps off the edge.
  function probeForTakeoff(mob, type, graph, target, st, now) {
    const mcx = mob.x + mob.width / 2, feetY = mob.y + mob.height;
    const dx = target.cx - mcx;

    if (Math.abs(dx) > AI.STOP_DISTANCE) {
      mob.facing = dx >= 0 ? 1 : -1;
      mob.vx = mob.facing * type.chaseSpeed;
      mob.state = 'run';
      if (progressStuck(mob, st, now)) { st.route = null; st.repathAt = 0; st.probeDir = -(st.probeDir || 1); }
      return;
    }

    if (!st.probeDir) { st.probeDir = dx >= 0 ? 1 : -1; st.probeFlipAt = now + AI.PROBE_FLIP_MS; }
    else if (now >= st.probeFlipAt) { st.probeDir = -st.probeDir; st.probeFlipAt = now + AI.PROBE_FLIP_MS; }

    const here = surfaceAt(graph.nodes, mcx, feetY);
    if (here >= 0) {
      const n = graph.nodes[here];
      if (st.probeDir > 0 && mcx + mob.width / 2 >= n.x2 - 2) { st.probeDir = -1; st.probeFlipAt = now + AI.PROBE_FLIP_MS; }
      else if (st.probeDir < 0 && mcx - mob.width / 2 <= n.x1 + 2) { st.probeDir = 1; st.probeFlipAt = now + AI.PROBE_FLIP_MS; }
    }
    if (mob.hitWall && mob.hitWall !== st.probeDir) { st.probeDir = -st.probeDir; st.probeFlipAt = now + AI.PROBE_FLIP_MS; }

    mob.facing = st.probeDir;
    mob.vx = st.probeDir * type.chaseSpeed;
    mob.state = 'run';
  }

  function patrol(mob, type, st, now) {
    // Currently paused after hitting a wall? Sit, then turn and walk away.
    if (now < st.blockUntil) { mob.vx = 0; mob.state = 'idle'; return; }
    if (st.blockUntil && now >= st.blockUntil && !st.walkAwayUntil) {
      mob.patrolDir = -mob.patrolDir;               // turn around
      st.walkAwayUntil = now + AI.BLOCK_WALKAWAY_MS; // committed escape window
      st.blockUntil = 0;
      st.nextIdleAt = now + rand(AI.IDLE_GAP_MIN_MS, AI.IDLE_GAP_MAX_MS);
    }

    // Random idle (never while escaping an obstacle).
    if (!st.walkAwayUntil || now >= st.walkAwayUntil) {
      st.walkAwayUntil = 0;
      if (now < st.idleUntil) { mob.vx = 0; mob.facing = mob.patrolDir; mob.state = 'idle'; return; }
      if (now >= st.nextIdleAt) {
        st.idleUntil = now + rand(AI.IDLE_MIN_MS, AI.IDLE_MAX_MS);
        st.nextIdleAt = st.idleUntil + rand(AI.IDLE_GAP_MIN_MS, AI.IDLE_GAP_MAX_MS);
        mob.vx = 0; mob.facing = mob.patrolDir; mob.state = 'idle';
        return;
      }
    }

    // Walk.
    mob.facing = mob.patrolDir;
    mob.vx = mob.patrolDir * type.patrolSpeed;
    mob.state = 'walk';

    // Wall / edge / zone block → stop and schedule a pause+turn.
    if (mob.hitWall && mob.hitWall !== mob.patrolDir) {
      mob.vx = 0;
      mob.state = 'idle';
      st.blockUntil = now + rand(AI.BLOCK_PAUSE_MIN_MS, AI.BLOCK_PAUSE_MAX_MS);
      st.walkAwayUntil = 0;
    }
  }

  // Grounded, trying to move, but position hasn't changed for STUCK_MS.
  function progressStuck(mob, st, now) {
    if (Math.abs(mob.x - st.stuckX) > AI.STUCK_EPS) { st.stuckX = mob.x; st.stuckAt = now; return false; }
    if (now - st.stuckAt > AI.STUCK_MS) { st.stuckX = mob.x; st.stuckAt = now; return true; }
    return false;
  }

  // ---- Attacks --------------------------------------------------------------
  // Same-surface, in-range check happens in the caller-facing shouldAttack.
  function resolveAttack(mob, type, targets, out) {
    const mcx = mob.x + mob.width / 2, mcy = mob.y + mob.height / 2;
    let primary = null, best = type.attackHitRange;
    for (const t of targets) {
      const d = Math.hypot(t.cx - mcx, t.cy - mcy);
      if (d <= best) { best = d; primary = t; }
    }
    if (!primary) { out.attack = { mcx, mcy, primary: null, struck: [], color: type.tint }; return; }
    const struck = [primary];
    if (type.chain) {
      for (const t of targets) {
        if (t === primary) continue;
        if (Math.hypot(t.cx - primary.cx, t.cy - primary.cy) <= type.chainRadius) struck.push(t);
      }
    }
    for (const t of struck) {
      out.hits.push({
        targetId: t.id, damage: mob.damage,
        knockbackX: type.knockbackX, knockbackY: type.knockbackY,
        srcX: mcx, chained: t !== primary,
      });
    }
    out.attack = { mcx, mcy, primary, struck, color: type.tint };
  }

  // ---- Charge attack --------------------------------------------------------
  //  A two-phase attack for types with `charge: true`:
  //    phase 1  rooted wind-up (plays the attack clip — the tell),
  //    phase 2  a dash that accelerates from `chargeStartSpeed` toward
  //             `chargeSpeed` and damages whatever it ploughs into.
  //  The damage is read off the mob's SPEED at the moment of contact, so a
  //  player who lets it wind up all the way takes far more than one who steps
  //  into it right off the mark. Ends on contact, a wall, a ledge or a timeout.
  function shouldCharge(mob, type, target, now) {
    if (!target || !mob.onGround || now < mob.attackReadyAt) return false;
    const mcx = mob.x + mob.width / 2, mcy = mob.y + mob.height / 2;
    if (Math.abs(target.cy - mcy) > AI.ATTACK_VERTICAL_TOL) return false;
    return Math.abs(target.cx - mcx) <= type.chargeRange;
  }

  function beginCharge(mob, type, target, now) {
    mob.chargePhase = 1;
    mob.chargeStartedAt = now;
    mob.facing = (target.cx - (mob.x + mob.width / 2)) >= 0 ? 1 : -1;
    mob.vx = 0;
  }

  function endCharge(mob, type, now, opts) {
    mob.chargePhase = 0;
    mob.vx = 0;
    mob.attackReadyAt = now + (type.chargeCooldownMs || opts.attackCooldownMs);
  }

  function stepCharge(mob, env, type, targets, now, opts, out) {
    // Phase 1 — rooted wind-up. Rooted so players get a readable warning.
    if (mob.chargePhase === 1) {
      mob.vx = 0;
      applyGravity(mob, env, type);
      mob.state = 'attack';
      if (now - mob.chargeStartedAt >= type.chargeWindupMs) {
        mob.chargePhase = 2;
        mob.chargeStartedAt = now;
        mob.vx = mob.facing * type.chargeStartSpeed;
        out.fx.push({ kind: 'charge', x: mob.x + mob.width / 2, y: mob.y + mob.height / 2, color: type.tint });
      }
      return;
    }

    // Phase 2 — the dash. Accelerate toward top speed and keep going.
    const dir = mob.facing;
    mob.vx = dir * Math.min(type.chargeSpeed, Math.abs(mob.vx) + type.chargeAccel * mob._dt);
    integrateX(mob, env);
    applyGravity(mob, env, type);
    mob.state = 'run';

    // Contact is checked AFTER the move so the damage reflects the speed the
    // mob actually arrived at.
    if (resolveChargeHit(mob, type, targets, out)) { endCharge(mob, type, now, opts); return; }
    // Ran into a wall, ran off a ledge, or ran out of momentum budget. Off a
    // ledge we keep the velocity so it arcs away instead of stopping in mid-air.
    if (mob.hitWall || now - mob.chargeStartedAt >= type.chargeMaxMs) { endCharge(mob, type, now, opts); return; }
    if (!mob.onGround) {
      const vx = mob.vx;
      endCharge(mob, type, now, opts);
      mob.vx = vx;
    }
  }

  // Speed -> damage multiplier: a shove at the start of the dash, double at
  // half speed, triple at full speed. Multiplies the mob's configured damage so
  // a spawner override still scales the whole ramp.
  function chargeDamageMult(ratio) {
    if (ratio >= AI.CHARGE_FULL_RATIO) return 3;
    if (ratio >= AI.CHARGE_HALF_RATIO) return 2;
    return 1;
  }

  function resolveChargeHit(mob, type, targets, out) {
    const mcx = mob.x + mob.width / 2, mcy = mob.y + mob.height / 2;
    const reach = type.chargeHitRange || type.attackHitRange;
    let struck = null, best = reach;
    for (const t of targets) {
      if (Math.abs(t.cy - mcy) > AI.ATTACK_VERTICAL_TOL) continue;
      const d = Math.abs(t.cx - mcx);
      if (d <= best) { best = d; struck = t; }
    }
    if (!struck) return false;
    const ratio = Math.min(1, Math.abs(mob.vx) / type.chargeSpeed);
    const mult = chargeDamageMult(ratio);
    const damage = Math.max(1, Math.round((mob.damage || type.damage) * mult));
    // Knockback rides the same ramp, so a full-speed ram launches you.
    const kb = 0.7 + ratio * 0.8;
    out.hits.push({
      targetId: struck.id, damage,
      knockbackX: Math.round(type.knockbackX * kb), knockbackY: Math.round(type.knockbackY * kb),
      srcX: mcx, chained: false,
    });
    out.attack = { mcx, mcy, primary: struck, struck: [struck], color: type.tint, damage, charge: true, speedRatio: ratio };
    return true;
  }

  function maybeTeleport(mob, env, type, target, now, out) {
    if (!type.teleport || !target) return;
    const dx = target.cx - (mob.x + mob.width / 2);
    if (now < mob.teleportReadyAt || Math.abs(dx) <= type.teleportMinGap) return;
    const dir = dx >= 0 ? 1 : -1;
    const dist = Math.min(type.teleportRange, Math.abs(dx) - type.attackRange * 0.5);
    if (dist <= 16) return;
    const fromX = mob.x + mob.width / 2, fromY = mob.y + mob.height / 2;
    let nx = mob.x + dir * dist;
    if (mob.zone) nx = Math.max(mob.zone.x, Math.min(nx, mob.zone.x + mob.zone.width - mob.width));
    nx = Math.max(0, Math.min(nx, env.world.width - mob.width));
    for (const b of env.boxes) {
      const oy = mob.y + mob.height > b.y && mob.y < b.y + b.height;
      if (oy && nx + mob.width > b.x && nx < b.x + b.width) return;
    }
    if (Math.abs(nx - mob.x) < 8) return;
    mob.x = nx;
    mob.teleportReadyAt = now + type.teleportCooldownMs;
    mob.blinked = true;
    out.blinked = true;
    out.fx.push({ kind: 'blink', x: fromX, y: fromY, color: type.tint });
    out.fx.push({ kind: 'blink', x: mob.x + mob.width / 2, y: mob.y + mob.height / 2, color: type.tint });
  }

  // Apply a player-swing knockback to the mob: launch it away in `dir`, pop it
  // off the ground, and stagger the AI briefly so it doesn't instantly steer
  // back. Used by BOTH the server (broadcast) and the client local sim so the
  // recoil looks the same everywhere.
  function hitKnockback(mob, dir, now, kbX, kbY, staggerMs) {
    mob.vx = (dir >= 0 ? 1 : -1) * Math.abs(kbX);
    mob.vy = -Math.abs(kbY);
    mob.onGround = false;
    mob.attacking = false;
    mob.chargePhase = 0;
    mob.staggerUntil = now + (staggerMs || AI.STAGGER_MS);
    // Abandon any in-progress navigation jump so it can't fight the knockback.
    if (mob.nav) { mob.nav.airborne = false; mob.nav.dropping = false; mob.nav.route = null; mob.nav.repathAt = 0; }
  }

  // Decide whether a grounded, cooled-down mob should start an attack this tick.
  // Adds a VERTICAL tolerance so a mob can't hit a player through a floor.
  function shouldAttack(mob, type, target, now) {
    if (!target || now < mob.attackReadyAt || !mob.onGround) return false;
    const mcx = mob.x + mob.width / 2, mcy = mob.y + mob.height / 2;
    const dxAbs = Math.abs(target.cx - mcx);
    const dyAbs = Math.abs(target.cy - mcy);
    return dxAbs <= type.attackRange && dyAbs <= AI.ATTACK_VERTICAL_TOL;
  }

  return {
    AI, TICK,
    buildGraph, invalidate, findRoute, resolveGoalNode,
    buildSurfaces, surfaceAt, simulate,
    stepMob, shouldAttack, shouldCharge, chargeDamageMult, finish, hitKnockback,
  };
});
