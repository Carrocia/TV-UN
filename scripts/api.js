import { SUPABASE_URL, SUPABASE_ANON_KEY } from './supabase-config.js';

const VIDEO_BUCKET = 'tv-videos';
let client;
function getClient() {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) throw new Error('Configure a Project URL e a chave anon/public em scripts/supabase-config.js.');
  if (!window.supabase?.createClient) throw new Error('Não foi possível carregar a biblioteca do Supabase. Confira sua conexão com a internet.');
  client ||= window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { autoRefreshToken: true, persistSession: true, detectSessionInUrl: true } });
  return client;
}
function unwrap(result) { if (result.error) throw result.error; return result.data; }
function mapVideo(row) { return { id: row.id, name: row.name, url: getClient().storage.from(VIDEO_BUCKET).getPublicUrl(row.storage_path).data.publicUrl, type: row.mime_type, uploadedAt: Date.parse(row.created_at) }; }

async function getPlaylists() {
  const supabase = getClient();
  const rows = unwrap(await supabase.from('playlists').select('*').order('created_at')) || [];
  return Promise.all(rows.map(async playlist => {
    const items = unwrap(await supabase.from('playlist_items').select('id,video_id,sort_order,videos(*)').eq('playlist_id', playlist.id).order('sort_order')) || [];
    return { id: playlist.id, name: playlist.name, items: items.map(item => ({ ...mapVideo(item.videos), itemId: item.id })) };
  }));
}
async function fetchState(deviceId = null) {
  const supabase = getClient();
  const [playlists, playbackResult] = await Promise.all([
    getPlaylists(), supabase.from('playback_state').select('*').eq('id', 1).single()
  ]);
  const playback = playbackResult.error?.code === 'PGRST116' ? null : unwrap(playbackResult);
  let effectivePlayback = playback;
  let deviceOverride = false;
  if (deviceId) {
    const deviceResult = await supabase.from('tv_device_playback').select('*').eq('device_id', deviceId).maybeSingle();
    const devicePlayback = unwrap(deviceResult);
    deviceOverride = Boolean(devicePlayback);
    effectivePlayback = devicePlayback || playback;
  }
  const selected = playlists.find(playlist => playlist.id === effectivePlayback?.playlist_id) || playlists[0];
  const videos = selected?.items || [];
  const current = videos.findIndex(video => video.id === effectivePlayback?.current_video_id);
  return { playlists, playlistId: selected?.id || null, videos, current: current >= 0 ? current : 0, action: effectivePlayback?.action || 'pause', position: Number(effectivePlayback?.position_seconds || 0), changedAt: effectivePlayback?.updated_at ? Date.parse(effectivePlayback.updated_at) : Date.now(), deviceId, deviceOverride };
}
function applyDevicePlayback(base, deviceId, devicePlayback) {
  const effectivePlayback = devicePlayback || base;
  const selected = base.playlists.find(playlist => playlist.id === effectivePlayback?.playlist_id) || base.playlists[0];
  const videos = selected?.items || [];
  const current = videos.findIndex(video => video.id === effectivePlayback?.current_video_id);
  return { ...base, playlistId: selected?.id || null, videos, current: current >= 0 ? current : 0, action: effectivePlayback?.action || 'pause', position: Number(effectivePlayback?.position_seconds || 0), changedAt: effectivePlayback?.updated_at ? Date.parse(effectivePlayback.updated_at) : Date.now(), deviceId, deviceOverride: Boolean(devicePlayback) };
}
async function savePlayback({ playlistId, current = 0, action, position = 0 }) {
  const state = await fetchState();
  const chosenId = playlistId || state.playlistId;
  const playlist = state.playlists.find(item => item.id === chosenId);
  const currentVideo = playlist?.items[current];
  unwrap(await getClient().from('playback_state').update({ playlist_id: chosenId, current_video_id: currentVideo?.id || null, action: action || 'pause', position_seconds: Math.max(0, Number(position) || 0), updated_at: new Date().toISOString() }).eq('id', 1));
  return fetchState();
}

