# Worship Hub: hosting and auth plan

Decisions made so far. Update as things change.

Everything is church-neutral: Worker `worship-hub`, Neon project `worship-hub`, R2 bucket `worship-hub`, domain
`worshiphub.jssoriao.dev`. One site serves every church; a church is a tenant in the database, never part
of a resource name. The app's previous address redirects to the current one (`redirect/`, see docs/infra.md).

## Stack

| Concern | Choice | Notes |
|---|---|---|
| App hosting | Cloudflare (Workers static assets or Pages) | Vite PWA |
| Stem storage | Cloudflare R2 | Zero egress fees. About $0.015/GB-month, first 10 GB free |
| API + auth | Cloudflare Worker + Better Auth | Same origin as the app, so no CORS |
| Database | Neon Postgres (standalone account, not via Vercel) | Free tier scales to zero after 5 min idle |
| Email | Resend | Sending subdomain `mail.jssoriao.dev` |
| IaC | `wrangler.jsonc` | Neon and Resend are one-time manual setup, documented here |
| Domain | `worshiphub.jssoriao.dev` | Registrar stays GoDaddy. DNS moves to Cloudflare (Free plan). A product domain can replace this later if the app is sold |

## Why these

- Stems are large (about 200 MB per song). R2 has no egress fees, so repeated loads cost nothing.
- Avoided SST and Pulumi community providers (Neon, Resend) because of maintenance risk. Wrangler is maintained by Cloudflare.
- Avoided Vercel for stems: Hobby plan is non-commercial and bandwidth is capped.
- Avoided Cognito: wanted a provider that can move with the product if it is sold later.
- Neon over Supabase: Supabase free projects pause after a week of inactivity and need a manual restore.

## Auth model

- Better Auth, emailed 6-digit code only (email OTP plugin). Started as a magic link, but a link that signs in on GET gets burned by mail scanners, and a confirm tap was an extra step. The code is typed in the same tab, so it also works when the email is on another device. 10-minute expiry, 3 wrong guesses kill the code.
- Invite-only: sign-up disabled. The `user` table is the allowlist; `member` rows say which church and role.
- A church is a Better Auth organization (organization plugin). Churches and members are added only by
  CLI scripts (`pnpm churches add`, `pnpm members add --church --role`): nobody signs up and nobody
  creates a church in the app. The Worker closes every organization endpoint except set-active, list,
  get-active-member(-role) and has-permission.
- After sign-in the person lands in their (earliest) church (`session.activeOrganizationId`, set by a
  session-create hook). Someone in several churches gets a switcher in the nav bar; the device remembers
  the last one. Switching reloads at Practice, so nothing of the other church stays open.
- Roles are permission bundles (`shared/permissions.ts`, `createAccessControl`); code asks
  `can(role, { content: ['edit'] })`, never compares role names:
  member (plays, own arrangements), editor (+ chords, lyrics, sections, charts, song details, any
  arrangement), admin (+ add/remove songs, manage members and editors), owner (+ church settings,
  grant admin/owner).
- Platform super admin: `user.platformAdmin` (set by `pnpm members platform-admin`, never by a client).
  Only they run Music.AI (`songs:analyse` checks it) and manage any church (the CLI). It does not
  bypass church membership in the Worker: to open a church's songs they must also be its member.
- The Worker never trusts a role from the cookie: it reads the `member` row (memoised 30 s per isolate,
  positive answers only), so a removed member loses song access within 30 s.
- Always answer "if that email is registered, we sent a code" so membership does not leak.
- Short link expiry (about 10 min), single use, rate limited per email and IP.
- Long sessions (about 30 days). httpOnly, Secure, SameSite cookies.
- Neon connection string and secrets live in Worker secrets, never in `VITE_*` vars.
- Optional later: Google sign-in, only for emails already in the allowlist.

## Songs and files (per church)

Songs belong to one church and are never shared (stems included), because each church edits its own
lyrics, chords and sections. Neon holds the relational data:
- `song(id, organizationId, title, artist, musicKey, bpm, meter, hasStems, createdBy, createdAt, updatedAt)`,
  title unique per church. The song list (`GET /songs/index.json`) is a query, scoped to the active church.
- `arrangement(id, songId, owner, name, data jsonb, ...)`, scoped to the church through its song.
- Ids are 12 random chars of `[a-z0-9]` (`shared/ids.ts`). `?song=` in the address is the song's id.
R2 holds the files, under one prefix per song: `churches/<churchId>/songs/<songId>/` with
`stems/manifest.json`, `stems/<file>` (original), `stems/standard/<file>`, `stems/saver/<file>`,
`chart.pro`, `analysis.json`, `analysis/history/<time>.json`. URLs stay `/songs/<songId>/...`: the
church comes from the session, never the URL. Before building any key the Worker checks that the song
belongs to the member's active church (404 otherwise, the same as missing); keys are built only from
validated ids (`worker/keys.ts`), so no path can leave the song's prefix. Audio is keyed by file name only
and groups live in the manifest, so regrouping never moves or re-uploads audio.
Saved-offline songs are kept per device in Cache Storage, keyed by URL (`src/lib/audio-cache.ts`).
The library URL carries `?church=<id>` so the offline copy of the list is per church. Signing out clears it.
How the data got here from the single-church layout: docs/infra.md, History.

## Build order

1. Host the PWA and stems (R2 + Worker), custom domain. Done and live. Real-phone testing: iPhone Safari partly checked; Android not yet.
2. Auth: Better Auth + Neon + Resend, gate song routes, seed members. Done and live.
3. CI (not started): GitHub Actions run checks on PRs (`pnpm build`, `pnpm lint`, `pnpm test`), and on `main` run `pnpm db:migrate --target prod` then deploy.
3b. Multi-tenancy (churches, songs in Neon, id based R2 layout) and church-neutral names. Done and live (2026-11-12).
4. Admin: member management page, then song upload (presigned PUT to R2, peaks precomputed).
5. Church features: chord and lyric charts (done: ChordPro charts, Music.AI analysis with in-app editing); services, lineups, volunteer assignments (not started).

## Open items

- DNS is on Cloudflare already (done). The old webapp records were removed and no email records exist.
- Resend domain verification (SPF, DKIM, DMARC) for `mail.jssoriao.dev`.
- Least-privilege Postgres role for the Worker (the owner role is only for migrations).
- Admin page for churches and members (today: CLI only).
- Verify current free-tier terms for R2, Neon, Resend before relying on them.
