import { api, isSupportedVideo } from './api.js';

const $ = selector => document.querySelector(selector);
const fileInput = $('#videoFiles');
const dropzone = $('#dropzone');
const uploadStatus = $('#uploadStatus');
let state = { videos: [], current: 0, action: 'pause', position: 0, changedAt: Date.now() };

function setTheme(theme) {
  document.body.dataset.theme = theme;
  localStorage.setItem('uni-theme', theme);
  document.querySelectorAll('[data-theme-choice]').forEach(button => {
    button.setAttribute('aria-pressed', String(button.dataset.themeChoice === theme));
  });
}

setTheme(localStorage.getItem('uni-theme') === 'light' ? 'light' : 'dark');
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

  $('#videoCount').textContent = String(videos.length).padStart(2, '0');
  $('#playState').textContent = !current ? 'Aguardando' : playing ? 'Reproduzindo' : 'Pausado';
  $('#currentVideoShort').textContent = current?.name || 'Nenhum vídeo selecionado';
  $('#liveText').textContent = !current ? 'Sem vídeo' : playing ? 'Reproduzindo' : 'Pausado';
  $('#livePill').classList.toggle('is-paused', !playing);
  $('#currentVideoTitle').textContent = current?.name || 'Sua mensagem\nem todas as telas.';
  $('#previewDescription').textContent = current ? 'Transmitindo para o player conectado à central.' : 'Adicione vídeos à playlist para começar a transmitir.';
  $('#currentVideoName').textContent = current?.name || 'Playlist vazia';
  $('#currentVideoMeta').textContent = current ? `Vídeo ${state.current + 1} de ${videos.length}` : 'Aguardando o primeiro vídeo';
  $('#pauseBtn').disabled = !current || !playing;
  $('#playBtn').disabled = !current || playing;

  const playlist = $('#playlistList');
  playlist.innerHTML = '';
  $('#playlistDuration').textContent = `${videos.length} vídeo${videos.length === 1 ? '' : 's'}`;
  if (!videos.length) {
    playlist.innerHTML = '<div class="playlist-empty"><div><span>▷</span>A playlist ainda está vazia.<br>Envie os vídeos para as telas.</div></div>';
    return;
  }

  videos.forEach((video, index) => {
    const row = document.createElement('div');
    row.className = `video-row${index === state.current ? ' is-current' : ''}`;
    row.innerHTML = `<button class="video-select" type="button" data-index="${index}" aria-label="Reproduzir ${escapeHtml(video.name)}"><span class="video-thumb">▷</span><span><span class="video-name">${escapeHtml(video.name)}</span><span class="video-subtitle">Vídeo ${String(index + 1).padStart(2, '0')} · Playlist padrão</span></span></button><button class="video-action" type="button" data-video-id="${escapeHtml(video.id)}" aria-label="Remover ${escapeHtml(video.name)}" title="Remover vídeo">×</button>`;
    playlist.appendChild(row);
  });

  playlist.querySelectorAll('[data-index]').forEach(button => button.addEventListener('click', () => {
    api.sendCommand({ action: 'play', current: Number(button.dataset.index), position: 0 }).catch(showError);
  }));
  playlist.querySelectorAll('[data-video-id]').forEach(button => button.addEventListener('click', async () => {
    if (!window.confirm('Remover este vídeo da playlist?')) return;
    try { render(await api.removeVideo(button.dataset.videoId)); } catch (error) { showError(error); }
  }));
}

function showError(error) {
  uploadStatus.textContent = error?.message || 'Algo deu errado. Tente novamente.';
  uploadStatus.classList.add('has-error');
}

async function uploadFiles(files) {
  const queue = [...files];
  for (let index = 0; index < queue.length; index += 1) {
    const file = queue[index];
    if (!isSupportedVideo(file)) {
      uploadStatus.textContent = `${file.name}: formato não reconhecido. Use MP4, WebM, OGG ou MOV.`;
      uploadStatus.classList.add('has-error');
      continue;
    }
    uploadStatus.classList.remove('has-error');
    uploadStatus.textContent = `Enviando ${index + 1} de ${queue.length}: ${file.name}…`;
    try {
      await api.uploadVideo(file);
      uploadStatus.textContent = `${file.name} enviado com sucesso.`;
    } catch (error) {
      showError(new Error(`${file.name}: ${error.message}`));
    }
  }
  fileInput.value = '';
}

function chooseFiles() { fileInput.click(); }

$('#chooseVideos').addEventListener('click', chooseFiles);
$('#addToPlaylist').addEventListener('click', chooseFiles);
dropzone.addEventListener('click', chooseFiles);
dropzone.addEventListener('keydown', event => {
  if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); chooseFiles(); }
});
fileInput.addEventListener('change', () => uploadFiles(fileInput.files));
for (const eventName of ['dragenter', 'dragover']) dropzone.addEventListener(eventName, event => {
  event.preventDefault(); dropzone.classList.add('dragover');
});
for (const eventName of ['dragleave', 'drop']) dropzone.addEventListener(eventName, event => {
  event.preventDefault(); dropzone.classList.remove('dragover');
});
dropzone.addEventListener('drop', event => uploadFiles(event.dataTransfer.files));

$('#playBtn').addEventListener('click', () => api.sendCommand({
  action: 'play', current: state.current || 0, position: state.position || 0
}).catch(showError));
$('#pauseBtn').addEventListener('click', () => api.sendCommand({
  action: 'pause', current: state.current || 0,
  position: (state.position || 0) + (state.action === 'play' ? (Date.now() - state.changedAt) / 1000 : 0)
}).catch(showError));
$('#logoutBtn').addEventListener('click', async () => {
  try { await api.logout(); } finally { location.href = '/login.html'; }
});

$('#copyTvLink').addEventListener('click', async event => {
  const button = event.currentTarget;
  try {
    await navigator.clipboard.writeText($('#tvLink').textContent);
    button.textContent = 'Copiado';
    setTimeout(() => { button.textContent = 'Copiar link'; }, 1800);
  } catch { uploadStatus.textContent = 'Não foi possível copiar automaticamente. Selecione e copie o endereço do player.'; }
});

function loadTvLink() {
  const url = new URL('tv.html', location.href).href;
  $('#tvLink').textContent = url;
  $('#openTv').href = url;
}

async function initialize() {
  const { session } = await api.getSession();
  if (!session) { location.replace('login.html'); return; }
  render(await api.getState());
  api.subscribe(render, connected => {
    $('.server-indicator').innerHTML = `<i></i> ${connected ? 'Central online' : 'Reconectando…'}`;
  });
  loadTvLink();
}

initialize().catch(showError);
