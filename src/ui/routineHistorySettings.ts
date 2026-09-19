import { activeScanOwner } from "../engine/scanScope.js";
import { onAuthChange } from "../engine/auth.js";
import { routineSyncStatus } from "../engine/routineSyncQueue.js";
import { exportRoutineHistory, previewRoutineHistoryImport, importRoutineHistory, ROUTINE_BACKUP_MAX_BYTES } from "../engine/routineHistoryBackup.js";
import "./routineHistorySettings.css";

/** File reads remain local. Only explicit Retry sends the existing recent snapshot. */
export function mountRoutineHistorySettings(section: HTMLElement | null, userId: string): () => void {
  if (!section) return () => {};
  const owner = `user:${userId}`;
  let closed = false;
  let fileRead = 0;
  let pendingJson: string | null = null;
  const current = () => !closed && section.isConnected && activeScanOwner() === owner;
  section.innerHTML = `<h3>Routine history</h3>
    <p class="set-hint">Account sync includes routine status, the latest seven tick dates and three check-ins. It does not back up your full history. These private files preserve all routine history still retained on this device, including records marked incomplete.</p>
    <p class="set-hint">A backup contains your account identifier and routine records, not photos, measurements, profile answers or chat messages. Keep it private. Import it only into the same account. Previously discarded history cannot be recovered.</p>
    <div class="routine-history-actions"><button type="button" data-export>Download private backup</button><button type="button" data-import>Choose backup to import</button><button type="button" data-retry>Retry recent-history sync</button></div>
    <input type="file" accept="application/json,.json" data-file hidden>
    <p class="set-hint" data-sync></p><p role="status" data-status></p>
    <div class="routine-history-preview" hidden><p data-summary></p><p>Import merges records without removing existing routines. Completed and declined routines stay closed. No routine is started, no day is counted and no points are awarded.</p>
      <div class="routine-history-actions"><button type="button" data-confirm>Confirm import on this device</button><button type="button" data-cancel>Cancel import</button></div>
    </div>`;
  const status = section.querySelector<HTMLElement>("[data-status]")!;
  const preview = section.querySelector<HTMLElement>(".routine-history-preview")!;
  const input = section.querySelector<HTMLInputElement>("[data-file]")!;
  const retry = section.querySelector<HTMLButtonElement>("[data-retry]")!;
  const syncLine = section.querySelector<HTMLElement>("[data-sync]")!;
  const refreshSync = () => {
    const state = routineSyncStatus();
    syncLine.textContent = state === "pending" ? "Recent routine changes are waiting for account sync. Full history stays on this device."
      : state === "unavailable" ? "Pending sync could not be read. Download a private backup before clearing device data."
      : state === "signed-out" ? "Sign in to manage routine history."
      : "No queued recent-history changes on this device. This is not confirmation of a full cloud backup.";
  };
  const clearPreview = () => { pendingJson = null; preview.hidden = true; input.value = ""; };
  section.querySelector<HTMLButtonElement>("[data-export]")!.onclick = () => {
    if (!current()) return;
    try {
      const json = exportRoutineHistory(owner);
      const url = URL.createObjectURL(new Blob([json], { type: "application/json" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = `truemax-routine-history-${new Date().toISOString().slice(0, 10)}.json`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1_000);
      status.textContent = "Private backup download requested. Keep the file safe; it contains your routine history.";
    } catch (error) { status.textContent = error instanceof Error ? error.message : "The backup could not be created."; }
  };
  section.querySelector<HTMLButtonElement>("[data-import]")!.onclick = () => { if (current()) input.click(); };
  input.onchange = async () => {
    const revision = ++fileRead;
    const file = input.files?.[0];
    clearPreview();
    if (!file || !current()) return;
    try {
      if (file.size > ROUTINE_BACKUP_MAX_BYTES) throw new Error("Choose a routine backup no larger than 2 MB.");
      const json = await file.text();
      if (!current() || revision !== fileRead) return;
      const summary = previewRoutineHistoryImport(json, owner);
      section.querySelector<HTMLElement>("[data-summary]")!.textContent = `${summary.routines} routine records, ${summary.ticks} tick dates and ${summary.checkIns} check-ins. ${summary.newRoutines} new to this device. ${summary.partialHistories} records have incomplete history.`;
      pendingJson = json;
      preview.hidden = false;
      status.textContent = "Review the backup above. Nothing has been imported or uploaded.";
    } catch (error) {
      if (current() && revision === fileRead) status.textContent = error instanceof Error ? error.message : "This backup could not be read.";
    }
  };
  section.querySelector<HTMLButtonElement>("[data-cancel]")!.onclick = () => { ++fileRead; clearPreview(); status.textContent = "Import cancelled. Nothing was changed."; };
  section.querySelector<HTMLButtonElement>("[data-confirm]")!.onclick = () => {
    if (!current() || !pendingJson) return;
    try {
      importRoutineHistory(pendingJson, owner);
      clearPreview();
      refreshSync();
      status.textContent = routineSyncStatus() === "pending"
        ? "Routine history imported on this device. No points or new completions were recorded. Only recent evidence is queued for account sync."
        : "Routine history imported on this device. No points or new completions were recorded. Use Retry to send recent evidence; full history is not uploaded.";
    } catch (error) { status.textContent = error instanceof Error ? error.message : "The routine history could not be saved."; }
  };
  retry.onclick = async () => {
    if (!current()) return;
    retry.disabled = true;
    status.textContent = "Syncing recent routine evidence...";
    try {
      const { syncMaxPlanItems } = await import("../engine/maxConversations.js");
      if (!current()) return;
      await syncMaxPlanItems([]);
      if (current()) status.textContent = routineSyncStatus() === "pending"
        ? "Newer changes are still waiting. Retry again when your connection is steady."
        : "Recent routine evidence synced. Full historical records remain in device storage and your private backup.";
    } catch (error) { if (current()) status.textContent = error instanceof Error ? error.message : "Sync failed. Your device history is unchanged."; }
    finally { if (current()) { retry.disabled = false; refreshSync(); } }
  };
  const unsubscribe = onAuthChange((user) => {
    if (user?.id === userId && activeScanOwner() === owner) return;
    closed = true;
    ++fileRead; clearPreview();
    section.replaceChildren();
    section.textContent = "The signed-in account changed. Reopen Settings to manage its routine history.";
  });
  refreshSync();
  return () => { closed = true; ++fileRead; pendingJson = null; unsubscribe(); };
}
