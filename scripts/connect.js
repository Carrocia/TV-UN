import { api } from './api.js?v=devices-20261008';
const $ = selector => document.querySelector(selector);
let playlists = [], groups = [], tvDevices = [], refreshing = false;
const tvLink = new URL('tv.html', location.href).href;

function escapeHtml(value = '') { return String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char])); }
function showError(error, target = $('#deviceStatus')) { target.textContent = error?.message || 'Não foi possível concluir essa ação.'; target.classList.add('has-error'); }
function setTheme(theme) { document.body.dataset.theme = theme; localStorage.setItem('uni-theme', theme); document.querySelectorAll('[data-theme-choice]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.themeChoice === theme))); }
setTheme(localStorage.getItem('uni-theme') === 'light' ? 'light' : 'dark');
document.querySelectorAll('[data-theme-choice]').forEach(button => button.addEventListener('click', () => setTheme(button.dataset.themeChoice)));
$('#tvLink').textContent = tvLink;
$('#copyTvLink').addEventListener('click', async event => {
  try { await navigator.clipboard.writeText(tvLink); event.currentTarget.textContent = 'Copiado'; setTimeout(() => { event.currentTarget.textContent = 'Copiar link'; }, 1800); }
  catch { showError(new Error('Copie o endereço exibido acima.')); }
});
$('#logoutBtn').addEventListener('click', async () => { try { await api.logout(); } finally { location.href = 'login.html'; } });

function playlistOptions(selectedId) { return playlists.map(playlist => `<option value="${playlist.id}" ${playlist.id === selectedId ? 'selected' : ''}>${escapeHtml(playlist.name)}</option>`).join(''); }
function videoOptions(playlistId, selectedIndex = 0) {
  const playlist = playlists.find(item => item.id === playlistId);
  if (!playlist?.items.length) return '<option value="">Playlist vazia</option>';
  return playlist.items.map((video, index) => `<option value="${index}" ${index === selectedIndex ? 'selected' : ''}>${index + 1}. ${escapeHtml(video.name)}</option>`).join('');
}
function renderGroups() {
  const list = $('#groupList');
  $('#groupSummary').textContent = `${groups.length} grupo${groups.length === 1 ? '' : 's'}`;
  if (!groups.length) {
    list.innerHTML = '<div class="group-empty"><strong>Nenhum grupo cadastrado</strong><span>Crie seu primeiro grupo acima, como “Recepção” ou “Loja Centro”.</span></div>';
    return;
  }
  list.innerHTML = groups.map(group => {
    const count = tvDevices.filter(device => device.group_id === group.id).length;
    const membership = count ? `${count} TV ${count === 1 ? 'associada' : 'associadas'}` : 'Nenhuma TV associada';
    return `<article class="group-card" data-group-id="${group.id}"><div class="group-card-info"><strong>${escapeHtml(group.name)}</strong><span>${membership}</span></div><div class="group-card-edit"><input data-group-name value="${escapeHtml(group.name)}" maxlength="80" aria-label="Nome do grupo ${escapeHtml(group.name)}"><button class="button button-quiet button-small" data-save-group type="button">Salvar nome</button><button class="button button-quiet button-small group-delete" data-delete-group type="button">Excluir</button></div><small class="group-card-status" data-group-message></small></article>`;
  }).join('');

  list.querySelectorAll('[data-group-id]').forEach(card => {
    const group = groups.find(item => item.id === card.dataset.groupId);
    const status = card.querySelector('[data-group-message]');
    card.querySelector('[data-save-group]').addEventListener('click', async () => {
      const name = card.querySelector('[data-group-name]').value.trim();
      if (!name) { status.textContent = 'Digite um nome para o grupo.'; status.classList.add('has-error'); return; }
      try { await api.renameTvGroup(group.id, name); await refreshDevices(); }
      catch (error) { status.textContent = error?.message || 'Não foi possível renomear o grupo.'; status.classList.add('has-error'); }
    });
    card.querySelector('[data-delete-group]').addEventListener('click', async () => {
      const count = tvDevices.filter(device => device.group_id === group.id).length;
      const detail = count ? ` As ${count} TV(s) associadas ficarão sem grupo.` : '';
      if (!confirm(`Excluir o grupo “${group.name}”?${detail}`)) return;
      try { await api.deleteTvGroup(group.id); await refreshDevices(); }
      catch (error) { status.textContent = error?.message || 'Não foi possível excluir o grupo.'; status.classList.add('has-error'); }
    });
  });
}
function selectConnectTab(tabName) {
  const showDevices = tabName === 'devices';
  $('#devicesTab').setAttribute('aria-selected', String(showDevices));
  $('#groupsTab').setAttribute('aria-selected', String(!showDevices));
  $('#devicesView').hidden = !showDevices;
  $('#groupsView').hidden = showDevices;
}
function seenText(lastSeen, online) {
  if (online) return 'Conectada agora';
  if (!lastSeen) return 'Ainda não enviou sinal';
  const minutes = Math.max(1, Math.floor((Date.now() - Date.parse(lastSeen)) / 60000));
  return `Visto há ${minutes} min`;
}
function renderDevices(entries) {
  const list = $('#deviceList');
  const onlineCount = entries.filter(item => item.online).length;
  $('#deviceSummary').textContent = `${onlineCount} online · ${entries.length} salva${entries.length === 1 ? '' : 's'}`;
  if (!entries.length) { list.innerHTML = '<div class="device-empty">Nenhuma TV cadastrada ainda. Abra o link do player no navegador de uma TV e ela aparecerá aqui.</div>'; return; }
  list.innerHTML = entries.map(({ device, state, online }) => {
    const name = device.name || `TV ${device.id.slice(0, 4).toUpperCase()}`;
    const playlistId = state.playlistId || playlists[0]?.id || '';
    const playlist = playlists.find(item => item.id === playlistId);
    const currentIndex = Math.max(0, state.current || 0);
    const groupOptions = `<option value="">Sem grupo</option>${groups.map(group => `<option value="${group.id}" ${group.id === device.group_id ? 'selected' : ''}>${escapeHtml(group.name)}</option>`).join('')}`;
    return `<article class="device-card" data-device="${device.id}">
      <div class="device-identity"><div class="device-title-row"><i class="device-online ${online ? 'is-online' : ''}"></i><strong>${escapeHtml(name)}</strong><span class="device-state-label ${online ? 'is-online' : ''}">${online ? 'Online' : 'Offline'}</span></div><code class="device-code">ID ${escapeHtml(device.id.slice(0, 8).toUpperCase())} · navegador cadastrado</code><small class="device-seen">${seenText(device.last_seen_at, online)}</small></div>
      <div class="device-settings"><div class="device-setting-line"><input data-device-name value="${escapeHtml(device.name || '')}" maxlength="80" placeholder="Nome da TV" aria-label="Nome desta TV"><button class="button button-quiet button-small" data-save-name type="button">Salvar nome</button></div><div class="device-target-line"><select data-device-group aria-label="Grupo de telas">${groupOptions}</select><input data-screen-order type="number" min="1" max="100" value="${Number(device.screen_order) || 1}" aria-label="Ordem da tela no grupo" title="Posição para futuras animações entre telas"></div><button class="button button-quiet button-small" data-save-layout type="button">Salvar grupo e posição</button></div>
      <div class="device-target"><span class="device-target-title">REPRODUZIR NESTA TV</span><div class="device-target-line"><select data-target-playlist aria-label="Playlist para esta TV">${playlistOptions(playlistId)}</select><select data-target-video aria-label="Vídeo inicial desta TV">${videoOptions(playlistId, currentIndex)}</select></div><div class="device-actions"><button class="button button-primary" data-send type="button" ${!playlist?.items.length ? 'disabled' : ''}>▶ Enviar e tocar</button><button class="button button-quiet" data-pause type="button">Ⅱ Pausar</button><button class="button button-quiet" data-follow-global type="button">Seguir todas</button></div><small class="device-control-message" data-device-message>${state.deviceOverride ? 'Programação individual ativa' : 'Seguindo a programação geral'}</small></div>
    </article>`;
  }).join('');

  list.querySelectorAll('[data-device]').forEach(card => {
    const deviceId = card.dataset.device;
    const playlistSelect = card.querySelector('[data-target-playlist]');
    const videoSelect = card.querySelector('[data-target-video]');
    const message = card.querySelector('[data-device-message]');
    playlistSelect.addEventListener('change', () => { videoSelect.innerHTML = videoOptions(playlistSelect.value, 0); card.querySelector('[data-send]').disabled = !playlists.find(item => item.id === playlistSelect.value)?.items.length; });
    card.querySelector('[data-save-name]').addEventListener('click', async () => {
      try { await api.updateTvDevice(deviceId, { name: card.querySelector('[data-device-name]').value.trim() }); await refreshDevices(); }
      catch (error) { showError(error, message); }
    });
    card.querySelector('[data-save-layout]').addEventListener('click', async () => {
      try { await api.updateTvDevice(deviceId, { group_id: card.querySelector('[data-device-group]').value || null, screen_order: Math.max(1, Number(card.querySelector('[data-screen-order]').value) || 1) }); await refreshDevices(); }
      catch (error) { showError(error, message); }
    });
    card.querySelector('[data-send]').addEventListener('click', async () => {
      message.classList.remove('has-error'); message.textContent = 'Enviando programação…';
      try { await api.sendDeviceCommand(deviceId, { playlistId: playlistSelect.value, current: Number(videoSelect.value) || 0, action: 'play', position: 0 }); message.textContent = 'Vídeo enviado; reprodução iniciada.'; }
      catch (error) { showError(error, message); }
    });
    card.querySelector('[data-pause]').addEventListener('click', async () => {
      message.classList.remove('has-error');
      try {
        const current = await api.getTvState(deviceId);
        const position = current.position + (current.action === 'play' ? (Date.now() - current.changedAt) / 1000 : 0);
        await api.sendDeviceCommand(deviceId, { playlistId: current.playlistId, current: current.current, action: 'pause', position });
        message.textContent = 'TV pausada.';
      } catch (error) { showError(error, message); }
    });
    card.querySelector('[data-follow-global]').addEventListener('click', async () => {
      try { await api.clearDeviceCommand(deviceId); message.textContent = 'TV voltou a seguir a programação geral.'; }
      catch (error) { showError(error, message); }
    });
  });
}

async function refreshDevices() {
  if (refreshing) return;
  refreshing = true;
  try {
    const [devices, nextGroups] = await Promise.all([api.getTvDevices(), api.getTvGroups()]);
    const [globalState, deviceStates] = await Promise.all([api.getState(), api.getTvDeviceStates(devices.map(device => device.id))]);
    groups = nextGroups; tvDevices = devices; playlists = globalState.playlists;
    const now = Date.now();
    const entries = devices.map(device => ({ device, state: deviceStates[device.id], online: Boolean(device.last_seen_at && now - Date.parse(device.last_seen_at) < 90000) }));
    renderDevices(entries);
    renderGroups();
  } catch (error) { showError(error); }
  finally { refreshing = false; }
}

$('#devicesTab').addEventListener('click', () => selectConnectTab('devices'));
$('#groupsTab').addEventListener('click', () => selectConnectTab('groups'));
$('#createGroupForm').addEventListener('submit', async event => {
  event.preventDefault();
  const input = $('#groupName');
  const name = input.value.trim();
  if (!name) return;
  try {
    $('#groupStatus').classList.remove('has-error');
    await api.createTvGroup(name);
    input.value = '';
    $('#groupStatus').textContent = `Grupo “${name}” criado. Agora você pode associar as TVs a ele na aba Dispositivos.`;
    await refreshDevices();
  } catch (error) { showError(error, $('#groupStatus')); }
});

async function init() {
  const { session } = await api.getSession();
  if (!session) { location.replace('login.html'); return; }
  await refreshDevices();
  setInterval(() => { const active = document.activeElement; if (!document.querySelector('.page-content').contains(active) || !active.matches('input,select,textarea')) refreshDevices(); }, 15000);
}
init().catch(showError);
