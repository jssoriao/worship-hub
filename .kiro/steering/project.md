# Worship Hub: project context

Church web app for worship teams, starting with a stem player: load a song's stems, play them in
sync, and mute/solo/adjust volume per stem. It grows into a full church app: chord and lyric
charts, services and lineups, and volunteer assignments per instrument or role.
It is multi-tenant: one site serves every church; a church is a tenant (a Better Auth organization).

Naming: everything is church-neutral. Repo and package `worship-hub`, Worker `worship-hub`, R2 bucket
`worship-hub`, Neon project `worship-hub`, domain `worshiphub.jssoriao.dev`. Church names appear only
as tenant data in the database, never in code, docs or resource names. The in-app name is
"Worship Hub". The app's previous address only redirects (Worker `worship-hub-redirect`, `redirect/`).

## Stack
- Vite 8 + React 19 + TypeScript 7, Tailwind v4, react-router, vite-plugin-pwa, JSZip. pnpm, Node 22 via fnm.
- Cloudflare: Workers (static assets + API), R2 (files), wrangler 4 pinned. Neon Postgres.
  Better Auth (email OTP + organization plugins) + Resend (emailed 6-digit code, invite only).
  See `docs/plan.md` (decisions) and `docs/infra.md` (every external resource with create/delete
  commands and the history of migrations; keep it current).
- `pnpm build` (tsc + vite), `pnpm lint` (oxlint), `pnpm test` (vitest; PGlite for the database and a
  fake R2 in `test/`).

## Tenancy and data
- Neon (`db/schema.sql` plus Better Auth's tables): `organization` (church), `member` (person, church,
  role), `user` (`platformAdmin` flag), `song` (per church: title unique per church, artist, key, bpm,
  meter, hasStems), `arrangement` (per song, owner, `data` jsonb). Ids are 12 random `[a-z0-9]`
  (`shared/ids.ts`); `?song=<id>` in the address is the song's id.
- R2: every file of a song under `churches/<churchId>/songs/<songId>/`: `stems/manifest.json`,
  `stems/<file>` (original), `stems/standard|saver/<file>`, `chart.pro`, `analysis.json`,
  `analysis/history/<time>.json`. URLs are `/songs/<songId>/...`; the church always comes from the
  session, never the URL.
