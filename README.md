# Worship Hub

Church web app for worship teams. It starts with a stem player: load a song's stems, play them
in sync, and mute / solo / adjust volume per stem. It is an installable PWA (iOS, Android, desktop).
Charts, services, lineups and volunteer assignments are planned.

The app runs at `worshiphub.jssoriao.dev`. One site serves every church
(tenant); each church has its own songs, members and roles. Access is invite only: people sign in
with a 6-digit code emailed to the address on the team list, and land in their church (several
churches: a switcher at the top of the sidebar). Each church can have its own colours, app name and
logo (see Churches and roles).

All rights reserved: the code is published for viewing only (see `LICENSE`).

Project context for AI assistants is in `.kiro/steering/project.md`. Decisions are in `docs/plan.md`.
Every external resource, with create and delete commands, is in `docs/infra.md`.

## Run

Local development runs the real Worker (sign-in, roles, the church's database and files) next to
Vite's hot reload, in two terminals:

```sh
pnpm install
pnpm dev:api        # the Worker on http://127.0.0.1:8787 (database from .dev.vars, files in a local R2)
pnpm dev            # the app with hot reload on http://127.0.0.1:5173, forwarding /api and /songs to the Worker
pnpm build          # type-check + production build
pnpm lint
pnpm test
```

Open http://127.0.0.1:5173 (not `localhost`: sign-in only trusts the address in `APP_URL`). Sign-in
asks Cloudflare Turnstile whether you are human; in development it uses Cloudflare's test keys, which always pass
(`TURNSTILE_SECRET_KEY` in `.dev.vars`). The
Worker reads and writes a **local R2** kept in `.wrangler/state` of the main checkout, shared by every
git worktree, and never touches the production bucket. Put songs there with a dev publish:

```sh
pnpm songs:publish "Song Folder" --church <slug>    # dev: the dev database (its own song ids) + the local R2
pnpm songs:publish "Song Folder" --church <slug> --target prod   # production database + the real bucket
```

Dev and production never share ids or files. A file that is online already is never uploaded (or
re-encoded) again, from any computer: for production the bucket is checked (the original by its MD5,
re-encoded copies by the source the manifest names, `src`). `.publish-state.json` is this computer's
record of its own uploads (dev ones apart): it saves that check, and it is all the local R2 has.

**A database on your machine instead of Neon** (needs Docker). Set `DATABASE_URL` and `DATABASE_OWNER_URL`
in `.dev.vars` to `postgres://postgres:postgres@localhost:5432/worship_hub`, then:

```sh
pnpm db:local       # Postgres 17 and a WebSocket proxy (the database driver talks WebSockets)
pnpm db:migrate     # creates the tables
pnpm churches add <slug> "<Name>"
pnpm members add <your email> "<Your name>" --church <slug> --role owner
```

The code uses the proxy only when a database URL points at `localhost`; Neon and production URLs are
untouched, and both URLs must be local or both hosted. Only this compose Postgres is supported (not
Homebrew or Postgres.app). If port 5433 is taken, set `LOCAL_DB_PROXY_PORT` in `.dev.vars`. Data lives in
the `worship-hub-pg` Docker volume (`docker compose -f docker-compose.local.yml down -v` erases it).
Sign-in codes are still emailed, so `RESEND_API_KEY` is needed. The compose file's login is a throwaway
for development: it listens on 127.0.0.1 only, so keep real data and real people out of it and do not
publish its ports. The Postgres and proxy images are pulled from their publishers (PostgreSQL license,
Apache-2.0); nothing of them is included in this repository.

## Pages

A sidebar on the left: the app name, the church you are in (a menu with search for someone in several
churches), the pages, and at the bottom your account (name, email, Sign out). On desktop it folds to
icons (Ctrl/Cmd+B); on phones it opens as a drawer. There is no top bar: each page starts with one row
(the sidebar toggle, the title and the page's controls). While a song is open, the
compact play bar stays docked at the bottom on every page. Routes: `/` Home
("Playing now" card and links), `/practice` the stem player, `/charts` chord charts, `/arrange` your own
arrangements, `/members` the church's people (admins and owners only, see below). Each takes the song in the address (`?song=<id>`, the id without its `song_` prefix), so a reload or a shared link opens the
same song; on Practice the address alone chooses the song. The Practice page stays mounted (hidden) on
other routes, so audio keeps playing while you browse, and the sidebar links back with the open song.

### Charts

A chart is a ChordPro text file named `chart.pro` in the song's folder (`songs/<song>/chart.pro`),
published with `pnpm songs:publish <song>` (also with `--manifest-only`). See `docs/example-chart.pro`.
Chords go in `[brackets]` inside the lyrics. `{start_of_verse: Verse 1}` ... `{end_of_verse}` (also
`chorus`, `bridge`) make sections; `{comment: Intro}` outside a block starts one too. Add
`{cue: 0:48.5}` inside a section to tie it to the song: while that song plays on Practice, Charts
highlights the current section and scrolls to it ("Follow playback" turns scrolling off), and the
`▶ 0:48` button seeks the stems there.

Charts read like sheet music: letter-size sheets laid out like printed pages and scaled to the
screen, up to three side by side when they fit (phones use the screen as the sheet). Swipe sideways,
tap the arrows, or press ←/→ or Page Up/Down (what page-turner pedals send). **Full screen** hides
the rest of the app. **View** sets key (transpose), capo (shows the shapes), letters or Nashville
numbers, columns (auto: two while a column holds about 24 em), text size and paper (light/dark).
Text size **Fit** (default) picks the largest text that shows the whole chart in the sheets on
screen without wrapped lines, never below about 9 px; A−/A+ step from there and reflow the sheets.
Key and capo are remembered per song, the rest per device. **Follow** turns to the sheet of the
section being played. Layout: `src/web/lib/chart-layout.ts` (paginate), chords: `src/web/lib/chords.ts`.

Editors edit charts in the app: **Edit** (or **Create one**) opens ChordPro text beside a live preview.
Paste a chart in, **Mark cue** inserts `{cue: m:ss.s}` at the cursor from the playhead (the song must be
loaded on Practice), **Save** writes the song's `chart.pro` to R2 (`PUT`, editors and up, 200 KB max). In development
that is the local R2.

A chart doesn't need stems: **+ New song** (admins) adds a chart-only song by title: a `songs` row with
`hasStems` false (Practice hides it). Publishing stems later from a folder with the same name (the
title) attaches them. Note: `songs:publish` uploads a local `chart.pro` if there is one, replacing the
one edited in the app.

### Arrange

Your own arrangement of a song (`/arrange`, its own player; playing pauses Practice, leaving the
page stops it): sections from the chart's cues snapped to bars, else the ones `songs:publish`
suggests from the stems (`src/cli/lib/sections.ts`: lead vocal in/out, drums in/out, loudness steps on
4-bar phrases; labels Intro/Instrumental/Outro/Part n; `song.json` `sections` overrides), else the
whole song. The strip shows the waveform and bars; tap to place the playhead, split at the
playhead and joined back, then an order of blocks you can move, repeat and remove, with stems muted
per block, a count-in and an optional click. Any member can save arrangements; only the owner or an
editor can change one (the Neon `arrangements` table). Plan and later phases (key, tempo, MIDI parts, export): `docs/arrangements.md`.

## Two ways to load a song

1. **Open zip**: a zip of mp3/wav files. Flat, one wrapping folder, or subfolders (shown as plain
   group labels) all work. A zip with a `manifest.json` also gets combined stems (see below).
2. **Library**: the active church's songs, served by the Worker at `/songs`.

### Groups and combined stems

Subfolders are stem groups. A group can have one **combined stem**, a file named like its folder
(`drums/drums.mp3`), next to the **parts** it was split into (`kick`, `snare`, ...):

```
Song Title/
  vocals/   vocals.mp3  lead_vocals.mp3  backing_vocals.mp3
  drums/    drums.mp3   kick.mp3  snare.mp3  toms.mp3  cymbals.mp3
  bass.mp3  guitar.mp3  piano.mp3  other.mp3
```

The combined stem is its parts added together, so they never play at the same time:

- Parts untouched: only the combined stem plays.
- Mute, solo or change the volume of a part: the combined stem stops and the audible parts play.
- Mute the combined stem: the whole group is silent. Its volume scales whichever source is playing.

Parts are not in the first download, so a song opens and plays quickly on the combined stems alone.
Then the parts download in the background, one at a time in display order, so switching to them is
instant. If you touch a part before it has arrived, what you need jumps the queue (muting `kick`
fetches `snare`, `toms` and `cymbals` first) and the combined stem keeps playing until it is there.
Browsers with Data Saver on skip the background download and fetch parts only when used. File names
must be unique within a song.

Stems are listed in band order: click/metronome, vocals, drums, bass, guitars, piano/keys, anything
else, and `other` last. The order follows the folder name, or the file name for loose stems. `other`
can be a folder too, with its own combined stem and parts.

### Analysis (chords, sections, timed lyrics) and the player views

`pnpm songs:analyse "<song>"` sends a mix of the song's main stems to Music.AI (workflow
`worship-hub-analysis`: Chords, Beats, Sections, Musical stems → Lyrics with word alignment; about
$0.46/min, pay as you go) and keeps every result in `songs/<song>/analysis/raw/`; the job is then
deleted on their side. The key is read from the macOS Keychain item `musicai-worship-hub` (or
`MUSICAI_API_KEY`); audio results are skipped unless `--with-audio`. `src/cli/lib/analysis.ts` turns the
raw files into `analysis.json` (about 20 KB), uploaded by
`songs:publish` to the song's `analysis.json` in R2; its section labels also go into the manifest.
Practice then shows **Stems · Lyrics · Chords · Shapes** (bottom bar, with play/pause). On wide
screens Stems is one timeline (`StemTimeline`): a strip of the coming chords as beat boxes, lanes for
bars, sections, chords and lyrics, a slim row per stem (parts of a combined stem fold out) and the
click, under one playhead; phones keep the stacked list. The other views: chords over
the lyrics with the sung line and words lit, bars of beat boxes with the current beat lit, and the
current and next chords as guitar diagrams or piano keys (`src/web/lib/chord-shapes.ts`; a slash
chord shows the chord's own shape), at Basic, Simple or Full chord detail.

Editors (and up) fix what the AI got wrong right there: **Edit** in the Chords view (tap a beat to
set its chord, a bar number to start, rename or remove a section) or the Lyrics view (tap a line to
change its words; `|` splits it; join or delete lines). Changes collect until **Save changes**; the
Worker then replaces `analysis.json` and keeps the version it replaced in
`analysis/history/` in the song's folder, which **Versions** lists and can bring back. `songs:publish`
uploads an analysis only when there is none online yet (or with `--analysis`), so it never
overwrites edits made in the app.

### Churches and roles

A church is a Better Auth organization; songs (stems included) belong to one church. Roles per church
are permission bundles in `src/shared/permissions.ts` (the Worker enforces them, the app shows or hides
controls with the same `can()`): `member` (plays, own arrangements), `editor` (+ chords, lyrics,
sections, charts, song details, any arrangement), `admin` (+ adds and removes songs, manages members
and editors), `owner` (+ church settings, grants admin/owner). The platform super admin
(`users.platform_admin`) is outside churches and is the only one who runs Music.AI.
`pnpm churches add <slug> <name>`, `pnpm members add <email> --church <slug> --role <role>`.

Branding (white label): `pnpm churches theme <slug> --brand #2563eb --brand2 #7c3aed --app-name "Our Hub"
--logo https://...` (`--reset` goes back to the default; no options shows the current one). Every colour
in the app is derived from the two brand colours (`src/web/index.css`); text on the brand colour and
brand-coloured text on the dark page are kept readable (`src/shared/theme.ts`). Members see a change on
their next load. Ids are `<prefix>_<24 random [0-9a-z]>` for every table (`org_`, `song_`, `user_`, ...).

### Members (admins and owners)

The **Members** page lists the church's people and lets an admin or owner add someone by email (with a
role), change a role, or remove them. Added people sign in with the emailed code; nobody signs up
themselves, and the sign-in still only emails people who are members. The rules are enforced by the
Worker (`src/api/members.ts`, `/api/church/members`), not just hidden in the page:

- An **owner** can give, change and remove any role. An **admin** can only manage members and editors.
- Nobody can change their own role or remove themselves, so a church always keeps its owner.
- Removing someone ends their sessions in that church. A person left in no church is deleted, unless
  they are the platform admin. The change applies within about 30 seconds (the Worker's membership
  cache) on every server, at once on the one that handled the request.
- Writes are refused when they come from another origin, and every query is restricted to the
  church of the signed-in session. A member id from another church answers 404.
- Adding an email that already has an account in another church links that account; it does not
  change their name or their other memberships.

### Key, tempo and click

Put the stem-separation job's `key_analysis.json` and `beat_grid.json` (its `keyAnalysis` and `beatGrid`
links; they expire after about a day) in the song's folder. The manifest
then carries `music: { key, bpm, meter, beats, downbeats }` (beats in ms, a few KB). Practice shows
key and BPM and offers a **Click** (on/off, volume, remembered per device) that plays on every beat,
higher on the first beat of each bar, scheduled on the same clock as the stems. Charts shows the
key and BPM when the chart has no `{key}`. To correct the analysis, add `song.json` next to them:
`{ "key": "Ab", "bpm": 63, "meter": 4 }` (a new meter re-places the accents from the first downbeat).
Republish with `pnpm songs:publish <song> --manifest-only`.

