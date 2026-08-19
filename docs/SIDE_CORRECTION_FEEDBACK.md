# Side landmark correction feedback

TrueMax now treats automatic side-profile points as a draft, not a fact. The
person reviews all thirteen landmarks before the side analysis runs.

## User flow

1. A side photo is captured or uploaded.
2. TrueMax places thirteen points automatically and locks them for review.
3. **Points look right** confirms them unchanged. **Edit point placement**
   unlocks dragging, with **Reset automatic** and **Retake profile** available.
4. Impossible or missing point arrangements still fail the integrity guard.
5. After confirmation, a separate consent dialog asks whether this side photo,
   the automatic points and the confirmed points may be sent to TrueMax.
6. **No** creates no upload record and makes no feedback network request.
   **Yes** queues the feedback until the user is authenticated, then uploads it
   through a same-origin server route. The analysis continues if delivery
   fails.
7. A signed-in person can open **Settings → Correction feedback you've shared**
   to see submission and expiry dates. **Revoke and delete** removes that one
   review row immediately and deletes its private photo, or leaves the object
   in the protected cleanup queue if Storage is temporarily unavailable.

The front photo is never included. Consent to feedback does not affect the
score, account eligibility or membership.

## Private data path

- Browser: a JPEG side copy plus immutable `scan_id`, automatic points and
  corrected point coordinates.
- Server route: `POST`, `GET` and `DELETE /api/side-correction-feedback`, each
  requiring a valid Supabase access token and rejecting cross-origin access.
  `GET` returns only submission/scan IDs, consent version and lifecycle dates;
  it never returns landmarks, hashes, review notes or a photo path.
- Abuse guard: five new submissions per signed-in account per rolling 24 hours;
  a retry of the same submission ID remains idempotent.
- Database: `public.side_landmark_feedback`, linked by `user_id` and `scan_id`
  and inaccessible to `anon` and `authenticated` browser roles.
- Consent audit: `public.side_feedback_consent_events`, also service-only. It
  records grant/revoke/expire/delete events using pseudonymous submission and
  scan IDs, deliberately stores no `user_id`, and expires after at most 365
  days. Revocation ownership check, row deletion and its audit commit together.
- Storage: private JPEG-only bucket `side-correction-feedback`, with no browser
  Storage policy and a 2 MB object limit.
- Retention: feedback metadata and photo expire after 90 days. The daily
  protected cron removes expired objects and rows, records expiry, and purges
  expired audit events. Account deletion and per-submission revocation queue
  associated storage objects for the same cleanup route.

The base schema is in
`supabase/migrations/20260812034506_side_correction_feedback.sql`. Immutable
scan linkage is added by
`supabase/migrations/20260819090000_add_scan_id_to_side_feedback.sql`; deploy
all unapplied migrations before enabling submissions. Per-submission audit and
revocation are added by
`supabase/migrations/20260819100000_side_feedback_consent_audit.sql`.

## Required Vercel configuration

Add the Supabase server secret in Preview and Production, then redeploy. The
project URL is already present in both environments and the cron secret is
already present in Production:

```text
SUPABASE_URL=https://ruvgkrlfmixfnmnzqgap.supabase.co
SUPABASE_SECRET_KEY=<copy the project secret key from Supabase API settings>
CRON_SECRET=<generate a long random secret>
```

Do not prefix either secret with `VITE_`, paste it into chat, or commit it. A
legacy project can use `SUPABASE_SERVICE_ROLE_KEY` instead of
`SUPABASE_SECRET_KEY`, but the new secret key is preferred.

Verify the current Preview and Production values through `/api/health`; do not
infer current configuration from this repository or an older deployment note.

## Reviewing a correction

1. Open **Supabase → Table Editor → side_landmark_feedback** and filter
   `review_status = new`.
2. Start with `moved_point_ids`; it shows which of the thirteen labels changed.
3. Open **Storage → side-correction-feedback** and privately download the JPEG
   named by `storage_path`.
4. Compare `automatic_points` with `corrected_points`. Coordinates are stored
   normalized from 0 to 1, so they remain meaningful if the image is resized.
5. Set `review_status` to `reviewed`, `incorporated`, or `rejected` and add a
   short `review_notes` explanation.

To investigate a repeatable detector error with Codex, attach the downloaded
photo and a JSON export of that row to a TrueMax task. Treat the pair as private
face data: do not put it in Git, public issues, analytics, email newsletters or
training sets outside this explicitly consented review process.

## Pre-launch verification

- Confirm **No** produces no request to `/api/side-correction-feedback`.
- Confirm **Yes** while signed out survives Google/email auth and uploads once.
- Confirm a signed-in **Yes** creates one private object and one metadata row
  with the expected `user_id` and active `scan_id`, plus one pseudonymous
  `granted` event with no account identifier.
- Confirm direct anonymous table and bucket reads fail.
- As user A, confirm Settings lists only A's safe feedback metadata. Submit
  user B's IDs to A's DELETE request and confirm no row/object changes.
- Revoke A's own item and confirm the feedback row is gone, `revoked` is
  audited, and the private object is removed or present in the cleanup queue.
- Run the cleanup route with Vercel Cron authentication and confirm an expired
  test row removes both its object and metadata, records `expired`, and purges
  an audit event whose `retain_until` is in the past.
- Update the public privacy policy to name the optional side-photo feedback,
  its purpose, Supabase processing and 90-day maximum retention.
