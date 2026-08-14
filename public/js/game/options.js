    // ---- Options panel ------------------------------------------------------
    // Gear button (top-right) opens a panel with: the Interact-with-Stream
    // control, character body/beak colors, account log-out, and a rebindable
    // controls list (keyboard + gamepad). All wiring reuses existing globals:
    // player.color/beakColor, emitMoveNow(), hasJoined, the keyBindings API in
    // keybindings.js, and window.__slimeAuth from auth.js.
    (function initOptions() {
      const btn = document.getElementById('optionsBtn');
      const panel = document.getElementById('optionsPanel');
      const closeBtn = document.getElementById('optionsClose');
      if (!btn || !panel) return;

      const hexOk = (c) => /^#[0-9a-fA-F]{6}$/.test(String(c || ''));
      const toHex = (c, fb) => (hexOk(c) ? c : fb);

      // Restore a returning guest's saved colors into the login pickers so GO
      // reuses them (beginPlay reads those inputs).
      try {
        const b = localStorage.getItem('duckBodyColor');
        const k = localStorage.getItem('duckBeakColor');
        const uc = document.getElementById('usernameColor');
        const ub = document.getElementById('usernameBeakColor');
        if (uc && hexOk(b)) uc.value = b;
        if (ub && hexOk(k)) ub.value = k;
      } catch (e) {}

      function open() {
        const bc = document.getElementById('optBodyColor');
        const kc = document.getElementById('optBeakColor');
        if (bc) bc.value = toHex(player.color, '#2b6b61');
        if (kc) kc.value = toHex(player.beakColor, '#e8a23a');
        const gp = document.getElementById('optGamepad');
        if (gp) gp.checked = gamepadEnabled;
        renderAccount();
        renderGamepadStatus();
        renderBindings();
        panel.style.display = 'block';
      }
      function close() { panel.style.display = 'none'; if (typeof canvas !== 'undefined' && canvas) canvas.focus(); }
      btn.addEventListener('click', () => { panel.style.display === 'block' ? close() : open(); });
      if (closeBtn) closeBtn.addEventListener('click', close);

      // --- Character color (live update + persist for guests) ---
      const bodyInput = document.getElementById('optBodyColor');
      const beakInput = document.getElementById('optBeakColor');
      if (bodyInput) bodyInput.addEventListener('input', () => {
        player.color = bodyInput.value;
        try { localStorage.setItem('duckBodyColor', player.color); } catch (e) {}
        if (typeof emitMoveNow === 'function') emitMoveNow();
      });
      if (beakInput) beakInput.addEventListener('input', () => {
        player.beakColor = beakInput.value;
        try { localStorage.setItem('duckBeakColor', player.beakColor); } catch (e) {}
        if (typeof emitMoveNow === 'function') emitMoveNow();
      });

      // --- Account / log out ---
      function renderAccount() {
        const info = document.getElementById('optAccountInfo');
        const logoutBtn = document.getElementById('optLogout');
        const auth = window.__slimeAuth;
        const signedIn = !!(auth && auth.isSignedIn && auth.isSignedIn());
        if (info) info.textContent = signedIn
          ? ('Signed in as ' + (auth.username() || 'player'))
          : 'Playing as a guest';
        if (logoutBtn) logoutBtn.textContent = signedIn ? 'Log out' : 'Back to menu';
      }
      const logoutBtn = document.getElementById('optLogout');
      if (logoutBtn) logoutBtn.addEventListener('click', async () => {
        try { if (window.__slimeAuth && window.__slimeAuth.signOut) await window.__slimeAuth.signOut(); } catch (e) {}
        hasJoined = false;
        const overlay = document.getElementById('loginOverlay');
        if (overlay) overlay.style.display = 'flex';
        close();
      });

      // --- Controller ---
      const gpToggle = document.getElementById('optGamepad');
      if (gpToggle) {
        gpToggle.checked = gamepadEnabled;
        gpToggle.addEventListener('change', () => { setGamepadEnabled(gpToggle.checked); renderGamepadStatus(); });
      }
      function renderGamepadStatus() {
        const el = document.getElementById('optGamepadStatus');
        if (!el) return;
        if (!gamepadEnabled) { el.textContent = 'Controller off — keyboard only.'; return; }
        el.textContent = isGamepadPresent() ? 'Controller detected.' : 'Enabled — connect a controller and press any button.';
      }
      const resetBtn = document.getElementById('optResetBindings');
      if (resetBtn) resetBtn.addEventListener('click', () => { resetBindings(); renderBindings(); });

      // --- Rebindable controls list ---
      let capturingKey = null; // action id while waiting for a keyboard key
      function renderBindings() {
        const wrap = document.getElementById('optBindings');
        if (!wrap) return;
        wrap.innerHTML = '';
        for (const a of KB_ACTIONS) {
          const row = document.createElement('div');
          row.className = 'binding-row';

          const label = document.createElement('span');
          label.className = 'binding-label';
          label.textContent = a.label;

          const keyBtn = document.createElement('button');
          keyBtn.className = 'pixel-btn pixel-btn-small binding-btn';
          keyBtn.textContent = capturingKey === a.id
            ? 'Press a key…'
            : keyBindings[a.id].keys.map(keyLabel).join(' / ');
          keyBtn.addEventListener('click', () => beginKeyCapture(a.id));

          const padBtn = document.createElement('button');
          padBtn.className = 'pixel-btn pixel-btn-small binding-btn';
          padBtn.textContent = (padRebindAction === a.id)
            ? 'Press button…'
            : ('Pad ' + (keyBindings[a.id].pad != null ? keyBindings[a.id].pad : '—'));
          padBtn.addEventListener('click', () => { startPadRebind(a.id, renderBindings); renderBindings(); });

          row.appendChild(label);
          row.appendChild(keyBtn);
          row.appendChild(padBtn);
          wrap.appendChild(row);
        }
      }
      function beginKeyCapture(action) {
        capturingKey = action;
        renderBindings();
        const onKey = (e) => {
          e.preventDefault();
          e.stopPropagation();
          const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
          if (k !== 'Escape') { keyBindings[action].keys = [k]; saveBindings(); }
          capturingKey = null;
          window.removeEventListener('keydown', onKey, true);
          renderBindings();
        };
        window.addEventListener('keydown', onKey, true);
      }
    })();
