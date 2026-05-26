// Shared auth + mobile drawer — runs on every page

document.addEventListener('DOMContentLoaded', () => {
  const userId = localStorage.getItem('wc2026_userId');
  const name   = localStorage.getItem('wc2026_name');

  // ── Mobile drawer ──────────────────────────────────────────────────────────
  const hamburger     = document.getElementById('navHamburger');
  const drawerOverlay = document.getElementById('navDrawerOverlay');
  const drawer        = document.getElementById('navDrawer');
  const drawerClose   = document.getElementById('navDrawerClose');

  function openDrawer() {
    drawerOverlay?.classList.add('open');
    drawer?.classList.add('open');
    document.body.style.overflow = 'hidden';
  }
  function closeDrawer() {
    drawerOverlay?.classList.remove('open');
    drawer?.classList.remove('open');
    document.body.style.overflow = '';
  }

  hamburger?.addEventListener('click', openDrawer);
  drawerOverlay?.addEventListener('click', closeDrawer);
  drawerClose?.addEventListener('click', closeDrawer);

  // Mark the active drawer link based on current page
  if (drawer) {
    const page = location.pathname.split('/').pop() || 'index.html';
    drawer.querySelectorAll('a[href]').forEach(a => {
      const href = a.getAttribute('href');
      if (href === page || (page === '' && href === 'index.html')) {
        a.classList.add('active');
      }
    });
    // Close drawer when a real nav link is tapped
    drawer.querySelectorAll('.nav-drawer-links a').forEach(a =>
      a.addEventListener('click', closeDrawer)
    );
  }

  // ── Desktop nav member link ────────────────────────────────────────────────
  const link        = document.getElementById('navMemberLink');
  const drawerFooter = document.getElementById('navDrawerUser');

  if (!link) return;

  if (userId && name) {
    // ── Logged in ─────────────────────────────────────────────────────────────
    link.innerHTML     = '<i class="fa-solid fa-user"></i> ' + name;
    link.href          = 'member.html?id=' + userId;
    link.style.display = 'flex';

    const logoutBtn = document.createElement('button');
    logoutBtn.textContent    = 'Log out';
    logoutBtn.className      = 'btn btn-outline btn-sm';
    logoutBtn.style.marginLeft = '4px';
    logoutBtn.addEventListener('click', doLogout);
    link.insertAdjacentElement('afterend', logoutBtn);

    // Drawer footer: profile link + logout
    if (drawerFooter) {
      const profileLink = document.createElement('a');
      profileLink.innerHTML = '<i class="fa-solid fa-user"></i> ' + name;
      profileLink.href        = 'member.html?id=' + userId;
      profileLink.addEventListener('click', closeDrawer);

      const drawerLogout = document.createElement('button');
      drawerLogout.textContent = 'Log out';
      drawerLogout.className   = 'btn btn-outline btn-sm btn-full';
      drawerLogout.addEventListener('click', doLogout);

      drawerFooter.appendChild(profileLink);
      drawerFooter.appendChild(drawerLogout);
    }

  } else {
    // ── Logged out ────────────────────────────────────────────────────────────
    const signInBtn = document.createElement('button');
    signInBtn.textContent    = 'Sign in';
    signInBtn.className      = 'btn btn-outline btn-sm';
    signInBtn.style.marginLeft = '4px';
    signInBtn.addEventListener('click', () => openAuthModal());
    link.insertAdjacentElement('afterend', signInBtn);

    // Inject auth modal
    document.body.insertAdjacentHTML('beforeend', `
      <div class="modal-overlay" id="navAuthModal">
        <div class="modal">
          <h2><i class="fa-regular fa-futbol"></i> Sign in</h2>
          <p>Enter your name and 4-digit PIN. New here? A new account will be created automatically.</p>
          <div id="navAuthError" class="error-msg hidden"></div>
          <div class="form-group">
            <label for="navAuthName">Your name</label>
            <input type="text" id="navAuthName" placeholder="e.g. Gary" maxlength="30" autocomplete="off">
          </div>
          <div class="form-group">
            <label for="navAuthPin">4-digit PIN</label>
            <input type="number" id="navAuthPin" placeholder="e.g. 1234" min="1000" max="9999" inputmode="numeric">
            <small>Choose any 4-digit number — you'll need it to log in again.</small>
          </div>
          <button class="btn btn-primary btn-full" id="navAuthSubmit">Sign in →</button>
          <button class="btn btn-outline btn-full" id="navAuthCancel" style="margin-top:8px;">Cancel</button>
        </div>
      </div>`);

    const modal     = document.getElementById('navAuthModal');
    const nameInput = document.getElementById('navAuthName');
    const pinInput  = document.getElementById('navAuthPin');
    const submitBtn = document.getElementById('navAuthSubmit');
    const cancelBtn = document.getElementById('navAuthCancel');
    const errorEl   = document.getElementById('navAuthError');

    function openAuthModal() {
      nameInput.value = '';
      pinInput.value  = '';
      errorEl.classList.add('hidden');
      modal.classList.add('open');
      setTimeout(() => nameInput.focus(), 50);
    }
    function closeAuthModal() { modal.classList.remove('open'); }

    cancelBtn.addEventListener('click', closeAuthModal);
    modal.addEventListener('click', e => { if (e.target === modal) closeAuthModal(); });
    nameInput.addEventListener('keydown', e => { if (e.key === 'Enter') pinInput.focus(); });
    pinInput.addEventListener('keydown',  e => { if (e.key === 'Enter') submitBtn.click(); });

    submitBtn.addEventListener('click', async () => {
      const n = nameInput.value.trim();
      const p = pinInput.value.trim();
      errorEl.classList.add('hidden');
      if (!n) { showNavErr('Please enter your name.'); return; }
      if (!/^\d{4}$/.test(p)) { showNavErr('PIN must be exactly 4 digits.'); return; }

      submitBtn.disabled    = true;
      submitBtn.textContent = 'Signing in…';
      try {
        const res  = await fetch('/api/register', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: n, pin: p })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Error');
        Session.save(data.userId, data.name, data.token);
        location.reload();
      } catch (e) {
        const msg = e.message.includes('PIN')
          ? 'That name exists with a different PIN.'
          : 'Could not reach server. Is it running?';
        showNavErr(msg);
        submitBtn.disabled    = false;
        submitBtn.textContent = 'Sign in →';
      }
    });

    function showNavErr(msg) {
      errorEl.textContent = msg;
      errorEl.classList.remove('hidden');
    }

    // Drawer footer: sign-in button
    if (drawerFooter) {
      const drawerSignIn = document.createElement('button');
      drawerSignIn.textContent = 'Sign in';
      drawerSignIn.className   = 'btn btn-outline btn-sm btn-full';
      drawerSignIn.addEventListener('click', () => {
        closeDrawer();
        openAuthModal();
      });
      drawerFooter.appendChild(drawerSignIn);
    }
  }

  async function doLogout() {
    await API.logout();
    Session.clear();
    location.reload();
  }
});