### Local library (dev)

Put song folders (or symlinks) in `./songs` (gitignored), or point `SONGS_DIR` at another folder
(`SONGS_DIR=~/Music/Stems pnpm songs:publish ...`).
`pnpm songs:publish --church <slug>` uploads them to the local R2 (and the dev database), which
`pnpm dev:api` serves at `/songs`. Production serves the same URLs from the private R2 bucket. Either way
the files are under `churches/<churchId>/songs/<songId>/`:

| URL | Content |
| --- | --- |
| `/songs/index.json` | `[{ "id", "title", "artist", "key", "bpm", "meter", "stems" }]`, the active church's songs (Neon) |
| `/songs/<id>/stems/manifest.json` | `{ "title", "stems": [{ "file", "name", "group", "mix" }] }` |
| `/songs/<id>/stems/<file name>` | audio (Range supported) |

The `<id>` is the song's row id (`song_<24 random [0-9a-z]>`); `?song=` shows it without the `song_` prefix. The folder name is the
song's title and how `songs:publish` finds its row. `mix: true` marks a group's
combined stem. The manifest is generated from the folders when you publish, so it is the one place
that declares groups.

Each stem in the manifest also carries its waveform (`peaks`, 600 bytes), made with `ffmpeg` at
publish time. That lets the app draw every stem, including parts it has not downloaded, and skips
decoding each file just to draw it. Without `ffmpeg` the manifest has no `peaks` and the app draws
waveforms after downloading, as before (`brew install ffmpeg`).

