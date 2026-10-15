/* Review Comments · https://github.com/carnold713/review-comments
   A commenting layer for live sites. A comment stores a snapshot of what the commenter saw (screen size, scroll, open
   panels, and any app state the page chooses to share). Opening a comment replays that snapshot in a frame of the same
   size, with the marker attached to the content it was dropped on.

   The page can describe its own state with an adapter (see README):
     ReviewComments.adapter({ snapshot(), restore(snap), details(snap) })
   Without one, scroll positions, open <details> and open <dialog> elements are saved and restored. */
(() => {
  if (window.ReviewComments?.loaded) return;
  const VERSION = '1.0.1';
  const script = document.currentScript;
  const DS = script?.dataset || {};
  const CFG = Object.assign({}, window.__COMMENTS || {}, window.ReviewCommentsConfig || {});
  if (CFG.enabled === false || DS.enabled === 'false') return;
  const BASE = (CFG.base || DS.base || (script?.src ? new URL('.', script.src).pathname : '/__rc/')).replace(/\/+$/, '');
  const PAGE = CFG.page || DS.page || location.pathname;
  const LABEL = CFG.label || DS.label || document.title || PAGE;
  const REPLAY = new URLSearchParams(location.search).get('rc_replay');

  /* ---------- the page adapter ---------- */
  let custom = null;
  const adapter = () => custom || window.__rcAdapter || window.__proto || null;     // __proto: the original prototype contract
  const RC = window.ReviewComments = {loaded: true, version: VERSION, adapter(a) { custom = a || null; }, snapshot: () => snapshot(), restore: s => restore(s)};

  const api = (p = '', opts = {}) => fetch(BASE + '/api/comments' + p, {credentials: 'same-origin', ...opts, headers: {'Content-Type': 'application/json', ...(opts.headers || {})}})
    .then(r => r.ok ? r.json() : Promise.reject(Object.assign(new Error('Request failed (' + r.status + ')'), {status: r.status})));
  const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'}[c]));
  const $ = (s, r = document) => r.querySelector(s);
  const css = t => { const s = document.createElement('style'); s.textContent = t; document.head.appendChild(s); };
  const safe = (v, d) => typeof v === 'string' && /^[\w\s#,'"().%\-]+$/.test(v) ? v : d;
  const BP = Array.isArray(CFG.breakpoints) ? CFG.breakpoints : [[768, 'Mobile'], [1024, 'Tablet'], [1440, 'Desktop Narrow']];
  const device = s => { const w = s.vw || 0, b = BP.find(([max]) => w < max); return (b ? b[1] : CFG.wideName || 'Desktop') + ` · ${s.vw}×${s.vh}`; };
  const ago = iso => { const m = Math.round((Date.now() - new Date(iso)) / 60000); return m < 1 ? 'just now' : m < 60 ? m + 'm ago' : m < 1440 ? Math.round(m / 60) + 'h ago' : Math.round(m / 1440) + 'd ago'; };
  const frames = n => new Promise(r => { const f = () => (--n <= 0 ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); });
  const settle = async () => {
    if (document.readyState !== 'complete') await new Promise(r => addEventListener('load', r, {once: true}));
    try { await document.fonts.ready; } catch {}
    await frames(2);
  };

  // a short, stable CSS path for an element (ids first, then position among same-tag siblings)
  const cssPath = el => {
    const parts = [];
    for (; el && el.nodeType === 1 && el !== document.documentElement; el = el.parentElement) {
      if (el.id && document.querySelectorAll('#' + CSS.escape(el.id)).length === 1) { parts.unshift('#' + CSS.escape(el.id)); break; }
      let i = 1, s = el; while ((s = s.previousElementSibling)) if (s.tagName === el.tagName) i++;
      parts.unshift(el.tagName.toLowerCase() + ':nth-of-type(' + i + ')');
    }
    return parts.join('>');
  };
  const find = p => { try { return p ? document.querySelector(p) : null; } catch { return null; } };

  // the built-in snapshot, used when the page has no adapter
  function domSnapshot() {
    const s = {scrollX: Math.round(scrollX), scrollY: Math.round(scrollY), scrolls: [], open: []};
    for (const el of document.querySelectorAll('body *')) {
      if (s.scrolls.length >= 40) break;
      if ((el.scrollTop > 0 || el.scrollLeft > 0) && !el.closest('#rc-root')) s.scrolls.push([cssPath(el), Math.round(el.scrollTop), Math.round(el.scrollLeft)]);
    }
    document.querySelectorAll('details[open], dialog[open]').forEach(el => { if (s.open.length < 40 && !el.closest('#rc-root')) s.open.push(cssPath(el)); });
    const dlg = [...document.querySelectorAll('dialog[open]')].pop();
    s.context = dlg ? (dlg.getAttribute('aria-label') || dlg.querySelector('h1,h2,h3')?.textContent.trim().slice(0, 60) || 'Dialog open') : 'Page';
    return s;
  }
  function snapshot() {
    const a = adapter();
    let s;
    try { s = a?.snapshot ? Object.assign({}, a.snapshot()) : domSnapshot(); } catch { s = domSnapshot(); }
    if (!s.context && a?.context) try { s.context = a.context(); } catch {}
    s.url = location.pathname + location.search.replace(/([?&])rc_replay=[^&]*&?/, '$1').replace(/[?&]$/, '') + location.hash;
    s.vw = document.documentElement.clientWidth;      // layout width, without the page scrollbar
    s.vh = innerHeight;
    s.dpr = devicePixelRatio || 1;
    return s;
  }
  async function restore(s) {
    await settle();
    const a = adapter();
    if (a?.restore) { await a.restore(s); return; }
    (s.open || []).forEach(p => {
      const el = find(p); if (!el) return;
      if (el.tagName === 'DETAILS') el.open = true;
      else if (el.tagName === 'DIALOG' && !el.open) { try { el.showModal(); } catch { el.setAttribute('open', ''); } }
    });
    await frames(2);
    (s.scrolls || []).forEach(([p, t, l]) => { const el = find(p); if (el) { el.scrollTop = t; el.scrollLeft = l; } });
    scrollTo(s.scrollX || 0, s.scrollY || 0);
    await frames(2);
  }
  function detailRows(s) {
    let rows = null;
    try { rows = adapter()?.details?.(s); } catch {}
    if (!Array.isArray(rows)) {
      rows = [];
      if (s.filters?.length) rows.push(['Filters', s.filters.join(', ')]);
      if (s.q) rows.push(['Search', s.q]);
    }
    if (s.url && s.url.split(/[?#]/)[0] !== location.pathname) rows.push(['Address', s.url]);
    return rows;
  }

  /* ---------- look ---------- */
  const FONT = safe(CFG.font, "system-ui,-apple-system,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif");
  const ACCENT = safe(CFG.accent, '#006dcc'), PIN = safe(CFG.pinColor, '#e8590c');
  css(`
  .rc-pin{position:fixed;z-index:2147483600;width:28px;height:28px;margin:-28px 0 0 0;border-radius:14px 14px 14px 2px;background:${PIN};color:#fff;font:700 13px/28px ${FONT};text-align:center;box-shadow:0 2px 8px rgba(0,0,0,.35);pointer-events:none}
  .rc-pin.rc-pulse::after{content:'';position:absolute;inset:-6px;border-radius:inherit;border:2px solid ${PIN};animation:rcPulse 1.6s ease-out infinite}
  .rc-area{position:fixed;z-index:2147483590;border:2px solid ${PIN};background:color-mix(in srgb, ${PIN} 10%, transparent);border-radius:4px;pointer-events:none;box-shadow:0 0 0 1px rgba(255,255,255,.7)}
  @keyframes rcPulse{from{opacity:.9;transform:scale(.8)}to{opacity:0;transform:scale(1.5)}}`);

  /* ---------- replay mode: this page is inside a comment viewer frame ---------- */
  if (REPLAY) {
    // the frame is exactly the commenter's layout width, so the page scrollbar must not take space
    css(`html{scrollbar-width:none!important;scrollbar-gutter:auto!important}html::-webkit-scrollbar{display:none!important}`);
    api('/' + encodeURIComponent(REPLAY)).then(async c => {
      await restore(c.snap || {});
      let ar = null;
      if (c.area) {
        ar = document.createElement('div'); ar.className = 'rc-area';
        Object.assign(ar.style, {left: c.area.x + 'px', top: c.area.y + 'px', width: c.area.w + 'px', height: c.area.h + 'px'});
        document.body.appendChild(ar);
      }
      const pin = document.createElement('div');
      pin.className = 'rc-pin' + (c.area ? '' : ' rc-pulse'); pin.textContent = c.n;
      pin.style.left = c.pin.x + 'px'; pin.style.top = c.pin.y + 'px';
      document.body.appendChild(pin);
      /* The marker belongs to the content it was dropped on, not to the window. It is tied to the element that was under it,
         so it moves with that element when the page, a panel or a sticky column is scrolled, and it is cut off where that
         element is cut off (the edge of a scrolling panel, say). If the element is re-rendered, the marker re-attaches to
         whatever is under it at that moment. */
      const ax = c.area ? c.area.x + c.area.w / 2 : c.pin.x, ay = c.area ? c.area.y + c.area.h / 2 : c.pin.y;
      let anchor = null, base = null, held = {x: 0, y: 0}, off = {x: 0, y: 0}, clips = [], last = '';
      const grab = () => {
        anchor = document.elementFromPoint(ax + off.x, ay + off.y) || document.body;
        if (anchor === document.documentElement) anchor = document.body;
        const r = anchor.getBoundingClientRect();
        base = {x: r.left, y: r.top}; held = {x: off.x, y: off.y}; clips = [];
        for (let el = anchor.parentElement; el && el !== document.body && el !== document.documentElement; el = el.parentElement) {
          const o = getComputedStyle(el);
          if (o.overflowX === 'visible' && o.overflowY === 'visible') continue;
          // only containers that hold the whole marker count (a scrolling panel does, a cropped thumbnail does not)
          const q = el.getBoundingClientRect(), m = c.area || {x: c.pin.x, y: c.pin.y, w: 0, h: 0};
          if (q.left <= m.x + off.x + 2 && q.top <= m.y + off.y + 2 && q.right >= m.x + off.x + m.w - 2 && q.bottom >= m.y + off.y + m.h - 2) clips.push(el);
        }
      };
      const follow = () => {
        if (!anchor || !anchor.isConnected) grab();
        const r = anchor.getBoundingClientRect();
        off = {x: Math.round(held.x + r.left - base.x), y: Math.round(held.y + r.top - base.y)};
        let L = -1e6, T = -1e6, R = 1e6, B = 1e6;
        for (const el of clips) { const q = el.getBoundingClientRect(); L = Math.max(L, q.left); T = Math.max(T, q.top); R = Math.min(R, q.right); B = Math.min(B, q.bottom); }
        const key = [off.x, off.y, L, T, R, B].map(Math.round).join();
        if (key !== last) {
          last = key;
          const px = c.pin.x + off.x, py = c.pin.y + off.y;
          pin.style.transform = `translate(${off.x}px,${off.y}px)`;
          pin.style.visibility = px >= L - 1 && px <= R + 1 && py >= T - 1 && py <= B + 1 ? '' : 'hidden';
          if (ar) {
            const x = c.area.x + off.x, y = c.area.y + off.y;
            ar.style.transform = `translate(${off.x}px,${off.y}px)`;
            ar.style.clipPath = `inset(${Math.max(0, T - y)}px ${Math.max(0, x + c.area.w - R)}px ${Math.max(0, y + c.area.h - B)}px ${Math.max(0, L - x)}px)`;
          }
        }
        requestAnimationFrame(follow);
      };
      grab(); follow();
      parent.postMessage({rc: 'ready', id: c.id}, location.origin);
    }).catch(() => parent.postMessage({rc: 'ready', id: REPLAY, error: true}, location.origin));
    return;
  }

  css(`
  #rc-root{position:fixed;inset:0;z-index:2147483000;pointer-events:none;font:400 14px/20px ${FONT};color:#262626;text-align:left;letter-spacing:normal}
  #rc-root *{box-sizing:border-box}
  #rc-root [hidden]{display:none!important}
  #rc-root button{font:inherit;color:inherit;background:none;border:0;cursor:pointer;padding:0;margin:0;text-transform:none}
  #rc-root>*{pointer-events:auto}
  .rc-fab{position:absolute;right:16px;bottom:16px;width:44px;height:44px;border-radius:22px;background:#262626!important;color:#fff!important;display:grid;place-items:center;box-shadow:0 6px 20px rgba(0,0,0,.28);transition:transform .15s,bottom .25s cubic-bezier(.22,.8,.24,1),background .15s}
  .rc-fab:hover{transform:scale(1.06)}
  .rc-fab.on{background:${ACCENT}!important}
  .rc-count{position:absolute;top:-4px;right:-4px;min-width:18px;height:18px;padding:0 5px;border-radius:9px;background:${PIN};color:#fff;font-size:11px;line-height:18px;font-weight:700;text-align:center}
  .rc-panel{position:absolute;right:16px;bottom:72px;width:360px;max-width:calc(100vw - 16px);max-height:min(600px,calc(100vh - 96px));display:flex;flex-direction:column;background:#fff;border-radius:14px;box-shadow:0 16px 48px rgba(0,0,0,.28);overflow:hidden;transform-origin:bottom right;animation:rcIn .2s cubic-bezier(.22,.8,.24,1)}
  @keyframes rcIn{from{opacity:0;transform:scale(.94) translateY(8px)}}
  .rc-head{display:flex;align-items:center;gap:8px;padding:14px 12px 10px 16px}
  .rc-head b{flex:1;font-size:16px;line-height:24px}
  .rc-sub{padding:0 16px 10px;color:#666;font-size:12px;line-height:16px}
  .rc-x{width:32px;height:32px;border-radius:16px;display:grid;place-items:center}
  .rc-x:hover{background:#f0f0f0}
  .rc-add{margin:0 16px 12px;height:40px;border-radius:20px;background:${ACCENT}!important;color:#fff!important;font-weight:600!important;display:flex;align-items:center;justify-content:center;gap:8px}
  .rc-add:hover{filter:brightness(.92)}
  .rc-tabs{display:flex;gap:16px;padding:0 16px;border-bottom:1px solid #e9e9e9}
  .rc-tabs button{padding:8px 0;font-weight:600!important;color:#666!important;border-bottom:2px solid transparent!important}
  .rc-tabs button[aria-selected=true]{color:#262626!important;border-color:#262626!important}
  .rc-list{overflow-y:auto;overscroll-behavior:contain;flex:1}
  .rc-item{display:block;width:100%;text-align:left!important;padding:12px 16px!important;border-bottom:1px solid #f0f0f0!important}
  .rc-item:hover{background:#f8f8f8}
  .rc-row{display:flex;align-items:center;gap:8px}
  .rc-num{flex:none;width:22px;height:22px;border-radius:11px 11px 11px 2px;background:${PIN};color:#fff;font-size:11px;line-height:22px;font-weight:700;text-align:center}
  .rc-item.done .rc-num{background:#9e9e9e}
  .rc-who{font-weight:600;flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .rc-when{color:#666;font-size:12px;flex:none}
  .rc-text{margin:6px 0 6px 30px;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden;white-space:pre-wrap;word-break:break-word}
  .rc-chips{margin-left:30px;display:flex;flex-wrap:wrap;gap:4px}
  .rc-chip{font-size:11px;line-height:16px;padding:1px 7px;border-radius:9px;background:#f0f0f0;color:#444;white-space:nowrap;max-width:100%;overflow:hidden;text-overflow:ellipsis}
  .rc-chip.dev{background:color-mix(in srgb, ${ACCENT} 12%, #fff);color:${ACCENT}}
  .rc-empty{padding:28px 20px;text-align:center;color:#666}
  .rc-layer{position:absolute;inset:0;cursor:crosshair;background:color-mix(in srgb, ${ACCENT} 6%, transparent);box-shadow:inset 0 0 0 3px ${ACCENT};touch-action:none;user-select:none;-webkit-user-select:none}
  .rc-hint{position:absolute;left:50%;top:12px;transform:translateX(-50%);background:#262626;color:#fff;padding:8px 14px;border-radius:20px;font-weight:600;white-space:nowrap;box-shadow:0 6px 20px rgba(0,0,0,.3);pointer-events:none;max-width:calc(100vw - 16px);overflow:hidden;text-overflow:ellipsis}
  .rc-compose{position:absolute;width:300px;max-width:calc(100vw - 16px);background:#fff;border-radius:12px;box-shadow:0 16px 48px rgba(0,0,0,.3);padding:12px;display:flex;flex-direction:column;gap:8px}
  .rc-compose input,.rc-compose textarea,.rc-reply textarea,.rc-reply input{width:100%;border:1px solid #d1d1d1;border-radius:8px;padding:8px 10px;font:inherit;color:#262626;background:#fff;outline:0;resize:none;margin:0}
  .rc-compose input:focus,.rc-compose textarea:focus,.rc-reply textarea:focus,.rc-reply input:focus{border-color:${ACCENT};box-shadow:0 0 0 3px color-mix(in srgb, ${ACCENT} 12%, transparent)}
  .rc-btns{display:flex;justify-content:flex-end;gap:8px}
  .rc-b{height:34px;padding:0 16px!important;border-radius:17px;font-weight:600!important}
  .rc-b.pri{background:${ACCENT}!important;color:#fff!important}
  .rc-b.pri:disabled{background:#e9e9e9!important;color:#9e9e9e!important;cursor:default}
  .rc-b.sec:hover{background:#f0f0f0}
  .rc-meta{color:#666;font-size:12px;line-height:16px}
  .rc-toast{position:absolute;left:50%;bottom:76px;transform:translateX(-50%);background:#262626;color:#fff;padding:10px 16px;border-radius:10px;box-shadow:0 8px 24px rgba(0,0,0,.3);animation:rcIn .2s}
  /* viewer */
  .rc-viewer{position:absolute;inset:0;background:#1b1b1b;color:#fff;display:flex;flex-direction:column;animation:rcFade .2s}
  @keyframes rcFade{from{opacity:0}}
  .rc-vbar{flex:none;display:flex;align-items:center;gap:6px;padding:8px 8px 8px 12px;border-bottom:1px solid #333}
  .rc-vbar .rc-vt{flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-weight:600}
  .rc-ib{width:36px;height:36px;border-radius:18px;display:grid;place-items:center;color:#fff!important;flex:none}
  .rc-ib:hover{background:#333}
  .rc-ib:disabled{opacity:.3;cursor:default}
  .rc-tb{height:32px;padding:0 12px!important;border-radius:16px;border:1px solid #555!important;color:#fff!important;font-weight:600!important;font-size:13px!important;flex:none}
  .rc-tb:hover{background:#333}
  .rc-vmain{flex:1;min-height:0;display:flex}
  .rc-stage{flex:1;min-width:0;position:relative;overflow:hidden}
  .rc-frame{position:absolute;background:#fff;box-shadow:0 0 0 1px #444,0 24px 64px rgba(0,0,0,.6);overflow:hidden;border-radius:4px}
  .rc-frame iframe{border:0;display:block;transform-origin:0 0;background:#fff}
  .rc-cap{position:absolute;left:0;right:0;bottom:6px;text-align:center;color:#9e9e9e;font-size:12px;pointer-events:none}
  .rc-load{position:absolute;inset:0;display:grid;place-items:center;color:#9e9e9e;background:#1b1b1b;transition:opacity .25s}
  .rc-vside{flex:none;width:320px;border-left:1px solid #333;overflow-y:auto;padding:16px;display:flex;flex-direction:column;gap:14px}
  .rc-body{white-space:pre-wrap;word-break:break-word;font-size:15px;line-height:22px}
  .rc-kv{display:grid;grid-template-columns:84px 1fr;gap:4px 8px;font-size:13px;margin:0}
  .rc-kv dt{color:#9e9e9e}.rc-kv dd{margin:0;word-break:break-word}
  .rc-modal{position:absolute;inset:0;background:rgba(0,0,0,.55);display:grid;place-items:center;padding:16px;animation:rcFade .15s}
  .rc-dialog{width:340px;max-width:100%;background:#fff;color:#262626;border-radius:14px;padding:20px;display:flex;flex-direction:column;gap:10px;box-shadow:0 24px 64px rgba(0,0,0,.5)}
  .rc-dialog b{font-size:16px;line-height:24px}
  .rc-dialog p{margin:0;color:#666;font-size:13px;line-height:18px}
  .rc-dialog p.rc-err{color:#c62828;font-weight:600}
  .rc-dialog input{width:100%;height:40px;border:1px solid #d1d1d1;border-radius:8px;padding:0 10px;font:inherit;font-size:16px;color:#262626;background:#fff;outline:0;margin:0}
  .rc-dialog input:focus{border-color:${ACCENT};box-shadow:0 0 0 3px color-mix(in srgb, ${ACCENT} 12%, transparent)}
  .rc-b.pri.danger{background:#c62828!important}
  .rc-b.pri.danger:disabled{background:#e9e9e9!important}
  .rc-rep{border-top:1px solid #333;padding-top:10px}
  .rc-rep b{font-weight:600}
  .rc-reply{display:flex;flex-direction:column;gap:8px}
  .rc-reply textarea,.rc-reply input{background:#262626;border-color:#444;color:#fff}
  @media (max-width:767px){
    .rc-panel{left:8px;right:8px;width:auto;bottom:68px}
    .rc-compose{left:8px!important;right:8px;top:auto!important;bottom:8px;width:auto}
    .rc-vmain{flex-direction:column}
    .rc-vside{width:auto;border-left:0;border-top:1px solid #333;max-height:38%;padding:12px}
    .rc-tb.hide-s{display:none}
  }`);

  const I = {
    msg: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none"><path d="M4 5.5A1.5 1.5 0 0 1 5.5 4h13A1.5 1.5 0 0 1 20 5.5v10a1.5 1.5 0 0 1-1.5 1.5H10l-4.5 3.5V17h0A1.5 1.5 0 0 1 4 15.5v-10Z" stroke="currentColor" stroke-width="1.75" stroke-linejoin="round"/></svg>',
    x: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
    l: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M15 5l-7 7 7 7" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    r: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M9 5l7 7-7 7" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    plus: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>',
  };

  const start = () => {
  const root = document.createElement('div'); root.id = 'rc-root';
  document.body.appendChild(root);
  // keep the page's own document-level handlers (Esc, arrow keys, click-outside) out of the comment UI
  ['click', 'keydown', 'keyup', 'pointerdown', 'mousedown', 'touchstart'].forEach(t => root.addEventListener(t, e => e.stopPropagation()));

  let list = [], tab = 'open', panelOpen = false, viewing = null, timer = null;
  const me = () => { try { return localStorage.getItem('rc_name') || ''; } catch { return ''; } };
  const remember = n => { try { localStorage.setItem('rc_name', n); } catch {} };

  root.innerHTML = `<button class="rc-fab" id="rc-fab" aria-label="Comments" title="Comments">${I.msg}<span class="rc-count" id="rc-count" hidden></span></button>`;
  const fab = $('#rc-fab', root);

  // never sit on top of the page's own bottom-right buttons: config.avoid selectors, or anything marked data-rc-avoid
  const AVOID = [].concat(CFG.avoid || [], '[data-rc-avoid]').join(',');
  function placeFab() {
    let bottom = 16;
    let els = []; try { els = document.querySelectorAll(AVOID); } catch {}
    els.forEach(f => {
      const r = f.getBoundingClientRect();
      if (!r.width || !r.height) return;
      if (r.right > innerWidth - 70 && r.top < innerHeight - 8 && r.bottom > innerHeight - 120) bottom = Math.max(bottom, innerHeight - r.top + 12);
    });
    fab.style.bottom = bottom + 'px';
    const p = $('.rc-panel', root); if (p) p.style.bottom = (bottom + 56) + 'px';
  }
  new MutationObserver(() => { setTimeout(placeFab, 30); setTimeout(placeFab, 520); }).observe(document.body, {subtree: true, attributes: true, attributeFilter: ['class', 'open', 'hidden']});
  addEventListener('resize', placeFab);
  placeFab();

  async function load() {
    try { list = await api('?page=' + encodeURIComponent(PAGE)); } catch { return; }
    const open = list.filter(c => !c.resolved).length, b = $('#rc-count', root);
    b.textContent = open; b.hidden = !open;
    if (panelOpen) renderPanel();
  }

  function renderPanel() {
    let p = $('.rc-panel', root);
    if (!panelOpen) { p?.remove(); fab.classList.remove('on'); return; }
    if (!p) { p = document.createElement('div'); p.className = 'rc-panel'; root.appendChild(p); }
    fab.classList.add('on');
    const rows = list.filter(c => tab === 'open' ? !c.resolved : c.resolved).sort((a, b) => b.n - a.n);
    const keep = $('.rc-list', p)?.scrollTop || 0;
    p.innerHTML = `
      <div class="rc-head"><b>Comments</b><button class="rc-x" data-a="close" aria-label="Close">${I.x}</button></div>
      <div class="rc-sub">${esc(LABEL)}</div>
      <button class="rc-add" data-a="add">${I.plus} Add a comment</button>
      <div class="rc-tabs"><button data-tab="open" aria-selected="${tab === 'open'}">Open (${list.filter(c => !c.resolved).length})</button><button data-tab="resolved" aria-selected="${tab === 'resolved'}">Resolved (${list.filter(c => c.resolved).length})</button></div>
      <div class="rc-list">${rows.length ? rows.map(c => `
        <button class="rc-item${c.resolved ? ' done' : ''}" data-id="${esc(c.id)}">
          <span class="rc-row"><span class="rc-num">${c.n}</span><span class="rc-who">${esc(c.author)}</span><span class="rc-when" title="${esc(new Date(c.created).toLocaleString())}">${ago(c.created)}</span></span>
          <span class="rc-text">${esc(c.text)}</span>
          <span class="rc-chips"><span class="rc-chip dev">${esc(device(c.snap || {}))}</span><span class="rc-chip">${esc(c.snap?.context || 'Page')}</span>${c.area ? '<span class="rc-chip">Area</span>' : ''}${c.replies.length ? `<span class="rc-chip">${c.replies.length} repl${c.replies.length === 1 ? 'y' : 'ies'}</span>` : ''}</span>
        </button>`).join('') : `<div class="rc-empty">${tab === 'open' ? 'No open comments yet.<br>Use “Add a comment”, then click the spot you want to talk about.' : 'Nothing resolved yet.'}</div>`}</div>`;
    $('.rc-list', p).scrollTop = keep;
    placeFab();
  }
  function togglePanel(on) {
    panelOpen = on ?? !panelOpen;
    clearInterval(timer);
    if (panelOpen) { load(); timer = setInterval(load, 30000); }
    renderPanel();
  }
  RC.open = () => togglePanel(true);
  fab.addEventListener('click', () => togglePanel());
  root.addEventListener('click', e => {
    const t = e.target;
    if (t.closest('[data-a=close]')) return togglePanel(false);
    if (t.closest('[data-a=add]')) return startPin();
    const tb = t.closest('[data-tab]'); if (tb) { tab = tb.dataset.tab; return renderPanel(); }
    const it = t.closest('.rc-item'); if (it) return openViewer(it.dataset.id);
  });

  function toast(msg) {
    const t = document.createElement('div'); t.className = 'rc-toast'; t.textContent = msg; root.appendChild(t);
    setTimeout(() => t.remove(), 2600);
  }

  /* ---------- add a comment: click a spot or drag an area, type, post ---------- */
  const TARGETS = (CFG.targets ? CFG.targets + ',' : '') + '[data-rc-label],button,a,h1,h2,h3,h4,h5,h6,p,label,li,dt,dd,th,td,figcaption,img[alt]';
  function startPin() {
    togglePanel(false);
    fab.hidden = true;
    const layer = document.createElement('div'); layer.className = 'rc-layer';
    layer.innerHTML = `<div class="rc-hint">Click a spot, or drag to select an area · Esc to cancel</div>`;
    root.appendChild(layer);
    let pin = null, box = null, sel = null, down = null;
    const stop = () => { layer.remove(); pin?.remove(); box?.remove(); sel?.remove(); fab.hidden = false; removeEventListener('keydown', onKey, true); };
    const onKey = e => { if (e.key === 'Escape') { e.stopPropagation(); e.preventDefault(); stop(); } };
    addEventListener('keydown', onKey, true);
    // click = pin on a spot; press and drag = select an area
    const rectOf = e => ({x: Math.min(down.x, e.clientX), y: Math.min(down.y, e.clientY), w: Math.abs(e.clientX - down.x), h: Math.abs(e.clientY - down.y)});
    layer.addEventListener('pointerdown', e => {
      if (box || e.button > 0) return;
      down = {x: e.clientX, y: e.clientY, id: e.pointerId};
      try { layer.setPointerCapture(e.pointerId); } catch {}
      e.preventDefault();
    });
    layer.addEventListener('pointermove', e => {
      if (!down || box || e.pointerId !== down.id) return;
      const r = rectOf(e);
      if (!sel && r.w < 8 && r.h < 8) return;
      if (!sel) { sel = document.createElement('div'); sel.className = 'rc-area'; sel.style.position = 'absolute'; root.appendChild(sel); }
      Object.assign(sel.style, {left: r.x + 'px', top: r.y + 'px', width: r.w + 'px', height: r.h + 'px'});
    });
    layer.addEventListener('pointercancel', () => { down = null; sel?.remove(); sel = null; });
    layer.addEventListener('pointerup', e => {
      if (!down || box || e.pointerId !== down.id) return;
      const r = rectOf(e), area = sel && (r.w >= 8 || r.h >= 8) ? {x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.w), h: Math.round(r.h)} : null;
      if (!area) { sel?.remove(); sel = null; }
      const x = area ? area.x : e.clientX, y = area ? area.y : e.clientY;
      const px = area ? area.x + area.w / 2 : x, py = area ? area.y + area.h / 2 : y;
      down = null;
      // what is under the click, for a readable label in the list
      layer.style.display = 'none';
      const under = area ? null : document.elementFromPoint(px, py);
      layer.style.display = '';
      let near = null; try { near = under?.closest(TARGETS) || under; } catch { near = under; }
      const label = (near?.getAttribute?.('data-rc-label') || near?.innerText || near?.getAttribute?.('aria-label') || near?.getAttribute?.('alt') || '').replace(/\s+/g, ' ').trim();
      const target = label.length <= 70 ? label : '';      // a long label means the click landed on a container, not a control
      const snap = snapshot();
      layer.style.cursor = 'default'; $('.rc-hint', layer).textContent = 'Write your comment';
      pin = document.createElement('div'); pin.className = 'rc-pin'; pin.textContent = '+'; pin.style.left = x + 'px'; pin.style.top = y + 'px'; pin.style.position = 'absolute';
      root.appendChild(pin);
      box = document.createElement('form'); box.className = 'rc-compose';
      box.innerHTML = `<input name="author" placeholder="Your name" maxlength="60" value="${esc(me())}" autocomplete="name">
        <textarea name="text" rows="3" placeholder="What should change here?" maxlength="2000"></textarea>
        <div class="rc-meta">Saved with this view: ${esc(device(snap))} · ${esc(snap.context || 'Page')}${area ? ' · selected area' : ''}</div>
        <div class="rc-btns"><button type="button" class="rc-b sec" data-c="cancel">Cancel</button><button class="rc-b pri" disabled>Post</button></div>`;
      root.appendChild(box);
      // beside the pin, or beside / below the selected area, kept on screen
      let bx = area ? area.x + area.w + 12 : x + 18, by = area ? area.y : y - 24;
      if (area && bx > innerWidth - 308) { bx = area.x; by = area.y + area.h + 12; }
      if (area && by > innerHeight - box.offsetHeight - 8 && area.y - box.offsetHeight - 12 > 8) by = area.y - box.offsetHeight - 12;
      box.style.left = Math.max(8, Math.min(bx, innerWidth - 308)) + 'px';
      box.style.top = Math.max(8, Math.min(by, innerHeight - box.offsetHeight - 8)) + 'px';
      const ta = box.elements.text, au = box.elements.author, post = $('.pri', box);
      (au.value ? ta : au).focus();
      const ok = () => { post.disabled = !ta.value.trim(); };
      ta.addEventListener('input', ok);
      ta.addEventListener('keydown', ev => { if (ev.key === 'Enter' && (ev.metaKey || ev.ctrlKey)) box.requestSubmit(); if (ev.key === 'Escape') stop(); });
      $('[data-c=cancel]', box).addEventListener('click', stop);
      box.addEventListener('submit', async ev => {
        ev.preventDefault();
        if (!ta.value.trim()) return;
        post.disabled = true; post.textContent = 'Posting…';
        remember(au.value.trim());
        try {
          await api('', {method: 'POST', body: JSON.stringify({page: PAGE, author: au.value, text: ta.value, pin: {x, y}, area, target, snap})});
          stop(); toast('Comment added'); tab = 'open'; await load(); togglePanel(true);
        } catch (err) { post.disabled = false; post.textContent = 'Post'; toast(err.status === 429 ? 'Too many comments just now. Try again in a minute.' : 'Could not save. Try again.'); }
      });
    });
  }

  /* ---------- viewer: replay what the commenter saw ---------- */
  const replaySrc = c => {
    const u = new URL(c.snap?.url || location.pathname, location.href);
    if (u.origin !== location.origin) return location.pathname + '?rc_replay=' + encodeURIComponent(c.id);
    u.searchParams.set('rc_replay', c.id);
    return u.pathname + u.search + u.hash;
  };
  function openViewer(id) {
    togglePanel(false);
    viewing = id;
    let v = $('.rc-viewer', root);
    if (!v) { v = document.createElement('div'); v.className = 'rc-viewer'; root.appendChild(v); fab.hidden = true; }
    const order = [...list].sort((a, b) => a.n - b.n);
    const i = order.findIndex(c => c.id === id), c = order[i];
    if (!c) return closeViewer();
    const s = c.snap || {};
    v.innerHTML = `
      <div class="rc-vbar">
        <button class="rc-ib" data-v="prev" aria-label="Previous comment" ${i <= 0 ? 'disabled' : ''}>${I.l}</button>
        <button class="rc-ib" data-v="next" aria-label="Next comment" ${i >= order.length - 1 ? 'disabled' : ''}>${I.r}</button>
        <span class="rc-vt">#${c.n} · ${esc(c.author)} · ${ago(c.created)}</span>
        <button class="rc-tb" data-v="resolve">${c.resolved ? 'Reopen' : 'Resolve'}</button>
        <button class="rc-tb hide-s" data-v="delete">Delete</button>
        <button class="rc-ib" data-v="close" aria-label="Close">${I.x}</button>
      </div>
      <div class="rc-vmain">
        <div class="rc-stage"><div class="rc-frame"><iframe title="What the commenter saw"></iframe><div class="rc-load">Restoring their view…</div></div><div class="rc-cap"></div></div>
        <aside class="rc-vside">
          <div class="rc-body">${esc(c.text)}</div>
          <dl class="rc-kv">
            <dt>Screen</dt><dd>${esc(device(s))}</dd>
            <dt>Showing</dt><dd>${esc(s.context || 'Page')}</dd>
            ${c.area ? `<dt>Marked</dt><dd>An area, ${c.area.w} × ${c.area.h}</dd>` : c.target ? `<dt>Clicked on</dt><dd>${esc(c.target)}</dd>` : ''}
            ${detailRows(s).map(([k, val]) => `<dt>${esc(k)}</dt><dd>${esc(val)}</dd>`).join('')}
            <dt>Posted</dt><dd>${esc(new Date(c.created).toLocaleString())}</dd>
          </dl>
          ${c.replies.map(r => `<div class="rc-rep"><b>${esc(r.author)}</b> <span class="rc-meta">${ago(r.created)}</span><div class="rc-body" style="font-size:14px;line-height:20px">${esc(r.text)}</div></div>`).join('')}
          <form class="rc-reply">${me() ? '' : '<input name="author" placeholder="Your name" maxlength="60">'}<textarea name="text" rows="2" placeholder="Reply…" maxlength="2000"></textarea><div class="rc-btns"><button class="rc-b pri">Reply</button></div></form>
          <button class="rc-tb" data-v="delete" style="align-self:flex-start">Delete comment</button>
        </aside>
      </div>`;
    const frame = $('.rc-frame', v), ifr = $('iframe', v), stage = $('.rc-stage', v), cap = $('.rc-cap', v);
    ifr.src = replaySrc(c);
    const fit = () => {
      const W = stage.clientWidth - 32, H = stage.clientHeight - 48, w = s.vw || 1440, h = s.vh || 900;
      const k = Math.min(1, W / w, H / h);
      ifr.style.width = w + 'px'; ifr.style.height = h + 'px'; ifr.style.transform = `scale(${k})`;
      frame.style.width = w * k + 'px'; frame.style.height = h * k + 'px';
      frame.style.left = (stage.clientWidth - w * k) / 2 + 'px'; frame.style.top = Math.max(8, (stage.clientHeight - 24 - h * k) / 2) + 'px';
      cap.textContent = `${w} × ${h}` + (k < 1 ? ` · shown at ${Math.round(k * 100)}%` : ' · actual size');
    };
    fit(); v._fit = fit;
    v.querySelector('.rc-reply').addEventListener('submit', async ev => {
      ev.preventDefault();
      const f = ev.target, text = f.elements.text.value.trim(); if (!text) return;
      if (f.elements.author?.value.trim()) remember(f.elements.author.value.trim());
      try { await api('/' + encodeURIComponent(c.id) + '/replies', {method: 'POST', body: JSON.stringify({author: me(), text})}); await load(); openViewer(c.id); } catch { toast('Could not save. Try again.'); }
    });
  }
  /* deleting needs a password, so comments are not removed by accident or by any visitor */
  function askDelete(c) {
    $('.rc-modal', root)?.remove();
    const m = document.createElement('div'); m.className = 'rc-modal';
    m.innerHTML = `<form class="rc-dialog" autocomplete="off">
      <b>Delete comment #${c.n}?</b>
      <p>This removes it for everyone and can’t be undone. Enter the delete password to continue.</p>
      <input type="password" name="pw" placeholder="Delete password" aria-label="Delete password" autocomplete="off">
      <p class="rc-err" hidden>That password isn’t right.</p>
      <div class="rc-btns"><button type="button" class="rc-b sec" data-d="cancel">Cancel</button><button class="rc-b pri danger" disabled>Delete</button></div></form>`;
    root.appendChild(m);
    const f = $('form', m), pw = f.elements.pw, go = $('.pri', f), err = $('.rc-err', f);
    const close = () => m.remove();
    pw.focus();
    pw.addEventListener('input', () => { go.disabled = !pw.value; err.hidden = true; });
    pw.addEventListener('keydown', e => { if (e.key === 'Escape') close(); });
    m.addEventListener('click', e => { if (e.target === m || e.target.closest('[data-d=cancel]')) close(); });
    f.addEventListener('submit', async e => {
      e.preventDefault();
      if (!pw.value) return;
      go.disabled = true; go.textContent = 'Deleting…';
      try {
        await api('/' + encodeURIComponent(c.id), {method: 'DELETE', headers: {'X-Delete-Password': pw.value}});
        close(); closeViewer(); toast('Comment deleted');
      } catch (ex) {
        go.textContent = 'Delete'; go.disabled = false;
        if (ex.status === 403) { err.hidden = false; pw.select(); } else { close(); toast('That did not work. Try again.'); }
      }
    });
  }
  function closeViewer() { $('.rc-viewer', root)?.remove(); viewing = null; fab.hidden = false; load(); }
  addEventListener('resize', () => $('.rc-viewer', root)?._fit?.());
  addEventListener('message', e => { if (e.origin === location.origin && e.data?.rc === 'ready') { const l = $('.rc-load', root); if (l) { l.style.opacity = 0; setTimeout(() => l.remove(), 260); } } });
  root.addEventListener('click', async e => {
    const b = e.target.closest('[data-v]'); if (!b || !viewing) return;
    const order = [...list].sort((a, b) => a.n - b.n), i = order.findIndex(c => c.id === viewing), c = order[i];
    const a = b.dataset.v;
    if (a === 'close') return closeViewer();
    if (a === 'prev' && order[i - 1]) return openViewer(order[i - 1].id);
    if (a === 'next' && order[i + 1]) return openViewer(order[i + 1].id);
    try {
      if (a === 'resolve') { await api('/' + encodeURIComponent(c.id), {method: 'PATCH', body: JSON.stringify({resolved: !c.resolved})}); await load(); return openViewer(c.id); }
      if (a === 'delete') return askDelete(c);
    } catch { toast('That did not work. Try again.'); }
  });
  addEventListener('keydown', e => {
    if (!viewing || e.target.closest?.('textarea,input') || $('.rc-modal', root)) return;
    if (e.key === 'Escape') { e.stopPropagation(); closeViewer(); }
    if (e.key === 'ArrowLeft') { e.stopPropagation(); $('[data-v=prev]', root)?.click(); }
    if (e.key === 'ArrowRight') { e.stopPropagation(); $('[data-v=next]', root)?.click(); }
  }, true);

  load();
  };
  if (document.body) start(); else addEventListener('DOMContentLoaded', start, {once: true});
})();
