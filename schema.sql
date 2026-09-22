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

/* ---------- v12: let the room see itself ----------
   Presence rides on the realtime socket and needs nothing here, but the live
   arrival of an entry does: postgres_changes only fires for tables in the
   publication. RLS still applies, so a client is only ever told about rows it
   was already allowed to read. Safe to re-run. */
do $$ begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'entries')
  then execute 'alter publication supabase_realtime add table public.entries'; end if;
end $$;

/* the payload of an update/delete carries only the primary key unless we ask for
   the whole row; inserts are complete either way, and full is what the client wants. */
alter table public.entries replica identity full;

/* ---------- v13: the founder ----------
   A column on its own would be worthless: profiles_update is `using (id = auth.uid())`
   with no column restriction, so any signed-in person could set their own flag through
   the API and wear the ring. The trigger refuses the change whenever the caller is a
   web client, which leaves the SQL editor — running as postgres — as the only way in.

   To grant it, once, from the dashboard:
     update profiles set founder = true where handle = 'your_handle';
*/
alter table profiles add column if not exists founder boolean not null default false;

create or replace function guard_founder() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if current_user in ('authenticated', 'anon') then
    if tg_op = 'INSERT' then new.founder := false;
    else new.founder := old.founder; end if;
  end if;
  return new;
end $$;

drop trigger if exists profiles_guard_founder on profiles;
create trigger profiles_guard_founder before insert or update on profiles
  for each row execute function guard_founder();

/* ---------- v14: things that haven't come out yet ----------
   The app has always sent a release date when it had one — every upcoming title
   carries one — but works had nowhere to put it, so PostgREST rejected the whole
   row and nothing dated could be added to a shelf at all. Text rather than date
   because the client compares it as a string ("2026-11-04" > today()) and an odd
   value from a source should not be able to fail an insert. Safe to re-run. */
alter table works add column if not exists release text;

/* ---------- v15: what you're in the middle of ----------
   The app has only ever known two states: on the shelf, meaning you mean to get to it,
   and logged, meaning you're done. Everything that takes longer than one sitting — a
   season, a novel, a game you'll be at for a month — has had nowhere to live, and the
   most present-tense thing about a person was invisible to the room they're in.

   Its own table rather than a second list, because a list cannot answer "where are you
   up to" and because list_items is private by RLS: `lists_mine` is `for all` on
   `owner = auth.uid()`, so nobody could ever see anybody else's. The read policy here
   matches entries exactly — yourself, or somebody you share a room with — so this is
   visible to precisely the people who can already see what you rate.

   `at` is free text on purpose. "episode 4", "page 200", "act II", "just started" —
   the shape of progress differs per medium and per person, and a number would force
   a fidelity nobody has. Safe to re-run. */
create table if not exists nows (
  user_id uuid not null references profiles on delete cascade,
  work_id text not null references works on delete cascade,
  started_on date not null default current_date,
  at text,
  updated_at timestamptz default now(),
  primary key (user_id, work_id)
);
create index if not exists nows_user_idx on nows (user_id, updated_at desc);

alter table nows enable row level security;
drop policy if exists nows_read on nows;
create policy nows_read on nows for select to authenticated
  using (user_id = auth.uid() or shares_room(user_id));
drop policy if exists nows_mine on nows;
create policy nows_mine on nows for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

/* the room should see somebody pick a book up without waiting for a reload */
do $$ begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'nows')
  then execute 'alter publication supabase_realtime add table public.nows'; end if;
end $$;
alter table nows replica identity full;

/* ---------- v16: handing something to somebody ----------
   Every social act in this app has been a broadcast: you log, and the room sees it.
   Nothing was ever aimed at one person, and "you have to watch this" said to one friend
   is the commonest thing anybody does about films. It is also the only thing here that
   happens on a day nobody finished anything.

   It lands in a queue rather than on their shelf. The shelf is described to its owner as
   everything they mean to get to, and somebody else does not get to decide what they
   meant. Accepting moves it across; declining removes it and is never reported back,
   because a decline anybody can see is a decline nobody makes.

   The accepted row is also the record of where a title came from — no column on entries
   and nothing to stamp at save time, because the handover already says who and when.
   Safe to re-run. */