**Audio quality.** A library song is published in three qualities, and a dropdown next to the song
picker chooses between them (with the download size of each):

| Quality | What it is | Song of 12 stems |
| --- | --- | --- |
| Standard (default) | re-encoded MP3, LAME variable bitrate q4 | ~61 MB |
| Data saver | re-encoded MP3, LAME variable bitrate q6 | ~43 MB |
| Original | your files as they are, e.g. 256 kbps, for backing tracks | ~141 MB |

The choice is remembered on the device. A browser with Data Saver on starts on "Data saver" and does
not preload parts in the background. Switching reloads the song at the same position with the same
mute/solo/volume and keeps playing.

You choose what to upload with `pnpm songs:publish --tiers=standard,saver` (default: all three).
The song's manifest in R2 keeps the running record of which qualities are online, and the app offers
exactly those: a switcher for two or three, and none when there is only one. Publishing one quality
never hides another that is already there (qualities are not removed by publishing).

The re-encoding uses `ffmpeg` and happens when you publish. The files are re-encoded from your originals, so encoding from lossless
WAVs gives slightly better results. Songs published before qualities existed simply have one.

`pnpm songs:pack "Song Folder"` writes `packs/<slug>.zip` with that manifest next to the audio, so
"Open zip" gets the same groups and combined stems as the library. A `manifest.json` at the root of
any zip (or inside its one wrapping folder) is used the same way; without one, folders are plain labels.

