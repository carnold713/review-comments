# How Review Comments works

The widget (`client/rc.js`), the API (`server/index.js`) and the loader (`index.js`) work together; this page explains the parts that are not obvious from the code.

## How it works

Three pieces:

```
┌───────────────────────────── browser ─────────────────────────────┐
│  Your page                                                         │
│   ├─ adapter (optional): window.__rcAdapter = {snapshot, restore}  │
│   └─ rc.js: button, panel, compose form, viewer                    │
│        │  fetch /__rc/api/comments…                                │
│        │  viewer → <iframe src="same page?rc_replay=<id>">         │
│        │             └─ rc.js in replay mode:                      │
│        │                restore(snap) → marker → postMessage ready │
└────────┼───────────────────────────────────────────────────────────┘
         ▼
┌──────────────── your Node server ───────────────┐
│  loader (index.js) ── checks GitHub every 5 min │
│   └─ server/index.js: /__rc/rc.js, /__rc/api/…  │
│  <dataDir>/comments.json on a persistent volume │
└─────────────────────────────────────────────────┘
```

### 1 Injection
`inject()` inserts, just before `</body>`:

```html
<script>window.__COMMENTS={"base":"/__rc","page":"home","label":"Home page"}</script>
<script src="/__rc/rc.js" defer></script>
```

`page` is the key comments are stored under; `label` is shown at the top of the panel. `rc.js` works out the API address from its own URL.

### 2 The page adapter (the important part)
The widget does not know anything about the page. The page exposes two functions:

```js
window.__rcAdapter = {   // or the older window.__proto
  snapshot() {            // → plain JSON, kept small (server limit 24 KB)
    return {
      vw: innerWidth, vh: innerHeight, dpr: devicePixelRatio,
      scrollY,                       // page scroll (or the locked scroll when a popup has frozen the page)
      q, applied, shown,             // app state: search, filters, how many items are loaded…
      overlay: 'flyout',             // which popup is open, plus whatever it needs (flyId, inner scroll…)
      context: 'Product panel: Light Management Hub',   // human-readable, shown as a chip
      filters: ['Processors & Hubs'],                     // optional, shown in the viewer
    };
  },
  async restore(s) {      // put the page back into that state, resolve when it is settled
    // close popups → set app state → render → scroll → open the popup → wait for its animation → set inner scroll
  },
};
```

Rules that made this reliable:
- Restore in the same order a person would get there: close everything, set state, render, scroll the page, then open the popup, **wait for its open animation**, then set scroll positions inside it.
- Record the scroll position that the user actually sees. If the page is frozen by a popup (`body{position:fixed}`), record the frozen offset, not `window.scrollY`.
- Make `restore` tolerant of old snapshots: unknown fields are ignored and removed features are dropped (when a filter is removed from the page, `restore` should simply stop reading it).
- `context` is the most useful field for people: one short phrase saying what was on screen.

The widget adds `url`, `vw` (layout width without the scrollbar, `document.documentElement.clientWidth`), `vh` and `dpr` itself. Without an adapter it saves page scroll, scrolled elements and open `<details>`/`<dialog>` by CSS path.

### 3 Adding a comment
1. "Add a comment" closes the panel and lays a full-screen transparent layer over the page (crosshair cursor, blue inset border, hint at the top).
2. `pointerdown` records the start. `pointermove` past 8 px starts drawing an area. `pointerup` finishes:
   - no drag → a **pin** at the pointer;
   - drag → an **area** `{x, y, w, h}` in viewport pixels, with the pin at its top-left corner.
3. For a pin, the layer is hidden for a moment and `document.elementFromPoint` finds what was clicked. The nearest meaningful element (a product tile, document row, button, heading…) gives a short label, saved as `target` (only if it is under 70 characters, which filters out clicks on big containers).
4. `snapshot()` is taken **at the moment of the click**, before the compose form appears.
5. The compose form is positioned beside the pin, or beside/below/above the area, and kept on screen.
6. `POST /api/comments` with `{page, author, text, pin, area, target, snap}`.

### 4 The viewer and replay
- The viewer loads the **same page** in an iframe with `?rc_replay=<id>`. Same origin, so no extra permissions are needed.
- The iframe is sized to the commenter's `vw × vh` exactly and scaled down with `transform: scale(k)` where `k = min(1, availableWidth / vw, availableHeight / vh)`. Sizing the iframe to the real width means the page's own media queries produce the same layout the commenter had.
- Inside the iframe, `rc.js` sees `rc_replay` and switches to **replay mode**: it hides the page scrollbar (so the layout width matches), loads the comment, awaits the adapter's `restore(snap)` (or the built-in one), draws the marker, and posts `{rc:'ready'}` to the parent, which fades out the "Restoring their view…" cover.
- Replay mode does not build any of the comment UI, so the replayed page is clean.

### 5 Keeping the marker on the content
Stored coordinates are viewport pixels at the moment of the comment. To make the marker follow the content while the reviewer scrolls the replay:

