# Keeping each project's comments database safe

Each project's database is `<dataDir>/comments.json`: a JSON array of comment objects, rewritten atomically (write `comments.json.tmp`, then rename) after every change. Next to it, `<dataDir>/.review-comments/` holds the last good copy of the tool downloaded from GitHub. Both belong on persistent storage.

## Choosing `dataDir`

- Resolution order: the `dataDir` option, then `RC_DATA_DIR`, then `DATA_DIR`, then `./data` relative to the working directory.
- Prefer a dedicated folder on the volume, e.g. `/data/review-comments`, set through `RC_DATA_DIR`, so the tool never shares a folder with the app's own files.
- **Existing projects:** if `comments.json` already exists somewhere, keep pointing at it. Changing `dataDir` makes all existing comments disappear from the site (they are still on disk, just not read).
- One project, one `dataDir`. Two projects sharing a folder mix their comments and their per-page comment numbers.

## Hosts

### Railway
1. Service → Settings → Volumes → add a volume, mount path `/data`.
2. Variables: `RC_DATA_DIR=/data/review-comments`, `RC_DELETE_PASSWORD=<random>`.
3. With a volume attached, Railway stops the old container before starting the new one, so each deploy has a minute or two of downtime. That is expected.
CLI: `railway volume add --mount-path /data`, `railway variables --set RC_DATA_DIR=/data/review-comments`.

### Render
Persistent disks need a paid instance type. Service → Disks → add, mount path `/var/data`; set `RC_DATA_DIR=/var/data/review-comments`. A service with a disk runs a single instance and has brief downtime on deploy.

### Fly.io
```bash
fly volumes create rc_data --size 1
```
```toml
[mounts]
  source = "rc_data"
  destination = "/data"
```
Set `fly secrets set RC_DATA_DIR=/data/review-comments RC_DELETE_PASSWORD=...`. Volumes are tied to one machine: keep the app at one machine (`fly scale count 1`), or comments split between machines.

### Docker / docker-compose / VPS
```yaml
services:
  web:
    volumes: [rc_data:/data]
    environment: [RC_DATA_DIR=/data/review-comments]
volumes:
  rc_data:
```
On a plain VPS, use a folder outside the deploy directory (e.g. `/var/lib/<project>/review-comments`) so redeploys that replace the app folder don't delete it.

### Heroku and other hosts with ephemeral disks only
No persistent filesystem: comments vanish on every restart. Move the project to a host with volumes, or tell the user the tool can't keep comments there. (The tool has no database backend other than the file.)

## Several instances

The store is a single file held in memory by one process. Two processes writing the same file overwrite each other's changes. Run the project as a single instance, or route `/__rc/...` to one instance. Don't enable horizontal scaling for a service that hosts the tool.

## Local development

`./data` is fine. Add the folder to `.gitignore`. Comments made locally stay local; they are not synced with production.

## Backups, moving and restoring

- Back up: copy `comments.json` from the volume, or download it through the API: `curl <site>/__rc/api/comments > comments-backup.json` (all pages, full records).
- Move to a new volume or host: stop the service, copy `comments.json` into the new `dataDir`, start it. The `.review-comments/` cache can be skipped; it is re-downloaded.
- Restore: stop the service, replace `comments.json` with the backup, start it. The file must be a JSON array; if it can't be parsed, the server starts with an empty list and overwrites it on the next change, so check the file before restoring.
- Before any risky change (a tool update that migrates data, a host move), take a backup first.

## Symptoms and causes

| Symptom | Likely cause |
|---|---|
| Comments vanish after each deploy | `dataDir` not on a volume, or the volume is mounted somewhere other than `dataDir`. |
| Comments vanish after changing code | Page keys or `dataDir` changed. |
| Some comments appear and disappear | More than one instance is running. |
| `/__rc/...` returns 503 | No delete password set (the API refuses to start), or a brand-new install that has not reached GitHub yet. Check the server log lines starting with `[review-comments]`. |
| `/__rc/version` shows an old version | The project pins `RC_REF`/`ref` or uses `RC_SOURCE=local`, the server can't reach `raw.githubusercontent.com`, or it has not checked yet (every 5 minutes, plus up to 5 minutes of GitHub caching). |
