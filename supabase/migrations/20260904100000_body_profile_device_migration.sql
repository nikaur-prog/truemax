-- The one-time device migration, as one conditional statement.
--
-- 20260903180000_body_profiles.sql is applied in production, so this is a
-- new file rather than an edit. The route used to read the row and then
-- upsert, which let two devices both read an empty row and the second
-- write win, and let a device value land on a row that already held one
-- of the two figures. This writes only where the row holds neither
-- figure, and the database decides that, not two round trips.

create or replace function public.migrate_body_profile(
  p_user_id uuid,
  p_height_cm numeric,
  p_weight_kg numeric,
  p_unit text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_unit not in ('metric', 'imperial') then
    raise exception 'Unknown unit preference';
  end if;
  insert into public.body_profiles (user_id, height_cm, weight_kg, unit_preference, source)
  values (p_user_id, round(p_height_cm, 1), round(p_weight_kg, 1), p_unit, 'device_migration')
  on conflict (user_id) do update
    set height_cm = excluded.height_cm,
        weight_kg = excluded.weight_kg,
        unit_preference = excluded.unit_preference,
        source = 'device_migration'
    where public.body_profiles.height_cm is null
      and public.body_profiles.weight_kg is null;
  return found;
end;
$$;

revoke all on function public.migrate_body_profile(uuid, numeric, numeric, text) from public, anon, authenticated;
grant execute on function public.migrate_body_profile(uuid, numeric, numeric, text) to service_role;