export const api = {
  getSession() { return getClient().auth.getSession().then(unwrap); },
  async signIn(email, password) { unwrap(await getClient().auth.signInWithPassword({ email, password })); },
  async logout() { unwrap(await getClient().auth.signOut()); },
  getState: fetchState,
  sendCommand(command) { return savePlayback({ playlistId: command.playlistId, current: Number.isInteger(command.current) ? command.current : 0, action: command.action || 'play', position: command.position || 0 }); },
  async advanceFromTv(expectedCurrent, deviceId = null) {
    const state = await fetchState(deviceId);
    if (!state.videos.length || state.current !== expectedCurrent) return state;
    const currentVideo = state.videos[state.current];
    if (!currentVideo) return state;
    const hasDeviceOverride = Boolean(deviceId && state.deviceOverride);
    const functionName = hasDeviceOverride ? 'advance_tv_device_playback' : 'advance_tv_playback';
    const args = hasDeviceOverride
      ? { expected_device_id: deviceId, expected_current_video_id: currentVideo.id }
      : { expected_current_video_id: currentVideo.id };
    unwrap(await getClient().rpc(functionName, args));
    return fetchState(deviceId);
  },
  getTvState(deviceId) { return fetchState(deviceId); },
  async getTvDeviceStates(deviceIds) {
    const base = await fetchState();
    if (!deviceIds.length) return {};
    const rows = unwrap(await getClient().from('tv_device_playback').select('*').in('device_id', deviceIds)) || [];
    const byId = new Map(rows.map(row => [row.device_id, row]));
    return Object.fromEntries(deviceIds.map(deviceId => [deviceId, applyDevicePlayback(base, deviceId, byId.get(deviceId) || null)]));
  },
  async registerTvDevice(deviceId) {
    unwrap(await getClient().rpc('register_tv_device', { p_device_id: deviceId }));
  },
  async getTvDevices() { return unwrap(await getClient().from('tv_devices').select('*').order('created_at')) || []; },
  async getTvGroups() { return unwrap(await getClient().from('tv_groups').select('*').order('created_at')) || []; },
  async createTvGroup(name) { return unwrap(await getClient().from('tv_groups').insert({ name: name.trim() }).select().single()); },
  async updateTvDevice(deviceId, updates) { unwrap(await getClient().from('tv_devices').update(updates).eq('id', deviceId)); },
  async sendDeviceCommand(deviceId, { playlistId, current = 0, action = 'play', position = 0 }) {
    const state = await fetchState();
    const playlist = state.playlists.find(item => item.id === playlistId);
    const currentVideo = playlist?.items[current];
    const payload = { device_id: deviceId, playlist_id: playlistId, current_video_id: currentVideo?.id || null, action, position_seconds: Math.max(0, Number(position) || 0), updated_at: new Date().toISOString() };
    unwrap(await getClient().from('tv_device_playback').upsert(payload, { onConflict: 'device_id' }));
    return fetchState(deviceId);
  },
  async clearDeviceCommand(deviceId) { unwrap(await getClient().from('tv_device_playback').delete().eq('device_id', deviceId)); },
  async createPlaylist(name) { return unwrap(await getClient().from('playlists').insert({ name: name.trim() }).select().single()); },
  async renamePlaylist(id, name) { unwrap(await getClient().from('playlists').update({ name: name.trim() }).eq('id', id)); },
  async deletePlaylist(id) { unwrap(await getClient().from('playlists').delete().eq('id', id)); return fetchState(); },
  async uploadVideo(file, playlistId) {
    const supabase = getClient();
    const extension = file.name.match(/\.[a-z0-9]+$/i)?.[0]?.toLowerCase() || '.mp4';
    const storagePath = `${crypto.randomUUID()}${extension}`;
    const mimeType = file.type || 'video/mp4';
    unwrap(await supabase.storage.from(VIDEO_BUCKET).upload(storagePath, file, { contentType: mimeType, upsert: false }));
    let video;
    try {
      video = unwrap(await supabase.from('videos').insert({ name: file.name, storage_path: storagePath, mime_type: mimeType, size_bytes: file.size, sort_order: 0 }).select().single());
      const countResult = await supabase.from('playlist_items').select('id', { count: 'exact', head: true }).eq('playlist_id', playlistId);
      if (countResult.error) throw countResult.error;
      const count = countResult.count;
      unwrap(await supabase.from('playlist_items').insert({ playlist_id: playlistId, video_id: video.id, sort_order: count || 0 }));
      return video;
    } catch (error) {
      if (video?.id) await supabase.from('videos').delete().eq('id', video.id);
      await supabase.storage.from(VIDEO_BUCKET).remove([storagePath]);
      throw error;
    }
  },
  async removeItem(itemId) { unwrap(await getClient().from('playlist_items').delete().eq('id', itemId)); return fetchState(); },
  async reorderItems(playlistId, orderedIds) {
    const supabase = getClient();
    for (const [index, id] of orderedIds.entries()) unwrap(await supabase.from('playlist_items').update({ sort_order: index }).eq('id', id).eq('playlist_id', playlistId));
  },
  subscribe(onState, onConnectionChange = () => {}, deviceId = null) {
    let refreshVersion = 0;
    const refreshState = () => {
      const version = ++refreshVersion;
      return fetchState(deviceId)
        .then(state => { if (version === refreshVersion) onState(state); })
        .catch(() => {});
    };
    const channel = getClient().channel('tv-uni-playback')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'videos' }, refreshState)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'playlists' }, refreshState)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'playlist_items' }, refreshState)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'playback_state' }, refreshState)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tv_device_playback' }, refreshState)
      .subscribe(status => onConnectionChange(status === 'SUBSCRIBED'));
    return () => getClient().removeChannel(channel);
  }
};
export function isSupportedVideo(file) { return file.type.startsWith('video/') || /\.(mp4|webm|ogg|ogv|mov|m4v)$/i.test(file.name); }
