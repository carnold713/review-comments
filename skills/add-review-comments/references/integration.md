# Wiring the loader into different servers

All of these assume `const comments = reviewComments({...})` from SKILL.md step 3. Two rules apply everywhere:

- `/__rc/...` must reach `comments.handle(req, res)` with the **raw Node request and response**, **before** any body parser has read the body.
- The pages and `/__rc/...` must be served from the **same origin** (same protocol, host and port). Replay loads the page in a same-origin iframe, and the API is called with same-origin credentials.

## Plain `http`

```js
http.createServer((req, res) => {
  if (comments.handle(req, res)) return;
  // ...the app's own routing; for HTML responses:
  res.end(comments.inject(html, {page: 'home', label: 'Home page'}));
}).listen(process.env.PORT || 3000);
```

## Express / Connect

```js
const app = express();
app.use(comments.middleware);            // first, before express.json(), bodyParser, csrf, auth that reads bodies
app.use(express.json());
// server-rendered page:
app.get('/', (req, res) => res.send(comments.inject(renderHome(), {page: 'home', label: 'Home'})));
// static files: add the two script tags to the HTML files (see below), or inject on the way out
app.use(express.static('public'));
```

If the app has authentication middleware that would block `/__rc/...`, mount `comments.middleware` before it only if the user wants reviewers who are not logged in to comment; otherwise mount it after authentication but still before body parsers.

## Fastify

```js
fastify.addHook('onRequest', (request, reply, done) => {
  if (request.raw.url.startsWith('/__rc')) { reply.hijack(); comments.handle(request.raw, reply.raw); return; }
  done();
});
```

## Koa

```js
app.use(async (ctx, next) => {
  if (ctx.path.startsWith('/__rc')) { ctx.respond = false; comments.handle(ctx.req, ctx.res); return; }
  await next();
});
```

## Next.js, Nuxt, Remix, SvelteKit, Astro (Node adapter)

These need a **custom Node server** (or the framework's Node adapter with a custom entry) running on a host with a persistent volume. They do not work on Vercel/Netlify serverless.

Next.js custom server:

```js
const next = require('next');
const app = next({dev: process.env.NODE_ENV !== 'production'});
const handleNext = app.getRequestHandler();
app.prepare().then(() => {
  http.createServer((req, res) => { if (comments.handle(req, res)) return; handleNext(req, res); }).listen(process.env.PORT || 3000);
});
```

Add the widget once in the root layout / `_document` (`<script>` tags below), with a fixed `page` key per route or one key for the whole app.

## Static sites and single-page apps (Vite, CRA, plain HTML)

The built files need a small Node server in production that serves them and the tool together:

```js
const express = require('express');
const app = express();
app.use(comments.middleware);
app.use(express.static('dist'));
app.get('*', (req, res) => res.sendFile(require('path').resolve('dist/index.html')));   // SPA fallback
app.listen(process.env.PORT || 3000);
```

Add the tags to `index.html` (Vite keeps them as-is):

```html
<script>window.__COMMENTS = {page: 'app', label: 'My app'}</script>
<script src="/__rc/rc.js" defer></script>
```

During `vite dev`, either run this server alongside and proxy `/__rc` to it (`server.proxy: {'/__rc': 'http://localhost:3000'}`), or add the middleware in a plugin: `configureServer(server) { server.middlewares.use(comments.middleware) }`.

## Choosing page keys

- Server-rendered sites with distinct pages: one key per page or template (`home`, `pricing`, `product-detail`).
- Single-page apps: one key for the app is simplest. Every comment stores the exact URL it was made on (`snap.url`) and replays that URL, so different routes still replay correctly.
- Prototypes with versions: a key per version (`checkout-v1`, `checkout-v2`) keeps each version's comments separate.
- Never derive keys from titles, query strings, build hashes or timestamps: a changed key hides that page's existing comments.