/* A one-way follow must not buy the right to put things in front of somebody: follows is
   readable by all and writable by anybody about anybody, so on its own it is an open door.
   A shared room is an invite code you handed out; a mutual follow is two decisions. */
create or replace function can_hand_to(target uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select target <> auth.uid() and (
    shares_room(target)
    or (exists (select 1 from follows where follower = auth.uid() and followee = target)
        and exists (select 1 from follows where follower = target and followee = auth.uid())))
$$;

create table if not exists handovers (
  id uuid primary key default gen_random_uuid(),
  sender uuid not null references profiles on delete cascade,
  recipient uuid not null references profiles on delete cascade,
  work_id text not null references works on delete cascade,
  note text,
  created_at timestamptz default now(),
  acted_at timestamptz,
  accepted boolean,
  unique (sender, recipient, work_id),
  check (sender <> recipient)
);
create index if not exists handovers_in_idx on handovers (recipient, created_at desc);
create index if not exists handovers_out_idx on handovers (sender, created_at desc);

alter table handovers enable row level security;
drop policy if exists handovers_read on handovers;
create policy handovers_read on handovers for select to authenticated
  using (sender = auth.uid() or recipient = auth.uid());
drop policy if exists handovers_send on handovers;
create policy handovers_send on handovers for insert to authenticated
  with check (sender = auth.uid() and can_hand_to(recipient));
drop policy if exists handovers_answer on handovers;
create policy handovers_answer on handovers for update to authenticated
  using (recipient = auth.uid()) with check (recipient = auth.uid());
drop policy if exists handovers_unsend on handovers;
create policy handovers_unsend on handovers for delete to authenticated
  using (sender = auth.uid() and acted_at is null);

/* RLS grants a row, not a column, so the update policy above would also let a recipient
   rewrite the note they were sent or move it to somebody else. Answering is all they may
   actually do. */
create or replace function handovers_answer_only() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() = old.recipient and auth.uid() <> old.sender then
    new.sender := old.sender; new.recipient := old.recipient;
    new.work_id := old.work_id; new.note := old.note; new.created_at := old.created_at;
  end if;
  return new;
end $$;
drop trigger if exists handovers_guard on handovers;
create trigger handovers_guard before update on handovers
  for each row execute function handovers_answer_only();

do $$ begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'handovers')
  then execute 'alter publication supabase_realtime add table public.handovers'; end if;
end $$;
alter table handovers replica identity full;


/* ============================================================================
   v17 — a bell, and the quiet thing it turned up
   ============================================================================
   Two problems, one of which was already live.

   1. Agreement had no clock. reactions is (entry_id, user_id) and nothing more,
      so "who agreed with me since I last looked" was a question the table could
      not answer. A column with a default is enough; existing rows are stamped
      at the moment this runs, and the app only ever asks about rows newer than
      the first time you opened the bell, so nobody gets a week of backlog.

   2. entries_read was widened in v13 so anything not marked room_only is
      readable by anyone signed in. The things hanging off an entry were never
      widened with it. That was invisible until the Same button started drawing
      outside rooms, and then it was bad in a specific way: you could write a
      reaction to a stranger's review — reactions_mine only checks that the row
      is yours — but you could not read it back. The count said nothing, your
      own agreement looked untaken, and tapping again collided with the row you
      had already written.

      So the rule lives with the entry now, and these two follow it rather than
      keeping their own out-of-date copy of it.
   ============================================================================ */

alter table reactions add column if not exists created_at timestamptz default now();

drop policy if exists reactions_read on reactions;
create policy reactions_read on reactions for select to authenticated
  using (exists (select 1 from entries e
    where e.id = reactions.entry_id
      and (e.user_id = auth.uid() or (not e.room_only) or shares_room(e.user_id))));

drop policy if exists replies_read on replies;
create policy replies_read on replies for select to authenticated
  using (exists (select 1 from entries e
    where e.id = replies.entry_id
      and (e.user_id = auth.uid() or (not e.room_only) or shares_room(e.user_id))));

/* the bell asks one question on every load — "reactions on my entries, newest
   first" — and without this it is a scan of every reaction in the table */
create index if not exists reactions_entry_time on reactions (entry_id, created_at desc);