## Production

Cloudflare Workers serve the app and the API, R2 stores the songs, Neon Postgres stores members and
sessions, and Resend sends the sign-in emails. Setup and cleanup commands are in `docs/infra.md`.

```sh
pnpm songs:publish --church <slug> --target prod   # upload ./songs to R2 (add a folder name for one song, --dry-run to preview)
                              # without --target prod it publishes to the dev database and the local R2 instead
pnpm songs:publish ... --tiers=standard   # upload only some qualities: standard (q4), saver (q6), original; default all three
pnpm songs:publish ... --manifest-only    # regroup, or add fingerprints, without re-uploading audio (file names must not change)
                              # what is online already is skipped (checked in the bucket), so re-running costs no data
pnpm churches list            # churches (tenants)
pnpm members list [--church <slug>]
pnpm members add a@b.com "Name" --church <slug> --role member|editor|admin|owner
pnpm members remove a@b.com --church <slug>   # the same can be done in the app: Members page (admins and owners)
pnpm db:generate              # write a migration for changes to src/db/schema (Drizzle)
pnpm db:migrate               # apply pending migrations (add --target prod for production)
pnpm db:app-role              # the app's database role (data access only); also rotates its password (--keep-password: grant only)
pnpm churches theme <slug> --brand #hex --brand2 #hex --app-name "..." --logo https://...   # a church's branding
pnpm test                     # vitest
pnpm cf:deploy                # build and deploy the Worker + app
```

