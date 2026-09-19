# Routine history continuity

> Status, 11 September 2026: Private retained-history transfer and recent-sync retry are built locally. Automatic full historical cloud synchronization is not built. See the
> [current continuation handoff](CLAUDE_HANDOFF_2026-09-11.md) for branch preservation,
> verification evidence and the next execution order. Historical details below
> do not imply that the whole roadmap has shipped.

## Implemented without a database change

Settings now offers a private routine-only JSON download and a same-account import.
Import first shows the record, tick and check-in counts. Choosing a file or cancelling
does not write or upload anything. The explicit confirmation merges on the device.
The file contains an account identifier and self-reported routine data, not photos,
scan measurements, profile answers, chat messages or credentials. It is not encrypted;
the user should keep it private.

The format is versioned and labelled `device-retained-history`. This means all history
still retained on that device, not a lifetime-history guarantee. Previously discarded
ticks cannot be recovered. The existing `historyPartial` flag survives export/import;
merging does not claim that a partial record became complete. Conflicting answers at
the same check-in timestamp become unknown rather than arbitrarily choosing an answer.

Limits reject the entire import rather than truncate it: 2 MB per file, 40 routine
records, 5,000 tick dates and 2,000 check-ins per routine. Dates, catalogue definitions,
types and same-account ownership are validated. Duplicate catalogue actions merge,
the existing local identity remains stable, and completed/declined records remain
terminal tombstones. Import preserves recorded start dates but does not infer a new
start, record a new completion, count a streak day or award points. A subsequent daily
tick retains imported history up to the explicit 5,000-day bound; a capped record is
marked partial. Older versions retained at most 400 tick dates.

Routine writes now persist a separate owner-scoped retry queue for the existing
bounded cloud snapshot. Coach opening and ordinary routine actions retry through the
existing sync path; Settings also has an explicit retry button. Reads of conversation
history do not wait for a failed write. A successful response must acknowledge every
submitted identity with a valid snapshot. Server canonical state is merged locally
before acknowledging the queue. A newer queued revision is never cleared by an older
request, and terminal states cannot be revived by a stale pending snapshot. A 15-second
whole-operation deadline covers token lookup, fetch and body parsing; a late result
cannot clear pending work. No background scheduler or new cloud storage was added.

The existing cloud record still holds only lifecycle plus seven recent tick dates and
three recent answered check-ins. Its `max_plan_items.notes` constraint is 1,000
characters. The queue and Settings copy do not describe that as full historical sync.
Device storage failure can prevent creating the queue; the retained routine data is
not removed, and explicit Retry rebuilds the bounded snapshot from the current device
record. A private backup should be downloaded before clearing device storage.

## Full automatic cloud history: separate schema work still required

Do not spread opaque history fragments across chat notes or reuse consent-limited
face/goal-preview buckets. The minimal dedicated design should include:

1. Private, owner-scoped routine state with a stable catalogue identity, explicit
   lifecycle, source identity aliases for legacy/offline duplicates, history-coverage
   version and a compare-and-set revision. Completed/declined tombstones stay durable.
2. Tick rows unique by owner, routine and calendar day. Check-in rows have stable event
   identities and preserve unknown answers. Neither imported nor replicated evidence
   calls streak/points endpoints.
3. Owner-constrained select/insert/update policies, both `USING` and `WITH CHECK` on
   updates, least-privilege grants and account-deletion cascades. Client-supplied owner
   fields never authorize a request. Existing server authentication/entitlement policy
   must be reviewed explicitly, including access to history after a plan expires.
4. An atomic, idempotent merge operation, bounded batches and cursor-based pagination.
   A revision/coverage manifest prevents a partly downloaded archive from replacing a
   complete local history. Conflicts and partial uploads remain retryable; no blind
   whole-document last-writer-wins upload.
5. An explicit data-erasure design with a sync epoch/tombstone so an old offline device
   cannot re-upload data after a person deliberately deletes their cloud history.

This design has not been migrated, deployed or exercised against production. Before
implementation: agree retention/erasure requirements, generate a reviewed migration
with the Supabase CLI workflow, run schema/RLS advisors and cross-user query tests,
then verify crash recovery, duplicate imports, simultaneous device writes and deletion
against a local test database. It remains distinct from the private file transfer
implemented here.

## Verification

- `routineHistoryBackup.test.ts`: full retained history, partial flags, read-only
  preview, same-account validation, malformed/budget rejection, terminal/deduplicated
  merges, failed storage and no history loss on the next tick.
- `routineSyncQueue.test.ts` and `routineSyncClient.test.ts`: durable owner isolation,
  network/malformed-ack failures, unchanged snapshots, canonical response restoration,
  newer-revision acknowledgement races and stalled token/body deadlines.
- `node tools/routine-history-smoke.mjs http://127.0.0.1:4189`: isolated local desktop
  and mobile-width browser flow, real file preview/cancel/confirm/download, malformed
  JSON, explicit sync only, and account/sign-out events before local scope updates.
  This uses fixture authentication, not production accounts or physical iOS hardware.

Supabase guidance checked for this pass: [storage access controls](https://supabase.com/docs/guides/storage/security/access-control)
and [filtered updates](https://supabase.com/docs/reference/javascript/update), alongside
the current changelog. No relevant breaking change affected the existing scoped table
operations. No database or storage writes were performed during this implementation.
