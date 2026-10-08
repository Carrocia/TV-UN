import { SUPABASE_URL, SUPABASE_ANON_KEY } from './supabase-config.js';

const VIDEO_BUCKET = 'tv-videos';
let client;

function getClient() {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    throw new Error('Configure a Project URL e a chave anon/public em scripts/supabase-config.js.');
  }
  if (!window.supabase?.createClient) {
    throw new Error('Não foi possível carregar a biblioteca do Supabase. Confira sua conexão com a internet.');
  }
  client ||= window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { autoRefreshToken: true, persistSession: true, detectSessionInUrl: true }
  });
  return client;
}

function unwrap(result) {
  if (result.error) throw result.error;
  return result.data;
}

function toAppState(videos, playback) {
  const orderedVideos = videos.map(video => ({
    id: video.id,
    name: video.name,
    url: getClient().storage.from(VIDEO_BUCKET).getPublicUrl(video.storage_path).data.publicUrl,
    type: video.mime_type,
    uploadedAt: Date.parse(video.created_at)
  }));
  const currentIndex = orderedVideos.findIndex(video => video.id === playback?.current_video_id);
  return {
    videos: orderedVideos,
    current: currentIndex >= 0 ? currentIndex : 0,
    action: playback?.action || 'pause',
    position: Number(playback?.position_seconds || 0),
    changedAt: playback?.updated_at ? Date.parse(playback.updated_at) : Date.now()
  };
}

async function fetchState() {
  const supabase = getClient();
  const [videoResult, playbackResult] = await Promise.all([
    supabase.from('videos').select('*').order('sort_order').order('created_at'),
    supabase.from('playback_state').select('*').eq('id', 1).single()
  ]);
  const videos = unwrap(videoResult) || [];
  const playback = playbackResult.error?.code === 'PGRST116' ? null : unwrap(playbackResult);
  return toAppState(videos, playback);
}

async function savePlayback({ current = 0, action, position = 0 }) {
  const supabase = getClient();
  const videos = unwrap(await supabase.from('videos').select('id').order('sort_order').order('created_at')) || [];
  const currentVideo = videos[current];
  unwrap(await supabase.from('playback_state').update({
    id: 1,
    current_video_id: currentVideo?.id || null,
    action: action || 'pause',
    position_seconds: Math.max(0, Number(position) || 0),
    updated_at: new Date().toISOString()
  }).eq('id', 1));
  return fetchState();
}

export const api = {
  getSession() {
    return getClient().auth.getSession().then(unwrap);
  },

  async signIn(email, password) {
    unwrap(await getClient().auth.signInWithPassword({ email, password }));
  },

  async logout() {
    unwrap(await getClient().auth.signOut());
  },

  getState: fetchState,

  sendCommand(command) {
    return savePlayback({
      current: Number.isInteger(command.current) ? command.current : 0,
      action: command.action || 'play',
      position: command.position || 0
    });
  },

  async advanceFromTv(expectedCurrent) {
    const state = await fetchState();
    if (!state.videos.length || state.current !== expectedCurrent) return state;
    return savePlayback({ current: (state.current + 1) % state.videos.length, action: 'play', position: 0 });
  },

  async uploadVideo(file) {
    const supabase = getClient();
    const extension = file.name.match(/\.[a-z0-9]+$/i)?.[0]?.toLowerCase() || '.mp4';
    const storagePath = `${crypto.randomUUID()}${extension}`;
    const mimeType = file.type || 'video/mp4';
    unwrap(await supabase.storage.from(VIDEO_BUCKET).upload(storagePath, file, {
      contentType: mimeType,
      upsert: false
    }));

    try {
      const currentState = await fetchState();
      const video = unwrap(await supabase.from('videos').insert({
        name: file.name,
        storage_path: storagePath,
        mime_type: mimeType,
        size_bytes: file.size,
        sort_order: currentState.videos.length
      }).select().single());

      if (!currentState.videos.length) {
        unwrap(await supabase.from('playback_state').update({
          current_video_id: video.id,
          action: 'play',
          position_seconds: 0,
          updated_at: new Date().toISOString()
        }).eq('id', 1));
      }
      return video;
    } catch (error) {
      await supabase.storage.from(VIDEO_BUCKET).remove([storagePath]);
      throw error;
    }
  },

  async removeVideo(id) {
    const supabase = getClient();
    const before = await fetchState();
    const removedCurrentVideo = before.videos[before.current]?.id === id;
    const video = unwrap(await supabase.from('videos').select('storage_path').eq('id', id).single());
    unwrap(await supabase.storage.from(VIDEO_BUCKET).remove([video.storage_path]));
    unwrap(await supabase.from('videos').delete().eq('id', id));

    const state = await fetchState();
    if (removedCurrentVideo && state.videos.length) {
      await savePlayback({ current: 0, action: 'play', position: 0 });
    } else if (!state.videos.length) {
      unwrap(await supabase.from('playback_state').update({
        current_video_id: null, action: 'pause', position_seconds: 0, updated_at: new Date().toISOString()
      }).eq('id', 1));
    }
    return fetchState();
  },

  subscribe(onState, onConnectionChange = () => {}) {
    const channel = getClient().channel('tv-uni-playback')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'videos' }, () => {
        fetchState().then(onState).catch(() => {});
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'playback_state' }, () => {
        fetchState().then(onState).catch(() => {});
      })
      .subscribe(status => onConnectionChange(status === 'SUBSCRIBED'));
    return () => getClient().removeChannel(channel);
  }
};

export function isSupportedVideo(file) {
  return file.type.startsWith('video/') || /\.(mp4|webm|ogg|ogv|mov|m4v)$/i.test(file.name);
}
