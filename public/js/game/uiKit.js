    // ---- Shared pixel UI kit -------------------------------------------------
    // Progressive enhancement for the two native controls that can't be styled
    // into the game's language: <input type="checkbox"> and
    // <input type="color">. Both inputs STAY in the DOM and stay authoritative —
    // every existing `.value` / `.checked` read and every `input`/`change`
    // listener elsewhere keeps working untouched. This module only adds a
    // pixel-styled face in front of them and forwards clicks.
    //
    //   <input type="checkbox" data-switch>  ->  [ OFF | ON ] switch
    //   <input type="color"    data-swatch>  ->  swatch + inline palette
    //
    // Code that sets a value programmatically (e.g. options.js re-reading the
    // player's colours when the panel opens) should call PixelUI.sync(root)
    // afterwards so the faces catch up.
    (function initPixelUI() {
      // Game-native palette: slime greens, beaks/golds, berry/violet accents,
      // then neutrals. 16 entries = four rows of four in the palette popup.
      const PALETTE = [
        '#7ed957', '#4c9a2a', '#2b6b61', '#1f8a70',
        '#ffc145', '#e8a23a', '#ff8c42', '#ff6b5a',
        '#9b6dff', '#6b45c4', '#1e3fff', '#43c6e8',
        '#f3f7ee', '#a9c2ac', '#5a6b5d', '#16241a',
      ];

      const isHex = (c) => /^#[0-9a-fA-F]{6}$/.test(String(c || ''));
      const norm = (c) => String(c || '').toLowerCase();

      // --- Toggle switch ---
      function enhanceSwitch(input) {
        if (input.dataset.uiReady) return;
        input.dataset.uiReady = '1';
        input.style.display = 'none';

        const sw = document.createElement('div');
        sw.className = 'pixel-switch';
        sw.setAttribute('role', 'switch');
        sw.tabIndex = 0;
        sw.innerHTML = '<span>OFF</span><span>ON</span>';
        input.insertAdjacentElement('afterend', sw);

        // The checkbox stays the source of truth; the switch just drives it,
        // and `change` is what the rest of the app already listens for.
        function flip() {
          input.checked = !input.checked;
          input.dispatchEvent(new Event('change', { bubbles: true }));
        }
        sw.addEventListener('click', flip);
        sw.addEventListener('keydown', (e) => {
          if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); flip(); }
        });
        input.addEventListener('change', () => syncSwitch(input));
        syncSwitch(input);
      }
      function syncSwitch(input) {
        const sw = input.nextElementSibling;
        if (sw && sw.classList.contains('pixel-switch')) {
          sw.setAttribute('aria-checked', input.checked ? 'true' : 'false');
        }
      }

      // --- Colour swatch + inline palette ---
      function enhanceColor(input) {
        if (input.dataset.uiReady) return;
        input.dataset.uiReady = '1';

        const label = input.dataset.swatchLabel || '';
        const field = document.createElement('div');
        field.className = 'swatch-field';
        input.insertAdjacentElement('beforebegin', field);
        field.appendChild(input);
        input.classList.add('is-enhanced');

        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'swatch-btn';
        btn.innerHTML = '<span class="chip"></span>' + (label ? '<span>' + label + '</span>' : '');

        const pop = document.createElement('div');
        pop.className = 'swatch-pop';
        const grid = document.createElement('div');
        grid.className = 'swatch-grid';
        for (const hex of PALETTE) {
          const dot = document.createElement('button');
          dot.type = 'button';
          dot.className = 'swatch-dot';
          dot.style.background = hex;
          dot.dataset.hex = hex;
          dot.title = hex;
          dot.addEventListener('click', () => { setValue(input, hex); close(); });
          grid.appendChild(dot);
        }
        pop.appendChild(grid);

        // Escape hatch to the OS picker for anything not on the palette.
        const custom = document.createElement('button');
        custom.type = 'button';
        custom.className = 'swatch-custom';
        custom.textContent = 'CUSTOM…';
        custom.addEventListener('click', () => {
          // The input is visually hidden but still focusable via .click().
          input.click();
        });
        pop.appendChild(custom);

        field.appendChild(btn);
        field.appendChild(pop);

        function close() { field.classList.remove('is-open'); }
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const opening = !field.classList.contains('is-open');
          closeAllSwatches();
          if (opening) field.classList.add('is-open');
        });
        pop.addEventListener('click', (e) => e.stopPropagation());
        input.addEventListener('input', () => syncColor(input));
        input.addEventListener('change', () => syncColor(input));
        syncColor(input);
      }

      // Setting .value in script does NOT fire input/change, so do it by hand —
      // that's what every existing listener is waiting for.
      function setValue(input, hex) {
        input.value = hex;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
      }

      function syncColor(input) {
        const field = input.closest('.swatch-field');
        if (!field) return;
        const val = isHex(input.value) ? input.value : '#000000';
        const chip = field.querySelector('.swatch-btn .chip');
        if (chip) chip.style.background = val;
        field.querySelectorAll('.swatch-dot').forEach((d) => {
          d.classList.toggle('is-active', norm(d.dataset.hex) === norm(val));
        });
      }

      function closeAllSwatches() {
        document.querySelectorAll('.swatch-field.is-open').forEach((f) => f.classList.remove('is-open'));
      }
      document.addEventListener('click', closeAllSwatches);
      document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeAllSwatches(); });

      // --- Public API ---
      function enhance(root) {
        const scope = root || document;
        scope.querySelectorAll('input[type="checkbox"][data-switch]').forEach(enhanceSwitch);
        scope.querySelectorAll('input[type="color"][data-swatch]').forEach(enhanceColor);
      }
      // Re-read every enhanced input and repaint its face. Cheap; call it
      // whenever a panel opens after values were assigned in code.
      function sync(root) {
        const scope = root || document;
        scope.querySelectorAll('input[type="checkbox"][data-switch]').forEach(syncSwitch);
        scope.querySelectorAll('input[type="color"][data-swatch]').forEach(syncColor);
      }

      window.PixelUI = { enhance, sync, PALETTE };
      enhance();
    })();
