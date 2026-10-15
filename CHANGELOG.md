# Changelog

Every project that follows `main` picks up a release within about 10 minutes of it being pushed.
Pin a project to a release with `RC_REF=<tag>`.

## 1.1.0
- **Copy for Claude** in the replay viewer (button, or press C): one image with what the commenter saw (marker included)
  and the comment with its details, put on the clipboard ready to paste into Claude. **Save as JPG** downloads it.
  The first copy asks to capture the tab; the capture stays on while the viewer is open.
- The e2e test takes extra Chrome flags from `CHROME_ARGS` (for example `--no-sandbox` when running as root).

## 1.0.1
- `GET /__rc/version` reports the release number of both the API and the widget.
- Added this changelog.

## 1.0.0
- First release: comment pins and areas, replay at the commenter's screen size with their state, markers that stay on their
  content, replies, resolve, password-protected delete, and the self-updating loader.