/* ============================================================================
   v18 — room_only finally means something, so the rows hanging off an entry
         have to respect it
   ============================================================================
   The column has existed since v13 and nothing ever set it, so every entry
   anybody has written has been public. The app can now keep one inside a room,
   which makes a gap in reactions_mine worth closing: it only ever checked that
   the row was yours, never that the entry was one you are allowed to see. You
   cannot read a room-only entry you are not in, so you cannot find its id — but
   "they cannot find it" is not the same as "they cannot write to it", and the
   second is the one worth being true.
   ============================================================================ */

drop policy if exists reactions_mine on reactions;
create policy reactions_mine on reactions for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid() and exists (select 1 from entries e
    where e.id = reactions.entry_id
      and (e.user_id = auth.uid() or (not e.room_only) or shares_room(e.user_id))));


/* ============================================================================
   v19 — closing your own account
   ============================================================================
   Apple requires that an account made in an app can be deleted from inside that
   app, and it is the right thing regardless of who is asking. Everything hangs
   off profiles, which hangs off the auth user, so one delete takes the lot —
   entries, reactions, follows, top lists, club votes, what you were in the
   middle of, and anything anybody handed you.

   Two things it has to do by hand. Rooms survive their maker (created_by is set
   null, not cascaded) so a room you started outlives you if anybody else is
   still in it — but a room with nobody left in it is closed behind you, the same
   rule leave_room already follows. And the rooms have to be gathered BEFORE the
   memberships go, because afterwards there is nothing left to say which they
   were.

   Deleting from auth.users needs more than the caller has, which is what
   security definer is for. It is scoped to auth.uid() and nothing else, so it
   cannot be pointed at anybody else's account.
   ============================================================================ */

create or replace function delete_me() returns void
language plpgsql security definer set search_path = public, auth as $$
declare
  me uuid := auth.uid();
  was uuid[];
begin
  if me is null then raise exception 'not signed in'; end if;

  select coalesce(array_agg(room_id), '{}') into was from room_members where user_id = me;
  delete from room_members where user_id = me;
  delete from rooms r where r.id = any(was)
    and not exists (select 1 from room_members m where m.room_id = r.id);

  delete from auth.users where id = me;
end $$;

revoke all on function delete_me() from public, anon;
grant execute on function delete_me() to authenticated;

-- ---------- v20: a show is a thing with things inside it ----------
-- A season and an episode are works under a work, on the same namespacing the ids
-- already use: tv:1396 -> tv:1396:s4 -> tv:1396:s4e7. That means entries needs no new
-- column to point at one: the foreign key already lands on works.id.
alter table works add column if not exists parent_id text references works(id) on delete cascade;
create index if not exists works_parent_idx on works (parent_id) where parent_id is not null;

-- Parts log, but they never broadcast. One binge is sixty rows, and a feed that carried
-- them would be somebody's week of Severance and nothing else. Every feed filters on
-- this, so it has to be cheap and it has to be indexable — which rules out joining works
-- on every feed query. Hence a column on entries.
--
-- It is set by a trigger rather than by the client, because a flag the app is trusted to
-- pass is a flag that will one day be passed wrong, and the wrong way round is a flood
-- nobody can put back.
alter table entries add column if not exists part boolean not null default false;

create or replace function entries_mark_part() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.part := coalesce((select w.parent_id is not null from works w where w.id = new.work_id), false);
  return new;
end $$;

drop trigger if exists entries_part_trg on entries;
create trigger entries_part_trg before insert or update of work_id on entries
  for each row execute function entries_mark_part();

-- anything logged before v20 is a whole thing, which the default already says
create index if not exists entries_whole_idx on entries (created_at desc) where not part;

-- ---------- v20: seen ----------
-- A tick is not an opinion. "I have watched up to here" is the thing a weekly show
-- actually needs, and it is not a score — forcing it through entries would mean
-- inventing a rating for an episode nobody wanted to rate.
create table if not exists seen (
  user_id uuid not null references profiles on delete cascade,
  work_id text not null references works on delete cascade,
  seen_on date not null default current_date,
  primary key (user_id, work_id)
);
create index if not exists seen_user_idx on seen (user_id, seen_on desc);

