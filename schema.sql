-- Rooms — full schema
-- film · tv · book · game, in one log.
-- Run this once, top to bottom, on a fresh Supabase project.
-- Sections are numbered by the version that introduced them; later ALTERs
-- assume the earlier tables exist, so don't reorder.
-- if you already ran the film-only schema, see the migration block at the bottom.

create extension if not exists pgcrypto;

-- ---------- who ----------
create table if not exists profiles (
  id uuid primary key references auth.users on delete cascade,
  handle text unique not null check (handle ~ '^[a-z0-9_]{2,24}$'),
  bio text,
  created_at timestamptz default now()
);

-- ---------- the things ----------
-- id is namespaced by source: film:496243, tv:1396, book:OL27448W, game:1942
create table if not exists works (
  id text primary key,
  kind text not null check (kind in ('film','tv','book','game')),
  title text not null,
  year text,
  cover text,             -- full url or a source-relative path
  creator text,           -- director · showrunner · author · studio
  length int,             -- minutes · minutes/episode · pages · hours
  meta jsonb,             -- genres, countries, episode counts
  credits jsonb,          -- role -> names, for the breakdown lines
  updated_at timestamptz default now()
);
create index if not exists works_kind_idx on works (kind);

-- ---------- your entries ----------
create table if not exists entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles on delete cascade,
  work_id text not null references works on delete cascade,
  rated_on date not null default current_date,
  score int not null check (score between 1 and 10),   -- half-stars; 10 is five
  note text,
  loved text[],                                        -- craft keys + person:Name
  breakdown jsonb,                                     -- only at four stars and up
  context jsonb,                                       -- per-kind tickboxes
  created_at timestamptz default now()
);
create index if not exists entries_user_idx on entries (user_id, rated_on desc);
create index if not exists entries_work_idx on entries (work_id);
create index if not exists entries_loved_idx on entries using gin (loved);

-- ---------- rooms ----------
create table if not exists rooms (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  code text unique not null,
  created_by uuid references profiles on delete set null,
  created_at timestamptz default now()
);
create table if not exists room_members (
  room_id uuid references rooms on delete cascade,
  user_id uuid references profiles on delete cascade,
  joined_at timestamptz default now(),
  primary key (room_id, user_id)
);

-- ---------- shelves ----------
create table if not exists lists (
  id uuid primary key default gen_random_uuid(),
  owner uuid not null references profiles on delete cascade,
  name text not null,
  created_at timestamptz default now()
);
create table if not exists list_items (
  list_id uuid references lists on delete cascade,
  work_id text references works on delete cascade,
  added_at timestamptz default now(),
  primary key (list_id, work_id)
);

-- ---------- the ten ----------
create table if not exists top_lists (
  id uuid primary key default gen_random_uuid(),
  owner uuid not null references profiles on delete cascade,
  name text not null default 'all time',
  unique (owner, name)
);
create table if not exists top_list_items (
  top_list_id uuid references top_lists on delete cascade,
  work_id text references works on delete cascade,
  rank int not null,
  primary key (top_list_id, work_id)
);

-- ---------- clubs: a list with a deadline ----------
create table if not exists clubs (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references rooms on delete cascade,
  name text not null,
  label text not null default 'programme',
  due date,
  items text[] not null default '{}',
  created_by uuid references profiles on delete set null,
  created_at timestamptz default now()
);
create index if not exists clubs_room_idx on clubs (room_id, created_at desc);

-- ---------- the talk ----------
create table if not exists reactions (
  entry_id uuid references entries on delete cascade,
  user_id uuid references profiles on delete cascade,
  primary key (entry_id, user_id)
);
create table if not exists replies (
  id uuid primary key default gen_random_uuid(),
  entry_id uuid references entries on delete cascade,
  user_id uuid references profiles on delete cascade,
  body text not null check (length(body) between 1 and 600),
  created_at timestamptz default now()
);

-- ---------- who can see what ----------
create or replace function my_room_ids()
returns setof uuid language sql security definer stable set search_path = public as $$
  select room_id from room_members where user_id = auth.uid()
$$;

