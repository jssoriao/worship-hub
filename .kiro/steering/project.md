# Worship Hub: project context

Church web app for worship teams, starting with a stem player: load a song's stems, play them in
sync, and mute/solo/adjust volume per stem. It grows into a full church app: chord and lyric
charts, services and lineups, and volunteer assignments per instrument or role.
It is multi-tenant: one site serves every church; a church is a tenant (a Better Auth organization).

Naming: everything is church-neutral. Repo and package `worship-hub`, Worker `worship-hub`, R2 bucket
`worship-hub`, Neon project `worship-hub`, domain `worshiphub.jssoriao.dev`. Church names appear only
as tenant data in the database, never in code, docs or resource names. The in-app name is
"Worship Hub". The app's previous address only redirects (Worker `worship-hub-redirect`, `src/redirect/`).

## Stack
- Vite 8 + React 19 + TypeScript 7, Tailwind v4, shadcn/ui (Radix, lucide icons), react-router, vite-plugin-pwa, JSZip. pnpm, Node 22 via fnm.
- Design system: tokens in `src/web/index.css` (`bg-background`, `bg-card`, `text-muted-foreground`,
  `bg-primary`, `ring-ring`, `text-highlight`, ...) all derived from four brand variables (`--brand`, `--brand-2`,
  `--brand-foreground`, `--brand-hue`); utilities `bg-app` (navy page with brand glows), `surface-glass` (cards),
  `bg-brand-gradient` (main action). Dark only. White label: a church's colours, app name and logo live in
  `organizations.metadata` (`{ theme: { brand, brand2, appName } }`) and `organizations.logo`, set with
  `pnpm churches theme <slug> ...`; `src/shared/theme.ts` validates them and fixes contrast, `src/web/lib/theme.ts`
  applies them. shadcn components in `src/web/components/ui/` (`components.json`, alias `@/` = `src/web`; the
  registry now imports `cn` from shadcn's own `cn` package: we keep `@/lib/utils`, so fetch sources with
  `pnpm dlx shadcn@<pinned> view <name>` and point the import there). Local changes to ui/ files are marked
  "adapted" (pill buttons with the brand gradient, `type="button"` by default, glass cards, readable destructive
  alert). Copied code is listed in `THIRD_PARTY_NOTICES.md`. Player visuals stay custom, on the tokens.
- Arrange is owner-only for now (not ready for others): `PAGES[].owner` + `pageShown` (`src/web/lib/pages.ts`) hide its
  sidebar and Home link, and `/arrange` shows Not found to anyone but an owner (UI only; its API is unchanged).
- Layout: `AppSidebar` (app name, church switcher, pages from `src/web/lib/pages.ts`, account with sign-out;
  folds to icons on desktop, a drawer on phones). No top bar: every page starts with `PageHeader` (sidebar toggle,
  title, the page's controls; the church is named once, in the sidebar). The play bar is drawn by Practice into a dock at the bottom
  (`src/web/lib/player-slot.ts`, App.tsx), so the compact player stays on every page while a song is open.
- Cloudflare: Workers (static assets + a Hono API), R2 (files), wrangler 4 pinned. Neon Postgres, Drizzle.
  Better Auth (email OTP + organization plugins) + Resend (emailed 6-digit code, invite only).
  See `docs/plan.md` (decisions) and `docs/infra.md` (every external resource with create/delete
  commands and the history of migrations; keep it current).
- `pnpm build` (tsc + vite), `pnpm lint` (oxlint), `pnpm test` (vitest; PGlite for the database and a
  fake R2 in `test/`).

## Tenancy and data
- Neon, through **Drizzle** (`src/db/schema/`, migrations in `src/db/migrations`, made by `pnpm db:generate`,
  applied by `pnpm db:migrate`). snake_case columns, plural tables: Better Auth's `users` (`platform_admin`),
  `sessions`, `accounts`, `verifications`, `organizations` (church), `members` (person, church, role),
  `invitations`, `rate_limits`; the app's `songs` (per church: title unique per church, artist, key, bpm,
  meter, has_stems) and `arrangements` (per song, owner, `data` jsonb). Better Auth uses its Drizzle adapter
  (`usePlural`); `test/auth-schema.test.ts` checks the tables match its options. Ids are `<prefix>_<24 random [0-9a-z]>` for every table, Better Auth's included (`src/shared/ids.ts`: nanoid; `user_`, `sess_`, `org_`, `mem_`, `song_`, `arr_`, ...; Drizzle `$defaultFn` and Better Auth `generateId`). The address bar shows them without the prefix (`?song=<24 chars>`, `src/web/lib/address.ts`).