alter table seen enable row level security;
drop policy if exists seen_mine on seen;
-- where you are up to is yours. The show you logged is the part other people see.
create policy seen_mine on seen for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ---------- v21: blocking and reporting ----------
-- Apple's guideline 1.2 asks for four things from an app that carries what people write:
-- a way to filter what goes up, a way to report it, a way to block a person, and a way
-- to reach whoever runs it. Three of them are here; the fourth is on the privacy page.
--
-- Blocking belongs in the row policies and not in the drawing. A block enforced by the
-- app is a block that still delivers every row to the blocked-from person's device and
-- merely declines to paint it — which is not blocking, it is a curtain. Everything below
-- is written so the rows never leave the database.
create table if not exists blocks (
  blocker uuid not null references profiles on delete cascade,
  blocked uuid not null references profiles on delete cascade,
  created_at timestamptz default now(),
  primary key (blocker, blocked),
  check (blocker <> blocked)
);
create index if not exists blocks_blocked_idx on blocks (blocked);

alter table blocks enable row level security;
drop policy if exists blocks_mine on blocks;
-- you can see and change who you have blocked. You cannot see who has blocked you:
-- a list of that is a list of people to go and find.
create policy blocks_mine on blocks for all to authenticated
  using (blocker = auth.uid()) with check (blocker = auth.uid());

