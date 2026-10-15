---
name: add-review-comments
description: Adds the Review Comments commenting tool (github.com/carnold713/review-comments) to a project so reviewers can drop comments on the live site and replay exactly what they saw. The project always follows the main branch, so every push to the tool updates every project, and each project keeps its own persistent comments database. Use this skill whenever the user asks to add, install, set up, wire up, enable, fix or update "the commenting tool", "review comments", "comment pins", "the feedback widget", "comments on my prototype/site", or wants clients or teammates to leave feedback directly on a running web page, even if they don't name the repository. Also use it when a project's comments disappeared after a deploy, or when the user is changing the tool itself and needs to keep existing comments readable.
---

# Add Review Comments to a project

Review Comments is the user's own commenting tool: <https://github.com/carnold713/review-comments>. A reviewer clicks a spot on the running site, writes a comment, and later anyone can replay the page at the reviewer's screen size and state, then **Copy for Claude** to paste the screenshot and comment straight into Claude.

The user wants one copy of the tool shared by all of their projects: they edit the repository, push to `main`, and every project picks the change up within about 10 minutes with no redeploy. Each project keeps its own comments in a file that must survive restarts, redeploys and tool updates. This skill sets that up.

## How the pieces fit (read this first)

- **The loader** (`index.js` in the repo, copied into the project as `review-comments.js`) runs inside the project's Node server. Every 5 minutes it downloads `server/index.js` (the API) and `client/rc.js` (the widget) from `raw.githubusercontent.com/carnold713/review-comments/main/` and swaps them in. If a download fails or the new API code throws while loading, it keeps the last good copy.
- **The database** is one JSON file, `<dataDir>/comments.json`, written atomically after every change. The last good copy of the tool is cached next to it in `<dataDir>/.review-comments/`. `dataDir` must therefore be on **persistent storage** for that project. If it is not, every deploy silently wipes the comments.
- **The widget** is served from the same origin as the pages (`/__rc/rc.js`) and talks to `/__rc/api/...`. Replay loads the same page in an iframe, so the tool must live in the same Node server that serves the pages. A separate comments server on another domain will not work.
- The loader file itself does **not** update itself; only the API and widget do. That is why you always copy the newest `index.js` from `main` when installing, and replace an older copy when you touch a project that already has one.

## Always use the latest version from `main`

Install from `main` and leave the project following `main`: no `RC_REF`, no `ref` option, no `RC_SOURCE=local`, no vendored copy of `server/` or `client/`. The user has chosen this on purpose so that fixing the tool once fixes it everywhere. Do not pin a tag or commit, and do not "helpfully" freeze the version, unless the user explicitly asks for it in that conversation. If a project you are touching already pins a version or uses `source: 'local'`, point it out and switch it back to `main` (ask first if it looks deliberate, for example a comment saying why it is pinned).

This choice has real security and reliability risks, and the user has accepted them. Tell the user about them briefly the first time you set the tool up in a project (two or three sentences in your final message, not a lecture), and don't argue for pinning:

- Whatever is on `main` runs inside every project's server process (with access to its environment variables, secrets and files) and in every visitor's browser on those sites. Anyone who can push to the repository, or anyone who steals a GitHub login or token with push access, can change all of those sites at once.
- A bad push reaches every project within about 10 minutes. Code that fails to load is rejected and the last good copy keeps running, but a push that loads fine and behaves wrongly (or corrupts `comments.json`) is not caught.
- If GitHub is unreachable, projects keep running the cached copy; brand-new installs serve 503 for `/__rc/...` until the first download succeeds (the bundled copy is used only when the package is installed from npm/GitHub with its `server/` and `client/` folders next to the loader).

Sensible protections that keep the always-latest behaviour: two-factor authentication on the GitHub account, branch protection on `main` (changes go through a pull request and `npm test`), no secrets ever committed to the tool repository, and a different delete password per project. Mention these as options; don't block on them.

## Steps

### 1. Look at the project

Work out, before changing anything:

- **Is there a long-running Node server that serves the pages?** (Express, Fastify, Koa, plain `http`, a Next.js/Nuxt/Remix custom server, `node server.js`, …) The tool needs one. Serverless or static hosting (Vercel/Netlify functions, GitHub Pages, S3) has no persistent disk and no long-running process. In that case stop and explain the options: serve the site from a small Node server (see `references/integration.md`), or host the project somewhere that runs Node with a persistent volume. Don't fake it with a separate comments domain.
- **Where does it deploy?** Railway, Render, Fly.io, Docker/VPS, Heroku, … This decides how persistent storage is set up. Look for `railway.json`/`railway.toml`, `render.yaml`, `fly.toml`, `Dockerfile`, `docker-compose.yml`, `Procfile`, deploy scripts and README notes.
- **Does it already have the tool?** Search for `review-comments`, `__rc`, `reviewComments(`, `comments.handle`, `__COMMENTS`. If it does, you are updating or repairing, not installing: keep the existing `dataDir` and page keys (changing either orphans the existing comments), replace the loader with the latest, and fix anything that pins the version.
- **Is there existing comment data?** If a `comments.json` exists anywhere the project can see (often `/data/comments.json` or `./data/comments.json`), that is the project's database. Never move, rename, reset or reformat it without the user's say-so.

