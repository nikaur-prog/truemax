-- The application asked for work that a new account does not have yet.
--
-- apply_to_creator_league required between two and three links, and the form
-- enforced the same rule in front of it. That is a reasonable bar for an
-- established creator and an impossible one for the people the League most
-- needs early: somebody opening a fresh account to make TrueMax content has
-- nothing to link to, and the only thing the form could tell them was no.
--
-- Links are now optional, capped at three. Everything that protects the
-- product is unchanged: this is still a click-wrap record rather than an
-- arbitrary insert, it still demands the current terms version and both
-- explicit confirmations, and its definer privileges still do not make
-- approval self-serve. The founder reads every application either way, so an
-- empty links array costs a moment of judgement rather than a broken gate.
--
-- CREATE OR REPLACE keeps the signature. Permissions are nevertheless reset
-- explicitly below so this function never becomes callable by a browser role
-- merely because a previous environment had broader defaults.
create or replace function public.apply_to_creator_league(
  p_handle text,
  p_display_name text,
  p_niche text,
  p_links jsonb,
  p_pitch text,
  p_adult boolean,
  p_accept_terms boolean,
  p_terms_version text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := (select auth.uid());
begin
  if caller_id is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;
  if p_adult is distinct from true or p_accept_terms is distinct from true
     or p_terms_version is distinct from '2026-08-31' then
    raise exception 'Adult eligibility and current Creator League terms are required'
      using errcode = '22023';
  end if;
  -- Name, handle, 18+ and the terms stay required. They are the identity and
  -- the consent, and neither is something an applicant can be missing.
  --
  -- The links check keeps its CEILING and loses its floor: an array is still
  -- required so the column shape never varies, and three is still the most
  -- anybody can send, but zero is now a legitimate answer.
  if p_links is null or jsonb_typeof(p_links) <> 'array' then
    raise exception 'Invalid Creator League application' using errcode = '22023';
  end if;

  if nullif(btrim(p_handle), '') is null
     or nullif(btrim(p_display_name), '') is null
     or length(p_handle) > 60 or length(p_display_name) > 60
     or jsonb_array_length(p_links) > 3
     or coalesce(length(p_niche), 0) > 80
     or coalesce(length(p_pitch), 0) > 500 then
    raise exception 'Invalid Creator League application' using errcode = '22023';
  end if;

  -- The browser validates these too, but SECURITY DEFINER functions must not
  -- trust a crafted RPC body. Every element is a bounded https URL string.
  if exists (
    select 1
    from jsonb_array_elements(p_links) as link(value)
    where jsonb_typeof(link.value) <> 'string'
       or length(link.value #>> '{}') > 2048
       or (link.value #>> '{}') !~* '^https://[^[:space:]]+$'
  ) then
    raise exception 'Invalid Creator League application' using errcode = '22023';
  end if;

  insert into public.league_creators (
    user_id, handle, display_name, niche, links, pitch, status,
    league_terms_version, league_terms_accepted_at
  ) values (
    caller_id, btrim(p_handle), btrim(p_display_name), nullif(btrim(p_niche), ''),
    p_links, nullif(btrim(p_pitch), ''), 'applied',
    '2026-08-31', now()
  );
  return true;
end;
$$;

revoke all on function public.apply_to_creator_league(text, text, text, jsonb, text, boolean, boolean, text)
  from public, anon, authenticated;
grant execute on function public.apply_to_creator_league(text, text, text, jsonb, text, boolean, boolean, text)
  to authenticated;