- Isolation lives in the Worker: `worker/tenant.ts` `requireChurch` (session -> active church ->
  `member` row read from the database, memoised 30 s), then `data.songBelongs(orgId, songId)` before
  any handler or key, then `worker/keys.ts` builds keys only from validated ids (no path can leave the
  song's prefix). `worker/data.ts` is the only SQL for church data; every function takes `orgId` first.
- Songs, stems included, are never shared between churches (per-church edits and stem licences).

## Roles
- Per church, permission bundles in `shared/permissions.ts` (`createAccessControl`), shared by the
  Worker (enforces) and the app (shows/hides): member (play, own arrangements), editor (+ chords,
  lyrics, sections, charts, song details, any arrangement), admin (+ add/remove songs, members and
  editors), owner (+ church settings, admins/owners). Code checks permissions (`can`), never role names.
- Platform super admin: `user.platformAdmin`, outside churches. Only they run Music.AI (credits) and
  manage any church from the CLI. It does not bypass church membership in the Worker.
- Churches and people are added only by the CLI: `pnpm churches add <slug> <name> [--owner <email>]`,
  `pnpm members add <email> [name] --church <slug> --role <role>`, `pnpm members platform-admin`.
  No sign-up and no church creation in the app; the Worker closes every organization endpoint except
  set-active, list, get-active-member(-role) and has-permission.
- Admins and owners also manage people in the app (`/api/church/members`, `worker/members.ts`): owners any
  role, admins only member and editor; nobody changes or removes themselves; removal ends the person's
  sessions in that church and deletes an account left in no church (not the platform admin).

## Layout
- `src/lib/bytestream.ts` (`ByteStream`, `download`): a file that arrives over time; consumers
  wait for bytes, downloads resume with Range and cancel via AbortSignal. `src/lib/audio-cache.ts`
  (`openStem`, `audioCache`): complete fingerprinted files go to Cache Storage, registry in
  localStorage, LRU of unpinned songs (300 MB), pin = "Save offline", cleared on sign-out.
  `Mp3Indexer`/`Mp3Feed` in `decoders.ts` index MP3 frames as bytes arrive (length from the Xing tag).
- `src/lib/engine.ts`: `StemEngine`. Chunked playback: decodes 8 s chunks around the
  playhead, keeps about 20 s ahead, and schedules `AudioBufferSourceNode`s at exact sample
  frames. One `GainNode` per stem. Solo rule: any solo means non-soloed stems are silent,
  and mute always wins. Recreates the AudioContext at the stems' native sample rate.
  Parts of a combined stem are downloaded on demand (`ensureLoaded`/`joinPlayback`).
  Streaming: playback starts after the first seconds of every heard stem; if a download falls
  within 1 s of the playhead it stalls ("Buffering…") and resumes at 6 s ahead. `unload()` aborts
  all downloads. `setBeats/setClick` schedule the click on the stems' clock.
- `src/lib/key-shift.ts` (`KeyBus`): key change for the Practice player (±6 semitones, same tempo). Stems and
  click play into the bus; at the original key it is a straight wire, otherwise one Signalsmith Stretch
  AudioWorklet (npm `signalsmith-stretch`, lazy chunk) shifts the summed stems and the click is delayed by its
  latency. `StemEngine.setKey`. Key is stored per song as the chart's `transpose` (`chart-view.ts`), so Charts
  and Practice agree; `transposeAnalysis` moves the chords shown in Practice.
- `src/lib/mix.ts`: pure mix rules (`computeMix`, `families`, `lazyFlags`), shared by the engine
  and the UI. A group can have a combined stem (`mix: true`, a file named like its folder) plus
  parts; they never play together. Parts are fetched after the first load (`preloadParts`, skipped
  under Save-Data). Display order is `sortStems` in `src/lib/sources.ts`.
- `src/lib/decoders.ts`: MP3 frame indexer (Xing/LAME gapless delay and padding) and WAV
  slicer, each decoding byte-range slices. Other formats fall back to a full decode.
- `src/lib/sources.ts`: `StemSource` (zip, library manifest), `fetchLibrary` (the active church's
  songs, `?church=<id>` so the offline copy is per church). Manifests list `tiers` (standard VBR q4,
  saver VBR q6, original), per-stem fingerprints `v` (`file.mp3?v=<hash>`) and waveform `peaks`.
- `src/lib/church.tsx` / `church-context.ts`: the active church and the switcher. `src/lib/address.ts`:
  the Practice address rules (`?song=<id>` alone chooses the song; no `?song` = nothing open).
- `src/config.ts`: `SONGS_BASE_URL` and `AUTH_REQUIRED` (always in prod; `pnpm dev` skips login unless
  `VITE_REQUIRE_AUTH=1`).
- Pages (react-router): `/` Home, `/members` (admins and owners: add, re-role, remove people; `worker/members.ts`,
  `src/lib/members-api.ts`), `/practice` (stays mounted/hidden on other routes so audio keeps
  playing; the nav bar links back with `?song=` of the open song), `/charts`, `/arrange`.
  `src/lib/now-playing*.ts(x)` shares song/playing state and a transport from Practice.
- Practice player: docked `TransportBar` (song + facts, skip/play/seek, click and view-settings
  popovers, Edit), views Stems (`StemTimeline` on wide screens, `StemRow` list on phones), Lyrics,
  Chords, Shapes (`src/components/player/`). Shared `Select` (styled native select) and `Popover`.
- Charts: `src/lib/chart.ts` parses ChordPro (`{cue: m:ss}` ties a section to the stems), `ChartPages`
  shows sheets, `ChartEditor` edits (editors and up; Worker PUT `chart.pro`). Chart-only songs are
  `song` rows with `hasStems` false.
- Arrange (`src/pages/ArrangePage.tsx`, own `StemEngine`): `src/lib/arrangement.ts`,
  `StemEngine.setTimeline(...)`. Arrangements are rows in Neon. Plan: `docs/arrangements.md`.
- Analysis: `scripts/analyse.ts` (`pnpm songs:analyse <song> --church <slug>`, Music.AI REST, no SDK;
  platform admin only; key in Keychain `musicai-worship-hub`) -> `songs/<song>/analysis/raw/`;
  `dev/analysis.ts` -> `analysis.json`. `src/lib/analysis.ts`, `src/lib/chord-shapes.ts`.
  Editing in Practice (`src/lib/analysis-edit.ts`; a changed word keeps the time of the word it
  replaces); the Worker keeps each replaced version in `analysis/history/`.
- `src/components/AuthGate.tsx`, `src/lib/auth-client.ts`: login form (email, then 6-digit code),
  sign-out. `src/components/NavBar.tsx` is the top bar (church switcher left, account menu with sign-out
  right, `AccountMenu.tsx`).
- Local backend: `pnpm cf:api` (Worker on 127.0.0.1:8787, local R2 in the main checkout's `.wrangler/state`,
  shared by worktrees) + `pnpm dev:app` (Vite forwarding `/api` and `/songs`, sign-in on; `vite.config.ts`).
  `pnpm songs:publish` without `--target prod` writes the dev database and that local R2 (dev ids; its upload
  record is kept apart in `.publish-state.json`). `pnpm db:local` (`docker-compose.local.yml`) is an optional
  Postgres on this machine: `shared/local-neon.ts` sends the Neon driver through a WebSocket proxy when a
  database URL is localhost (both URLs local or both hosted).
- `dev/songs-plugin.ts`: dev-only Vite middleware serving `./songs` (or `SONGS_DIR`) at `/songs` with
  the production URL layout; song ids come from the Neon dev database (`dev/dev-ids.ts`, church
  `DEV_CHURCH` from `.dev.vars`). Its helpers are reused by `scripts/publish-songs.ts`.
- `worker/`: `index.ts` (routing; `/api/auth/*` to Better Auth behind an allowlist, `/songs/*` to
  `router.ts`), `tenant.ts`, `router.ts`, `data.ts`, `keys.ts`, `songs.ts` (R2 serving with
  Range/HEAD/304 and edge cache, chart/analysis/arrangement handlers), `auth.ts` (Better Auth per
  isolate, a Neon pool per request), `auth-options.ts` (shared with the CLI), `mail.ts` (Resend).
  Regenerate types with `pnpm cf-typegen`.
- `scripts/`: `publish-songs.ts` (`pnpm songs:publish --church <slug> --target prod`), `churches.ts`,
  `members.ts`, `analyse.ts`, `pack-song.ts`, `db-migrate.ts`/`auth-cli.ts` (`pnpm db:migrate`).
  Scripts default to the dev database; `--target prod` uses `.prod.vars`. Scripts use the owner login
  (`DATABASE_OWNER_URL`); `pnpm db:app-role` manages the app's role.
- `redirect/`: the redirect Worker for the previous address (`pnpm cf:deploy:redirect`).
- `songs/` is gitignored. Song folders or symlinks go there for local testing.

## Auth model
- Invite only, no passwords. People are `user` rows linked to churches by `member` rows.
- The sign-in endpoint answers the same for members and strangers and only emails members.
- Sessions last 30 days with a 5-minute signed cookie cache, but song routes read the `member` row
  (memoised 30 s), so removing a member or changing a role applies within 30 s.
- After sign-in the person lands in their earliest church (`session.activeOrganizationId`).
- Secrets (`DATABASE_URL`, `BETTER_AUTH_SECRET`, `RESEND_API_KEY`) live in Worker secrets; locally
  `.dev.vars` (development branch) and `.prod.vars` (production), both gitignored. Two database logins:
  `DATABASE_URL` is the app role `worship_hub_worker` (data only, no DDL; the Worker and dev server) and
  `DATABASE_OWNER_URL` the owner (scripts and migrations only). Never put
  them in `VITE_*`.

## Verified
- Desktop Chrome, 12-stem 6:25 MP3 song: JS heap about 120 MB while playing (about 1.95 GB with a full
  decode); load about 3.8 s, time to sound about 150 ms, seek about 40 ms; chunked decode bit-exact.
- Production is live: sign-in by emailed code, songs, analysis editing, tenant isolation (another
  church's song id returns 404; covered by `test/worker.test.ts`).

## Not yet verified
- Android devices; iPhone Safari only partly (zoom fix done).
- WAV stems with real files; m4a/ogg/flac full-decode fallback.
- A second real church end to end (switcher with real people).

## Decisions
- PWA over native: Web Audio gives sample-accurate multi-track sync on both platforms.
- Cloudflare over AWS/Vercel: R2 has no egress fees (stems are about 140 MB per song and are
  reloaded often). Budget is up to $5/month. Wrangler is the IaC, not Pulumi/SST.
- Neon over Supabase: Supabase free projects pause after about a week idle.
- Stems are copyrighted: the Worker only serves them to signed-in members of the song's church.
- Prefer MP3/AAC at 256-320 kbps for the team, since phone data and load time matter.
- Large R2 copies run inside Cloudflare (a temporary Worker bound to both buckets), never through a
  laptop.
- Deploys should run `pnpm db:migrate --target prod` before `pnpm cf:deploy` (GitHub Actions, planned).

## Possible next steps
- See the GitHub issues (P1 first).
- Backups of edited data (analysis, charts, arrangements) beyond R2 history.
- Admin pages: members, songs (presigned-PUT upload, peaks at upload), Music.AI from the app.
- Services, lineups, volunteer assignments; A-B loop, playback speed, key/tempo change.

## Repo
- Code is public; all rights reserved (see `LICENSE`). Before every commit and push, follow
  `.kiro/steering/public-repo.md` (no secrets, personal data, lyrics, audio, third-party material or
  tenant names). Personal notes for this machine go in `.kiro/steering/local.md` (gitignored).
- Work is tracked in GitHub issues: labels `P1` (next), `P2` (soon), `P3` (later) plus `area:*`
  (infra, security, ops, admin, player, product, legal) and `dependencies`. Add an issue for every
  concern worth tracking.
