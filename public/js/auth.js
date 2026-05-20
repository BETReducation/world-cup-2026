// Shared auth helper — runs on every page
// Shows the user's name and a logout button in the nav when a session exists.

document.addEventListener('DOMContentLoaded', () => {
  const userId = localStorage.getItem('wc2026_userId');
  const name   = localStorage.getItem('wc2026_name');
  const link   = document.getElementById('navMemberLink');
  if (!link) return;

  if (userId && name) {
    link.textContent = '👤 ' + name;
    link.style.display = 'flex';

    const logoutBtn = document.createElement('button');
    logoutBtn.textContent = 'Log out';
    logoutBtn.className = 'btn btn-outline btn-sm';
    logoutBtn.style.marginLeft = '6px';
    logoutBtn.addEventListener('click', () => {
      localStorage.removeItem('wc2026_userId');
      localStorage.removeItem('wc2026_name');
      location.reload();
    });
    link.insertAdjacentElement('afterend', logoutBtn);
  }
});