create or replace function shares_room(other uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select exists (select 1 from room_members where user_id = other and room_id in (select my_room_ids()))
$$;

alter table profiles enable row level security;
alter table works enable row level security;
alter table entries enable row level security;
alter table rooms enable row level security;
alter table room_members enable row level security;
alter table lists enable row level security;
alter table list_items enable row level security;
alter table top_lists enable row level security;
alter table top_list_items enable row level security;
alter table clubs enable row level security;
alter table reactions enable row level security;
alter table replies enable row level security;

drop policy if exists profiles_read on profiles;
create policy profiles_read on profiles for select to authenticated
  using (id = auth.uid() or shares_room(id));
drop policy if exists profiles_write on profiles;
create policy profiles_write on profiles for insert to authenticated with check (id = auth.uid());
drop policy if exists profiles_update on profiles;
create policy profiles_update on profiles for update to authenticated using (id = auth.uid());

-- works are a shared catalogue: anyone signed in may read or add
drop policy if exists works_read on works;
create policy works_read on works for select to authenticated using (true);
drop policy if exists works_write on works;
create policy works_write on works for insert to authenticated with check (true);
drop policy if exists works_update on works;
create policy works_update on works for update to authenticated using (true);

drop policy if exists entries_read on entries;
create policy entries_read on entries for select to authenticated
  using (user_id = auth.uid() or shares_room(user_id));
drop policy if exists entries_mine on entries;
create policy entries_mine on entries for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists rooms_read on rooms;
create policy rooms_read on rooms for select to authenticated using (id in (select my_room_ids()));
drop policy if exists members_read on room_members;
create policy members_read on room_members for select to authenticated using (room_id in (select my_room_ids()));

drop policy if exists lists_mine on lists;
create policy lists_mine on lists for all to authenticated
  using (owner = auth.uid()) with check (owner = auth.uid());
drop policy if exists list_items_mine on list_items;
create policy list_items_mine on list_items for all to authenticated
  using (list_id in (select id from lists where owner = auth.uid()))
  with check (list_id in (select id from lists where owner = auth.uid()));

drop policy if exists top_read on top_lists;
create policy top_read on top_lists for select to authenticated
  using (owner = auth.uid() or shares_room(owner));
drop policy if exists top_mine on top_lists;
create policy top_mine on top_lists for all to authenticated
  using (owner = auth.uid()) with check (owner = auth.uid());
drop policy if exists topi_read on top_list_items;
create policy topi_read on top_list_items for select to authenticated
  using (top_list_id in (select id from top_lists where owner = auth.uid() or shares_room(owner)));
drop policy if exists topi_mine on top_list_items;
create policy topi_mine on top_list_items for all to authenticated
  using (top_list_id in (select id from top_lists where owner = auth.uid()))
  with check (top_list_id in (select id from top_lists where owner = auth.uid()));

drop policy if exists clubs_read on clubs;
create policy clubs_read on clubs for select to authenticated using (room_id in (select my_room_ids()));
drop policy if exists clubs_write on clubs;
create policy clubs_write on clubs for insert to authenticated
  with check (room_id in (select my_room_ids()) and created_by = auth.uid());
drop policy if exists clubs_update on clubs;
create policy clubs_update on clubs for update to authenticated using (room_id in (select my_room_ids()));
drop policy if exists clubs_delete on clubs;
create policy clubs_delete on clubs for delete to authenticated using (created_by = auth.uid());

drop policy if exists reactions_read on reactions;
create policy reactions_read on reactions for select to authenticated
  using (entry_id in (select id from entries where user_id = auth.uid() or shares_room(user_id)));
drop policy if exists reactions_mine on reactions;
create policy reactions_mine on reactions for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists replies_read on replies;
create policy replies_read on replies for select to authenticated
  using (entry_id in (select id from entries where user_id = auth.uid() or shares_room(user_id)));
drop policy if exists replies_mine on replies;
create policy replies_mine on replies for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ---------- the calls ----------
create or replace function create_room(p_name text)
returns rooms language plpgsql security definer set search_path = public as $$
declare r rooms;
begin
  insert into rooms (name, code, created_by)
  values (p_name, lower(substr(replace(gen_random_uuid()::text,'-',''),1,6)), auth.uid())
  returning * into r;
  insert into room_members (room_id, user_id) values (r.id, auth.uid());
  return r;
end $$;

create or replace function join_room(p_code text)
returns rooms language plpgsql security definer set search_path = public as $$
declare r rooms;
begin
  select * into r from rooms where code = lower(p_code);
  if r.id is null then raise exception 'no room with that code'; end if;
  insert into room_members (room_id, user_id) values (r.id, auth.uid()) on conflict do nothing;
  return r;
end $$;

-- everything the room screen needs, in one call
create or replace function room_entries(p_room uuid)
returns table (
  id uuid, user_id uuid, handle text, work_id text, kind text, rated_on date,
  score int, note text, loved text[], breakdown jsonb, context jsonb,
  title text, year text, cover text, creator text
)
language sql security definer stable set search_path = public as $$
  select e.id, e.user_id, p.handle, e.work_id, w.kind, e.rated_on,
         e.score, e.note, e.loved, e.breakdown, e.context,
         w.title, w.year, w.cover, w.creator
  from entries e
  join profiles p on p.id = e.user_id
  join works w on w.id = e.work_id
  where e.user_id in (select user_id from room_members where room_id = p_room)
    and p_room in (select my_room_ids())
  order by e.created_at desc
$$;

-- ---------- coming from the film-only schema ----------
-- run this once if you already have data in films/watches/clubs:
--
-- insert into works (id, kind, title, year, cover, creator, length, meta, credits)
--   select 'film:'||tmdb_id, 'film', title, year,
--          case when poster <> '' then 'https://image.tmdb.org/t/p/w342'||poster end,
--          crew->>'director', runtime,
--          jsonb_build_object('genres', to_jsonb(genres)), crew
--   from films on conflict (id) do nothing;
--
-- insert into entries (user_id, work_id, rated_on, score, note, loved, breakdown, context)
--   select user_id, 'film:'||tmdb_id, watched_on, score, note, loved, breakdown,
--          jsonb_build_object('first', first_watch, 'where', venue, 'with', company)
--   from watches;
--
-- rooms/clubs: the old `clubs` table becomes `rooms`, the old `strands` becomes `clubs`.

-- ---------- v6: following ----------
create table if not exists follows (
  follower uuid references profiles on delete cascade,
  followee uuid references profiles on delete cascade,
  created_at timestamptz default now(),
  primary key (follower, followee),
  check (follower <> followee)
);
alter table follows enable row level security;
drop policy if exists follows_read on follows;
create policy follows_read on follows for select to authenticated using (true);
drop policy if exists follows_mine on follows;
create policy follows_mine on follows for all to authenticated using (follower = auth.uid()) with check (follower = auth.uid());
-- profiles and public entries are readable by everyone signed in (the hall); rooms stay private
drop policy if exists profiles_read on profiles;
create policy profiles_read on profiles for select to authenticated using (true);
alter table entries add column if not exists room_only boolean not null default false;
drop policy if exists entries_read on entries;
create policy entries_read on entries for select to authenticated
  using (user_id = auth.uid() or (not room_only) or shares_room(user_id));


-- ---------- v7: clubs anyone can join ----------
alter table clubs add column if not exists scope text not null default 'room';
alter table clubs alter column room_id drop not null;

create table if not exists club_members (
  club_id uuid references clubs on delete cascade,
  user_id uuid references profiles on delete cascade,
  joined_at timestamptz default now(),
  primary key (club_id, user_id)
);
alter table club_members enable row level security;

drop policy if exists clubs_read on clubs;
create policy clubs_read on clubs for select to authenticated
  using (scope = 'open' or (room_id is not null and room_id in (select my_room_ids())));
drop policy if exists clubs_write on clubs;
create policy clubs_write on clubs for all to authenticated
  using (created_by = auth.uid()) with check (created_by = auth.uid());

drop policy if exists club_members_read on club_members;
create policy club_members_read on club_members for select to authenticated using (true);
drop policy if exists club_members_mine on club_members;
create policy club_members_mine on club_members for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());


