// End-to-end test: node test/e2e.mjs   (needs Google Chrome; set CHROME=/path/to/chrome if it is not in the usual place)
// Starts the example server on a spare port with a fresh data folder, then drives it with puppeteer-core.
import puppeteer from 'puppeteer-core';
import {spawn} from 'child_process';
import {mkdtempSync, rmSync} from 'fs';
import {tmpdir} from 'os';
import path from 'path';
import {fileURLToPath} from 'url';

const here = path.dirname(fileURLToPath(import.meta.url));
const PORT = 4600 + Math.floor(Math.random() * 300), B = `http://localhost:${PORT}`;
const data = mkdtempSync(path.join(tmpdir(), 'rc-test-'));
const srv = spawn(process.execPath, [path.join(here, '..', 'examples', 'server.js')], {env: {...process.env, PORT, DATA_DIR: data, DELETE_PASSWORD: 'secret', RC_SOURCE: 'local'}, stdio: 'inherit'});
const w = ms => new Promise(r => setTimeout(r, ms));
let failed = 0;
const check = (ok, what, extra = '') => { console.log((ok ? '  ok   ' : '  FAIL ') + what + (extra ? '  ' + extra : '')); if (!ok) failed++; };
const CHROME = process.env.CHROME || {darwin: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', linux: '/usr/bin/google-chrome', win32: 'C:/Program Files/Google/Chrome/Application/chrome.exe'}[process.platform];
await w(700);
// --auto-accept-this-tab-capture answers the "capture this tab?" prompt used by Copy for Claude; CHROME_ARGS adds more (e.g. --no-sandbox as root)
const b = await puppeteer.launch({executablePath: CHROME, headless: 'new', args: ['--hide-scrollbars', '--auto-accept-this-tab-capture', ...(process.env.CHROME_ARGS || '').split(' ').filter(Boolean)]});
try {
  const p = await b.newPage(); const errs = []; p.on('pageerror', e => errs.push(String(e)));
  await p.setViewport({width: 1280, height: 800});
  const j = (u, o) => fetch(B + u, o).then(async r => ({status: r.status, body: await r.json().catch(() => null)}));

  console.log('widget and API');
  const js = await fetch(B + '/__rc/rc.js'); check(js.ok && (await js.text()).includes('ReviewComments'), 'serves /__rc/rc.js');
  check((await j('/__rc/version')).body?.version === '1.1.0', 'reports its version');
  check((await j('/__rc/api/comments', {method: 'POST', body: '{}'})).status === 400, 'rejects an empty comment');

  console.log('add a comment through the UI (page with no adapter)');
  await p.goto(B + '/', {waitUntil: 'load'}); await w(300);
  check(await p.$('#rc-fab') !== null, 'comment button is on the page');
  const avoid = await p.evaluate(() => innerHeight - document.querySelector('#rc-fab').getBoundingClientRect().bottom);
  check(avoid > 40, 'button sits above the data-rc-avoid bar', `gap ${Math.round(avoid)}`);
  await p.evaluate(() => { document.querySelector('#more').open = true; document.querySelector('#panel').scrollTop = 300; window.scrollTo(0, 420); }); await w(200);
  const card = await p.evaluate(() => { const r = document.querySelectorAll('.card')[5].getBoundingClientRect(); return {x: Math.round(r.left + 30), y: Math.round(r.top + 30)}; });
  await p.click('#rc-fab'); await w(300);
  await p.click('.rc-add'); await w(200);
  await p.mouse.click(card.x, card.y); await w(300);
  await p.type('.rc-compose input[name=author]', 'Tester');
  await p.type('.rc-compose textarea', 'Make this card bigger');
  await p.click('.rc-compose .pri'); await w(800);
  const list = (await j('/__rc/api/comments?page=home')).body;
  const c = list?.[0];
  check(list?.length === 1 && c.text === 'Make this card bigger' && c.author === 'Tester', 'comment saved');
  check(c?.target === 'Card 6', 'remembers what was clicked', c?.target);
  check(c?.snap?.scrollY === 420 && c.snap.open?.length === 1 && c.snap.scrolls?.some(s => s[1] === 300), 'snapshot has page scroll, open details and panel scroll');

  console.log('replay');
  await p.goto(B + '/?rc_replay=' + c.id, {waitUntil: 'load'}); await w(900);
  const r = await p.evaluate(() => ({y: scrollY, open: document.querySelector('#more').open, panel: document.querySelector('#panel').scrollTop, pin: (() => { const b = document.querySelector('.rc-pin').getBoundingClientRect(); return {x: b.left, y: b.bottom}; })(), fab: !!document.querySelector('#rc-fab')}));
  check(r.y === 420 && r.open && r.panel === 300, 'restores scroll, details and panel scroll', JSON.stringify(r));
  check(Math.abs(r.pin.x - card.x) <= 1 && Math.abs(r.pin.y - card.y) <= 1, 'pin is where the comment was made');
  check(!r.fab, 'no comment UI inside the replay');
  await p.evaluate(() => window.scrollBy(0, 200)); await w(300);
  const moved = await p.evaluate(() => document.querySelector('.rc-pin').getBoundingClientRect().bottom);
  check(Math.abs(moved - (card.y - 200)) <= 1, 'pin stays on its card when the replay is scrolled');

  console.log('viewer');
  await p.goto(B + '/', {waitUntil: 'load'}); await w(300);
  await p.click('#rc-fab'); await w(400);
  await p.click('.rc-item'); await w(1500);
  const v = await p.evaluate(() => ({frame: document.querySelector('.rc-frame iframe')?.style.width, loaded: !document.querySelector('.rc-load'), side: document.querySelector('.rc-vside')?.innerText}));
  check(v.frame === '1280px' && v.loaded, 'viewer replays at the commenter\'s size', JSON.stringify({frame: v.frame, loaded: v.loaded}));
  check(/Clicked on\s*Card 6/.test(v.side || ''), 'viewer shows what was clicked');

  console.log('app with an adapter');
  await p.goto(B + '/app', {waitUntil: 'load'}); await w(300);
  await p.click('[data-tab=two]'); await p.click('#open-drawer'); await w(400);
  await p.evaluate(() => fetch('/__rc/api/comments', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({page: 'app', text: 'drawer note', pin: {x: 1100, y: 100}, snap: window.ReviewComments.snapshot()})}));
  const ac = (await j('/__rc/api/comments?page=app')).body[0];
  check(ac.snap.tab === 'two' && ac.snap.drawer === true && ac.snap.context === 'Drawer open', 'adapter snapshot saved');
  await p.goto(B + '/app?rc_replay=' + ac.id, {waitUntil: 'load'}); await w(1000);
  check(await p.evaluate(() => document.querySelector('#drawer').classList.contains('on') && document.querySelector('[data-tab=two]').getAttribute('aria-selected') === 'true'), 'adapter restore reopens the drawer on tab two');

  check(!errs.length, 'no page errors', errs.join(' | '));

  // Last browser step on purpose: headless Chromium crashes when a tab that is capturing itself stops capturing
  // (closing the viewer, or navigating). Real Chrome does not.
  console.log('copy for Claude');
  await p.goto(B + '/', {waitUntil: 'load'}); await w(300);
  await p.click('#rc-fab'); await w(400);
  await p.click('.rc-item'); await w(1500);
  await b.defaultBrowserContext().overridePermissions(B, ['clipboard-read', 'clipboard-write', 'clipboard-sanitized-write']);
  await p.bringToFront();
  await p.click('[data-v=claude]'); await w(3000);
  const toastText = await p.evaluate(() => document.querySelector('.rc-toast')?.textContent || '');
  check(/^Copied comment #1\. Paste it into Claude\.$/.test(toastText), 'copies with a screenshot', toastText);
  const clip = await p.evaluate(async () => {
    const it = (await navigator.clipboard.read()).find(i => i.types.includes('image/png'));
    if (!it) return null;
    const bmp = await createImageBitmap(await it.getType('image/png'));
    const cv = new OffscreenCanvas(bmp.width, bmp.height), g = cv.getContext('2d'); g.drawImage(bmp, 0, 0);
    // the screenshot is the top part of the image; the replayed marker (#e8590c) must be in it
    const d = g.getImageData(0, 0, bmp.width, Math.floor(bmp.height * 0.45)).data; let pin = 0;
    for (let i = 0; i < d.length; i += 4) if (Math.abs(d[i] - 232) < 24 && Math.abs(d[i + 1] - 89) < 30 && d[i + 2] < 60) pin++;
    const png = await new Promise(r => { const fr = new FileReader(); fr.onload = () => r(fr.result); it.getType('image/png').then(bl => fr.readAsDataURL(bl)); });
    return {w: bmp.width, h: bmp.height, pin, png};
  });
  if (process.env.RC_SAVE_CLIP && clip) { (await import('fs')).writeFileSync(process.env.RC_SAVE_CLIP, Buffer.from(clip.png.split(',')[1], 'base64')); }
  if (clip) delete clip.png;
  check(clip && clip.w >= 1440 && clip.h > clip.w * 0.6, 'clipboard holds one image of the page and the comment', JSON.stringify(clip));
  check(clip && clip.pin > 100, 'the screenshot shows the replayed marker', JSON.stringify(clip));
  const dl = await p.evaluate(async () => {
    const c = (await (await fetch('/__rc/api/comments?page=home')).json())[0];
    const cv = window.ReviewComments.feedbackImage(c);              // no screenshot: text card only
    const blob = await new Promise(r => cv.toBlob(r, 'image/jpeg', 0.9));
    return {type: blob.type, w: cv.width, h: cv.height};
  });
  check(dl.type === 'image/jpeg' && dl.w > 0 && dl.h > 200, 'the same card encodes as a JPG', JSON.stringify(dl));
  check(await p.evaluate(() => !document.querySelector('.rc-capturing') && document.querySelector('.rc-vside')?.offsetWidth > 0), 'viewer is back to normal after the capture');
  check(!errs.length, 'no page errors while copying', errs.join(' | '));

  console.log('reply, resolve, delete');
  check((await j(`/__rc/api/comments/${c.id}/replies`, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({author: 'A', text: 'agreed'})})).body?.replies?.length === 1, 'reply added');
  check((await j(`/__rc/api/comments/${c.id}`, {method: 'PATCH', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({resolved: true})})).body?.resolved === true, 'resolved');
  check((await j(`/__rc/api/comments/${c.id}`, {method: 'DELETE', headers: {'X-Delete-Password': 'nope'}})).status === 403, 'wrong delete password refused');
  check((await j(`/__rc/api/comments/${c.id}`, {method: 'DELETE', headers: {'X-Delete-Password': 'secret'}})).status === 200, 'right delete password works');

} finally {
  await b.close().catch(() => {}); srv.kill(); rmSync(data, {recursive: true, force: true});
}
console.log(failed ? `\n${failed} check(s) failed` : '\nall checks passed');
process.exit(failed ? 1 : 0);
