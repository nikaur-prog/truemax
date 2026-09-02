-- Staff and owner are deliberately different roles.
--
-- app_admins remains the hand-granted staff list. Exactly one of those rows
-- may carry the note "owner"; only that identity opens Brand Engine and the
-- calibration corpus. A partial unique index is the database backstop against
-- accidentally promoting a second account in the SQL editor.
create unique index if not exists app_admins_single_owner_idx
  on public.app_admins ((lower(btrim(note))))
  where lower(btrim(note)) = 'owner';

comment on index public.app_admins_single_owner_idx is
  'Allows exactly one app_admins row to carry the owner role used by private creator tools.';
