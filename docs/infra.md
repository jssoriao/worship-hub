# Infrastructure runbook

Everything that exists outside this repo, how it was created, and how to remove it.
Wrangler has no state file, so this table is the source of truth. Update it whenever a resource is added.

Cloudflare account: the owner's personal account. Run `pnpm exec wrangler whoami` to confirm before touching anything.

## Resources

| Resource | Where | Create | Delete |
|---|---|---|---|
| DNS zone `jssoriao.dev` | Cloudflare (registrar stays GoDaddy) | Dashboard: Add a domain, then set the two Cloudflare nameservers at GoDaddy | Point nameservers back to GoDaddy, then remove the site in Cloudflare |
| Worker `worship-hub` (app assets, `/api/auth/*`, `/songs/*`). Secrets: `DATABASE_URL` (the app role `worship_hub_worker` on production, from `.prod.vars`), `BETTER_AUTH_SECRET` (random), `RESEND_API_KEY` | Cloudflare Workers | `pnpm cf:deploy`, then `pnpm exec wrangler secret put <NAME>` for each secret | `pnpm exec wrangler delete` |
| Worker `worship-hub-redirect` (`src/redirect/`): redirect only, no bindings or secrets. Owns the app's previous address (custom domain, set in `src/redirect/wrangler.jsonc`, which is gitignored; template `src/redirect/wrangler.example.jsonc`) and sends every request to the same path on `worshiphub.jssoriao.dev` (301) | Cloudflare Workers | `pnpm cf:deploy:redirect` | `pnpm exec wrangler delete --config src/redirect/wrangler.jsonc` (the previous address then stops working; check DNS afterwards) |
| Custom domain `worshiphub.jssoriao.dev` | Declared in `wrangler.jsonc` (`routes`) | Created by `pnpm cf:deploy` | Removed by `wrangler delete` (check DNS afterwards) |
| R2 bucket `worship-hub` (private; every church's files under `churches/<churchId>/songs/<songId>/`) | Cloudflare R2 | `pnpm exec wrangler r2 bucket create worship-hub` | Empty it, then `pnpm exec wrangler r2 bucket delete worship-hub` |
| Neon project `worship-hub` (branch `production`), database `neondb` (production: people, churches, members, sessions, songs, arrangements). URLs in `.prod.vars` (gitignored): `DATABASE_OWNER_URL` (owner) and `DATABASE_URL` (app role, also the Worker secret) | Neon, standalone account | Dashboard: create project, copy the owner's pooled connection string; then `pnpm db:migrate --target prod` and `pnpm db:app-role --target prod` | Dashboard: delete project |
| Postgres role `worship_hub_worker` on each branch: the app's login, data access only (select/insert/update/delete on the app's tables, also on tables added later; no DDL, no create database/role) | Neon (SQL, not the console: console roles join `neon_superuser`, which the owner cannot remove) | `pnpm db:app-role [--target prod]` (also rotates the password); for prod then `pnpm exec wrangler secret put DATABASE_URL` | `drop owned by worship_hub_worker; drop role worship_hub_worker;` as the owner (after pointing the Worker elsewhere) |
| Neon branch `development` of project `worship-hub` (child of `production`, database `worship_hub`; development only). Pooled URL in `.dev.vars` (gitignored) | Neon | Dashboard > Branches > Create branch `development`, parent `production`, "Branch data and schema", auto-delete Never; create database `worship_hub` (Dashboard > Databases, owner `neondb_owner`), then `pnpm db:migrate` and `pnpm db:app-role` | Dashboard > Branches > `development` > Delete |
| Resend domain `mail.jssoriao.dev` + API key | Resend, DNS records in Cloudflare | Dashboard: Domains > Add domain, add the records it lists in Cloudflare DNS | Dashboard: delete domain and key, remove the DNS records |
| Budget alert | Cloudflare dashboard: Billing, Billable usage | Dashboard: Add Budget Alert | Dashboard |

### Worker secrets

| Secret | Value | Set | Remove |
|---|---|---|---|
| `DATABASE_URL` | Pooled connection string of the app role `worship_hub_worker` on `production` (the `DATABASE_URL` line of `.prod.vars`); never the owner | `pnpm exec wrangler secret put DATABASE_URL` | `pnpm exec wrangler secret delete DATABASE_URL` |
| `BETTER_AUTH_SECRET` | Random string: `openssl rand -base64 32`. Changing it signs everyone out | `pnpm exec wrangler secret put BETTER_AUTH_SECRET` | same pattern |
| `RESEND_API_KEY` | Resend API key with sending access | `pnpm exec wrangler secret put RESEND_API_KEY` | same pattern |

