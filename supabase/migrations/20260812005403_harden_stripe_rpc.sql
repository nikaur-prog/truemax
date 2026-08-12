-- The webhook RPC must bypass RLS, but it does not need a mutable schema in
-- its resolution path: every application object in the function is already
-- schema-qualified.
alter function public.apply_stripe_entitlement(
  text, text, timestamptz, uuid, text, text, text, text, text, timestamptz, boolean
) set search_path = '';
