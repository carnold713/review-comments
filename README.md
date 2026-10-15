# Review Comments

Comment on a live site, and see exactly what the commenter saw.

Reviewers click a spot (or drag over an area) on the running site and leave a comment. Opening the comment later replays the page **at their screen size, scrolled to where they were, with the same panels open and the same app state**, and the marker stays attached to the content it was dropped on as you scroll around.

It runs inside your own Node server: no third-party service, no build step, no dependencies. Comments are stored in a JSON file next to your app.

**One copy, every project.** Each project includes a small loader. It pulls the widget and the API from this repository and checks for updates every few minutes, so pushing a change here updates every project that uses it, without redeploying them.

---

## Add it to a project

### 1. Get the loader

Either copy [`index.js`](index.js) into your project (for example as `review-comments.js`), or install the package from GitHub:

```bash
npm install github:carnold713/review-comments
```

Copying the one file is the simplest: there is nothing to install, and the loader fetches everything else.

### 2. Use it in your server

```js
const http = require('http');
const reviewComments = require('./review-comments');      // or require('review-comments') if installed

const comments = reviewComments({
  dataDir: process.env.DATA_DIR || './data',               // comments.json is stored here
  deletePassword: process.env.DELETE_PASSWORD,             // needed to delete a comment
});

http.createServer((req, res) => {
  if (comments.handle(req, res)) return;                   // the widget and the API, under /__rc
  // …your own routing…
  res.end(comments.inject(html, {page: 'home', label: 'Home page'}));   // put the widget on a page
}).listen(process.env.PORT || 3000);
```

With **Express**, mount it before any body parser:

```js
app.use(comments.middleware);
app.get('/', (req, res) => res.send(comments.inject(html, {page: 'home'})));
```

Not rendering HTML on the server? Put the tags in your page yourself (`comments.tag({page: 'home'})` returns them):

```html
<script>window.__COMMENTS = {page: 'home', label: 'Home page'}</script>
<script src="/__rc/rc.js" defer></script>
```

### 3. Store comments somewhere that lasts

`dataDir` must survive restarts and redeploys. On Railway, add a volume (for example at `/data`) and set `DATA_DIR=/data`. With a volume attached, Railway takes the old container down before starting the new one, so expect a minute or two of downtime per deploy.

That's it. A comment button appears in the bottom-right corner of the page.

---

## Page options

Passed to `inject(html, options)` / `tag(options)`, or set as `window.ReviewCommentsConfig` before the widget loads.

| Option | Default | What it does |
|---|---|---|
| `page` | the URL path | Which page the comments belong to. Use a stable key when several URLs show the same page, or different keys for different versions of a prototype. |
| `label` | the page title | Shown at the top of the comments panel. |
| `font` | system font | CSS `font-family` for the widget, e.g. `"'Lutron Sans', Arial, sans-serif"`. |
| `accent` / `pinColor` | `#006dcc` / `#e8590c` | Button and marker colours. |
| `avoid` | none | CSS selectors the comment button should stay above (sticky footers, chat buttons). You can also add `data-rc-avoid` to those elements. |
| `targets` | buttons, links, headings… | Extra selectors for "what was clicked" (e.g. `".card, .row"`). Any element with `data-rc-label="…"` is used too. |
| `breakpoints` | `[[768,'Mobile'],[1024,'Tablet'],[1440,'Desktop Narrow']]` | How screen sizes are named in the list; wider than the last one is "Desktop". |
| `enabled` | `true` | `false` turns the widget off on that page. |

## Server options

| Option | Environment variable | Default |
|---|---|---|
| `dataDir` | `RC_DATA_DIR` or `DATA_DIR` | `./data` |
| `deletePassword` | `RC_DELETE_PASSWORD` or `DELETE_PASSWORD` | required |
| `ref` | `RC_REF` | `main`: the branch, tag or commit to follow |
| `source` | `RC_SOURCE` | `github`; `local` uses only the copy next to the loader and never updates |
| `refreshMinutes` | `RC_REFRESH_MINUTES` | `5` |
| `repo` | `RC_REPO` | `carnold713/review-comments` |
| `base` | | `/__rc`, the URL prefix for every route |
| `pages` | | optional list of allowed page keys |
| `maxComments`, `postsPerMinute` | | `5000`, `30` per address |

## How updates reach your projects

