import { api } from './api.js?v=tv-advance-20261008';

const stage = document.querySelector('#stage');
const bar = document.querySelector('#bar');
const title = document.querySelector('#title');
const status = document.querySelector('#status');
let state = null;
let activeVideoId = null;
let videoElement = null;
let hideTimer;
let advancing = false;

function showOverlay() {
  bar.classList.add('visible');
  clearTimeout(hideTimer);
  hideTimer = setTimeout(() => bar.classList.remove('visible'), 4500);
}

function setStatus(message, mode = 'playing') {
  status.textContent = message;
  status.classList.toggle('paused', mode === 'paused');
  status.classList.toggle('error', mode === 'error');
}

function showEmpty(message) {
  videoElement = null;
  activeVideoId = null;
  stage.innerHTML = `<div class="tv-message"><span class="tv-brand"><img src="assets/images/uni-logo-dark.png" alt="UNI Internet"><i>·</i> central de telas</span><strong>${message}</strong><span>A central atualizará esta tela assim que houver programação.</span></div>`;
  title.textContent = 'Aguardando programação';
  setStatus('Sem vídeo', 'paused');
}

function alignPlayback(nextState) {
  if (!videoElement || !Number.isFinite(videoElement.duration)) return;
  const elapsed = nextState.action === 'play' ? Math.max(0, (Date.now() - nextState.changedAt) / 1000) : 0;
  const target = Math.min(nextState.position + elapsed, Math.max(0, videoElement.duration - 0.25));
  if (Math.abs(videoElement.currentTime - target) > 1.3) {
    try { videoElement.currentTime = target; } catch { /* The media is not seekable yet. */ }
  }
  if (nextState.action === 'play') {
    videoElement.play().then(() => setStatus('Reproduzindo')).catch(() => {
      setStatus('Interaja com a tela para iniciar o áudio', 'error');
      showOverlay();
    });
  } else {
    videoElement.pause();
    setStatus('Pausado', 'paused');
  }
}

function render(nextState) {
  state = nextState;
  const current = state.videos?.[state.current];
  if (!current) { showEmpty('Nenhum vídeo na programação'); return; }

  title.textContent = `${String(state.current + 1).padStart(2, '0')} · ${current.name}`;
  setStatus(state.action === 'play' ? 'Conectando vídeo…' : 'Pausado', state.action === 'play' ? 'playing' : 'paused');
  if (current.id !== activeVideoId) {
    const transition = current.transition || 'none';
    activeVideoId = current.id;
    videoElement = document.createElement('video');
    videoElement.className = 'tv-video';
    if (transition === 'fade') videoElement.classList.add('tv-enter-fade');
    if (transition === 'slide') videoElement.classList.add('tv-enter-slide');
    videoElement.playsInline = true;
    videoElement.autoplay = true;
    videoElement.preload = 'auto';
    videoElement.src = new URL(current.url, location.href).href;
    videoElement.addEventListener('loadedmetadata', () => alignPlayback(state));
    videoElement.addEventListener('ended', async () => {
      if (advancing) return;
      advancing = true;
      try {
        render(await api.advanceFromTv(state.current));
      } catch (error) {
        console.error('Falha ao avançar a playlist:', error);
        setStatus('Falha ao avançar a playlist', 'error');
        showOverlay();
      } finally {
        advancing = false;
      }
    });
    videoElement.addEventListener('error', () => {
      setStatus('Formato não compatível com esta TV', 'error');
      showOverlay();
    });
    stage.replaceChildren(videoElement);
  }
  alignPlayback(state);
}

api.getState().then(render).catch(error => {
  const message = error?.message?.startsWith('Configure a Project URL') ? 'Player ainda não configurado' : 'Servidor indisponível';
  showEmpty(message);
});
try {
  api.subscribe(render, connected => { if (!connected) setStatus('Reconectando…', 'error'); });
} catch (error) {
  const message = error?.message?.startsWith('Configure a Project URL') ? 'Player ainda não configurado' : 'Falha ao conectar à programação';
  showEmpty(message);
}
document.addEventListener('mousemove', showOverlay);
document.addEventListener('click', () => { if (videoElement && state?.action === 'play') videoElement.play().catch(() => {}); showOverlay(); });
document.addEventListener('keydown', event => {
  if (event.key.toLowerCase() === 'f') {
    if (!document.fullscreenElement) document.documentElement.requestFullscreen?.();
    else document.exitFullscreen?.();
  }
});
showOverlay();
