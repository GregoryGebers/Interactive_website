    // ---- Keybindings + gamepad ----------------------------------------------
    // Every gameplay action maps to one or more keyboard keys (in normKey form:
    // single chars lowercased, named keys as-is) plus an optional gamepad button
    // index. Bindings are rebindable from the options panel and persisted in
    // localStorage. pollGamepad() (called each frame from the loop) turns pad
    // input into synthetic keydown/keyup events on the game canvas, so ALL of
    // input.js's existing handling — buffering, press-edges, cooldowns — is
    // reused unchanged for the controller.
    const KB_ACTIONS = [
      { id: 'moveLeft',  label: 'Move Left'  },
      { id: 'moveRight', label: 'Move Right' },
      { id: 'jump',      label: 'Jump'       },
      { id: 'dash',      label: 'Dash'       },
      { id: 'vanish',    label: 'Vanish'     },
      { id: 'punch',     label: 'Punch'      },
      { id: 'shop',      label: 'Shop'       },
      { id: 'chat',      label: 'Chat'       },
    ];
    // pad indices follow the "standard" gamepad mapping: 0=A 1=B 2=X 3=Y,
    // 8=Back/Select 9=Start, 14/15 = D-pad left/right.
    const DEFAULT_BINDINGS = {
      moveLeft:  { keys: ['ArrowLeft', 'a'],  pad: 14 },
      moveRight: { keys: ['ArrowRight', 'd'], pad: 15 },
      jump:      { keys: ['ArrowUp', 'w'],    pad: 0  },
      dash:      { keys: ['Shift'],           pad: 1  },
      vanish:    { keys: ['Control'],         pad: 3  },
      punch:     { keys: [' '],               pad: 2  },
      shop:      { keys: ['p'],               pad: 9  },
      chat:      { keys: ['t'],               pad: 8  },
    };
    const KB_STORAGE = 'duckKeybindings';
    function cloneBindings(b) { return JSON.parse(JSON.stringify(b)); }
    function loadBindings() {
      try {
        const saved = JSON.parse(localStorage.getItem(KB_STORAGE));
        if (saved && typeof saved === 'object') {
          const merged = cloneBindings(DEFAULT_BINDINGS);
          for (const id in merged) {
            if (!saved[id]) continue;
            if (Array.isArray(saved[id].keys)) merged[id].keys = saved[id].keys.slice(0, 3);
            if (typeof saved[id].pad === 'number' || saved[id].pad === null) merged[id].pad = saved[id].pad;
          }
          return merged;
        }
      } catch (e) {}
      return cloneBindings(DEFAULT_BINDINGS);
    }
    let keyBindings = loadBindings();
    function saveBindings() { try { localStorage.setItem(KB_STORAGE, JSON.stringify(keyBindings)); } catch (e) {} }
    function resetBindings() { keyBindings = cloneBindings(DEFAULT_BINDINGS); saveBindings(); }

    function bindingHasKey(action, key) {
      const b = keyBindings[action];
      return !!b && b.keys.indexOf(key) !== -1;
    }
    function primaryKey(action) {
      const b = keyBindings[action];
      return b && b.keys.length ? b.keys[0] : null;
    }
    // True if a key drives a movement/ability action — used to swallow those
    // keys during hit-stun without swallowing menu keys.
    function isGameplayKey(key) {
      return ['moveLeft', 'moveRight', 'jump', 'dash', 'vanish', 'punch'].some((a) => bindingHasKey(a, key));
    }
    function keyLabel(key) {
      const map = { ' ': 'Space', ArrowLeft: '←', ArrowRight: '→', ArrowUp: '↑', ArrowDown: '↓', Control: 'Ctrl', Shift: 'Shift' };
      if (map[key]) return map[key];
      if (key && key.length === 1) return key.toUpperCase();
      return key || '—';
    }

    // ---- Gamepad ----
    let gamepadEnabled = (() => { try { return localStorage.getItem('duckGamepad') === '1'; } catch (e) { return false; } })();
    let gamepadIndex = null;
    let padRebindAction = null; // action id while the options panel captures a button
    let onPadRebound = null;    // callback fired after a capture completes
    const padPrev = {};
    function setGamepadEnabled(v) { gamepadEnabled = !!v; try { localStorage.setItem('duckGamepad', v ? '1' : '0'); } catch (e) {} }
    function isGamepadPresent() { return !!firstGamepad(); }
    window.addEventListener('gamepadconnected', (e) => { if (gamepadIndex === null) gamepadIndex = e.gamepad.index; });
    window.addEventListener('gamepaddisconnected', (e) => { if (gamepadIndex === e.gamepad.index) gamepadIndex = null; });

    function firstGamepad() {
      const pads = navigator.getGamepads ? navigator.getGamepads() : [];
      if (gamepadIndex !== null && pads[gamepadIndex]) return pads[gamepadIndex];
      for (const p of pads) if (p) return p;
      return null;
    }
    function padPressed(gp, i) { return i != null && gp.buttons[i] && gp.buttons[i].pressed; }

    function pollGamepad() {
      if (!gamepadEnabled && padRebindAction === null) return;
      const gp = firstGamepad();
      if (!gp) return;

      // Rebind capture: bind the first pressed button to the pending action.
      if (padRebindAction !== null) {
        for (let i = 0; i < gp.buttons.length; i++) {
          if (gp.buttons[i].pressed) {
            keyBindings[padRebindAction].pad = i;
            saveBindings();
            const cb = onPadRebound;
            padRebindAction = null; onPadRebound = null;
            if (typeof cb === 'function') cb();
            break;
          }
        }
        return;
      }
      if (!gamepadEnabled) return;

      const ax = gp.axes && gp.axes.length ? (gp.axes[0] || 0) : 0;
      const state = {
        moveLeft:  ax < -0.4 || padPressed(gp, keyBindings.moveLeft.pad),
        moveRight: ax >  0.4 || padPressed(gp, keyBindings.moveRight.pad),
        jump:   padPressed(gp, keyBindings.jump.pad),
        dash:   padPressed(gp, keyBindings.dash.pad),
        vanish: padPressed(gp, keyBindings.vanish.pad),
        punch:  padPressed(gp, keyBindings.punch.pad),
        shop:   padPressed(gp, keyBindings.shop.pad),
        chat:   padPressed(gp, keyBindings.chat.pad),
      };
      for (const action in state) {
        const now = !!state[action], was = !!padPrev[action];
        if (now !== was) {
          const k = primaryKey(action);
          if (k && typeof canvas !== 'undefined' && canvas) {
            canvas.dispatchEvent(new KeyboardEvent(now ? 'keydown' : 'keyup', { key: k, bubbles: true }));
          }
        }
        padPrev[action] = now;
      }
    }
    // Options panel calls this to start capturing a pad button for `action`.
    function startPadRebind(action, cb) { padRebindAction = action; onPadRebound = cb || null; }
