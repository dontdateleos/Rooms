-- Rooms quality pass: invite state, pinned reviews, activity and room preferences.
-- Run after schema.sql and 026-room-limit.sql in an existing Supabase project.

create table if not exists room_invites (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references rooms(id) on delete cascade,
  inviter uuid not null references profiles(id) on delete cascade,
  invitee uuid references profiles(id) on delete cascade,
  code text not null,
  status text not null default 'pending' check (status in ('pending','accepted','declined','expired')),
  created_at timestamptz not null default now(),
  responded_at timestamptz,
  unique (room_id, code)
);

create table if not exists room_pins (
  room_id uuid not null references rooms(id) on delete cascade,
  entry_id uuid not null references entries(id) on delete cascade,
  pinned_by uuid not null references profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (room_id, entry_id)
);

create table if not exists room_activity (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references rooms(id) on delete cascade,
  actor uuid references profiles(id) on delete set null,
  kind text not null check (kind in ('review','like','join','leave','pin','invite')),
  entry_id uuid references entries(id) on delete cascade,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists room_notification_preferences (
  room_id uuid not null references rooms(id) on delete cascade,
  user_id uuid not null references profiles(id) on delete cascade,
  muted boolean not null default false,
  activity boolean not null default true,
  mentions boolean not null default true,
  updated_at timestamptz not null default now(),
  primary key (room_id, user_id)
);

create index if not exists room_invites_invitee_idx on room_invites (invitee, status, created_at desc);
create index if not exists room_activity_room_idx on room_activity (room_id, created_at desc);

alter table room_invites enable row level security;
alter table room_pins enable row level security;
alter table room_activity enable row level security;
alter table room_notification_preferences enable row level security;

drop policy if exists room_invites_read on room_invites;
create policy room_invites_read on room_invites for select to authenticated
  using (inviter = auth.uid() or invitee = auth.uid() or room_id in (select my_room_ids()));

drop policy if exists room_pins_read on room_pins;
create policy room_pins_read on room_pins for select to authenticated
  using (room_id in (select my_room_ids()));

drop policy if exists room_activity_read on room_activity;
create policy room_activity_read on room_activity for select to authenticated
  using (room_id in (select my_room_ids()));

drop policy if exists room_preferences_own on room_notification_preferences;
create policy room_preferences_own on room_notification_preferences for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid() and room_id in (select my_room_ids()));

drop policy if exists room_invites_write on room_invites;
create policy room_invites_write on room_invites for insert to authenticated
  with check (inviter = auth.uid() and room_id in (select my_room_ids()));
drop policy if exists room_invites_update on room_invites;
create policy room_invites_update on room_invites for update to authenticated
  using (inviter = auth.uid() or invitee = auth.uid())
  with check (inviter = auth.uid() or invitee = auth.uid());

drop policy if exists room_pins_write on room_pins;
create policy room_pins_write on room_pins for all to authenticated
  using (pinned_by = auth.uid() and room_id in (select my_room_ids()))
  with check (pinned_by = auth.uid() and room_id in (select my_room_ids()));

create or replace function toggle_room_pin(p_room uuid, p_entry uuid)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from room_pins where room_id = p_room and entry_id = p_entry and pinned_by = auth.uid()) then
    delete from room_pins where room_id = p_room and entry_id = p_entry and pinned_by = auth.uid();
    return false;
  end if;
  if p_room not in (select my_room_ids()) then raise exception 'not a room member'; end if;
  insert into room_pins(room_id, entry_id, pinned_by) values (p_room, p_entry, auth.uid()) on conflict do nothing;
  return true;
end $$;

create or replace function record_room_activity(p_room uuid, p_kind text, p_entry uuid default null, p_metadata jsonb default '{}'::jsonb)
returns room_activity language plpgsql security definer set search_path = public as $$
declare a room_activity;
begin
  if p_room not in (select my_room_ids()) then raise exception 'not a room member'; end if;
  insert into room_activity(room_id, actor, kind, entry_id, metadata)
  values (p_room, auth.uid(), p_kind, p_entry, coalesce(p_metadata, '{}'::jsonb)) returning * into a;
  return a;
end $$;

create or replace function room_remove_member(p_room uuid, p_user uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from rooms where id = p_room and created_by = auth.uid()) then raise exception 'only the room owner can remove members'; end if;
  if p_user = auth.uid() then raise exception 'owner cannot remove themselves'; end if;
  delete from room_members where room_id = p_room and user_id = p_user;
  perform record_room_activity(p_room, 'leave', null, jsonb_build_object('removed', p_user));
end $$;

create or replace function room_transfer_owner(p_room uuid, p_user uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from rooms where id = p_room and created_by = auth.uid()) then raise exception 'only the room owner can transfer ownership'; end if;
  if not exists (select 1 from room_members where room_id = p_room and user_id = p_user) then raise exception 'new owner must be a room member'; end if;
  update rooms set created_by = p_user where id = p_room;
end $$;
