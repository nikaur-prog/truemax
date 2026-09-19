# Response to Claude's five handoff questions

> Historical snapshot. See [the 19 September release status](RELEASE_CALIBRATION_2026-09-19.md)
> for current verification, publication state and operator instructions.
> Local/untracked status and transfer-package statements below apply to the
> 13 September inspection, not the current release.

13 September 2026. This is a local evidence/transfer check, not a deployment or
new implementation test run. No secrets or calibration data have been committed.

## 1. Handoff document

`docs/CLAUDE_HANDOFF_2026-09-11.md` exists in the local worktree and is included
as a standalone file in the transfer package. It is still untracked locally,
which explains why the GitHub URL did not provide the document. The missing
remote handoff was a delivery gap, not a reason to assume the remaining work was
already completed. Read the handoff plus this clarification before proceeding.

## 2. FaceIQ results actually available

There is no complete set of FaceIQ scores matched to the 20 synthetic pilot IDs
in the files inspected. Do not fabricate rows or match a celebrity report to an
unrelated pilot identity. The existing evidence is the owner's Rihanna and
Justin Bieber recordings/screenshots, summarized with timestamps in
`docs/FACEIQ_RECORDING_AUDIT_2026-09-09.md` (included).

Examples transcribed there include side gonial angles of 125.1 degrees with
9.7/10 for Rihanna and 120.2 degrees with 10.0/10 for Justin. These are metric
scores, not overall scores. The audit also identifies Harmony versus Features
versus overall scope mismatches. Use the complete audit and original recordings
to check context. They cannot stand in for pilot front/side/overall rows.

The examined FaceIQ account export contained photos plus IDs, gender, race and
creation dates, but no scores, measurements or landmark coordinates. Account
and billing metadata are not included in this transfer. See
`docs/FACEIQ_DATA_ACCESS_2026-09-09.md` (included).

What remains needed from the owner: exact same-photo reports for `f01` and
`m01` first, retaining front/side/overall scope, metric values and units,
reference settings and displayed ideal bands. Check those before repeating the
whole external set. There is no confirmed mapping from local corpus IDs such
as `m1` to pilot IDs such as `m01`; use an explicit mapping, not string guessing.

## 3. Local pilot diagnostics

Two original JSON files are included privately, unchanged:

- `truemax-baseline.json`: 7,351,146 bytes; SHA-256
  `426d22f0e0332a050963f87f2a3543a5ae0137f5213753e8439c402a0eebbc87`.
- `truemax-repeat.json`: 7,360,346 bytes; SHA-256
  `7d694b3b5fca82c0c5be3f7327899cf3d4ec7a4bc2abace164df116645f8cce7`.

The wrapper has `data` and `nonFiniteValues`. Within `data`, `records` contains
40 front/side rows, and `pairs` contains 20 merged diagnostic reports. Match on
`personId` (`f01`...`f10`, `m01`...`m10`) and `view`, or `key` such as
`f01-side`. Front rows contain 478 points; side rows contain 13. Reports contain
measurements, scores and reference definitions. `source.sha256` ties each row
to its original image. Non-finite or absent values must not become zero.

The repeat makes missing-value serialization more complete; numeric point and
score values match the baseline. These are automatic engineering runs, **not
the owner's human-reviewed calibration export**. The merged rows explicitly
say `automaticPointsVerified: false` and `diagnostic-unverified`. They predate
the current dirty build and do not demonstrate its full capture flow.

`DIAGNOSTIC_FINDINGS.md` is included privately. In particular, fifteen side
outputs repeat a template-derived 117.457752125-degree gonial angle. This is a
placement defect to investigate, not fifteen confirmations of anatomy. The
initial baseline and repeat must remain immutable.

The existing 40-image ZIP is separate:
`TrueMax-Calibration-Pilot-20-Pairs-2026-09-10-v2.zip` in the owner's Downloads folder.
These are synthetic identities, but private annotations and account metadata
still need care. Do not commit either raw diagnostic file or the face bundle.

## 4. Uncommitted code beyond 60158b0

Yes, substantially more than documentation. At initial inspection there were
70 tracked modified files and 69 untracked files. This clarification adds one
untracked document. The transfer manifest records the exact final list and
hashes. It includes changes to API handlers, coaching, routine continuity,
calibration, rendering, camera flow, the Max asset, tests and tools.

Worktree: the local `truemax-post-267-audit` checkout.
Branch: `codex/post-267-audit`.
Exact patch base: `60158b076cf91999ee1d8479727f2a591d21a75a`.

`uncommitted-changes.patch` includes tracked differences AND new files, including
the binary Max asset. It is generated without staging, committing or changing
the branch. The archive excludes `.git`, dependencies, environment files and
face photos. Diagnostics are in a separate data directory, outside the patch.

If Claude has access to the same Mac, use the existing worktree directly and
do not apply the patch over it. Otherwise use a separate clean checkout at the
exact base, inspect the patch and run `git apply --check` before applying.
The packaging process tests reconstruction in a disposable directory and checks
the resulting changed-file hashes. Never force it onto newer or dirty work.
Read `RESTORE.md` in the archive for the exact sequence.

Last full code gates were on 10 September: TypeScript/build/copy checks passed;
2,048 tests passed, zero failures, 28 skipped, one todo. That is historical
evidence, not a fresh full test run on 13 September. Re-run after integration.

## 5. Exact morph rollout switch and correction

The frontend switch is `import.meta.env.VITE_MORPH_PREVIEW === "1"` in
`src/ui/results.ts` (line 2594 at inspection). Missing or any other value means
off. It additionally requires Max entitlement, adulthood and a scan ID, and is
passed as `renderEnabled` to the create/recovery controls and handlers.
This is a Vite build-time value: inspect the correct Preview/Production and
branch-specific environment, then the resulting build. A local unset value
does not prove the deployed bundle is off.

**There is no matching server rollout kill switch in the inspected code.**
`api/morph-preview.ts` enforces authentication, entitlement, adulthood, consent,
valid input and quota, but does not consult `VITE_MORPH_PREVIEW`. An eligible
direct POST can therefore render if a provider is configured. Provider selection
in `api/_previewProvider.ts` uses `HF_CREDENTIALS` plus
`HIGGSFIELD_PREVIEW_ENDPOINT`, otherwise `OPENAI_API_KEY`. These are provider
dependencies, not rollout switches. No secret values are included here.

Correction to the earlier handoff: "rollout disabled" meant this work did not
enable the default-off frontend flag. It was **not a verified production state
or a claim that the backend cannot render**. No deployed environment or bundle
was inspected in this handoff check. Do not disable shared provider credentials
as a workaround. If a true kill switch is needed, implement and test a separate
server-side gate across both morph and legacy goal-preview endpoints, including
all routes that start provider work, before rollout.

Server atomic idempotency is also still required before broad paid generation:
two tabs/devices can both pass an empty saved-job search. Local recovery markers
prevent blind single-panel retries but are not a global duplicate-charge guard.
