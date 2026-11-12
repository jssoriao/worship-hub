-- Worship Hub tables that Better Auth does not own. Applied by `pnpm db:migrate` AFTER
-- `auth migrate` (which creates user, session, organization, member, invitation, ...).
-- Idempotent: safe to run on every deploy. Quoted camelCase columns match Better Auth's tables.

-- the platform super admin flag (set by the CLI only; Better Auth never lets a client write it)
alter table "user" add column if not exists "platformAdmin" boolean;
update "user" set "platformAdmin" = false where "platformAdmin" is null;
alter table "user" alter column "platformAdmin" set default false;
alter table "user" alter column "platformAdmin" set not null;

create table if not exists song (
  id text primary key,
  "organizationId" text not null references organization(id) on delete cascade,
  title text not null,
  artist text,
  "musicKey" text,
  bpm numeric(5,1),
  meter smallint,
  "hasStems" boolean not null default false,
  "createdBy" text references "user"(id) on delete set null,
  "createdAt" timestamptz not null default now(),
  "updatedAt" timestamptz not null default now(),
  unique ("organizationId", title)
);
create index if not exists song_organization_idx on song ("organizationId");

create table if not exists arrangement (
  id text primary key,
  "songId" text not null references song(id) on delete cascade,
  owner text references "user"(id) on delete set null,
  name text not null,
  data jsonb not null,
  "createdAt" timestamptz not null default now(),
  "updatedAt" timestamptz not null default now()
);
create index if not exists arrangement_song_idx on arrangement ("songId");
