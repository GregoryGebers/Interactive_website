'use strict';

const gameState = require('../state/gameState');
const {
  hasSpawners, spawnMob, stepMob, knockbackMob, snapshot, RESPAWN_DELAY_MS,
} = require('../services/mob.service');

// ---- Mob loop ---------------------------------------------------------------
// One shared mob at a time, simulated on the server so viewer.html and
// overlay.html render the same creature in the same place. The loop:
//   • spawns a mob (weighted by scene spawners) when none is alive,
//   • runs its AI each tick and broadcasts position/state,
//   • forwards contact-attack hits to the affected player(s),
//   • respawns the next mob shortly after one dies.
const MOB_TICK_MS = 40;              // 25 ticks/sec
let lastTick = Date.now();
let mobTimer = null;
let mobLoopActive = false;

// Is the mob simulation actually running? A scene with no spawners disables it
// entirely, which is easy to do by accident in the editor and otherwise leaves
// no trace after startup — /health reports this.
function isMobLoopRunning() {
  return mobLoopActive;
}

function stopMobLoop() {
  if (mobTimer) clearTimeout(mobTimer);
  mobTimer = null;
  mobLoopActive = false;
}

function startMobLoop(io) {
  if (!hasSpawners()) {
    console.log('[mob] no spawners in scene — mob loop idle');
    return;
  }
  // First mob appears almost immediately on boot.
  gameState.mobRespawnAt = Date.now() + 500;
  mobLoopActive = true;

  // A self-correcting scheduler, not setInterval. Under event-loop pressure
  // setInterval queues ticks up and then fires them back-to-back, which makes
  // mob motion stutter and jump; targeting an absolute next-tick time instead
  // lets a late tick simply run late and re-aim, without a burst.
  let nextTickAt = Date.now() + MOB_TICK_MS;

  const scheduleNext = () => {
    const delay = Math.max(0, nextTickAt - Date.now());
    mobTimer = setTimeout(tick, delay);
    // Never let the mob loop hold the process open during shutdown.
    if (mobTimer.unref) mobTimer.unref();
  };

  const tick = () => {
    nextTickAt += MOB_TICK_MS;
    // If we fell far behind (a long stall), re-aim rather than trying to catch
    // up with a burst of ticks the simulation cannot use anyway.
    const drift = Date.now() - nextTickAt;
    if (drift > MOB_TICK_MS * 5) nextTickAt = Date.now() + MOB_TICK_MS;

    try {
      const now = Date.now();
      const dt = Math.min(0.1, (now - lastTick) / 1000);
      lastTick = now;

      // Spawn the next mob once the respawn timer elapses.
      if (!gameState.currentMob) {
        if (now >= gameState.mobRespawnAt) {
          gameState.currentMob = spawnMob();
          if (gameState.currentMob) io.emit('mob', snapshot(gameState.currentMob));
        }
        return;
      }

      const mob = gameState.currentMob;
      const hits = stepMob(mob, gameState.players, dt, now);

      for (const hit of hits) {
        io.to(hit.playerId).emit('mob-hit', {
          mobId: mob.id,
          damage: hit.damage,
          knockbackX: hit.knockbackX,
          knockbackY: hit.knockbackY,
          srcX: hit.srcX,
          chained: !!hit.chained,
        });
      }
      // An electric blink this tick: tell everyone so both clients can flash it.
      if (mob.blinked) {
        mob.blinked = false;
        io.emit('mob-blink', { id: mob.id, x: Math.round(mob.x + mob.width / 2), y: Math.round(mob.y + mob.height / 2) });
      }

      io.emit('mob-move', snapshot(mob));
    } catch (err) {
      console.error('[mob] loop error:', err);
    } finally {
      // MUST be in a finally: the "no mob yet" branch above returns early, and
      // with a self-rescheduling timer (unlike setInterval) that would end the
      // loop permanently.
      if (mobLoopActive) scheduleNext();
    }
  };

  scheduleNext();
}

// Called from the combat handler when a player's swing lands on the mob.
// Returns true if the swing connected. `io` broadcasts the hurt/death visuals.
function damageMobFromSwing(io, attackerId, dir, attacker) {
  const mob = gameState.currentMob;
  if (!mob) return false;
  const mcx = mob.x + mob.width / 2, mcy = mob.y + mob.height / 2;
  // A generous reach in front of the swinger, matching player-vs-player feel.
  const cx = attacker.x + dir * 20, cy = attacker.y;
  const reach = 60;
  if (Math.hypot(mcx - cx, mcy - cy) > reach) return false;

  mob.health -= 1;
  io.emit('mob-hurt', { id: mob.id, dir });

  if (mob.health > 0) {
    // Recoil the mob away from the swing. The mob loop broadcasts its moved
    // position next tick, so every client sees the knockback.
    knockbackMob(mob, dir, Date.now());
  } else {
    io.emit('mob-died', { id: mob.id, type: mob.type, x: Math.round(mcx), y: Math.round(mcy), facing: mob.facing });
    gameState.currentMob = null;
    gameState.mobRespawnAt = Date.now() + RESPAWN_DELAY_MS;
    io.emit('mob', null);
  }
  return true;
}

module.exports = { startMobLoop, stopMobLoop, isMobLoopRunning, damageMobFromSwing };
