// Shared auth helper — runs on every page
// Shows the #navMemberLink with the user's name when a session exists.

document.addEventListener('DOMContentLoaded', () => {
  const userId = localStorage.getItem('wc2026_userId');
  const name   = localStorage.getItem('wc2026_name');
  const link   = document.getElementById('navMemberLink');
  if (!link) return;

  if (userId && name) {
    link.textContent = '👤 ' + name;
    link.style.display = 'flex';
  }
});
