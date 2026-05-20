// Shared auth helper — runs on every page
// Injects a Sign in / Log out button into the nav and a login modal into the page.

document.addEventListener('DOMContentLoaded', () => {
  const userId = localStorage.getItem('wc2026_userId');
  const name   = localStorage.getItem('wc2026_name');
  const link   = document.getElementById('navMemberLink');
  if (!link) return;

  if (userId && name) {
    // ── Logged in: show name + Log out ──────────────────────────────────────
    link.textContent   = '👤 ' + name;
    link.href          = 'member.html?id=' + userId;
    link.style.display = 'flex';

    const logoutBtn = document.createElement('button');
    logoutBtn.textContent = 'Log out';
    logoutBtn.className   = 'btn btn-outline btn-sm';
    logoutBtn.style.marginLeft = '4px';
    logoutBtn.addEventListener('click', () => {
      localStorage.removeItem('wc2026_userId');
      localStorage.removeItem('wc2026_name');
      location.reload();
    });
    link.insertAdjacentElement('afterend', logoutBtn);

  } else {
    // ── Logged out: show Sign in button ─────────────────────────────────────
    const signInBtn = document.createElement('button');
    signInBtn.textContent = 'Sign in';
    signInBtn.className   = 'btn btn-outline btn-sm';
    signInBtn.style.marginLeft = '4px';
    signInBtn.addEventListener('click', () => openAuthModal());
    link.insertAdjacentElement('afterend', signInBtn);

    // ── Inject login modal ───────────────────────────────────────────────────
    const modalHtml = `
      <div class="modal-overlay" id="navAuthModal">
        <div class="modal">
          <h2>⚽ Sign in</h2>
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
      </div>`;
    document.body.insertAdjacentHTML('beforeend', modalHtml);

    const modal      = document.getElementById('navAuthModal');
    const nameInput  = document.getElementById('navAuthName');
    const pinInput   = document.getElementById('navAuthPin');
    const submitBtn  = document.getElementById('navAuthSubmit');
    const cancelBtn  = document.getElementById('navAuthCancel');
    const errorEl    = document.getElementById('navAuthError');

    function openAuthModal() {
      nameInput.value = '';
      pinInput.value  = '';
      errorEl.classList.add('hidden');
      modal.classList.add('open');
      setTimeout(() => nameInput.focus(), 50);
    }

    function closeAuthModal() {
      modal.classList.remove('open');
    }

    cancelBtn.addEventListener('click', closeAuthModal);
    modal.addEventListener('click', e => { if (e.target === modal) closeAuthModal(); });
    nameInput.addEventListener('keydown', e => { if (e.key === 'Enter') pinInput.focus(); });
    pinInput.addEventListener('keydown',  e => { if (e.key === 'Enter') submitBtn.click(); });

    submitBtn.addEventListener('click', async () => {
      const name = nameInput.value.trim();
      const pin  = pinInput.value.trim();

      errorEl.classList.add('hidden');
      if (!name) { showNavErr('Please enter your name.'); return; }
      if (!/^\d{4}$/.test(pin)) { showNavErr('PIN must be exactly 4 digits.'); return; }

      submitBtn.disabled   = true;
      submitBtn.textContent = 'Signing in…';

      try {
        const res = await fetch('/api/register', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, pin })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Error');

        localStorage.setItem('wc2026_userId', data.userId);
        localStorage.setItem('wc2026_name',   data.name);
        location.reload();
      } catch (e) {
        const msg = e.message.includes('PIN')
          ? 'That name exists with a different PIN.'
          : 'Could not reach server. Is it running?';
        showNavErr(msg);
        submitBtn.disabled   = false;
        submitBtn.textContent = 'Sign in →';
      }
    });

    function showNavErr(msg) {
      errorEl.textContent = msg;
      errorEl.classList.remove('hidden');
    }
  }
});
