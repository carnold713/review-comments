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

Download the newest loader into the project, next to the server entry point (or in a `lib/` folder the project already uses):

```bash
curl -fsSL https://raw.githubusercontent.com/carnold713/review-comments/main/index.js -o review-comments.js
```

If you cannot download it, copy `index.js` from a clone of the repository. Do not hand-type it. Also skim `https://raw.githubusercontent.com/carnold713/review-comments/main/README.md`: the README on `main` is the source of truth for options, and it may have changed since this skill was written. Where they disagree, follow the README.

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

Optional page settings (`font`, `accent`, `avoid`, `targets`, `breakpoints`) and the state adapter for apps that keep state in JavaScript are described in the README. Add an adapter when the page has tabs, filters, drawers or a selected item that matter for understanding a comment.

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

The API refuses to start without one, and `/__rc/...` then answers 503. Generate a random one per project (for example `openssl rand -base64 18`), set it as `RC_DELETE_PASSWORD` in the host's environment variables and in the local `.env` if the project uses one (never commit it), and give it to the user in your final message so they can delete comments.

### 6. Check it works

Run the project locally (or against the deployed URL) and check:

1. `GET /__rc/version` returns JSON with `"source": "github"` and `"ref": "main"`, a `version`/`widget` matching the latest on `main`, and a recent `checked` time (the first check happens at startup; if `checked` is null the server could not reach GitHub, which is fine locally but must work in production).
2. The page shows the round comment button in the bottom-right corner, and it is not covering a sticky footer or chat button (use the `avoid` option or `data-rc-avoid` if it is).
3. Posting a comment creates `<dataDir>/comments.json`, and the comment is still there after restarting the server. Delete your test comment afterwards (viewer → Delete, using the password), or with `curl -X DELETE -H "X-Delete-Password: …" <site>/__rc/api/comments/<id>`.

If the project has tests or a build, run them.

### 7. Tell the user

Finish with a short summary: where the tool was added and which pages have it; the page keys; where the comments live (`dataDir`) and whether persistent storage is already set up or what they still need to click; the delete password (or where you put it); that the project follows `main` and will update itself within about 10 minutes of each push; and the two- or three-sentence risk note from above (first install only).

## When the user is changing the tool itself

Every project's `comments.json` will be read by whatever is on `main` next, so changes to the tool must keep old comments working. Before changing `server/index.js`, `client/rc.js` or the stored format, read `references/data-contract.md`: it lists the stored fields, what may change, how to migrate safely, and what to test before pushing. The short version: add fields, never rename or remove them, treat every field as possibly missing, keep the routes and the loader's contract (`module.exports = function (opts, host) → {handle, version}`), bump the version, and run `npm test` before pushing to `main`.

## Reading a project's comments

- Each comment can be replayed in the viewer and handed to Claude with **Copy for Claude** (one image with the screenshot and the comment) or **Save as JPG**.
- Claude can also read them directly: `GET <site>/__rc/api/comments?page=<key>` returns the comments for a page (all pages without `?page`), including text, author, what was clicked, screen size, URL, replies and resolved state.
- To work through feedback, fetch the open comments (`resolved: false`), make the changes, and resolve each one in the viewer (or `PATCH /__rc/api/comments/<id>` with `{"resolved": true}`) once the user confirms.
