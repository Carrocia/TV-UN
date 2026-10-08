const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const os = require('node:os');
const { pipeline } = require('node:stream/promises');

const ROOT = __dirname;
const MEDIA = path.join(ROOT, 'uploads');
const STATE_FILE = path.join(ROOT, 'site-state.json');
const AUTH_FILE = path.join(ROOT, 'auth.json');
const PORT = Number(process.env.PORT || 8080);
const HOST = process.env.HOST || '0.0.0.0';
fs.mkdirSync(MEDIA, { recursive: true });
let state = { videos: [], current: 0, action: 'play', position: 0, changedAt: Date.now() };
try { state = { ...state, ...JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')) }; } catch {}
let auth = null;
try { auth = JSON.parse(fs.readFileSync(AUTH_FILE, 'utf8')); } catch {}
const sessions = new Map();
const clients = new Set();
function save() { fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2)); }
function broadcast() { const payload = `data: ${JSON.stringify(state)}\n\n`; for (const client of clients) client.write(payload); }
function send(res, code, body, type = 'application/json; charset=utf-8', headers = {}) { res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store', ...headers }); res.end(type.startsWith('application/json') ? JSON.stringify(body) : body); }
function safeName(value) { return path.basename(value || 'video.mp4').replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').slice(0, 120) || 'video.mp4'; }
function tvPlayerUrl(req) {
  const host = req.headers.host || '';
  const hostname = host.split(':')[0].replace(/^\[|\]$/g, '');
  if (hostname && !['localhost', '127.0.0.1', '0.0.0.0', '::1'].includes(hostname)) return `${req.socket.encrypted ? 'https' : 'http'}://${host}/tv.html`;
  const addresses = Object.values(os.networkInterfaces()).flat().filter(item => item && item.family === 'IPv4' && !item.internal && !item.address.startsWith('169.254.'));
  const address = addresses[0]?.address || 'localhost';
  return `http://${address}:${PORT}/tv.html`;
}
function cookies(req) { return Object.fromEntries((req.headers.cookie || '').split(';').map(v => v.trim().split('=').map(decodeURIComponent)).filter(v => v.length === 2)); }
function signedIn(req) { const id = cookies(req).uni_session; const expires = sessions.get(id); if (!expires) return false; if (expires < Date.now()) { sessions.delete(id); return false; } return true; }
function cookie(res, value, maxAge, secure = false) { res.setHeader('Set-Cookie', `uni_session=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure ? '; Secure' : ''}`); }
async function readBody(req, limit = 16_384) { let body = ''; for await (const chunk of req) { body += chunk; if (body.length > limit) throw new Error('Requisição muito grande.'); } return JSON.parse(body || '{}'); }
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const secure = Boolean(req.socket.encrypted);
  if (url.pathname === '/api/auth/status' && req.method === 'GET') return send(res, 200, { configured: Boolean(auth), authenticated: signedIn(req) });
  if (url.pathname === '/api/auth/setup' && req.method === 'POST') {
    if (auth) return send(res, 409, { error: 'O acesso já foi configurado.' });
    try {
      const { username, password } = await readBody(req);
      if (typeof username !== 'string' || username.trim().length < 3 || username.trim().length > 64) return send(res, 400, { error: 'O usuário precisa ter entre 3 e 64 caracteres.' });
      if (typeof password !== 'string' || password.length < 8 || password.length > 256) return send(res, 400, { error: 'A senha precisa ter pelo menos 8 caracteres.' });
      const salt = crypto.randomBytes(16).toString('hex');
      auth = { username: username.trim(), salt, hash: crypto.scryptSync(password, salt, 64).toString('hex') };
      fs.writeFileSync(AUTH_FILE, JSON.stringify(auth, null, 2), { flag: 'wx' });
      const token = crypto.randomBytes(32).toString('hex'); sessions.set(token, Date.now() + 8 * 60 * 60 * 1000); cookie(res, token, 8 * 60 * 60, secure); return send(res, 201, { ok: true });
    } catch (error) { auth = null; return send(res, 400, { error: error.message || 'Não foi possível criar o acesso.' }); }
  }
  if (url.pathname === '/api/auth/login' && req.method === 'POST') {
    try {
      const { username, password } = await readBody(req);
      if (!auth) return send(res, 409, { error: 'Configure o acesso primeiro.' });
      const candidate = crypto.scryptSync(String(password || ''), auth.salt, 64);
      const expected = Buffer.from(auth.hash, 'hex');
      const valid = candidate.length === expected.length && crypto.timingSafeEqual(candidate, expected);
      if (!valid || username !== auth.username) return send(res, 401, { error: 'Usuário ou senha incorretos.' });
      const token = crypto.randomBytes(32).toString('hex'); sessions.set(token, Date.now() + 8 * 60 * 60 * 1000); cookie(res, token, 8 * 60 * 60, secure); return send(res, 200, { ok: true });
    } catch (error) { return send(res, 400, { error: error.message }); }
  }
  if (url.pathname === '/api/auth/logout' && req.method === 'POST') { const id = cookies(req).uni_session; sessions.delete(id); cookie(res, '', 0, secure); return send(res, 200, { ok: true }); }
  const publicRoute = url.pathname === '/' || url.pathname === '/index.html' || url.pathname === '/login.html' || url.pathname === '/tv.html' || url.pathname === '/api/state' || url.pathname === '/events' || url.pathname === '/api/tv/next' || url.pathname.startsWith('/media/') || url.pathname.startsWith('/api/auth/') || url.pathname.startsWith('/styles/') || url.pathname.startsWith('/scripts/') || url.pathname.startsWith('/assets/images/');
  if (!publicRoute && !signedIn(req)) {
    if (url.pathname.startsWith('/api/')) return send(res, 401, { error: 'Entre na central para continuar.' });
    res.writeHead(302, { Location: '/login.html', 'Cache-Control': 'no-store' }); return res.end();
  }
  if (url.pathname === '/api/state' && req.method === 'GET') return send(res, 200, state);
  if (url.pathname === '/api/tv-link' && req.method === 'GET') return send(res, 200, { url: tvPlayerUrl(req) });
  if (url.pathname === '/api/tv/next' && req.method === 'POST') {
    try {
      const command = await readBody(req);
      if (command.expectedCurrent !== state.current || !state.videos.length) return send(res, 200, { ok: true, unchanged: true, state });
      state.current = (state.current + 1) % state.videos.length;
      state.position = 0; state.action = 'play'; state.changedAt = Date.now(); save(); broadcast(); return send(res, 200, { ok: true, state });
    } catch { return send(res, 400, { error: 'Comando de reprodução inválido.' }); }
  }
  if (url.pathname === '/events' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'Access-Control-Allow-Origin': '*' });
    res.write(`data: ${JSON.stringify(state)}\n\n`); clients.add(res); req.on('close', () => clients.delete(res)); return;
  }
  if (url.pathname === '/api/upload' && req.method === 'PUT') {
    const name = safeName(url.searchParams.get('name'));
    const ext = path.extname(name).toLowerCase();
    if (!['.mp4', '.webm', '.ogg', '.ogv', '.mov', '.m4v'].includes(ext)) return send(res, 415, { error: 'Formato não suportado. Use MP4, WebM ou MOV.' });
    const id = crypto.randomUUID();
    try {
      await pipeline(req, fs.createWriteStream(path.join(MEDIA, `${id}${ext}`), { flags: 'wx' }));
      state.videos.push({ id, name, url: `/media/${id}${ext}`, type: req.headers['content-type'] || 'video/mp4', uploadedAt: Date.now() });
      if (state.videos.length === 1) { state.current = 0; state.position = 0; state.action = 'play'; state.changedAt = Date.now(); }
      save(); broadcast(); return send(res, 201, { ok: true, video: state.videos.at(-1) });
    } catch (error) { try { fs.unlinkSync(path.join(MEDIA, `${id}${ext}`)); } catch {} return send(res, 500, { error: `Falha no upload: ${error.message}` }); }
  }
  if (url.pathname.startsWith('/api/videos/') && req.method === 'DELETE') {
    const id = path.basename(url.pathname.slice('/api/videos/'.length));
    const index = state.videos.findIndex(video => video.id === id);
    if (index < 0) return send(res, 404, { error: 'Vídeo não encontrado.' });
    const [removed] = state.videos.splice(index, 1);
    try { fs.unlinkSync(path.join(MEDIA, path.basename(removed.url))); } catch {}
    if (state.current >= state.videos.length) state.current = Math.max(0, state.videos.length - 1);
    state.position = 0; state.changedAt = Date.now(); save(); broadcast(); return send(res, 200, { ok: true, state });
  }
  if (url.pathname === '/api/control' && req.method === 'POST') {
    try {
      const command = await readBody(req);
      if (command.next === true) {
        if (state.current !== command.expectedCurrent) return send(res, 200, { ok: true, unchanged: true, state });
        state.current = state.videos.length ? (state.current + 1) % state.videos.length : 0;
        state.position = 0; state.action = 'play';
      }
      if (command.action) state.action = command.action;
      if (Number.isInteger(command.current)) state.current = Math.max(0, Math.min(command.current, Math.max(0, state.videos.length - 1)));
      if (Number.isFinite(command.position)) state.position = Math.max(0, command.position);
      state.changedAt = Date.now(); save(); broadcast(); return send(res, 200, { ok: true, state });
    } catch { return send(res, 400, { error: 'Comando inválido.' }); }
  }
  if (url.pathname.startsWith('/media/')) {
    const file = path.basename(url.pathname.slice('/media/'.length));
    const filePath = path.join(MEDIA, file);
    if (!fs.existsSync(filePath)) return send(res, 404, { error: 'Vídeo não encontrado.' });
    const stat = fs.statSync(filePath), range = req.headers.range;
    const ext = path.extname(file).toLowerCase();
    const mime = ({ '.mp4': 'video/mp4', '.webm': 'video/webm', '.ogg': 'video/ogg', '.ogv': 'video/ogg', '.mov': 'video/quicktime', '.m4v': 'video/mp4' })[ext] || 'application/octet-stream';
    if (range) {
      const [startText, endText] = range.replace(/bytes=/, '').split('-'); const start = Number(startText); const end = endText ? Math.min(Number(endText), stat.size - 1) : stat.size - 1;
      if (start > end || start >= stat.size) { res.writeHead(416, { 'Content-Range': `bytes */${stat.size}` }); return res.end(); }
      res.writeHead(206, { 'Content-Type': mime, 'Content-Length': end - start + 1, 'Content-Range': `bytes ${start}-${end}/${stat.size}`, 'Accept-Ranges': 'bytes' }); return fs.createReadStream(filePath, { start, end }).pipe(res);
    }
    res.writeHead(200, { 'Content-Type': mime, 'Content-Length': stat.size, 'Accept-Ranges': 'bytes' }); return fs.createReadStream(filePath).pipe(res);
  }
  const requested = url.pathname === '/' ? '/index.html' : url.pathname;
  const file = path.join(ROOT, path.normalize(requested).replace(/^([/\\]|\.\.(?:[/\\]|$))+/, ''));
  if (!file.startsWith(ROOT + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return send(res, 404, { error: 'Página não encontrada.' });
  const type = ({ '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' })[path.extname(file).toLowerCase()] || 'application/octet-stream';
  res.writeHead(200, { 'Content-Type': type }); fs.createReadStream(file).pipe(res);
});
server.listen(PORT, HOST, () => console.log(`Uni Central de Telas disponível em http://localhost:${PORT}`));
