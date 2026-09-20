# Calibration capture safeguards

These checks prevent silent collection mistakes. They do not establish anatomical accuracy, infer a person's sex, train the detector or change existing saved rows.

## Anonymous file hints

Only files following the anonymous pilot convention, for example `m01-front.png`, `f02-side.jpg` or `w2_side.webp`, suggest a Reference ID. The `w` alias normalises to `f`. Both views must suggest the same ID for automatic prefill. The operator can edit the suggestion. Unrecognised filenames, private labels and save-order row IDs never become identity evidence. No raw filename is saved or exported.

Hints are replaced only after a successful capture and are cleared on the next face, leaving calibration or changing account. A cancelled replacement does not change the prior captured view.

## Save-time warnings

Before a write, the latest owner-local saved set is checked for:

- a pilot Reference ID or recognised filename whose group differs from the selected men/women reference group;
- conflicting front/side filename identities, or a filename indicating the wrong view slot;
- an entered pilot Reference ID that differs from a recognised filename;
- one exact photo used in both view slots;
- an exact photo already present in any saved row, including across reference groups;
- a reused explicit Reference ID, including pilot aliases and retakes.

Photo matching uses original-file SHA-256 or a valid equal-dimension displayed-pixel fingerprint. It does not claim to recognise a face in different photos. Without hashes or recognised anonymous filenames, the UI cannot verify image identity automatically.

Warnings initially prevent saving and preserve the pending capture. The operator can correct the photos, ID or group, or explicitly confirm an intentional exception. A confirmation must acknowledge the current warning set; new warnings require another review. Changing the Reference ID clears confirmation. Confirmed exceptions are saved as separate rows, carry warning codes in the private diagnostic export, and are excluded from automatic score fitting. Existing rows are never replaced or deleted by this flow.

## Ratings remain separate

Blank ratings still save all capture diagnostics. External totals, unknown rating scopes, revised ratings and reviewed capture exceptions do not become independent front-only fitting labels. These safeguards do not retroactively relabel historical records or recover fields an older build did not save.