- On start, the loader uses the last copy it downloaded (kept in `<dataDir>/.review-comments`), or the copy next to it.
- It then fetches `server/index.js` and `client/rc.js` from `raw.githubusercontent.com/<repo>/<ref>/`, and again every `refreshMinutes`.
- New widget code is served to browsers straight away. New API code is loaded in place of the old one; if it fails to load, the old one keeps running.
- GitHub's raw files are cached for up to 5 minutes, so a push reaches every project within about 10 minutes.
- `GET /__rc/version` shows which versions a project is running and when it last checked.

**Pin a version** when you don't want a project to change: tag a release here (`git tag v1.1.0 && git push --tags`) and set `RC_REF=v1.1.0` on that project.

Because every project runs whatever is on `main`, treat `main` as production: run `npm test` before pushing, and keep the comment format backwards compatible. Anyone who can push to this repository can change code on every site that follows it.

---

## Saving app state (adapters)

Without any setup, a comment saves the page scroll, scroll positions inside scrolling elements, and open `<details>` / `<dialog>` elements, and restores them on replay.

If your page keeps state in JavaScript (filters, tabs, a drawer, a selected item), give the widget an adapter:

```js
window.__rcAdapter = {
  snapshot: () => ({
    tab: state.tab, filters: [...state.filters], drawerOpen: state.drawerOpen,
    scrollY: Math.round(scrollY),
    context: state.drawerOpen ? 'Drawer open' : 'Page',   // short "what was showing", shown in the list
  }),
  restore: async s => {
    // close everything → set state → render → scroll → open panels → wait for their animation → inner scroll
    Object.assign(state, {tab: s.tab, filters: new Set(s.filters), drawerOpen: s.drawerOpen});
    render();
    scrollTo(0, s.scrollY || 0);
    await new Promise(r => setTimeout(r, 400));
  },
  details: s => [['Tab', s.tab], ['Filters', s.filters.join(', ')]],   // optional rows in the viewer
};
// or, after the widget has loaded: ReviewComments.adapter({...})
```

With an adapter, the adapter is responsible for scrolling. Keep snapshots small (under 32 KB) and tolerant: old comments keep their old snapshots, so `restore` should ignore fields it no longer understands. The widget adds `url`, `vw`, `vh` and `dpr` itself.

Pages that already define `window.__proto = {snapshot, restore}` (the original prototype contract) work as they are.

---

## Using it

- **Comment:** the round button → **Add a comment** → click a spot, or press and drag to mark an area → type → **Post** (Cmd/Ctrl+Enter). Esc cancels. Your name is remembered in the browser.
- **Read:** the list has **Open** and **Resolved** tabs. Each comment shows the screen size, what was showing, and the reply count.
- **Replay:** click a comment. The page loads in a frame at the commenter's size (scaled to fit), restored to their state, with their marker. ← → step through comments, Esc closes.
- **Reply, Resolve / Reopen, Delete** from the viewer. Delete asks for the delete password.

Anyone with the link can post. Deleting needs the password.

## API

All under `/__rc`:

| Method | Path | |
|---|---|---|
| GET | `/rc.js` | the widget |
| GET | `/version` | versions in use, last update check |
| GET | `/api/comments?page=<key>` | comments for a page |
| GET | `/api/comments/<id>` | one comment |
| POST | `/api/comments` | `{page, author, text, pin:{x,y}, area?:{x,y,w,h}, target?, snap}` |
| POST | `/api/comments/<id>/replies` | `{author, text}` |
| PATCH | `/api/comments/<id>` | `{resolved: true \| false}` |
| DELETE | `/api/comments/<id>` | header `X-Delete-Password` |

## Developing

```bash
npm install          # only puppeteer-core, for the tests
npm start            # example site on http://localhost:4600 using the local code
npm test             # end-to-end test in headless Chrome
```

- `client/rc.js`: the widget (no dependencies, plain browser JavaScript).
- `server/index.js`: the API and file store (Node built-ins only). Exports `create(options, {client, info})` returning `{handle}`.
- `index.js`: the loader that projects use.
- `examples/`: a plain page and a page with an adapter.

To try a change in a project before it reaches everyone, push it to a branch and set `RC_REF=<branch>` on that project. To run a project against your working copy, `npm install /path/to/review-comments` there and set `RC_SOURCE=local`.

See [docs/how-it-works.md](docs/how-it-works.md) for the design: snapshots, replay, keeping markers on their content, and lessons learned.

## License

MIT