-- Symmetrical on purpose. If blocking only worked one way, the person blocked would
-- keep seeing everything and only wonder why the replies stopped — and the person who
-- blocked them would still be reading them, which is not what they asked for.
create or replace function apart_from(other uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select exists (select 1 from blocks b
    where (b.blocker = auth.uid() and b.blocked = other)
       or (b.blocker = other      and b.blocked = auth.uid()))
$$;
revoke all on function apart_from(uuid) from public, anon;
grant execute on function apart_from(uuid) to authenticated;

-- every door a person's writing comes through
drop policy if exists entries_read on entries;
create policy entries_read on entries for select to authenticated
  using ((user_id = auth.uid() or (not room_only) or shares_room(user_id))
    and not apart_from(user_id));

drop policy if exists reactions_read on reactions;
create policy reactions_read on reactions for select to authenticated
  using (not apart_from(reactions.user_id) and exists (
    select 1 from entries e where e.id = reactions.entry_id
      and (e.user_id = auth.uid() or (not e.room_only) or shares_room(e.user_id))
      and not apart_from(e.user_id)));

drop policy if exists replies_read on replies;
create policy replies_read on replies for select to authenticated
  using (not apart_from(replies.user_id) and exists (
    select 1 from entries e where e.id = replies.entry_id
      and (e.user_id = auth.uid() or (not e.room_only) or shares_room(e.user_id))
      and not apart_from(e.user_id)));

drop policy if exists nows_read on nows;
create policy nows_read on nows for select to authenticated
  using ((user_id = auth.uid() or shares_room(user_id)) and not apart_from(user_id));

drop policy if exists handovers_read on handovers;
create policy handovers_read on handovers for select to authenticated
  using ((sender = auth.uid() or recipient = auth.uid())
    and not apart_from(case when sender = auth.uid() then recipient else sender end));

-- and the one that stops it happening again rather than hiding it afterwards
create or replace function can_hand_to(target uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select target <> auth.uid() and not apart_from(target) and (
    shares_room(target)
    or (exists (select 1 from follows where follower = auth.uid() and followee = target)
        and exists (select 1 from follows where follower = target and followee = auth.uid())))
$$;

-- a block is also an undoing: whatever following there was between you stops
create or replace function block_them(target uuid) returns void
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid();
begin
  if me is null or target is null or target = me then raise exception 'no'; end if;
  insert into blocks (blocker, blocked) values (me, target) on conflict do nothing;
  delete from follows where (follower = me and followee = target)
                         or (follower = target and followee = me);
  delete from handovers where (sender = me and recipient = target)
                           or (sender = target and recipient = me);
end $$;
revoke all on function block_them(uuid) from public, anon;
grant execute on function block_them(uuid) to authenticated;

-- ---------- v21: reports ----------
-- Insert-only from the app. Nobody reads these through the API — not even the person
-- who sent one, because a readable report is a report somebody can check the status of
-- and then go and argue about. They are read in the SQL editor, by a person, and acted
-- on within a day, which is what the store asks for and what the privacy page says.
create table if not exists reports (
  id uuid primary key default gen_random_uuid(),
  -- nullable on purpose: a report outlives the person who sent it. "not null" here
  -- with "on delete set null" would have made closing your own account fail outright.
  reporter uuid references profiles on delete set null,
  about_user uuid references profiles on delete cascade,
  about_entry uuid references entries on delete cascade,
  reason text not null check (reason in ('abuse','hate','sexual','violence','spam','spoiler','other')),
  note text check (note is null or length(note) <= 400),
  created_at timestamptz default now(),
  check (about_user is not null or about_entry is not null)
);
create index if not exists reports_new_idx on reports (created_at desc);

alter table reports enable row level security;
drop policy if exists reports_send on reports;
create policy reports_send on reports for insert to authenticated
  with check (reporter = auth.uid());

-- ---------- v22: the things you will want to change in a hurry ----------
-- Once this is in an App Store, a one-word change costs a build, an upload and a day or
-- two of review — and a slur list you can only update through App Review is a slur list
-- that is out of date the first time somebody finds a word it does not know. The same
-- goes for the reasons on a report form and for the address on the privacy page.
--
-- So they live in a row instead. The app reads this at startup and falls back to what is
-- baked into the file when it cannot — offline, first paint, or a project where nobody
-- has run this migration. The bundled copy is the floor, never the ceiling.
create table if not exists settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz default now()
);

alter table settings enable row level security;
drop policy if exists settings_read on settings;
-- readable by anyone signed in, writable by nobody through the API. These are edited in
-- the SQL editor, running as postgres, for the same reason the founder flag is.
create policy settings_read on settings for select to authenticated using (true);

-- seeded empty. Add a word without shipping anything:
--   insert into settings (key, value) values ('nope', '["some","patterns"]'::jsonb)
--   on conflict (key) do update set value = excluded.value, updated_at = now();
-- The patterns are case-insensitive regular expressions, matched against the text with
-- spaces, dots, stars and hyphens stripped out. They are ADDED to the bundled list,
-- never replace it, so a bad row here cannot switch the filter off.

-- ---------- v23: one handle each ----------
-- A handle is the only name anybody has here, and it was free to change and free to
-- drop. Change yours and the old one went back in the pool — so anybody could take the
-- name your friends know you by and be mistaken for you in a room. That is the whole
-- attack and it costs nothing to run.
--
-- So a handle stays with whoever had it. Changing yours takes the new one and keeps the
-- old, and nobody else can ever have either.
create table if not exists handles (
  handle text primary key check (handle ~ '^[a-z0-9_]{2,24}$'),
  owner uuid references profiles on delete set null,
  taken_at timestamptz default now()
);
create index if not exists handles_owner_idx on handles (owner);

alter table handles enable row level security;
drop policy if exists handles_read on handles;
-- readable so the app can say "that one is taken" before you press anything. It says
-- nothing about who has it: the owner column is not in what the app asks for, and
-- knowing a name is spoken for is not knowing whose it is.
create policy handles_read on handles for select to authenticated using (true);

-- Names nobody gets. Not a moral list — these are the ones that let somebody pass for
-- the app itself, which is the only impersonation that works on everybody at once.
insert into handles (handle, owner) values
  ('rooms', null), ('admin', null), ('support', null), ('help', null), ('team', null),
  ('staff', null), ('official', null), ('moderator', null), ('mod', null), ('system', null),
  ('root', null), ('security', null), ('billing', null), ('me', null), ('you', null),
  ('anonymous', null), ('deleted', null), ('null', null), ('undefined', null)
on conflict (handle) do nothing;

-- every handle already in use belongs to whoever is using it
insert into handles (handle, owner)
  select handle, id from profiles on conflict (handle) do nothing;

-- Taking one, in a single statement, so two people pressing save at the same moment
-- cannot both be told yes. Raises rather than returning false, because the caller has
-- nothing useful to do with a quiet no.
create or replace function claim_handle(want text) returns void
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); holder uuid; had text;
begin
  if me is null then raise exception 'not signed in'; end if;
  want := lower(trim(want));
  if want !~ '^[a-z0-9_]{2,24}$' then raise exception 'two to twenty-four, lowercase, no spaces'; end if;
  select owner into holder from handles where handle = want;
  if found and holder is distinct from me then raise exception 'that handle is taken'; end if;
  if not found then insert into handles (handle, owner) values (want, me); end if;
  select handle into had from profiles where id = me;
  update profiles set handle = want where id = me;
  -- the old one is kept, owned, and unavailable: that is the point
  if had is not null and had <> want then
    insert into handles (handle, owner) values (had, me) on conflict (handle) do update set owner = me;
  end if;