Non-secret settings (`APP_URL`, `MAIL_FROM`) live in `wrangler.jsonc` under `vars`.

### Databases: dev and prod

- `.prod.vars` points at branch `production`, `.dev.vars` at branch `development` (database `worship_hub`;
  production still uses `neondb` until the stack cutover, #21), pooled URLs, gitignored, in the main repo and in
  each worktree. Each has two logins:
  - `DATABASE_URL`: the app role `worship_hub_worker` (data only). The Worker uses it, locally (`pnpm dev:api`)
    and deployed (as its secret), so local runs have exactly production's rights.
  - `DATABASE_OWNER_URL`: the owner `neondb_owner`. Only scripts use it (`db:migrate`, `members`, `churches`,
    `songs:publish`, `songs:analyse`, `db:app-role`), because migrations create and alter tables.
  Scripts default to dev; anything that should touch production needs `--target prod`. Scripts and the dev
  server refuse to run when `.dev.vars` names the production database (either login; same host and database).
- After "Reset from parent" the development branch gets production's role and password; run `pnpm db:app-role`
  to give dev its own password again.
- `development` is a copy-on-write branch of `production`: its own compute (scales to zero after 5 min idle),
  storage only for what changes. Free plan: up to 10 branches per project, and the project's 100 CU-hours and
  1 GB of storage a month are shared by its branches.
- Fresh copy of production data (people, churches, songs): Dashboard > Branches > `development` > Reset from
  parent. That replaces everything on the branch (every database on it, roles included); run `pnpm db:migrate`
  afterwards if dev had newer migrations, and `pnpm db:app-role` for dev's own password.
- Local development runs the real Worker against the `development` branch (`pnpm dev:api` + `pnpm dev`);
  put songs into its local R2 with a dev publish (`pnpm songs:publish "Song Folder" --church <slug>`).

### Cutover to the new stack (#21), once

Production moves from `neondb` (old tables, 12-character ids) to `worship_hub` (Drizzle tables, prefixed
ids), and its R2 files to the new ids. Dev went through the same steps (see History). Each step is
safe to repeat, and nothing old is deleted until the end, so the previous Worker version keeps
working throughout and is the rollback.

1. Freeze edits for a few minutes: no `songs:publish`, chart or analysis edits, arrangement saves.
2. Neon dashboard > `production` > Databases > New database `worship_hub`, owner `neondb_owner`. Point both
   URLs in `.prod.vars` at `/worship_hub` (keep the old lines commented for the rollback), then
   `pnpm db:migrate --target prod` and `pnpm db:app-role --target prod --keep-password` (grants on the new
   database, same password, so the live Worker is unaffected).
3. `pnpm db:move --from neondb --target prod`: copies every row with a new id (row counts are checked) and
   writes `.id-map.prod.json`.
4. `pnpm r2:rekey --target prod`: copies the R2 files to their new keys inside Cloudflare (a temporary
   Worker `worship-hub-rekey`, deleted when it finishes). Old keys stay.
5. GitHub: `gh secret set DATABASE_OWNER_URL --env production` with the new owner URL.
6. Deploy the new code with the new database in one step: `pnpm build`, `pnpm exec wrangler versions upload`,
   `pnpm exec wrangler versions secret put DATABASE_URL` (the new app URL) on that version, then
   `pnpm exec wrangler versions deploy <version>@100%`, then `pnpm smoke` and a real sign-in on a phone.
7. Merge `refactor/stack` into `main` (the deploy workflow migrates and deploys again: no changes).
8. Main checkout: point `.dev.vars` at `/worship_hub` and drop `DEV_CHURCH`.

Rollback before step 7: `pnpm exec wrangler rollback` (the previous version still has the old
`DATABASE_URL`, and the old database and R2 keys are untouched); put the old `DATABASE_OWNER_URL` back in
GitHub. After a week or two of normal use: `pnpm r2:rekey --target prod --delete-old`, drop `neondb` on
both branches, and delete `src/cli/move-db.ts`, `src/cli/r2-rekey.ts` and `src/cli/lib/rekey-worker.ts`
(and their scripts in `package.json`). Old `?song=` links stop working; signed-in people stay signed in
(the 5 minute cookie cache can deny them until it refreshes).

## Deploy (GitHub Actions)
Every push to `main` runs `.github/workflows/deploy.yml`: the CI checks, then in the GitHub environment
`production` (no approval step): `pnpm db:migrate --target prod`, `pnpm cf:deploy`, `pnpm smoke`. A failed check or
migration stops the run before anything is deployed. If the smoke test fails, the job runs `wrangler rollback`
to the previous Worker version and the run is marked failed. Runs never overlap and are never cancelled halfway.
Manual deploy from a laptop still works: `pnpm db:migrate --target prod`, `pnpm cf:deploy`, `pnpm smoke`.

- Secrets of the environment `production`: `CLOUDFLARE_API_TOKEN`, `DATABASE_OWNER_URL` (the owner login: it can
  change the schema, so only this environment sees it).
- Variables of the environment `production`: `CLOUDFLARE_ACCOUNT_ID`, `SMOKE_URL` (the app's address).
- The Worker's own secrets (`DATABASE_URL`, `BETTER_AUTH_SECRET`, `RESEND_API_KEY`) stay in Cloudflare; a deploy does not touch them.
- The API token `worship-hub-github-deploy` is a Cloudflare account API token made from the "Edit Cloudflare Workers"
  template, limited to the personal account and, for Workers Routes, to the zone `jssoriao.dev`. It expires on
  2027-11-12: make a new one then, store it in the Keychain (`security add-generic-password -U -a "$USER" -s
  cloudflare-worship-hub-deploy -w`) and update the secret (`gh secret set CLOUDFLARE_API_TOKEN --env production`).
  After that date a deploy fails with an authentication error.
- The environment `production` only accepts runs from the branch `main`.
- Migrations run while the previous Worker version is still live (and stay applied after a rollback), so every
  migration must work with both the old and the new code: add columns, tables and indexes first; remove or rename
  only in a later deploy, once no running version uses them.

## Everyday commands

```sh
pnpm cf:deploy                       # build the PWA and deploy the Worker + assets (CI does this on every push to main)
pnpm smoke [url]                     # check a deployed Worker answers (/, /api/auth/ok, /songs/index.json is 401)
pnpm db:generate                     # a new migration in src/db/migrations from changes to src/db/schema (Drizzle; Better Auth's tables included)
pnpm db:migrate [--target prod]      # apply pending migrations (drizzle.__drizzle_migrations records them); owner login
pnpm db:app-role [--target prod]     # create the app role worship_hub_worker or give it a new password; writes DATABASE_URL
                                     # --keep-password: only grant on the database in DATABASE_OWNER_URL
pnpm test                            # vitest: permissions, tenancy (PGlite + fake R2), address rules
pnpm cf:deploy:redirect              # the redirect Worker for the previous address (rarely needed)

# churches (a church is a Better Auth organization; only this CLI makes them)
pnpm churches list [--target prod]
pnpm churches add <slug> <name> [--owner <email>] [--target prod]
pnpm churches rename <slug> <name>
pnpm churches theme <slug> [--brand #hex] [--brand2 #hex] [--app-name <name>] [--logo <https url>] [--reset]   # branding; no options shows it
pnpm churches delete <slug> [--target prod]                    # dry run: what would go (members, songs, arrangements, sessions, R2 files)
pnpm churches delete <slug> --confirm <slug> [--target prod]   # R2 files first (prod only), checked gone, then the rows in one transaction; rerun if it stops

# people (admins and owners can also add, re-role and remove people in the app: Members page, /api/church/members)
pnpm members list [--church <slug>]
pnpm members add <email> [name] --church <slug> --role member|editor|admin|owner   # adds, or changes the role
pnpm members remove <email> --church <slug>    # leaves that church; someone in no church is removed entirely
pnpm members platform-admin <email> [--revoke] # the platform super admin (Music.AI, any church)

# songs (per church; the folder name is the title; --target prod writes the real bucket, the default writes the
# dev database and the LOCAL R2 in <main checkout>/.wrangler/state, which pnpm dev:api serves; never prod)
pnpm songs:publish --church <slug> --target prod                  # every song in ./songs (or $SONGS_DIR)
pnpm songs:publish "Song Folder" --church <slug> --target prod    # one song: finds or creates its row, uploads under its id
pnpm songs:publish --church <slug> --dry-run                      # list what would be uploaded (new layout keys)
pnpm songs:publish ... --tiers=standard   # only some qualities: standard (q4), saver (q6), original; comma list; default all
pnpm songs:publish ... --force            # upload audio again even if .publish-state.json says it is there
pnpm songs:publish ... --manifest-only    # manifests only (regroup folders without re-uploading audio); needs ffmpeg for waveforms
pnpm songs:analyse "Song Folder" --church <slug> --target prod    # Music.AI; only the platform admin (checked by git user.email)
pnpm songs:pack "Song Folder"        # write packs/<slug>.zip: manifest.json + audio, for "Open zip"
pnpm cf-typegen                      # regenerate src/api/worker-configuration.d.ts after editing wrangler.jsonc
```

## History

- 2026-11-12: moved to churches (multi-tenancy). A one-off migration created the first church, made every
  person a member, gave each song a database row and id, copied `songs/<slug>/...` to
  `churches/<churchId>/songs/<songId>/...`, then deleted the old keys and the legacy `user.role` column.
  The one-off migration code was removed once it had run.
- 2026-11-12: development moved from a second database (`neondb_dev`) on the production branch to its own
  Neon branch `development`; `neondb_dev` was dropped.
- 2026-11-12: development moved to a new database `worship_hub` (Drizzle migrations, plural snake_case
  tables): created, `pnpm db:migrate`, `pnpm db:app-role --keep-password`, then `pnpm db:move --from neondb`
  copied the data. The development branch's old `neondb` stays until the production cutover.
- 2026-11-13: prefixed ids (`<prefix>_<24 chars>`, every table). Dev re-copied with `pnpm db:move --from neondb
  --replace` (new ids, references rewritten), its local R2 files moved with `pnpm r2:rekey`, then `--delete-old`.
- 2026-11-12: church-neutral names. The Worker, the bucket and the address dropped the first church's
  name: Worker `worship-hub`, bucket `worship-hub` (copied inside Cloudflare by a temporary Worker; the old bucket and that Worker were then deleted), address
  `worshiphub.jssoriao.dev`. The previous address redirects (`src/redirect/`).

## Notes

- Sign-in is invite-only. People are rows in the Neon `users` table and belong to churches through `members` rows, so `pnpm members add` is the only way in. The sign-in endpoint answers identically for members and strangers and only emails members.
- Removing a member deletes their sessions in that church. Song routes read the `members` row (memoised 30 s), so access to songs ends within 30 s; other session data may live up to 5 minutes (signed session cookie cache).
- Audio is stored once in R2 and served by the Worker with Range support, only to signed-in members. There are no egress fees.
- `wrangler r2 object put` rejects files over 300 MiB. Stems are far below that.
- Each song is stored in three qualities: `stems/<file>` (original), `stems/standard/<file>` (VBR q4) and `stems/saver/<file>` (VBR q6), re-encoded with ffmpeg at publish time (about 141 + 61 + 43 MB for a 12-stem song). R2 charges for storage only (egress is free), so the extra copies cost cents. `.publish-state.json` (gitignored) records what was uploaded from which source, so publishing again skips unchanged files; a fresh clone without it uploads everything again.
- Every file in a manifest has a fingerprint per quality (`v`, the first 16 hex characters of the SHA-256 of the uploaded bytes). It is written when the file is uploaded (and remembered in `.publish-state.json` as `<key>#v`) and kept when the manifest is rewritten, so a file's address never changes unless its content does. Songs published before this get theirs by running `pnpm songs:publish --manifest-only` (it uploads a few KB and no audio).
- The Worker caches fingerprinted audio at the Cloudflare edge (Cache API, `caches.default`, key = file + fingerprint, after the session check). Nothing to set up or pay for; it needs the custom domain (it does not work on workers.dev). Browsers also keep the audio for a year (`immutable`). If a file ever has to be replaced, upload it and publish again: the new content gets a new fingerprint, so nothing stale is served.
- Deleting a song: an admin's `DELETE /songs/<songId>` removes the row (and its arrangements) and every R2 object under its prefix. There is no button for it yet.
- Local testing: copy `.dev.vars.example` to `.dev.vars` and fill it in (gitignored). Run `pnpm dev:api` (`wrangler dev --infer-origin-from-routes=false`; without that flag the Worker sees `worshiphub.jssoriao.dev` as its origin and Better Auth rejects local requests with `INVALID_ORIGIN`) and `pnpm dev`, open http://127.0.0.1:5173. `.dev.vars` points at the dev database. Seed the local R2 emulator with `wrangler r2 object put worship-hub/churches/<churchId>/songs/<songId>/stems/<file> --file <path> --local` (ids from `pnpm churches list` and `.dev-song-ids.json`).
