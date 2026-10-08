import { api } from './api.js?v=tv-transition-20261008';

const stage = document.querySelector('#stage');
const bar = document.querySelector('#bar');
const title = document.querySelector('#title');
const status = document.querySelector('#status');
const DEVICE_STORAGE_KEY = 'uni-tv-device-id';
let deviceId;
try {
  deviceId = localStorage.getItem(DEVICE_STORAGE_KEY);
  if (!deviceId) { deviceId = crypto.randomUUID(); localStorage.setItem(DEVICE_STORAGE_KEY, deviceId); }
} catch { deviceId = crypto.randomUUID(); }
let state = null;
let activeVideoId = null;
let videoElement = null;
let displayedVideo = null;
let pendingVideo = null;
let warmedVideo = null;
let warmedVideoId = null;
let transitionTimer;
let hideTimer;
let advancing = false;
const advancedVideos = new WeakSet();

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
  clearTimeout(transitionTimer);
  pendingVideo = null;
  videoElement = null;
  displayedVideo = null;
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

function warmNextVideo(playbackState) {
  const videos = playbackState.videos || [];
  if (videos.length < 2) return;
  const next = videos[(playbackState.current + 1) % videos.length];
  if (warmedVideoId === next.id) return;
  warmedVideo?.remove();
  warmedVideo = document.createElement('video');
  warmedVideoId = next.id;
  warmedVideo.className = 'tv-video tv-preload';
  warmedVideo.preload = 'auto';
  warmedVideo.muted = true;
  warmedVideo.playsInline = true;
  warmedVideo.src = new URL(next.url, location.href).href;
  stage.append(warmedVideo);
}

function render(nextState) {
  state = nextState;
  const current = state.videos?.[state.current];
  if (!current) { showEmpty('Nenhum vídeo na programação'); return; }

  title.textContent = `${String(state.current + 1).padStart(2, '0')} · ${current.name}`;
  setStatus(state.action === 'play' ? 'Conectando vídeo…' : 'Pausado', state.action === 'play' ? 'playing' : 'paused');
  if (current.id !== activeVideoId) {
    const transition = current.transition || 'none';
    clearTimeout(transitionTimer);
    if (pendingVideo && pendingVideo !== videoElement) pendingVideo.remove();
    const outgoing = displayedVideo?.isConnected ? displayedVideo : null;
    const incoming = warmedVideoId === current.id ? warmedVideo : document.createElement('video');
    warmedVideo = null;
    warmedVideoId = null;
    stage.querySelectorAll('.tv-video').forEach(video => {
      if (video !== outgoing && video !== incoming) video.remove();
    });
    if (outgoing) advancedVideos.add(outgoing);
    activeVideoId = current.id;
    pendingVideo = incoming;
    videoElement = incoming;
    incoming.className = `tv-video${transition === 'fade' ? ' tv-incoming tv-incoming-fade' : transition === 'slide' ? ' tv-incoming tv-incoming-slide' : ''}`;
    incoming.muted = false;
    incoming.playsInline = true;
    incoming.autoplay = true;
    incoming.preload = 'auto';
    if (!incoming.src || incoming.src !== new URL(current.url, location.href).href) {
      incoming.src = new URL(current.url, location.href).href;
    }
    incoming.addEventListener('loadedmetadata', () => {
      if (incoming === videoElement && state) alignPlayback(state);
    });
    const beginTransition = () => {
      if (incoming !== pendingVideo || incoming !== videoElement) return;
      pendingVideo = null;
      if (!incoming.isConnected) stage.append(incoming);
      displayedVideo = incoming;
      if (!outgoing || transition === 'none' || !outgoing.isConnected) {
        outgoing?.remove();
        incoming.classList.remove('tv-incoming', 'tv-incoming-fade', 'tv-incoming-slide');
        if (state) alignPlayback(state);
        return;
      }
      if (state) alignPlayback(state);
      requestAnimationFrame(() => {
        incoming.classList.remove(transition === 'fade' ? 'tv-incoming-fade' : 'tv-incoming-slide');
        outgoing.classList.add(transition === 'fade' ? 'tv-outgoing-fade' : 'tv-outgoing-slide');
      });
      transitionTimer = setTimeout(() => {
        outgoing.pause();
        outgoing.remove();
        incoming.classList.remove('tv-incoming');
      }, transition === 'fade' ? 850 : 1100);
    };
    incoming.addEventListener('canplay', beginTransition, { once: true });
    if (incoming.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA) queueMicrotask(beginTransition);
    incoming.addEventListener('ended', async () => {
      if (advancedVideos.has(incoming) || advancing) return;
      advancedVideos.add(incoming);
      advancing = true;
      const expectedCurrent = state.current;
      const nextCurrent = (expectedCurrent + 1) % state.videos.length;
      render({ ...state, current: nextCurrent, position: 0, changedAt: Date.now(), action: 'play' });
      try {
        const serverState = await api.advanceFromTv(expectedCurrent, deviceId);
        if (serverState.current !== state.current || serverState.playlistId !== state.playlistId) render(serverState);
      } catch (error) {
        console.error('Falha ao avançar a playlist:', error);
        // A reprodução local continua; o próximo sinal do Supabase sincroniza o estado.
      } finally {
        advancing = false;
      }
    });
    incoming.addEventListener('error', () => {
      if (incoming !== videoElement) return;
      pendingVideo = null;
      if (outgoing?.isConnected) {
        videoElement = outgoing;
        displayedVideo = outgoing;
        activeVideoId = null;
      }
      setStatus('Formato não compatível com esta TV', 'error');
      showOverlay();
    });
    if (!incoming.isConnected) stage.append(incoming);
  }
  if (!pendingVideo) alignPlayback(state);
  warmNextVideo(state);
}

async function connectPlayer() {
  try {
    await api.registerTvDevice(deviceId);
    render(await api.getTvState(deviceId));
    setInterval(() => api.registerTvDevice(deviceId).catch(error => {
      console.warn('Falha no sinal de presença da TV:', error);
      setStatus('Reconectando…', 'error');
    }), 30000);
    api.subscribe(render, connected => { if (!connected) setStatus('Reconectando…', 'error'); }, deviceId);
  } catch (error) {
    console.error('Falha ao conectar o player da TV:', error);
    const message = error?.message?.startsWith('Configure a Project URL') ? 'Player ainda não configurado' : 'Falha ao registrar esta TV';
    showEmpty(message);
  }
}
connectPlayer();
document.addEventListener('mousemove', showOverlay);
document.addEventListener('click', () => { if (videoElement && state?.action === 'play') videoElement.play().catch(() => {}); showOverlay(); });
document.addEventListener('keydown', event => {
  if (event.key.toLowerCase() === 'f') {
    if (!document.fullscreenElement) document.documentElement.requestFullscreen?.();
    else document.exitFullscreen?.();
  }
});
showOverlay();
