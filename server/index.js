'use strict';
/* Review Comments server: the comments API and the widget script, for any Node http server.
   Node built-ins only. Normally created through the loader (../index.js), which keeps it up to date from GitHub.

     const rc = create({dataDir, deletePassword}, {client: () => rcJsText, info: () => ({...})});
     http.createServer((req, res) => { if (rc.handle(req, res)) return; ... });

   Routes, all under `base` (default /__rc):
     GET    /rc.js                          the widget
     GET    /version                        which code is running
     GET    /api/comments?page=<key>        comments for a page
     GET    /api/comments/<id>              one comment
     POST   /api/comments                   {page, author, text, pin, area?, target?, snap}
     POST   /api/comments/<id>/replies      {author, text}
     PATCH  /api/comments/<id>              {resolved}
     DELETE /api/comments/<id>              header X-Delete-Password */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const VERSION = '1.1.0';

module.exports = function createReviewComments(opts = {}, host = {}) {
  const base = '/' + String(opts.base || '/__rc').replace(/^\/+|\/+$/g, '');
  const dataDir = opts.dataDir || process.env.RC_DATA_DIR || process.env.DATA_DIR || path.join(process.cwd(), 'data');
  const file = opts.file || path.join(dataDir, 'comments.json');
  const deletePassword = opts.deletePassword || process.env.RC_DELETE_PASSWORD || process.env.DELETE_PASSWORD || '';
  if (!deletePassword) throw new Error('review-comments: set deletePassword (or the RC_DELETE_PASSWORD environment variable)');
  const pages = Array.isArray(opts.pages) && opts.pages.length ? new Set(opts.pages) : null;
  const maxComments = opts.maxComments || 5000;
  const maxSnap = opts.maxSnapshotBytes || 32 * 1024;
  const postsPerMinute = opts.postsPerMinute || 30;
  const bundled = path.join(__dirname, '..', 'client', 'rc.js');
  const clientText = host.client || (() => { try { return fs.readFileSync(bundled, 'utf8'); } catch { return ''; } });

  /* ---- store: one JSON file, written atomically ---- */
  fs.mkdirSync(path.dirname(file), {recursive: true});
  let comments = [];
  try { comments = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { comments = []; }
  if (!Array.isArray(comments)) comments = [];
  const save = () => { const tmp = file + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(comments)); fs.renameSync(tmp, file); };

  const clip = (v, n) => String(v ?? '').trim().slice(0, n);
  const num = v => { const n = Math.round(+v); return Number.isFinite(n) ? Math.max(-100000, Math.min(100000, n)) : 0; };
  const areaOf = a => { if (!a || typeof a !== 'object') return null; const r = ['x', 'y', 'w', 'h'].map(k => Math.round(+a[k])); return r.every(Number.isFinite) && r[2] > 0 && r[3] > 0 && r[2] < 20000 && r[3] < 20000 ? {x: r[0], y: r[1], w: r[2], h: r[3]} : null; };
  const pageOk = p => typeof p === 'string' && /^[\w\-./:~%]{1,160}$/.test(p) && (!pages || pages.has(p));
  const digest = s => crypto.createHash('sha256').update(String(s)).digest();
  const json = (res, code, body) => { res.writeHead(code, {'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store'}); res.end(JSON.stringify(body)); };
  const readBody = (req, limit) => new Promise((resolve, reject) => {
    let body = '';
    req.setEncoding('utf8');
    req.on('data', c => { body += c; if (body.length > limit) { reject(Object.assign(new Error('too large'), {status: 413})); req.destroy(); } });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });

  // a light per-address limit on new comments and replies
  const hits = new Map();
  const tooMany = req => {
    const ip = String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '').split(',')[0].trim();
    const now = Date.now(), list = (hits.get(ip) || []).filter(t => now - t < 60000);
    list.push(now); hits.set(ip, list);
    if (hits.size > 5000) hits.clear();
    return list.length > postsPerMinute;
  };

  async function api(req, res, rest) {
    const parts = rest.split('/').filter(Boolean);              // [id], [replies]
    const id = parts[0] ? decodeURIComponent(parts[0]) : null;
    const url = new URL(req.url, 'http://x');
    if (req.method === 'GET' && !id) {
      const page = url.searchParams.get('page');
      return json(res, 200, comments.filter(c => !page || c.page === page));
    }
    let body = {};
    if (req.method === 'POST' || req.method === 'PATCH') {
      try { body = JSON.parse(await readBody(req, maxSnap + 16 * 1024) || '{}'); } catch (e) { return json(res, e.status || 400, {error: 'bad request'}); }
      if (!body || typeof body !== 'object') body = {};
    }
    if (req.method === 'POST' && !id) {
      const text = clip(body.text, 2000);
      if (!text || !pageOk(body.page)) return json(res, 400, {error: 'text and a valid page are required'});
      if (tooMany(req)) return json(res, 429, {error: 'too many comments, try again in a minute'});
      if (comments.length >= maxComments) return json(res, 429, {error: 'comment limit reached'});
      const snap = body.snap && typeof body.snap === 'object' ? body.snap : {};
      if (JSON.stringify(snap).length > maxSnap) return json(res, 400, {error: 'snapshot too large'});
      const n = comments.filter(c => c.page === body.page).reduce((m, c) => Math.max(m, c.n), 0) + 1;
      const c = {id: crypto.randomBytes(5).toString('hex'), n, page: body.page, author: clip(body.author, 60) || 'Anonymous', text,
        pin: {x: num(body.pin?.x), y: num(body.pin?.y)}, area: areaOf(body.area), target: clip(body.target, 80), snap,
        created: new Date().toISOString(), resolved: false, replies: []};
      comments.push(c); save();
      return json(res, 201, c);
    }
    const c = comments.find(x => x.id === id);
    if (!c) return json(res, 404, {error: 'not found'});
    if (req.method === 'GET' && parts.length === 1) return json(res, 200, c);
    if (req.method === 'POST' && parts[1] === 'replies') {
      const text = clip(body.text, 2000);
      if (!text) return json(res, 400, {error: 'text is required'});
      if (tooMany(req)) return json(res, 429, {error: 'too many replies, try again in a minute'});
      c.replies.push({author: clip(body.author, 60) || 'Anonymous', text, created: new Date().toISOString()}); save();
      return json(res, 201, c);
    }
    if (req.method === 'PATCH' && parts.length === 1) { if (typeof body.resolved === 'boolean') c.resolved = body.resolved; save(); return json(res, 200, c); }
    if (req.method === 'DELETE' && parts.length === 1) {
      const pw = String(req.headers['x-delete-password'] || '');
      if (!pw || !crypto.timingSafeEqual(digest(pw), digest(deletePassword))) return json(res, 403, {error: 'wrong password'});
      comments = comments.filter(x => x.id !== id); save(); return json(res, 200, {ok: true});
    }
    return json(res, 405, {error: 'method not allowed'});
  }

  let jsCache = {text: null, etag: ''};
  function serveClient(req, res) {
    const text = clientText() || '';
    if (text !== jsCache.text) jsCache = {text, etag: '"' + crypto.createHash('sha1').update(text).digest('hex').slice(0, 16) + '"'};
    const head = {'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'no-cache', 'ETag': jsCache.etag};
    if (req.headers['if-none-match'] === jsCache.etag) { res.writeHead(304, head); return res.end(); }
    res.writeHead(text ? 200 : 503, head);
    res.end(text || '/* review-comments: widget not loaded yet */');
  }

  /* Handles a request if it is under `base`. Returns true when it did (the response is then taken care of). */
  function handle(req, res) {
    const p = (req.url || '').split('?')[0];
    if (p !== base && !p.startsWith(base + '/')) return false;
    const rest = p.slice(base.length) || '/';
    if (rest === '/rc.js' && (req.method === 'GET' || req.method === 'HEAD')) serveClient(req, res);
    else if (rest === '/version') json(res, 200, {version: VERSION, widget: (/const VERSION = '([^']+)'/.exec(clientText() || '') || [])[1] || null, ...(host.info ? host.info() : {})});
    else if (rest === '/api/comments' || rest.startsWith('/api/comments/')) api(req, res, rest.slice('/api/comments'.length)).catch(() => { if (!res.headersSent) json(res, 500, {error: 'server error'}); });
    else json(res, 404, {error: 'not found'});
    return true;
  }

  return {handle, version: VERSION, base, file};
};
module.exports.VERSION = VERSION;