-- ---------- v8: club runs and ballots ----------
alter table club_members add column if not exists started_at timestamptz default now();
alter table club_members add column if not exists finished_at timestamptz;

create table if not exists club_votes (
  club_id uuid references clubs on delete cascade,
  user_id uuid references profiles on delete cascade,
  work_id text references works on delete cascade,
  rank int not null check (rank between 1 and 5),
  primary key (club_id, user_id, work_id)
);
alter table club_votes enable row level security;
drop policy if exists club_votes_read on club_votes;
create policy club_votes_read on club_votes for select to authenticated using (true);
drop policy if exists club_votes_mine on club_votes;
create policy club_votes_mine on club_votes for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

alter table clubs add column if not exists closed_at timestamptz;
-- ballots are write-your-own, read-your-own until the club closes
drop policy if exists club_votes_read on club_votes;
create policy club_votes_read on club_votes for select to authenticated using (
  user_id = auth.uid()
  or exists (select 1 from clubs c where c.id = club_id
             and (c.closed_at is not null or (c.due is not null and c.due < current_date)))
);

-- ---------- v9: avatars ----------
alter table profiles add column if not exists avatar jsonb;

-- ---------- v10: a shelf you can arrange ----------
-- null means never dragged; those fall in behind the placed ones, oldest first
alter table list_items add column if not exists position int;

-- ---------- v11: a room you can leave ----------
-- membership is protected by the room's own policies, so leaving goes through a
-- function the same way joining does
create or replace function leave_room(p_room_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  delete from room_members where room_id = p_room_id and user_id = auth.uid();
  -- the last one out closes the room behind them; its clubs cascade with it
  delete from rooms r where r.id = p_room_id
    and not exists (select 1 from room_members m where m.room_id = r.id);
end $$;