end $$;
revoke all on function claim_handle(text) from public, anon;
grant execute on function claim_handle(text) to authenticated;

-- ---------- v23: looking at a room before you are in it ----------
-- An invite link asked for an account before it would show anything, which is a strange
-- thing to ask of somebody who has been sent a link by a friend: sign up, then find out
-- whether it was worth it.
--
-- What comes back is who is in there and how much they have logged. Not a word anybody
-- wrote. The code is the only thing guarding a room, and it is fair to let it prove the
-- room is real — it is not fair to let it publish everybody's writing to anyone who is
-- handed six characters.
create or replace function peek_room(p_code text)
returns table (name text, members int, logged bigint, handles text[])
language sql security definer stable set search_path = public as $$
  select r.name,
         (select count(*)::int from room_members m where m.room_id = r.id),
         (select count(*) from entries e
            where e.user_id in (select m.user_id from room_members m where m.room_id = r.id)
              and not e.part),
         (select coalesce(array_agg(p.handle order by p.handle), '{}')
            from room_members m join profiles p on p.id = m.user_id where m.room_id = r.id)
  from rooms r where upper(r.code) = upper(trim(p_code)) limit 1
$$;
revoke all on function peek_room(text) from public;
grant execute on function peek_room(text) to anon, authenticated;

-- ---------- v24: the charts ----------
-- Everybody could see what their room liked and nobody could see what the app liked.
-- The hall worked its rankings out from the last three hundred entries it happened to
-- have fetched, which is fine on the first day and a lie by the second: "the best films
-- this year" computed from three hundred rows is the best of whatever was logged most
-- recently, wearing the word year.
--
-- So the ranking happens where the rows are. One score per person per thing — the most
-- recent word they said, not every rewatch — averaged, then pulled towards the overall
-- mean by a constant, which is what stops a single ten from topping a chart. Rooms-only
-- entries stay out of it, parts stay out of it, and anybody you have blocked stops
-- counting towards what you see.
--
-- It returns no user, no note and no date. A chart is a number and a title.
create or replace function best_of(p_since date default null, p_kind text default null,
                                   p_limit int default 8)
returns table (work_id text, n int, avg numeric, weighted numeric, spread numeric)
language sql security definer stable set search_path = public as $$
  with latest as (
    select distinct on (e.user_id, e.work_id) e.user_id, e.work_id, e.score
      from entries e
     where not e.part and not e.room_only
       and (p_since is null or e.rated_on >= p_since)
       and not apart_from(e.user_id)
     order by e.user_id, e.work_id, e.rated_on desc, e.created_at desc
  ), per as (
    select l.work_id, count(*)::int as n, avg(l.score)::numeric as a,
           coalesce(stddev_pop(l.score), 0)::numeric as s
      from latest l join works w on w.id = l.work_id
     where (p_kind is null or w.kind = p_kind) and w.parent_id is null
     group by l.work_id
  ), m as (select avg(a) as mean from per)
  -- Smoothing alone cannot stop a lone ten topping a chart: pulled towards the mean it
  -- is still above everything the mean pulled down, whatever constant you pick. So there
  -- is a floor of two people, and anything under it charts below everything over it
  -- rather than not at all -- on the first week there is nothing else to show.
  select p.work_id, p.n, round(p.a, 2),
         round((p.n * p.a + 1.5 * m.mean) / (p.n + 1.5), 3), round(p.s, 2)
    from per p, m
   order by (p.n >= 2) desc, 4 desc, p.n desc, p.work_id
   limit greatest(1, least(coalesce(p_limit, 8), 50))
$$;
revoke all on function best_of(date, text, int) from public, anon;
grant execute on function best_of(date, text, int) to authenticated;

