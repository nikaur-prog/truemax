-- Account deletion now runs through /api/delete-account so an active Stripe
-- subscription is cancelled before the identity disappears. Leaving this old
-- SECURITY DEFINER RPC executable would let a signed-in user bypass that order.
revoke execute on function public.delete_own_account() from authenticated;