Local secrets live in `.dev.vars` (gitignored, template `.dev.vars.example`); it points at the Neon development branch. Production's are in `.prod.vars` (gitignored), used with `--target prod`. Each has two database logins: `DATABASE_URL`, the app's role with data access only (what the Worker uses), and `DATABASE_OWNER_URL`, the owner, which only scripts and migrations use.
To try a production build locally: `pnpm build`, then `pnpm dev:api` serves the built app and the API
together at http://127.0.0.1:8787.

## How playback works

Only compressed audio is kept in memory. Stems are decoded in 8 s chunks around the
playhead (mp3 and wav are sliced natively; other formats fall back to a full decode)
and scheduled sample-accurately on the Web Audio clock. The audio graph runs at the
stems' native sample rate so chunk joins are bit-exact. A 12-stem, 6.5-minute song
uses ~120 MB of JS heap while playing instead of ~2 GB.

### Streaming

Library MP3s play while they download. The stems that open with the song all download at once, an
index of MP3 frames is built from the bytes as they arrive (the length comes from the file's own
Xing/Info tag), and a decode waits only for the bytes of its own 8 s range. Playback starts once
the first seconds of every stem that is heard are in: on an 8 Mbps connection that was 31 s before,
and 2.7 s now. If the download ever falls behind the playhead, playback pauses ("Buffering…") and
carries on by itself when about 6 s are ahead again; tapping pause while it waits keeps it paused.
Downloads are cancelled when you leave the song or switch quality, and a dropped connection resumes
where it stopped. The page shows "Downloading N%" while files are still coming.
Zip files and WAV stay whole-file, as before.

### Kept on the device

A file that has downloaded completely is saved in the browser's Cache Storage under its fingerprinted
address, so opening the song again reads it from the device with no network, and it plays with no
connection at all (the song list and manifests are saved too). Without any action the most recently
used songs are kept up to 300 MB, oldest removed first. **Save offline** (next to the quality
dropdown) downloads every stem of the song and pins it: pinned songs are never removed by that
cleanup, and the browser is asked not to clear them. **Remove** deletes it. Signing out deletes
everything saved. Only files with a fingerprint are saved, so a song published before fingerprints
existed streams but is not kept.

### Caching

- **Fingerprints.** `songs:publish` puts a hash of each file's bytes in the manifest (`v`), and the app
  asks for `file.mp3?v=<hash>`. The same address always means the same bytes, so the Worker sends
  `Cache-Control: private, max-age=31536000, immutable` and the browser may keep it for good. A changed
  file gets a new address.
- **Edge cache.** For fingerprinted whole-file requests the Worker keeps a copy in Cloudflare's cache
  (keyed by the fingerprint) and serves later requests from there instead of reading R2. This happens
  only after the sign-in check, so only members can ever get a cached copy. Range and conditional
  requests go straight to R2. It costs nothing extra: the cache has no storage charge, and a file is
  well under the 512 MB per-file limit.
