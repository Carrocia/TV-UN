import { api, isSupportedVideo } from './api.js?v=playlists-20261007';
const $ = selector => document.querySelector(selector);
let state = null, activePlaylist = null, dragging = null;
function setTheme(theme) { document.body.dataset.theme = theme; localStorage.setItem('uni-theme', theme); document.querySelectorAll('[data-theme-choice]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.themeChoice === theme))); }
setTheme(localStorage.getItem('uni-theme') === 'light' ? 'light' : 'dark');
document.querySelectorAll('[data-theme-choice]').forEach(button => button.addEventListener('click', () => setTheme(button.dataset.themeChoice)));
function showError(error) { const status = $('#uploadStatus'); status.textContent = error?.message || 'Algo deu errado. Tente novamente.'; status.classList.add('has-error'); }
function render(next = state) {
  if (!next) return; state = next;
  const select = $('#playlistSelect');
  select.innerHTML = state.playlists.map(playlist => `<option value="${playlist.id}">${playlist.name.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}</option>`).join('');
  activePlaylist = state.playlists.find(item => item.id === activePlaylist?.id) || state.playlists.find(item => item.id === state.playlistId) || state.playlists[0] || null;
  if (activePlaylist) select.value = activePlaylist.id;
  const list = $('#playlistList'); list.innerHTML = '';
  $('#playlistTitle').textContent = activePlaylist?.name || 'Crie sua primeira playlist';
  $('#playlistCount').textContent = `${activePlaylist?.items.length || 0} vídeo${activePlaylist?.items.length === 1 ? '' : 's'}`;
  $('#renamePlaylist').disabled = !activePlaylist; $('#deletePlaylist').disabled = !activePlaylist;
  if (!activePlaylist?.items.length) { list.innerHTML = '<div class="playlist-empty"><div><span>▷</span>Esta playlist ainda está vazia.<br>Envie ou arraste seus vídeos acima.</div></div>'; return; }
  activePlaylist.items.forEach((video, index) => {
    const row = document.createElement('article'); row.className = 'video-row editor-row'; row.draggable = true; row.dataset.itemId = video.itemId;
    const safeName = video.name.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    row.innerHTML = `<span class="drag-handle" aria-label="Arrastar para ordenar">⠿</span><span class="video-thumb">▷</span><span class="editor-video-info"><strong class="video-name">${safeName}</strong><small class="video-subtitle">Vídeo ${String(index + 1).padStart(2, '0')}</small></span><label class="transition-label">Transição<select data-transition="${video.itemId}" aria-label="Transição para ${safeName}"><option value="none" ${video.transition === 'none' ? 'selected' : ''}>Sem efeito</option><option value="fade" ${video.transition === 'fade' ? 'selected' : ''}>Dissolver</option><option value="slide" ${video.transition === 'slide' ? 'selected' : ''}>Deslizar</option></select></label><button class="video-action" type="button" data-remove="${video.itemId}" aria-label="Remover ${safeName}" title="Remover vídeo">×</button>`;
    list.appendChild(row);
  });
  list.querySelectorAll('[data-transition]').forEach(control => control.addEventListener('change', async () => { try { await api.setTransition(control.dataset.transition, control.value); } catch (error) { showError(error); } }));
  list.querySelectorAll('[data-remove]').forEach(button => button.addEventListener('click', async () => { if (!confirm('Remover este vídeo desta playlist? O arquivo continuará na biblioteca do Supabase.')) return; try { await api.removeItem(button.dataset.remove); render(await api.getState()); } catch (error) { showError(error); } }));
  list.querySelectorAll('.editor-row').forEach(row => {
    row.addEventListener('dragstart', event => { dragging = row.dataset.itemId; row.classList.add('is-dragging'); event.dataTransfer.effectAllowed = 'move'; });
    row.addEventListener('dragend', () => { dragging = null; row.classList.remove('is-dragging'); });
    row.addEventListener('dragover', event => { event.preventDefault(); if (!dragging || dragging === row.dataset.itemId) return; const dragged = list.querySelector(`[data-item-id="${dragging}"]`); const bounds = row.getBoundingClientRect(); list.insertBefore(dragged, event.clientY < bounds.top + bounds.height / 2 ? row : row.nextSibling); });
    row.addEventListener('drop', async event => { event.preventDefault(); const ids = [...list.querySelectorAll('[data-item-id]')].map(item => item.dataset.itemId); try { await api.reorderItems(activePlaylist.id, ids); render(await api.getState()); } catch (error) { showError(error); } });
  });
}
$('#playlistSelect').addEventListener('change', event => { activePlaylist = state.playlists.find(item => item.id === event.target.value); render(state); });
$('#createPlaylist').addEventListener('click', async () => { const name = prompt('Nome da nova playlist:'); if (!name?.trim()) return; try { await api.createPlaylist(name); state = await api.getState(); activePlaylist = state.playlists.at(-1); render(state); } catch (error) { showError(error); } });
$('#renamePlaylist').addEventListener('click', async () => { if (!activePlaylist) return; const name = prompt('Novo nome da playlist:', activePlaylist.name); if (!name?.trim()) return; try { await api.renamePlaylist(activePlaylist.id, name); render(await api.getState()); } catch (error) { showError(error); } });
$('#deletePlaylist').addEventListener('click', async () => { if (!activePlaylist || !confirm(`Excluir a playlist “${activePlaylist.name}”? Os arquivos de vídeo não serão apagados.`)) return; try { await api.deletePlaylist(activePlaylist.id); activePlaylist = null; render(await api.getState()); } catch (error) { showError(error); } });
const fileInput = $('#videoFiles'), dropzone = $('#dropzone');
async function uploadFiles(files) { if (!activePlaylist) { showError(new Error('Crie uma playlist antes de enviar vídeos.')); return; } const queue = [...files]; for (const [index, file] of queue.entries()) { if (!isSupportedVideo(file)) { showError(new Error(`${file.name}: formato não reconhecido.`)); continue; } $('#uploadStatus').classList.remove('has-error'); $('#uploadStatus').textContent = `Enviando ${index + 1} de ${queue.length}: ${file.name}…`; try { await api.uploadVideo(file, activePlaylist.id); $('#uploadStatus').textContent = `${file.name} enviado.`; } catch (error) { showError(new Error(`${file.name}: ${error.message}`)); } } fileInput.value = ''; render(await api.getState()); }
dropzone.addEventListener('click', () => fileInput.click()); fileInput.addEventListener('change', () => uploadFiles(fileInput.files));
for (const name of ['dragenter', 'dragover']) dropzone.addEventListener(name, event => { event.preventDefault(); dropzone.classList.add('dragover'); });
for (const name of ['dragleave', 'drop']) dropzone.addEventListener(name, event => { event.preventDefault(); dropzone.classList.remove('dragover'); });
dropzone.addEventListener('drop', event => uploadFiles(event.dataTransfer.files));
$('#logoutBtn').addEventListener('click', async () => { try { await api.logout(); } finally { location.href = 'login.html'; } });
async function init() { const { session } = await api.getSession(); if (!session) { location.replace('login.html'); return; } render(await api.getState()); api.subscribe(render); }
init().catch(showError);
