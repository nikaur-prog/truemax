-- The counter is intentionally callable only through the server-side service
-- client. RLS with no policies already blocks rows, but explicit revocation
-- prevents future policy changes from accidentally turning aggregate traffic
-- into a browser-readable table. Restore only the service grants the API and
-- deployment probe require.

revoke all on table public.funnel_events from public, anon, authenticated;
grant select, insert, update on table public.funnel_events to service_role;

revoke all on function public.bump_funnel_event(text) from public, anon, authenticated;
grant execute on function public.bump_funnel_event(text) to service_role;