1. After restore, find the element under the marker (`elementFromPoint` at the pin, or at the centre of the area). That is the **anchor**. Remember its position.
2. Every animation frame, read the anchor's `getBoundingClientRect()`. Move the marker by the anchor's movement since step 1 (`transform: translate(dx, dy)`).
3. If the anchor is removed from the page (re-rendered), pick a new anchor under the marker's current position and continue from there.
4. **Clipping**: while walking up from the anchor, collect ancestors with `overflow` other than `visible` that fully contain the marker (a scrolling panel does; a cropped image wrapper does not). Each frame, intersect their rectangles: the pin is hidden when its point is outside, and the area gets a `clip-path: inset(...)` so only the visible part shows.
5. Only write styles when something changed (a key of the offsets and clip box), so the loop is cheap.

This handles page scroll, scrolling panels, sticky columns, and FLIP-style animations without knowing anything about the page.

### 6 Isolation from the host page
- Everything lives in one fixed `#rc-root` with a huge `z-index`; class names are prefixed `rc-`.
- `#rc-root` stops `click`, `keydown`, `keyup`, `pointerdown`, `mousedown` and `touchstart` from bubbling, so the page's own "click outside to close", Esc, and arrow-key handlers don't fire while someone types a comment.
- Buttons inside the widget reset `font`, `background`, `border` and `padding`, and some rules use `!important`, because host pages often style `button` globally.
- The viewer's keyboard shortcuts are registered in the capture phase and ignore keys typed into inputs.

### 7 Server, storage and updates
- Node with built-in modules only (`http`, `fs`, `crypto`, `zlib`).
- Comments are one JSON array in `DATA_DIR/comments.json`, loaded at startup and written atomically (write `.tmp`, then rename) after every change.
- `dataDir` should point at a persistent volume (on Railway, a volume mounted at `/data`).
- The loader (`index.js`) fetches `server/index.js` and `client/rc.js` from GitHub every few minutes and swaps them in; the last good copy is cached in `<dataDir>/.review-comments`.

---

## Data model

```jsonc
{
  "id": "a1b2c3d4e5",            // 5 random bytes, hex
  "n": 7,                         // per-page running number shown on the pin
  "page": "home",                 // which page/version
  "author": "Sam",             // ≤ 60 chars, "Anonymous" if blank
  "text": "Make this card bigger",   // ≤ 2000 chars
  "pin": { "x": 180, "y": 870 },  // viewport px; for an area, its top-left corner
  "area": { "x": 180, "y": 870, "w": 300, "h": 300 } ,  // or null
  "target": "Card 6",      // label of what was clicked, ≤ 80 chars, "" for areas
  "snap": { /* page adapter snapshot + vw, vh */ },     // ≤ 32 KB
  "created": "2026-10-13T15:31:02.000Z",
  "resolved": false,
  "replies": [ { "author": "…", "text": "…", "created": "…" } ]
}
```

---

## Lessons learned

1. **Size the frame to the layout width, not the window width.** Record `document.documentElement.clientWidth` and hide the scrollbar inside the replay, or the replay can land on the wrong side of a breakpoint. Known gap: a window within ~12 px above a breakpoint may still replay at the smaller layout.
2. **Popups that freeze the page** (`body{position:fixed; top:-Ypx}`) make `window.scrollY` 0. The adapter must report the frozen offset.
3. **Wait for animations** before setting inner scroll positions; a panel that is still sliding in ignores `scrollTop`.
4. **The marker must follow content**, not the viewport. See 2.5.
5. **Only clip at containers that hold the whole marker**, or a marked area gets cut off by image wrappers with `overflow:hidden`.
6. **Stop event propagation** at the widget root, or the host page closes its popups when someone clicks into the comment form.
7. **`[hidden]` gets overridden** by any class that sets `display`. Use a `[hidden]{display:none!important}` rule for the widget's own elements.
8. **Keep the comment button clear of the page's own bottom-right buttons** (sticky footers, "Download"). Re-check on class changes (a MutationObserver) and on resize.
9. **Deletes need a password**; anyone could otherwise wipe a review.
10. **Persistent storage on Railway** needs a volume; with a volume attached, each deploy has a few minutes of downtime ("Application not found") while the old container stops.
11. **Old comments outlive design changes.** Snapshots must tolerate missing or removed features; consider the screenshot fallback (7.3).
12. **Testing with headless Chrome**: taking a screenshot can fire a scroll event; use `captureBeyondViewport:false`.

---

## Ideas for later

**Better anchoring at creation time.** Today the anchor is found during replay. Also store, when the comment is made:
- a CSS path to the element under the pin (or area centre) and the pin's offset inside it as a fraction of its size;
- a short text fingerprint of that element (first 60 chars).

On replay, look the element up by path, check the fingerprint, and place the marker from it. Fall back to the stored coordinates. This keeps markers right after layout changes, not just scrolling.

**Optional visual fallback.** If the page has changed a lot since the comment, a replay can be misleading. Option: capture a small screenshot of the viewport at comment time (`html2canvas`, or server-side with a headless browser later) and show it as a "Then" thumbnail next to the live "Now" replay.

**Optional visual fallback.** If the page has changed a lot since the comment, a replay can be misleading. Option: capture a small screenshot of the viewport at comment time (`html2canvas`, or server-side with a headless browser later) and show it as a "Then" thumbnail next to the live "Now" replay.

- Project or page passwords for posting, if a review should not be open to anyone with the link.
- Notifications (Slack, email) on new comments; export to CSV.
