    // ---- Player accounts (Supabase Auth) ------------------------------------
    // Optional login layer. Signing in ties this browser to a Supabase account
    // whose progression (coins, cosmetics, upgrades) is stored server-side in
    // the database instead of only a signed cookie, so it follows the player
    // across devices. Everything here degrades gracefully: if Supabase isn't
    // configured, or the CDN fails to load, the login panel simply hides and
    // the game keeps working as an anonymous/guest cookie session.
    //
    // Security note: this file only handles AUTHENTICATION. It never sends
    // coins/upgrades to the database — the server owns those and writes them
    // itself once it has verified the access token on the socket handshake.

    (function initAuth() {
      const panel = document.getElementById('authPanel');
      if (IS_EDITOR_TEST || !panel) return; // editor test uses a fake socket

      const emailEl = document.getElementById('authEmail');
      const passEl = document.getElementById('authPassword');
      const signInBtn = document.getElementById('authSignIn');
      const signUpBtn = document.getElementById('authSignUp');
      const signOutBtn = document.getElementById('authSignOut');
      const statusEl = document.getElementById('authStatus');
      const msgEl = document.getElementById('authMsg');
      const formRow = document.getElementById('authFormRow');

      function setMsg(text, isError) {
        msgEl.textContent = text || '';
        msgEl.style.color = isError ? '#ff6b6b' : 'var(--gold)';
      }

      // Reflect the "signed in" vs "signed out" state in the panel.
      function renderSession(user) {
        if (user) {
          statusEl.textContent = 'Signed in as ' + (user.email || 'player');
          statusEl.style.display = 'block';
          formRow.style.display = 'none';
          signInBtn.style.display = 'none';
          signUpBtn.style.display = 'none';
          signOutBtn.style.display = 'inline-block';
        } else {
          statusEl.style.display = 'none';
          formRow.style.display = 'flex';
          signInBtn.style.display = 'inline-block';
          signUpBtn.style.display = 'inline-block';
          signOutBtn.style.display = 'none';
        }
      }

      // Re-handshake the game socket so the server picks up (or drops) the
      // access token and loads the right progression. Safe to call before the
      // player has joined — they're still on this login screen.
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

      async function boot() {
        // Fetch the public Supabase config the server exposes.
        let cfg = null;
        try {
          const res = await fetch('/config');
          if (res.ok) cfg = await res.json();
        } catch (e) {
          console.warn('[auth] could not fetch /config:', e);
        }
        const sb = cfg && cfg.supabase;
        if (!sb || !sb.url || !sb.anonKey || !window.supabase || !window.supabase.createClient) {
          // Supabase unavailable — hide the login UI, stay a guest.
          panel.style.display = 'none';
          return;
        }

        const client = window.supabase.createClient(sb.url, sb.anonKey);
        window.__slimeSupabase = client;

        // Restore an existing session (returning player) and keep the socket
        // token in sync whenever auth state changes (sign in / out / refresh).
        client.auth.onAuthStateChange((_event, session) => {
          const user = session && session.user ? session.user : null;
          renderSession(user);
          applyToken(session && session.access_token ? session.access_token : null);
        });

        const { data } = await client.auth.getSession();
        const session = data && data.session ? data.session : null;
        renderSession(session && session.user ? session.user : null);
        if (session && session.access_token) applyToken(session.access_token);

        signInBtn.addEventListener('click', async () => {
          setMsg('Signing in…');
          const { error } = await client.auth.signInWithPassword({
            email: emailEl.value.trim(),
            password: passEl.value,
          });
          if (error) setMsg(error.message || 'Sign-in failed.', true);
          else { setMsg('Signed in — your progress will be saved.'); passEl.value = ''; }
        });

        signUpBtn.addEventListener('click', async () => {
          setMsg('Creating account…');
          const { data: res, error } = await client.auth.signUp({
            email: emailEl.value.trim(),
            password: passEl.value,
          });
          if (error) { setMsg(error.message || 'Sign-up failed.', true); return; }
          passEl.value = '';
          // If email confirmation is required, there is no session yet.
          if (res && res.session) setMsg('Account created — your progress will be saved.');
          else setMsg('Account created — check your email to confirm, then sign in.');
        });

        signOutBtn.addEventListener('click', async () => {
          await client.auth.signOut();
          setMsg('Signed out — playing as a guest.');
        });
      }

      boot();
    })();
