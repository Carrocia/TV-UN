import { api } from './api.js';
const $ = selector => document.querySelector(selector);
let state = { playlists: [], videos: [], current: 0, action: 'pause', position: 0, changedAt: Date.now(), playlistId: null };
function setTheme(theme) { document.body.dataset.theme = theme; localStorage.setItem('uni-theme', theme); document.querySelectorAll('[data-theme-choice]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.themeChoice === theme))); }
setTheme(localStorage.getItem('uni-theme') === 'light' ? 'light' : 'dark');
<<<<<<< HEAD
document.querySelectorAll('[data-theme-choice]').forEach(button => button.addEventListener('click', () => setTheme(button.dataset.themeChoice)));
function showError(error) { const status = $('#uploadStatus'); status.textContent = error?.message || 'Algo deu errado. Tente novamente.'; status.classList.add('has-error'); }
function render(next = state) {
  state = next;
  const playlist = state.playlists.find(item => item.id === state.playlistId) || state.playlists[0];
  if (playlist && playlist.id !== state.playlistId) { state.playlistId = playlist.id; state.videos = playlist.items; }
  else if (playlist) state.videos = playlist.items;
  const videos = state.videos || [], current = videos[state.current], playing = state.action === 'play' && Boolean(current);
  const select = $('#playlistSelect'), previousId = select.value;
  select.innerHTML = state.playlists.map(item => `<option value="${item.id}">${item.name.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}</option>`).join('');
  if (playlist) select.value = playlist.id;
  select.disabled = !state.playlists.length;
=======
document.querySelectorAll('[data-theme-choice]').forEach(button => button.addEventListener('click', () => {
  setTheme(button.dataset.themeChoice);
}));

const navLinks = [...document.querySelectorAll('.nav-link[href^="#"]')];
const navSections = navLinks.map(link => document.querySelector(link.getAttribute('href'))).filter(Boolean);
function setActiveSection(id) {
  navLinks.forEach(link => {
    const active = link.hash === `#${id}`;
    link.classList.toggle('is-active', active);
    if (active) link.setAttribute('aria-current', 'location');
    else link.removeAttribute('aria-current');
  });
}
navLinks.forEach(link => link.addEventListener('click', () => setActiveSection(link.hash.slice(1))));
window.addEventListener('hashchange', () => setActiveSection(location.hash.slice(1) || 'painel'));
function updateActiveSectionFromScroll() {
  if (!navSections.length) return;
  const atPageEnd = window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 2;
  if (atPageEnd) { setActiveSection(navSections.at(-1).id); return; }
  const activationLine = window.scrollY + Math.min(144, window.innerHeight * 0.2);
  const current = navSections.filter(section => section.getBoundingClientRect().top + window.scrollY <= activationLine).at(-1);
  setActiveSection((current || navSections[0]).id);
}
let scrollFrame = 0;
window.addEventListener('scroll', () => {
  cancelAnimationFrame(scrollFrame);
  scrollFrame = requestAnimationFrame(updateActiveSectionFromScroll);
}, { passive: true });
setActiveSection(location.hash.slice(1) || 'painel');

function escapeHtml(value = '') {
  return String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
}

function render(nextState = state) {
  state = nextState;
  const videos = state.videos || [];
  const current = videos[state.current];
  const playing = state.action === 'play' && Boolean(current);

>>>>>>> ed74c20df62dc8744b015131348c076c5788da38
  $('#videoCount').textContent = String(videos.length).padStart(2, '0');
  $('#playlistNameCaption').textContent = playlist?.name || 'Nenhuma playlist';
  $('#playState').textContent = !current ? 'Aguardando' : playing ? 'Reproduzindo' : 'Pausado';
  $('#currentVideoShort').textContent = current?.name || 'Nenhum vídeo selecionado';
  $('#liveText').textContent = !current ? 'Sem vídeo' : playing ? 'Reproduzindo' : 'Pausado';
  $('#livePill').classList.toggle('is-paused', !playing);
  $('#currentVideoTitle').textContent = current?.name || 'Sua mensagem\nem todas as telas.';
  $('#previewDescription').textContent = current ? `Transmitindo a playlist “${playlist?.name}” para as TVs conectadas.` : 'Abra a página Playlist para criar sua programação.';
  $('#currentVideoName').textContent = current?.name || 'Playlist vazia';
  $('#currentVideoMeta').textContent = current ? `Vídeo ${state.current + 1} de ${videos.length}` : 'Aguardando o primeiro vídeo';
  $('#pauseBtn').disabled = !current || !playing; $('#playBtn').disabled = !current || playing;
  if (previousId && previousId !== playlist?.id) select.value = playlist?.id || '';
}
$('#playlistSelect').addEventListener('change', async event => { try { render(await api.sendCommand({ playlistId: event.target.value, action: 'pause', current: 0, position: 0 })); } catch (error) { showError(error); } });
$('#playBtn').addEventListener('click', () => api.sendCommand({ playlistId: state.playlistId, action: 'play', current: state.current, position: state.position }).then(render).catch(showError));
$('#pauseBtn').addEventListener('click', () => api.sendCommand({ playlistId: state.playlistId, action: 'pause', current: state.current, position: state.position + (state.action === 'play' ? (Date.now() - state.changedAt) / 1000 : 0) }).then(render).catch(showError));
$('#logoutBtn').addEventListener('click', async () => { try { await api.logout(); } finally { location.href = 'login.html'; } });
async function initialize() {
  const { session } = await api.getSession(); if (!session) { location.replace('login.html'); return; }
  render(await api.getState());
  api.subscribe(render, connected => { $('.server-indicator').innerHTML = `<i></i> ${connected ? 'Central online' : 'Reconectando…'}`; });
}
initialize().catch(showError);