-- rated_on is what every window is measured against, and nothing was indexed on it
create index if not exists entries_rated_idx on entries (rated_on desc) where not part;

-- ---------- v25: names, and the rest of the swearing ----------
-- The filter lived only in the app, which is one file served off a CDN with its source
-- in a public repository. That is a sign on a door, not a lock: anybody who wants a
-- handle the filter refuses can have one with a single line in a console. A name is the
-- one piece of text everybody else has to read on every screen it appears on, so this
-- is the half that has to hold.
--
-- Three lists, and the middle one is the point. Slurs go from everything. Swearing goes
-- from everything too -- with one exception, because "this is fucking magnificent" is a
-- compliment and refusing it teaches people the app is stupid, which is the fastest way
-- to stop them writing at all. So that one word stays in a review and goes from a name.
--
-- Every pattern is anchored. Scunthorpe, Hitchcock, assassin, classic, shiitake, Moby
-- Dick and Pissarro are ordinary things to write about films, and a filter that trips on
-- them is worse than no filter. The app carries the same three lists and the same
-- anchoring; if you change one, change the other.
create or replace function flat_text(t text) returns text
language sql immutable strict as $$
  select regexp_replace(translate(lower(t), '@4310$57!|', 'aaeiosstii'), '[^a-z]+', ' ', 'g')
$$;
-- the dressing-up stripped out entirely: for a slur written l i k e  t h i s
create or replace function bare_text(t text) returns text
language sql immutable strict as $$
  select regexp_replace(lower(t), '[^a-z0-9]+', '', 'g')
$$;

create or replace function bad_word(t text) returns boolean
language sql immutable as $$
  select case when t is null or t = '' then false else
    bare_text(t) ~* '(n[i1!]+gg?[e3]+r|n[i1!]+gg?a|f[a@4]+gg?[o0]+t|k[i1!]+k[e3]|sp[i1!]+ck|ch[i1!]+nk|tr[a@4]+nn[yie]+|r[e3]+t[a@4]+rd|c[o0][o0]+ns?\y|w[e3]+tb[a@4]+ck|g[o0][o0]+k\y|b[e3]+[a@4]+n[e3]+r\y)'
    or regexp_replace(flat_text(t) || ' ' || bare_text(t),
         'scunthorpe|penistone|lightwater|shiitake|pissarro|assassin|mishit|prickly', '', 'g')
       ~* '(cunt|shit|bitch|bastard|wank|twat|bollock|arsehole|asshole|whore|slut|douche|prick|dickhead|cocksucker|scumbag)'
    or (flat_text(t) || ' ' || bare_text(t)) ~* '\y(c+u+n+t+(s|y|ish)?|(bull|horse|dog|bat|ape|dip)?s+h+i+t+(e|s|y|ty|ter|ting|ed|head|hole|bag|faced)?|b+i+t+c+h+(es|y|in|ing|ed)?|b+a+s+t+a+r+d+s?|w+a+n+k+(er|ers|ing|ed|s)?|t+w+a+t+s?|b+o+l+l+o+c+k+(s|ed|ing)?|p+i+s+s+(ed|ing|er|es|take)?|(ars|ass)e?(hole|holes|wipe|hat|clown)|arses?|wh+o+r+e+(s|house)?|sluts?|douche(bag)?s?|pricks?|dick(head|heads|face|wad|weed)|cock(head|sucker|suckers|face)|jerk *off|sc+u+m+bag+s?)\y'
  end
$$;
-- A name is held to the stricter rule, because it is read by people who did not ask to.
-- And a handle is one word with no spaces in it, so the anchors have nothing to hold on
-- to: fuckinglegend and shitposter walk straight past a list anchored at both ends, and
-- they are exactly what somebody picking a handle will try. So there is a second pass
-- with no anchors, over a much shorter list -- the cores with no innocent host word. No
-- ass (assassin, classic), no cock (Hitchcock, peacock), no dick (Moby Dick), no piss
-- (Pissarro), no fuk (Fukunaga), and no elongation, because s+h+i+t+ matches shiitake
-- and plain 'shit' does not. The towns are the oldest joke in this business and somebody
-- really is from one of them.
create or replace function bad_name(t text) returns boolean
language sql immutable as $$
  select case when t is null or t = '' then false else
    bad_word(t)
    or (flat_text(t) || ' ' || bare_text(t)) ~* '\y((mother|cluster)?f+u+c+k+(s|er|ers|ing|in|ed|up|ups|off|wit|wits|face|head|tard|tards)?|f+u+k+(s|ing|er)?|fck|stfu)\y'
    or regexp_replace(flat_text(t) || ' ' || bare_text(t),
         'scunthorpe|penistone|lightwater|shiitake|pissarro|assassin|mishit|prickly', '', 'g')
       ~* 'fuck'
  end
