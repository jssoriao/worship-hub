# Public repo: check before every commit and push

This repo is public and all rights reserved (see `LICENSE`). Nothing pushed can be taken back
(forks, caches, mirrors), so check every change before committing:

- No secrets: keys, tokens, passwords, connection strings, contents of `.dev.vars`/`.prod.vars`.
  Placeholders only (`USER:PASSWORD@HOST`).
- No personal data: real names, emails or phone numbers of members or anyone else, and not the
  owner's personal email. Commits use the GitHub noreply address set in the repo's git config.
- No copyrighted content: song lyrics (except public domain), chord charts, audio, stems, album
  art, or analysis output from real songs. Examples and tests use public-domain songs or made-up
  titles.
- No third-party code, assets, icons, fonts, CSS or copy pasted from other products or sites.
  Write it yourself. New dependencies need a license that allows this use (MIT, Apache-2.0, BSD,
  ISC); flag anything else (GPL, AGPL, no license) before adding it.
- No church names or other tenant data in code, docs, tests, commit messages or issues. Tenants
  live only in the database.
- Naming other products: factual mentions only (services the app integrates with, file formats it
  reads). No comparisons and no "like X" wording.
- Issues, PR text and commit messages are public too: the same rules apply.
- Private context for this machine goes in `.kiro/steering/local.md` (gitignored), never here.

Before pushing, read the diff with these rules in mind and search it for emails, URLs with
credentials and lyrics. If anything is unclear, ask John first.
