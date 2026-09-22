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