### 2. Add the loader from `main`

Do this before touching the project's code, so you never leave a server that `require`s a file that isn't there. Download the newest loader next to the server entry point (or into a `lib/` folder the project already uses):

```bash
curl -fsSL https://raw.githubusercontent.com/carnold713/review-comments/main/index.js -o review-comments.js
```

Also read `https://raw.githubusercontent.com/carnold713/review-comments/main/README.md` if you can: the README on `main` is the source of truth and may be newer than this skill. Where they disagree, follow the README.

**If the download is blocked** (no network, or the session's permission rules refuse to fetch code from outside), don't try other ways around the block and don't type the file from memory. Stop here and tell the user: what you were about to do, the exact `curl` command above for them to run in the project folder (or to allow in their Claude permission settings), and that you'll continue once `review-comments.js` is there. You may describe the remaining steps, but don't edit the server or commit anything until the loader exists.

Only copy the loader from a local clone if the user points you to one; then take it from `main` as it is on GitHub, not from whatever is checked out: `git -C <clone> fetch origin main && git -C <clone> show origin/main:index.js > review-comments.js`.

Installing the package instead (`npm install github:carnold713/review-comments`) also works and bundles a starting copy of the API and widget, but npm pins the loader to a commit in the lockfile. Prefer the copied file unless the project already installs it this way.

### 3. Wire it into the server

Create the instance once, at startup:

```js
const reviewComments = require('./review-comments');
const comments = reviewComments({
  dataDir: process.env.RC_DATA_DIR || process.env.DATA_DIR || './data',   // persistent storage, see step 4
  deletePassword: process.env.RC_DELETE_PASSWORD,                          // required, see step 5
});
```

Then two things:

1. **Let it handle its own routes** (`/__rc/...`) before the app's routing and **before any body parser** (it reads request bodies itself):
   - plain `http`: `if (comments.handle(req, res)) return;` at the top of the request handler;
   - Express/Connect: `app.use(comments.middleware);` before `express.json()` and friends.
   - Other frameworks: see `references/integration.md`.
2. **Put the widget on the pages**: server-rendered HTML can go through `comments.inject(html, {page: 'home', label: 'Home page'})`; for static or client-rendered HTML, add `comments.tag({page: ..., label: ...})` output, or these two tags, before `</body>`:

   ```html
   <script>window.__COMMENTS = {page: 'home', label: 'Home page'}</script>
   <script src="/__rc/rc.js" defer></script>
   ```

**Page keys are part of the database.** Comments are stored per `page` key, so keys must stay stable for the life of the project. Use short route-based keys (`home`, `pricing`, `product-detail`), not titles, build hashes or anything that changes. A single-page app can use one key for the whole app (each comment still remembers its exact URL and replays it), or one key per major route if every route is a full page load. When you update an existing project, keep the keys it already uses.

Optional page settings go in the same object as `page` and `label` (`inject`/`tag` options, or `window.__COMMENTS`):

| Option | Example | What it does |
|---|---|---|
| `avoid` | `'.chat-launcher, footer.sticky'` or an array of selectors | The comment button moves up to stay clear of these when they sit in the bottom-right corner. Marking an element with the bare attribute `data-rc-avoid` does the same. |
| `targets` | `'.card, .row'` | Extra elements that count as "what was clicked". Any element with `data-rc-label="…"` is used too. |
| `font` | `"'Lutron Sans', Arial, sans-serif"` | Font for the widget. |
| `accent`, `pinColor` | `'#006dcc'`, `'#e8590c'` | Button and marker colours. |
| `breakpoints` | `[[768, 'Mobile'], [1024, 'Tablet'], [1440, 'Desktop Narrow']]` | How screen widths are named; wider is "Desktop". |
| `enabled` | `false` | Turns the widget off on that page. |

Apps that keep state in JavaScript (tabs, filters, a drawer, a selected item) should get an adapter so replays reopen that state: `window.__rcAdapter = {snapshot: () => ({...state, context: 'Drawer open'}), restore: async s => {/* close everything, set state, render, scroll, open panels, wait for animations */}, details: s => [['Tab', s.tab]]}`. Keep snapshots small (under 32 KB) and make `restore` ignore fields it doesn't know, because old comments keep old snapshots. The README has the full contract.

### 4. Make the comments database persistent

This is the step that protects the comments across deploys and tool updates. Point `dataDir` at storage that outlives the container, using a folder dedicated to the tool (so it never collides with the app's own files):

| Host | What to do |
|---|---|
| Railway | Add a volume to the service mounted at `/data`; set `RC_DATA_DIR=/data/review-comments` (or `DATA_DIR=/data` if the project already uses that and already has `/data/comments.json`). |
| Render | Add a persistent disk (paid instance types) mounted at e.g. `/var/data`; set `RC_DATA_DIR=/var/data/review-comments`. |
| Fly.io | `fly volumes create rc_data`, mount it in `fly.toml` (`[mounts] source="rc_data" destination="/data"`); set `RC_DATA_DIR=/data/review-comments`. Keep to one machine, or comments split between machines. |
| Docker / VPS | Mount a named volume or host folder (`-v rc_data:/data`); set `RC_DATA_DIR=/data/review-comments`. |
| Local development | `./data` is fine; add `data/` (or whatever folder you used) to `.gitignore` so comments and the cached tool are never committed. |

More detail, including multiple instances, backups and moving data, is in `references/storage.md`. If you can't configure the host yourself (no CLI access or credentials), make the code change, then give the user the exact clicks or commands for their host and say clearly that comments will be lost on every deploy until the volume exists.

Things that break persistence and must be avoided: `dataDir` inside the app's build output or source folder on an ephemeral container; more than one running instance writing the same file (the store is a single file per process: run one instance, or put the tool on a single instance); two projects sharing one `dataDir` (comments mix and page numbers collide).

### 5. Set the delete password

The API refuses to start without one, and every `/__rc/...` route then answers 503, including the widget script, so the comment button silently doesn't appear. Generate a random one per project (for example `openssl rand -base64 18`) and set it as `RC_DELETE_PASSWORD` in the host's environment variables. Locally, use the project's existing `.env` if it already loads one (and make sure `.env` is git-ignored); otherwise just pass it on the command line (`RC_DELETE_PASSWORD=… npm start`). Don't create a `.env` the app never reads, and don't add dotenv just for this. Give the password to the user in your final message so they can delete comments.

### 6. Check it works

Run the project locally (or check the deployed URL) with a throwaway local `dataDir`, then:

1. `curl -s localhost:<port>/__rc/version` returns JSON with `"source": "github"`, `"ref": "main"`, a `version`/`widget` matching the latest on `main`, and a recent `checked` time.
2. The page HTML contains the two script tags (`window.__COMMENTS` and `/__rc/rc.js`), `/__rc/rc.js` answers 200, and in a browser the round comment button is in the bottom-right corner, clear of sticky footers and chat buttons (fix with `avoid` or `data-rc-avoid`).
3. Post a test comment, restart the server, and check it is still there and that `<dataDir>/comments.json` exists:
   ```bash
   curl -s -X POST localhost:<port>/__rc/api/comments -H 'Content-Type: application/json' \
     -d '{"page":"home","author":"Setup check","text":"Test comment","pin":{"x":10,"y":10},"snap":{}}'
   curl -s 'localhost:<port>/__rc/api/comments?page=home'
   ```
   Then delete it: `curl -s -X DELETE -H "X-Delete-Password: <password>" localhost:<port>/__rc/api/comments/<id>`.

Without access to GitHub (an offline sandbox), a fresh install has no API or widget code yet, so `/__rc/...` answers 503 and checks 1–3 can't pass locally. Then check what you can (the server starts, pages render with the script tags, the loader logs `update check failed`), and say clearly that the live check has to happen on the deployed site after the first deploy.

If the project has tests or a build, run them.

### 7. Tell the user

Finish with a short summary: where the tool was added and which pages have it; the page keys; where the comments live (`dataDir`) and whether persistent storage is already set up or what they still need to click; the delete password (or where you put it); that the project follows `main` and will update itself within about 10 minutes of each push; and the two- or three-sentence risk note from above (first install only).

## When the user is changing the tool itself

Every project's `comments.json` will be read by whatever is on `main` next, so changes to the tool must keep old comments working. Before changing `server/index.js`, `client/rc.js` or the stored format, read `references/data-contract.md`: it lists the stored fields, what may change, how to migrate safely, and what to test before pushing. The short version: add fields, never rename or remove them, treat every field as possibly missing, keep the routes and the loader's contract (`module.exports = function (opts, host) → {handle, version}`), bump the version, and run `npm test` before pushing to `main`.

## Reading a project's comments

- Each comment can be replayed in the viewer and handed to Claude with **Copy for Claude** (one image with the screenshot and the comment) or **Save as JPG**.
- Claude can also read them directly: `GET <site>/__rc/api/comments?page=<key>` returns the comments for a page (all pages without `?page`), including text, author, what was clicked, screen size, URL, replies and resolved state.
- To work through feedback, fetch the open comments (`resolved: false`), make the changes, and resolve each one in the viewer (or `PATCH /__rc/api/comments/<id>` with `{"resolved": true}`) once the user confirms.