- R2: every file of a song under `churches/<churchId>/songs/<songId>/`: `stems/manifest.json`,
  `stems/<file>` (original), `stems/standard|saver/<file>`, `chart.pro`, `analysis.json`,
  `analysis/history/<time>.json`. URLs are `/songs/<songId>/...`; the church always comes from the
  session, never the URL.
- Isolation lives in the Worker (a Hono app, `src/api/app.ts`): the `church` middleware in
  `src/api/tenant.ts` (session -> active church -> `members` row read from the database, memoised 30 s),
  then `songOwned` (`data.songBelongs(orgId, songId)`) before any handler or key, then `src/api/keys.ts` builds keys only from validated ids (no path can leave the
  song's prefix). `src/api/data.ts` is the only SQL for church data; every function takes `orgId` first.
- Songs, stems included, are never shared between churches (per-church edits and stem licences).

## Roles
- Per church, permission bundles in `src/shared/permissions.ts` (`createAccessControl`), shared by the
  Worker (enforces) and the app (shows/hides): member (play, own arrangements), editor (+ chords,
  lyrics, sections, charts, song details, any arrangement), admin (+ add/remove songs, members and
  editors), owner (+ church settings, admins/owners). Code checks permissions (`can`), never role names.
- Platform super admin: `users.platform_admin`, outside churches. Only they run Music.AI (credits) and
  manage any church from the CLI. It does not bypass church membership in the Worker.
- Churches are added only by the CLI: `pnpm churches add <slug> <name> [--owner <email>]`; people by
  `pnpm members add <email> [name] --church <slug> --role <role>` (`pnpm members platform-admin`), Members, or
  a join link. No open sign-up and no church creation in the app; the Worker closes every organization endpoint except
  set-active, list, get-active-member(-role) and has-permission.
- Admins and owners also manage people in the app (`/api/church/members`, `src/api/members.ts`): owners any
  role, admins only member and editor; nobody changes or removes themselves; removal ends the person's
  sessions in that church and deletes an account left in no church (not the platform admin).
- Join links (`join_links`, `src/api/links.ts` `/api/church/links`, `src/web/components/JoinLinks.tsx` in Members):
  one person (single use, 3 days) or shared (1 day), role up to admin (admins up to editor); only the secret's
  SHA-256 is stored, the address is shown once. `/join/<token>` (`src/web/pages/JoinPage.tsx`, outside the app
  in main.tsx; `src/api/join.ts`): GET shows church + role (404 unknown, 410 expired/used/off), POST start
  {email} adds a 30-minute `join_requests` row, then the normal emailed-code sign-in (`EmailCodeSignIn` in
  AuthGate), then POST finish (session) adds the member (`data.joinWithLink`, row locked; already a member =
  unchanged, link unused) and the page sets the active church. Better Auth `disableSignUp` is false, but its
  user create hook (auth-options.ts) refuses any address without a live join request, and auth.ts only
  emails codes to accounts or join requests. Ended links (expired, used up, off) are deleted 7 days later and
  expired join requests at once, whenever the church's links are listed (`data.deleteStaleJoinData`); a failed
  finish removes the account the code made if it is in no church (`removePersonIfChurchless`).

## Layout
- `src/web/lib/bytestream.ts` (`ByteStream`, `download`): a file that arrives over time; consumers
  wait for bytes, downloads resume with Range and cancel via AbortSignal. `src/web/lib/audio-cache.ts`
  (`openStem`, `audioCache`): complete fingerprinted files go to Cache Storage, registry in
  localStorage, LRU of unpinned songs (300 MB), pin = "Save offline", cleared on sign-out.
  `Mp3Indexer`/`Mp3Feed` in `decoders.ts` index MP3 frames as bytes arrive (length from the Xing tag).
- `src/web/lib/engine.ts`: `StemEngine`. Chunked playback: decodes 8 s chunks around the
  playhead, keeps about 20 s ahead, and schedules `AudioBufferSourceNode`s at exact sample
  frames. One `GainNode` per stem. Solo rule: any solo means non-soloed stems are silent,
  and mute always wins. Recreates the AudioContext at the stems' native sample rate.
  Parts of a combined stem are downloaded on demand (`ensureLoaded`/`joinPlayback`).
  Streaming: playback starts after the first seconds of every heard stem; if a download falls
  within 1 s of the playhead it stalls ("Buffering…") and resumes at 6 s ahead. `unload()` aborts
  all downloads. `setBeats/setClick` schedule the click on the stems' clock.
- Tempo (`StemEngine.setTempo(rate)`, 0.7-1.3, `src/web/lib/tempo.ts` steps/memory): plain playback only (timelines stay at 1).
  Sources play at `playbackRate = rate` (`position` = clock * rate, chunk and click times divided by rate) and the
  KeyBus shifter turns the pitch back: shift = key - 12*log2(rate), fractional semitones allowed (`MAX_SHIFT` 12).
  A change restarts the sources from the same position (brief gap), so the page applies it on each step.
- `src/web/lib/key-shift.ts` (`KeyBus`): key change for the Practice player (±6 semitones, same tempo). Stems and
  click play into the bus; at the original key it is a straight wire, otherwise one Signalsmith Stretch
  AudioWorklet (npm `signalsmith-stretch`, lazy chunk) shifts the summed stems and the click is delayed by its
  latency. `StemEngine.setKey`. Key is stored per song as the chart's `transpose` (`chart-view.ts`), so Charts
  and Practice agree; `transposeAnalysis` moves the chords shown in Practice.
- `src/web/lib/mix.ts`: pure mix rules (`computeMix`, `families`, `lazyFlags`), shared by the engine
  and the UI. A group can have a combined stem (`mix: true`, a file named like its folder) plus
  parts; they never play together. Parts are fetched after the first load (`preloadParts`, skipped
  under Save-Data). Display order is `sortStems` in `src/web/lib/sources.ts`.
- `src/web/lib/decoders.ts`: MP3 frame indexer (Xing/LAME gapless delay and padding) and WAV
  slicer, each decoding byte-range slices. Other formats fall back to a full decode.
- `src/web/lib/sources.ts`: `StemSource` (zip, library manifest), `fetchLibrary` (the active church's
  songs, `?church=<id>` so the offline copy is per church). Manifests list `tiers` (standard VBR q4,
  saver VBR q6, original), per-stem fingerprints `v` (`file.mp3?v=<hash>`) and waveform `peaks`.
- `src/web/lib/api.ts`: the typed API client (`hc<AppType>`, Hono RPC): `songsApi`, `membersApi`, and `call()`
  (typed ok body, else `ApiError` with the server's `{ error }`). Every JSON call goes through it, so an API
  change the app does not follow fails `pnpm build` (`tsconfig.app.json` references `tsconfig.worker.json`
  for the API's types). Song files (audio, manifests, `chart.pro`, `analysis.json`) stay plain URLs (`songFile`)
  for Range streaming and the offline cache. `test/client.test.ts` runs the client against the real app.
- `src/web/lib/church.tsx` / `church-context.ts`: the active church and the switcher. `src/web/lib/address.ts`:
  the Practice address rules (`?song=<id>` alone chooses the song; no `?song` = nothing open).
- Songs always come from the Worker at `/songs` (same origin). Sign-in is always on, also in development.
- Pages (react-router): `/` Home, `/members` (admins and owners: add, re-role, remove people; `src/api/members.ts`,
  `src/web/lib/members-api.ts`), `/practice` (stays mounted/hidden on other routes so audio keeps
  playing; the sidebar links back with `?song=` of the open song), `/charts`, `/arrange`.
  `src/web/lib/now-playing*.ts(x)` shares song/playing state and a transport from Practice.
- Practice player: `TransportBar`, drawn into the bottom dock (seek line on its top edge; song + facts;
  volume popover (master gain, `KeyBus.master`), back, stop (`StemEngine.stop`: to the start), play, forward,
  repeat (plays again from the start at the end; tinted with a dot when on), time and bar; click, a
  "143 bpm · E" button (Tempo & Key panel: − value + for each, Reset) and view-settings popovers, Edit;
  volume and repeat remembered per device, tempo and key per song; the key shows its move, "E +3" / "E (+3)"; the click
  is controlled only from its popover, no Click lane), views Stems (`StemTimeline` on wide screens, `StemRow` list on phones), Lyrics,
  Chords, Shapes (`src/web/components/player/`). `Popover` (play-bar panels, on the shadcn popover).
- Charts: `src/web/lib/chart.ts` parses ChordPro (`{cue: m:ss}` ties a section to the stems), `ChartPages`
  shows sheets, `ChartEditor` edits (editors and up; Worker PUT `chart.pro`). Chart-only songs are
  `songs` rows with `has_stems` false.
- Arrange (`src/web/pages/ArrangePage.tsx`, own `StemEngine`): `src/web/lib/arrangement.ts`,
  `StemEngine.setTimeline(...)`. Arrangements are rows in Neon. Plan: `docs/arrangements.md`.
- Analysis: `src/cli/analyse.ts` (`pnpm songs:analyse <song> --church <slug>`, Music.AI REST, no SDK;
  platform admin only; key in Keychain `musicai-worship-hub`) -> `songs/<song>/analysis/raw/`;
  `src/cli/lib/analysis.ts` -> `analysis.json`. `src/web/lib/analysis.ts`, `src/web/lib/chord-shapes.ts`.
  Editing in Practice: the Save changes / Discard changes / Versions / Done bar floats above the view tabs (`floating`
  prop of `TransportBar`, built in PracticePage as `editBar`); edits stay in a draft in the browser until Save changes
  (the Worker then replaces R2's analysis.json, not the database), and closing the tab with a draft asks first
  (`src/web/lib/analysis-edit.ts`; a changed word keeps the time of the word it
  replaces); the Worker keeps each replaced version in `analysis/history/`.
- `src/web/components/AuthGate.tsx`, `src/web/lib/auth-client.ts`: login form (email, then 6-digit code),
  sign-out. `AuthScreen` is the card the screens before the app share (sign-in, choosing a church).
- Local dev: `pnpm dev:api` (the Worker on 127.0.0.1:8787, local R2 in the main checkout's `.wrangler/state`,
  shared by worktrees) + `pnpm dev` (Vite with hot reload, forwarding `/api` and `/songs`; `vite.config.ts`).
  `pnpm songs:publish` without `--target prod` writes the dev database and that local R2 (dev ids; its upload
  record is kept apart in `.publish-state.json`). `pnpm db:local` (`docker-compose.local.yml`) is an optional
  Postgres on this machine: `src/shared/local-neon.ts` sends the Neon driver through a WebSocket proxy when a
  database URL is localhost (both URLs local or both hosted).
- `src/cli/lib/song-files.ts`: reads a local folder of songs (`./songs` or `SONGS_DIR`): stems, groups,
  manifests, qualities and their re-encoding. Used by `songs:publish`, `songs:analyse` and `songs:pack`.
- `src/api/` (Hono, Zod via `@hono/zod-validator`): `app.ts` (`createApp(provide)`: `/api/auth/*` to Better
  Auth behind an allowlist, `/api/church/members` to `members.ts`, `/songs/*` to `songs.ts`; exports
  `AppType` for the typed client), `index.ts` (Worker entry: a pool and Better Auth per request),
  `tenant.ts` (`church`, `sameOrigin`, `need(permission)`, `songOwned` middleware), `validate.ts`,
  `songs.ts` (song, chart, analysis, arrangement routes), `files.ts` (R2 serving with Range/HEAD/304
  and edge cache), `data.ts`, `keys.ts`, `auth.ts` (Better Auth per isolate, a Neon pool per request),
  `auth-options.ts` (shared with the CLI), `mail.ts` (Resend). Tests drive the real app with
  `app.request()` over PGlite and a fake bucket (`test/app.ts`).
  Regenerate types with `pnpm cf-typegen`.
- `src/cli/`: `publish-songs.ts` (`pnpm songs:publish --church <slug> --target prod`), `churches.ts`,
  `members.ts`, `analyse.ts`, `pack-song.ts`, `db-migrate.ts` (`pnpm db:migrate`).
  Scripts default to the dev database; `--target prod` uses `.prod.vars`. Scripts use the owner login
  (`DATABASE_OWNER_URL`); `pnpm db:app-role` manages the app's role.
- `src/redirect/`: the redirect Worker for the previous address (`pnpm cf:deploy:redirect`).
- `songs/` is gitignored. Song folders or symlinks go there for local testing.

## Auth model
- Invite only, no passwords. People are `users` rows linked to churches by `members` rows.
- The sign-in endpoint answers the same for members and strangers and only emails people with an account
  or a live join request (a join link opened in the last 30 minutes).
- Sessions last 30 days with a 5-minute signed cookie cache, but song routes read the `members` row
  (memoised 30 s), so removing a member or changing a role applies within 30 s.
- After sign-in the person lands in their earliest church (`session.activeOrganizationId`).
- Secrets (`DATABASE_URL`, `BETTER_AUTH_SECRET`, `RESEND_API_KEY`) live in Worker secrets; locally
  `.dev.vars` (development branch) and `.prod.vars` (production), both gitignored. Two database logins:
  `DATABASE_URL` is the app role `worship_hub_worker` (data only, no DDL; the Worker, locally and deployed) and
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
