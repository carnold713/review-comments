'use strict';
/* Review Comments loader · https://github.com/carnold713/review-comments

   Add review comments to any Node server, and keep it on the latest version from GitHub:

     const reviewComments = require('./review-comments');          // this file (copy it in, or install the package)
     const comments = reviewComments({dataDir: '/data', deletePassword: process.env.DELETE_PASSWORD});

     http.createServer((req, res) => {
       if (comments.handle(req, res)) return;                         // serves /__rc/rc.js and /__rc/api/...
       res.end(comments.inject(html, {page: 'home', label: 'Home page'}));   // adds the widget to a page
     });

   Every few minutes the loader checks GitHub for new versions of the widget (client/rc.js) and of the API
   (server/index.js). New code is used straight away, without a redeploy. If GitHub can't be reached, the last copy that
   worked is used (kept in <dataDir>/.review-comments). Options and environment variables:

     ref             RC_REF               branch, tag or commit to follow (default "main"; a tag pins a version)
     source          RC_SOURCE            "github" (default) or "local" (only the copy next to this file, no updates)
     refreshMinutes  RC_REFRESH_MINUTES   how often to check (default 5)
     repo            RC_REPO              default "carnold713/review-comments"
     dataDir         RC_DATA_DIR/DATA_DIR where comments.json and the cache live
     deletePassword  RC_DELETE_PASSWORD   needed to delete a comment (DELETE_PASSWORD also works)
     base                                 URL prefix for the routes (default "/__rc")
     pages                                optional list of allowed page keys */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

module.exports = function reviewComments(opts = {}) {
  const base = '/' + String(opts.base || '/__rc').replace(/^\/+|\/+$/g, '');
  const repo = opts.repo || process.env.RC_REPO || 'carnold713/review-comments';
  const ref = opts.ref || process.env.RC_REF || 'main';
  const source = opts.source || process.env.RC_SOURCE || 'github';
  const every = Math.max(1, +(opts.refreshMinutes ?? process.env.RC_REFRESH_MINUTES ?? 5)) * 60000;
  const dataDir = opts.dataDir || process.env.RC_DATA_DIR || process.env.DATA_DIR || path.join(process.cwd(), 'data');
  const cacheDir = opts.cacheDir || path.join(dataDir, '.review-comments');
  const log = opts.log === false ? () => {} : (typeof opts.log === 'function' ? opts.log : (...a) => console.log('[review-comments]', ...a));
  const local = {server: path.join(__dirname, 'server', 'index.js'), client: path.join(__dirname, 'client', 'rc.js')};
  const hash = t => crypto.createHash('sha1').update(t).digest('hex').slice(0, 12);
  const read = f => { try { return fs.readFileSync(f, 'utf8'); } catch { return null; } };
  const write = (f, t) => { try { fs.mkdirSync(cacheDir, {recursive: true}); fs.writeFileSync(f, t); } catch (e) { log('could not write', f, e.message); } };

  let impl = null, client = null;
  const info = {repo, ref, source, server: null, client: null, checked: null};
  const serverOpts = {...opts, base, dataDir};
  delete serverOpts.log;

  // load a version of server/index.js; throws (and keeps the current one) if it does not work
  function useServer(code, from) {
    const h = hash(code);
    if (impl && info.server?.hash === h) return false;
    let file = from === 'local' ? local.server : path.join(cacheDir, `server-${h}.js`);
    if (from !== 'local') write(file, code);
    if (!fs.existsSync(file)) { file = path.join(require('os').tmpdir(), `review-comments-server-${h}.js`); fs.writeFileSync(file, code); }
    delete require.cache[require.resolve(file)];
    const create = require(file);
    if (typeof create !== 'function') throw new Error('server/index.js does not export a function');
    const next = create(serverOpts, {client: () => client, info: () => info});
    if (!next || typeof next.handle !== 'function') throw new Error('server/index.js returned no handler');
    impl = next;
    info.server = {hash: h, version: next.version || null, from, at: new Date().toISOString()};
    if (from !== 'local') { write(path.join(cacheDir, 'server.js'), code); tidy(h); }
    return true;
  }
  function useClient(code, from) {
    if (!code || !/ReviewComments/.test(code)) throw new Error('client/rc.js looks wrong');
    const h = hash(code);
    if (info.client?.hash === h) return false;
    client = code;
    info.client = {hash: h, from, at: new Date().toISOString()};
    if (from !== 'local') write(path.join(cacheDir, 'rc.js'), code);
    return true;
  }
  function tidy(keep) {
    try { for (const f of fs.readdirSync(cacheDir)) if (/^server-[0-9a-f]+\.js$/.test(f) && f !== `server-${keep}.js`) fs.unlinkSync(path.join(cacheDir, f)); } catch {}
  }

  // start from what is already on disk: the last good copy from GitHub, else the copy next to this file
  const startWith = [];
  if (source !== 'local') startWith.push([read(path.join(cacheDir, 'server.js')), read(path.join(cacheDir, 'rc.js')), 'cache']);
  startWith.push([read(local.server), read(local.client), 'local']);
  for (const [s, c, from] of startWith) {
    try { if (!impl && s) useServer(s, from); } catch (e) { log(`${from} server copy failed:`, e.message); }
    try { if (!client && c) useClient(c, from); } catch (e) { log(`${from} widget copy failed:`, e.message); }
  }

  const fetchText = async rel => {
    const r = await fetch(`https://raw.githubusercontent.com/${repo}/${ref}/${rel}`, {headers: {'Cache-Control': 'no-cache'}, signal: AbortSignal.timeout(15000)});
    if (!r.ok) throw new Error(`${rel}: HTTP ${r.status}`);
    return r.text();
  };
  async function refresh() {
    try {
      const [s, c] = await Promise.all([fetchText('server/index.js'), fetchText('client/rc.js')]);
      try { if (useServer(s, 'github')) log('API updated from', `${repo}@${ref}`, info.server.hash); } catch (e) { log('new API code did not load, keeping the current one:', e.message); }
      try { if (useClient(c, 'github')) log('widget updated from', `${repo}@${ref}`, info.client.hash); } catch (e) { log('new widget did not load, keeping the current one:', e.message); }
      info.checked = new Date().toISOString();
    } catch (e) { log('update check failed:', e.message); }
  }
  let ready = Promise.resolve();
  if (source !== 'local') {
    ready = refresh();
    const t = setInterval(refresh, every); t.unref?.();
  }

  function handle(req, res) {
    const p = (req.url || '').split('?')[0];
    if (p !== base && !p.startsWith(base + '/')) return false;
    const go = () => {
      if (impl) return impl.handle(req, res);
      res.writeHead(503, {'Content-Type': 'application/json'}); res.end('{"error":"review comments are not available yet"}');
    };
    if (impl && client) go(); else ready.then(go);
    return true;
  }

  // the two script tags that put the widget on a page
  function tag(config = {}) {
    const cfg = JSON.stringify({base, ...config}).replace(/</g, '\\u003c').replace(/[\u2028\u2029]/g, '');
    return `<script>window.__COMMENTS=${cfg}</script><script src="${base}/rc.js" defer></script>`;
  }
  function inject(html, config) {
    const t = tag(config), s = String(html), i = s.toLowerCase().lastIndexOf('</body>');
    return i < 0 ? s + t : s.slice(0, i) + t + s.slice(i);
  }

  return {
    handle,
    middleware: (req, res, next) => { if (!handle(req, res)) next(); },   // for Express / Connect: mount before body parsers
    tag, inject, ready, refresh,
    info: () => ({...info}),
  };
};
