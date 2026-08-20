    // ---- Touch controls + landscape lock ------------------------------------
    // Phones and tablets get an on-screen pad instead of a keyboard. Exactly
    // like pollGamepad() in keybindings.js, every pad press is turned into a
    // synthetic keydown/keyup on the game canvas using the player's CURRENT
    // binding for that action — so all of input.js's edge detection, jump
    // buffering, dash cooldowns and hit-stun locking are reused unchanged, and
    // nothing downstream needs to know where the input came from.
    (function initTouchControls() {
      const root = document.documentElement;
      const layer = document.getElementById('touchControls');
      if (!layer) return;

      // `?touch=1` forces the pad on (handy for testing in a desktop browser),
      // `?touch=0` forces it off. Otherwise: a coarse pointer that cannot hover
      // is a touchscreen, with a UA check for older mobile browsers and for the
      // iPad-on-iPadOS case, which reports itself as a Mac.
      const forced = new URLSearchParams(location.search).get('touch');
      const isTouch = forced === '1' || (forced !== '0' && (
        (matchMedia('(any-pointer: coarse)').matches && matchMedia('(any-hover: none)').matches)
        || /Android|iPhone|iPad|iPod|IEMobile|Opera Mini/i.test(navigator.userAgent)
        || (navigator.maxTouchPoints > 1 && /Mac/.test(navigator.platform))
      ));
      if (!isTouch) return;
      root.classList.add('is-touch');

      // --- Force landscape ---------------------------------------------------
      // Android/Chrome only honours screen.orientation.lock() while the page is
      // fullscreen, and BOTH calls have to start inside a user gesture — hence
      // the document-level pointerdown hook rather than a call on load. The
      // flag is cleared by fullscreenchange, so leaving fullscreen re-arms it.
      // iOS supports neither API, so there the portrait #rotateNotice (a plain
      // CSS orientation media query) is the whole mechanism.
      const orient = screen.orientation;
      const canLock = !!(orient && orient.lock);
      const canFullscreen = !!(document.documentElement.requestFullscreen
        || document.documentElement.webkitRequestFullscreen);
      let landscapeDone = false;

      function lockLandscape() {
        if (landscapeDone) return;
        const el = document.documentElement;
        const req = el.requestFullscreen || el.webkitRequestFullscreen;
        if (req && !document.fullscreenElement && !document.webkitFullscreenElement) {
          try {
            const p = req.call(el, { navigationUI: 'hide' });
            if (p && p.catch) p.catch(() => {});
          } catch (e) {}
        }
        if (canLock) {
          try {
            const p = orient.lock('landscape');
            if (p && p.catch) p.catch(() => {});
          } catch (e) {}
        }
      }
      document.addEventListener('pointerdown', lockLandscape, true);
      document.addEventListener('fullscreenchange', () => {
        landscapeDone = !!document.fullscreenElement;
      });
      const fsBtn = document.getElementById('rotateFullscreen');
      if (fsBtn) {
        fsBtn.addEventListener('click', lockLandscape);
        // Nothing to try on iOS — hide the button rather than offer a dead one.
        if (!canLock && !canFullscreen) fsBtn.style.display = 'none';
      }

      // Rotating changes the viewport in stages on mobile (the URL bar collapses
      // after the flip), so re-fit the canvas a few times rather than once.
      function refit() { if (typeof resizeCanvas === 'function') resizeCanvas(); }
      function refitSoon() { refit(); setTimeout(refit, 250); setTimeout(refit, 600); }
      window.addEventListener('orientationchange', refitSoon);
      if (orient && orient.addEventListener) orient.addEventListener('change', refitSoon);

      // --- Pad -> synthetic key events ---------------------------------------
      const held = new Map();       // action id -> Set of pointerIds holding it
      const pointerBtn = new Map(); // pointerId -> the button it is currently on

      const actionOf = (el) => (el && el.dataset ? el.dataset.touchAction : null);

      function sendKey(action, type) {
        const key = typeof primaryKey === 'function' ? primaryKey(action) : null;
        if (!key || typeof canvas === 'undefined' || !canvas) return;
        canvas.dispatchEvent(new KeyboardEvent(type, { key, bubbles: true }));
      }

      // Presses are reference-counted per action: two fingers on one button must
      // not send two keydowns, and lifting one must not send a keyup while the
      // other is still down.
      function press(el, id) {
        const action = actionOf(el);
        if (!action) return;
        let set = held.get(action);
        if (!set) { set = new Set(); held.set(action, set); }
        const wasEmpty = set.size === 0;
        set.add(id);
        pointerBtn.set(id, el);
        el.classList.add('is-pressed');
        if (wasEmpty) sendKey(action, 'keydown');
      }

      function release(id) {
        const el = pointerBtn.get(id);
        if (!el) return;
        pointerBtn.delete(id);
        const set = held.get(actionOf(el));
        if (!set) { el.classList.remove('is-pressed'); return; }
        set.delete(id);
        if (set.size === 0) {
          sendKey(actionOf(el), 'keyup');
          el.classList.remove('is-pressed');
        }
      }

      function releaseAll() {
        for (const id of Array.from(pointerBtn.keys())) release(id);
      }

      const btnAt = (x, y) => {
        const el = document.elementFromPoint(x, y);
        return el ? el.closest('[data-touch-action]') : null;
      };

      layer.addEventListener('pointerdown', (e) => {
        const el = btnAt(e.clientX, e.clientY);
        if (!el) return;
        e.preventDefault(); // no focus ring, no synthetic click, no page scroll
        press(el, e.pointerId);
      });

      // Sliding a thumb from ◀ to ▶ swaps which one is held instead of dropping
      // input entirely. The move/up listeners sit on `window`, not on the
      // button, so the gesture keeps working once the finger leaves where it
      // started — including when it leaves the pad altogether.
      window.addEventListener('pointermove', (e) => {
        if (!pointerBtn.has(e.pointerId)) return;
        const el = btnAt(e.clientX, e.clientY);
        if (el === pointerBtn.get(e.pointerId)) return;
        release(e.pointerId);
        if (el) press(el, e.pointerId);
      });

      const endPointer = (e) => { if (pointerBtn.has(e.pointerId)) release(e.pointerId); };
      window.addEventListener('pointerup', endPointer);
      window.addEventListener('pointercancel', endPointer);
      document.addEventListener('visibilitychange', () => { if (document.hidden) releaseAll(); });
      window.addEventListener('blur', releaseAll);

      // --- Stand the pad down behind menus -----------------------------------
      // Synthetic key events go straight to the canvas, bypassing focus — which
      // is what normally stops the keyboard driving the character while a dialog
      // or the chat box is up. So the pad has to hide itself explicitly.
      const blockers = ['loginOverlay', 'shopOverlay', 'chatInputWrap', 'optionsPanel']
        .map((id) => document.getElementById(id))
        .filter(Boolean);

      const isShown = (el) => getComputedStyle(el).display !== 'none';

      function syncVisibility() {
        const blocked = blockers.some(isShown);
        layer.classList.toggle('is-off', blocked);
        if (blocked) releaseAll();
      }
      const menuWatch = new MutationObserver(syncVisibility);
      for (const el of blockers) menuWatch.observe(el, { attributes: true, attributeFilter: ['style', 'class'] });
      syncVisibility();
    })();
