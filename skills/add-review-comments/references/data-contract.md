# Changing the tool without breaking anyone's comments

Every project that follows `main` will load the new `server/index.js` and `client/rc.js` within about 10 minutes of a push, and point them at that project's existing `comments.json`. Some of those files are years old and were written by older versions. The rules below keep them readable.

## What is stored

`comments.json` is a JSON array. Each element:

```jsonc
{
  "id": "a1b2c3d4e5",        // 10 hex chars, unique; used in URLs (/api/comments/<id>, ?rc_replay=<id>)
  "n": 7,                     // number shown on the marker, unique within its page
  "page": "home",             // page key chosen by the project
  "author": "Sam",            // ≤ 60 chars
  "text": "Make this bigger", // ≤ 2000 chars
  "pin": {"x": 180, "y": 870},                        // viewport px at comment time
  "area": {"x": 180, "y": 870, "w": 300, "h": 300},   // or null
  "target": "Card 6",         // what was clicked, ≤ 80 chars, may be ""
  "snap": {                   // ≤ 32 KB; free-form, written by the page adapter or the built-in snapshot
    "url": "/home?x=1#y", "vw": 1440, "vh": 900, "dpr": 2, "context": "Page"
    // + scrollX/scrollY/scrolls/open (built-in) or anything an adapter returns
  },
  "created": "2026-10-13T15:31:02.000Z",
  "resolved": false,
  "replies": [{"author": "…", "text": "…", "created": "…"}]
}
```

Records written by older versions may lack fields that newer versions add. `snap` contents vary by page and by age.

## Rules for changes

1. **Additive only.** Add new optional fields. Never rename, remove or change the type or meaning of an existing field. If a field becomes obsolete, stop writing it but keep reading it.
2. **Read defensively.** In both the server and the widget, treat every field as possibly missing or of an unexpected type (`c.replies || []`, `c.snap || {}`, `c.area ?? null`). Old snapshots must not make `restore` throw; ignore what isn't understood.
3. **Keep the API stable.** Existing routes, methods, request bodies and response shapes under `/__rc` keep working. New behaviour gets new optional fields or new routes. The widget served by one project and its API always come from the same push, but browsers may hold the old widget open for a while, so the API must still accept the previous widget's requests.
4. **Keep the loader contract.** `server/index.js` must keep exporting `function (opts, host) → {handle(req, res), version}`, accept the same options, use `opts.dataDir` and `host.client()`, and never throw at load time for an existing data file. `client/rc.js` must keep the string `ReviewComments` (the loader checks for it). Projects carry old copies of the loader (`review-comments.js`) for a long time, so don't rely on loader changes reaching them.
5. **Never lose data on load.** If the server can't parse `comments.json`, it currently starts empty and would overwrite the file on the next write. If you touch the store, keep a copy of an unparseable file (e.g. rename to `comments.broken-<timestamp>.json`) before anything is written, and never truncate the file except by the atomic write.
6. **If the format truly must change**, migrate in the server at load time, in memory: upgrade each old record to the new shape, write a one-off backup (`comments.backup-<version>.json`) before the first save, then save atomically. The migration must be idempotent (running it on already-migrated data changes nothing) and the new code must still read un-migrated records, because a rollback (reverting the push) will run old code on migrated data. The old code must therefore still understand migrated records: only add, never restructure.
7. **Limits** (`maxComments`, snapshot size, text lengths) may be raised freely; lowering them must not reject or truncate records that already exist.

## Before pushing to `main`

- Bump the version in `client/rc.js`, `server/index.js`, `package.json` and the version check in `test/e2e.mjs`; add a `CHANGELOG.md` entry.
- Run `npm test` (headless Chrome; set `CHROME=/path/to/chrome`, and `CHROME_ARGS=--no-sandbox` when running as root).
- If the change touches stored data or the API, also test against an old file: start the example server with a `comments.json` written by the previous version (or the record above with fields removed) and check the list, the viewer and replay still work.
- Remember the blast radius: a push reaches every project within about 10 minutes. Prefer a pull request into `main` over pushing directly, and to try a risky change on one project first, set `RC_REF=<branch>` on that project only, then remove it after merging.
