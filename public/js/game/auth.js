    // ---- Player accounts (Supabase Auth, username-based) --------------------
    // Players sign in with just a USERNAME + password (no email). Supabase Auth
    // is email-based under the hood, so each username is mapped to a stable
    // synthetic email (username -> "<slug>@slime.game"); the real display name
    // and name color are stored in the account's user metadata and reused on
    // every sign-in. Signing in ties this browser to an account whose
    // progression (coins, cosmetics, upgrades) is stored server-side.
    //
    // Everything degrades gracefully: if Supabase isn't configured (or its CDN
    // fails to load) the account UI hides and only the guest view remains.
    //
    // Security note: this file only handles AUTHENTICATION and presentation
    // identity (name/color). It never writes coins/upgrades — the server owns
    // those and persists them itself after verifying the access token.

    (function initAuth() {
      if (IS_EDITOR_TEST) return; // editor test uses a fake socket

      const authView = document.getElementById('authView');
      const signedInView = document.getElementById('signedInView');
      const guestView = document.getElementById('guestView');
      if (!authView || !guestView) return;

      const toggle = document.getElementById('authToggle');
      const segBtns = toggle ? toggle.querySelectorAll('.seg-btn') : [];
      const usernameEl = document.getElementById('authUsername');
      const passEl = document.getElementById('authPassword');
      const colorRow = document.getElementById('authColorRow');
      const colorEl = document.getElementById('authColor');
      const slider = toggle ? toggle.querySelector('.seg-slider') : null;
      const submitBtn = document.getElementById('authSubmit');
      const msgEl = document.getElementById('authMsg');
      const guestBtn = document.getElementById('guestBtn');
      const backToAuth = document.getElementById('backToAuth');
      const signedInStatus = document.getElementById('signedInStatus');
      const playBtn = document.getElementById('playBtn');
      const signOutBtn = document.getElementById('signOutBtn');

      const EMAIL_DOMAIN = 'slime.game';
      let mode = 'signin'; // 'signin' | 'signup'
      let client = null;
      let account = null; // { username, color } once signed in

      function setMsg(text, isError) {
        msgEl.textContent = text || '';
        msgEl.style.color = isError ? '#ff6b6b' : 'var(--gold)';
      }

      function showView(name) {
        authView.style.display = name === 'auth' ? 'flex' : 'none';
        signedInView.style.display = name === 'signedIn' ? 'flex' : 'none';
        guestView.style.display = name === 'guest' ? 'flex' : 'none';
      }

      // Map a display username to a stable synthetic email for Supabase Auth.
      function usernameToEmail(username) {
        const slug = String(username || '')
          .trim().toLowerCase()
          .replace(/[^a-z0-9._-]/g, '-')
          .replace(/^-+|-+$/g, '');
        return slug ? slug + '@' + EMAIL_DOMAIN : '';
      }

      // Reflect the active tab: move the slider, relabel the submit button, and
      // show the color picker only when creating an account.
      function setMode(next) {
        mode = next;
        if (toggle) toggle.setAttribute('data-mode', mode);
        // Position the sliding highlight from JS (inline). The CSS descendant
        // rule keyed on [data-mode] is not reliably re-applied on attribute
        // change in every engine, and percentage translate values don't resolve
        // in some engines — so we compute a PIXEL offset (slider width + gap)
        // and set it inline, which always wins and animates via the CSS
        // transition on .seg-slider.
        if (slider) {
          const dx = mode === 'signup' ? (slider.offsetWidth + 4) : 0;
          slider.style.transform = 'translateX(' + dx + 'px)';
        }
        segBtns.forEach((b) => b.classList.toggle('is-active', b.dataset.mode === mode));
        colorRow.style.display = mode === 'signup' ? 'flex' : 'none';
        submitBtn.textContent = mode === 'signup' ? 'CREATE ACCOUNT & PLAY' : 'SIGN IN & PLAY';
        passEl.setAttribute('autocomplete', mode === 'signup' ? 'new-password' : 'current-password');
        setMsg('');
      }

      // Re-handshake the game socket so the server picks up (or drops) the
      // access token and loads the right progression.
      let lastToken = window.__slimeAuthToken || null;
      function applyToken(token) {
        window.__slimeAuthToken = token || null;
        if (window.__slimeAuthToken === lastToken) return;
        lastToken = window.__slimeAuthToken;
        try {
          if (socket && typeof socket.disconnect === 'function') {
            socket.disconnect();
            socket.connect();
          }
        } catch (e) {
          console.warn('[auth] could not reconnect socket with new token:', e);
        }
      }

      // Enter signed-in state: remember name/color, show the PLAY view.
      function onSignedIn(user) {
        const meta = (user && user.user_metadata) || {};
        account = {
          username: meta.username || (user && user.email ? user.email.split('@')[0] : 'Player'),
          color: meta.color || '#1e3fff',
        };
        signedInStatus.innerHTML =
          'Signed in as <b>' + escapeHtml(account.username) + '</b> ' +
          '<span class="name-swatch" style="background:' + cssColor(account.color) + '"></span>';
        showView('signedIn');
      }

      function onSignedOut() {
        account = null;
        showView('auth');
      }

      function escapeHtml(s) {
        return String(s).replace(/[&<>"']/g, (c) => (
          { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
        ));
      }
      // Only allow a valid hex color into an inline style.
      function cssColor(c) {
        return /^#[0-9a-fA-F]{6}$/.test(String(c)) ? c : '#1e3fff';
      }

      async function boot() {
        let cfg = null;
        try {
          const res = await fetch('/config');
          if (res.ok) cfg = await res.json();
        } catch (e) {
          console.warn('[auth] could not fetch /config:', e);
        }
        const sb = cfg && cfg.supabase;

        // No Supabase (or CDN blocked): guest-only. Hide the "back to sign in".
        if (!sb || !sb.url || !sb.anonKey || !window.supabase || !window.supabase.createClient) {
          if (backToAuth) backToAuth.style.display = 'none';
          showView('guest');
          return;
        }

        client = window.supabase.createClient(sb.url, sb.anonKey);
        window.__slimeSupabase = client;

        setMode('signin');

        // Tab toggle.
        segBtns.forEach((b) => b.addEventListener('click', () => setMode(b.dataset.mode)));

        // Guest / back navigation.
        if (guestBtn) guestBtn.addEventListener('click', () => showView('guest'));
        if (backToAuth) backToAuth.addEventListener('click', () => showView('auth'));

        // Sign in / create account.
        submitBtn.addEventListener('click', doSubmit);
        passEl.addEventListener('keydown', (e) => { if (e.key === 'Enter') doSubmit(); });

        if (playBtn) playBtn.addEventListener('click', () => {
          if (account && typeof window.beginPlay === 'function') {
            window.beginPlay(account.username, account.color);
          }
        });
        if (signOutBtn) signOutBtn.addEventListener('click', async () => {
          await client.auth.signOut();
          setMsg('Signed out — you can sign in again or play as a guest.');
        });

        // Keep the socket token and the visible view in sync with auth state.
        client.auth.onAuthStateChange((_event, session) => {
          const token = session && session.access_token ? session.access_token : null;
          applyToken(token);
          if (session && session.user) onSignedIn(session.user);
          else onSignedOut();
        });

        const { data } = await client.auth.getSession();
        const session = data && data.session ? data.session : null;
        applyToken(session && session.access_token ? session.access_token : null);
        if (session && session.user) onSignedIn(session.user);
        else showView('auth');
      }

      async function doSubmit() {
        const username = usernameEl.value.trim();
        const password = passEl.value;
        const email = usernameToEmail(username);

        if (!email) { setMsg('Please choose a username (letters or numbers).', true); return; }
        if (password.length < 6) { setMsg('Password must be at least 6 characters.', true); return; }

        submitBtn.disabled = true;
        try {
          if (mode === 'signup') {
            setMsg('Creating account…');
            const color = cssColor(colorEl.value);
            const { data, error } = await client.auth.signUp({
              email, password,
              options: { data: { username, color } },
            });
            if (error) { setMsg(friendlyError(error), true); return; }
            if (data && data.session) {
              setMsg('Account created!');
              // onAuthStateChange will switch to the signed-in view.
            } else {
              // No session => email confirmation is enabled in Supabase, which
              // can't work with synthetic usernames. Tell the owner to disable
              // it (Authentication → Providers → Email → Confirm email OFF).
              setMsg('Account created, but sign-in is blocked by email confirmation. ' +
                     'Ask the site owner to turn off "Confirm email" in Supabase.', true);
            }
          } else {
            setMsg('Signing in…');
            const { error } = await client.auth.signInWithPassword({ email, password });
            if (error) { setMsg(friendlyError(error), true); return; }
            passEl.value = '';
          }
        } catch (e) {
          setMsg('Something went wrong. Please try again.', true);
          console.warn('[auth] submit failed:', e);
        } finally {
          submitBtn.disabled = false;
        }
      }

      function friendlyError(error) {
        const m = (error && error.message ? error.message : '').toLowerCase();
        if (m.includes('already registered') || m.includes('already been registered')) {
          return 'That username is taken — try signing in instead.';
        }
        if (m.includes('invalid login credentials')) {
          return 'Wrong username or password.';
        }
        if (m.includes('password')) return error.message;
        return error && error.message ? error.message : 'Authentication failed.';
      }

      boot();
    })();