$$;
grant execute on function flat_text(text), bare_text(text), bad_word(text), bad_name(text) to authenticated, anon;

-- Taking a handle goes through a function, so the check goes in the function. Raising
-- rather than quietly refusing: the caller has nothing useful to do with a silent no.
create or replace function claim_handle(want text) returns void
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); holder uuid; had text;
begin
  if me is null then raise exception 'not signed in'; end if;
  want := lower(trim(want));
  if want !~ '^[a-z0-9_]{2,24}$' then raise exception 'two to twenty-four, lowercase, no spaces'; end if;
  if bad_name(want) then raise exception 'that name does not go up here'; end if;
  select owner into holder from handles where handle = want;
  if found and holder is distinct from me then raise exception 'that handle is taken'; end if;
  if not found then insert into handles (handle, owner) values (want, me); end if;
  select handle into had from profiles where id = me;
  update profiles set handle = want where id = me;
  if had is not null and had <> want then
    insert into handles (handle, owner) values (had, me) on conflict (handle) do update set owner = me;
  end if;
end $$;
revoke all on function claim_handle(text) from public, anon;
grant execute on function claim_handle(text) to authenticated;

-- and the rest of it, where the row is written directly. `not valid` on purpose: these
-- check what is written from now on and leave whatever is already there alone -- a name
-- somebody has been using for a month is a job for reporting, not for a failed migration.
alter table profiles drop constraint if exists profiles_handle_clean;
alter table profiles add constraint profiles_handle_clean check (not bad_name(handle)) not valid;
alter table profiles drop constraint if exists profiles_bio_clean;
alter table profiles add constraint profiles_bio_clean check (not bad_name(bio)) not valid;
alter table rooms drop constraint if exists rooms_name_clean;
alter table rooms add constraint rooms_name_clean check (not bad_name(name)) not valid;
alter table clubs drop constraint if exists clubs_name_clean;
alter table clubs add constraint clubs_name_clean check (not bad_name(name)) not valid;
alter table lists drop constraint if exists lists_name_clean;
alter table lists add constraint lists_name_clean check (not bad_name(name)) not valid;
alter table top_lists drop constraint if exists top_lists_name_clean;
alter table top_lists add constraint top_lists_name_clean check (not bad_name(name)) not valid;
-- what somebody wrote about a film is held to the looser rule, and still to that one
alter table entries drop constraint if exists entries_note_clean;
alter table entries add constraint entries_note_clean check (not bad_word(note)) not valid;
alter table replies drop constraint if exists replies_note_clean;
alter table replies add constraint replies_note_clean check (not bad_word(body)) not valid;
-- a line you send with something you handed somebody is writing, not a name
alter table handovers drop constraint if exists handovers_note_clean;
alter table handovers add constraint handovers_note_clean check (not bad_word(note)) not valid;


-- v26: three memberships in total, including rooms you create.
-- Apply this section to existing hosted databases before deploying the frontend.
-- Lock the member's profile so simultaneous create/join requests cannot exceed three.
create or replace function enforce_room_membership_limit()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform 1 from profiles where id = new.user_id for update;
  if exists (select 1 from room_members where room_id = new.room_id and user_id = new.user_id) then
    return new; -- joining an existing room remains idempotent
  end if;
  if (select count(*) from room_members where user_id = new.user_id) >= 3 then
    raise exception 'You can be in up to three rooms. Leave a room first.';
  end if;
  return new;
end $$;
drop trigger if exists room_members_limit on room_members;
create trigger room_members_limit before insert or update of user_id on room_members
  for each row execute function enforce_room_membership_limit();
