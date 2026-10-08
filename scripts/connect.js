import { api } from './api.js?v=playlists-20261007';
const $ = selector => document.querySelector(selector);
const link = new URL('tv.html', location.href).href;
$('#tvLink').textContent = link;
document.body.dataset.theme = localStorage.getItem('uni-theme') === 'light' ? 'light' : 'dark';
document.querySelectorAll('[data-theme-choice]').forEach(button => button.addEventListener('click', () => {
  document.body.dataset.theme = button.dataset.themeChoice;
  localStorage.setItem('uni-theme', button.dataset.themeChoice);
  document.querySelectorAll('[data-theme-choice]').forEach(item => item.setAttribute('aria-pressed', String(item === button)));
}));
$('#copyTvLink').addEventListener('click', async event => {
  try { await navigator.clipboard.writeText(link); event.currentTarget.textContent = 'Copiado'; setTimeout(() => { event.currentTarget.textContent = 'Copiar link'; }, 1800); }
  catch { $('#copyStatus').textContent = 'Copie o endereço exibido acima.'; }
});
$('#logoutBtn').addEventListener('click', async () => { try { await api.logout(); } finally { location.href = 'login.html'; } });
api.getSession().then(({ session }) => { if (!session) location.replace('login.html'); }).catch(() => location.replace('login.html'));
