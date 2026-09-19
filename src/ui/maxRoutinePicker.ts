import { loadProfile } from "../engine/goals.js";
import { readProtocols } from "../engine/protocol.js";
import { coachRoutineChoices, addSelectedCoachRoutine } from "../engine/maxRoutineChoices.js";
import { activeScanOwner } from "../engine/scanScope.js";
import { onAuthChange } from "../engine/auth.js";
import { buildCoachingSnapshot } from "../engine/maxContext.js";
import { announceMaxConversationChanged, syncMaxPlanItems } from "../engine/maxConversations.js";
import { productExampleFor } from "../engine/productDestinations.js";
import "./maxRoutinePicker.css";

export function openMaxRoutinePicker(onOpenPlan?: () => void): void {
  if (document.querySelector(".max-routine-picker")) return;
  const owner = activeScanOwner();
  if (!owner?.startsWith("user:")) return;
  const choices = coachRoutineChoices(loadProfile(), readProtocols());
  const dialog = document.createElement("dialog");
  dialog.className = "max-routine-picker";
  dialog.setAttribute("aria-labelledby", "max-routine-title");
  dialog.innerHTML = `<form method="dialog">
    <h2 id="max-routine-title">Choose what to track</h2>
    <p>These basic care routines match your selected goals. Choose the actions you want to try; Max's chat reply is not saved as a routine automatically. This picker does not create diet, body-composition or medicinal plans.</p>
    <div class="max-routine-options"></div>
    <p class="max-routine-status" role="status"></p>
    <footer><button type="button" data-cancel>Cancel</button><button type="button" data-save>Add selected routines</button></footer>
  </form>`;
  const options = dialog.querySelector<HTMLElement>(".max-routine-options")!;
  const status = dialog.querySelector<HTMLElement>(".max-routine-status")!;
  const save = dialog.querySelector<HTMLButtonElement>("[data-save]")!;
  let submitted = false;
  for (const rec of choices) {
    const label = document.createElement("label");
    const input = document.createElement("input");
    input.type = "checkbox";
    input.value = rec.id;
    const copy = document.createElement("span");
    const title = document.createElement("b");
    title.textContent = rec.title;
    const detail = document.createElement("small");
    detail.textContent = rec.what;
    copy.append(title, detail);
    const example = productExampleFor(rec.id);
    if (example) {
      const link = document.createElement("a");
      link.href = example.url;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.textContent = example.label;
      link.className = "max-routine-product";
      const note = document.createElement("small");
      note.textContent = `Optional example, not a required purchase. Manufacturer information (${example.region}); check suitability and the label.`;
      copy.append(link, note);
    }
    label.append(input, copy);
    options.append(label);
  }
  save.disabled = true;
  options.onchange = () => { save.disabled = !options.querySelector("input:checked"); };
  if (!choices.length) {
    status.textContent = "There are no new routine options for these goals. Existing and previously declined routines are not added again. You can review your goals and full plan from your scan report.";
    if (onOpenPlan) {
      const review = document.createElement("button");
      review.type = "button";
      review.textContent = "Open full plan";
      review.onclick = () => { dialog.close(); onOpenPlan(); };
      options.append(review);
    }
  }
  save.onclick = async () => {
    if (submitted) return;
    if (activeScanOwner() !== owner) { dialog.close(); return; }
    submitted = true;
    save.disabled = true;
    const selected = new Set([...options.querySelectorAll<HTMLInputElement>("input:checked")].map((input) => input.value));
    let added = 0;
    let failed = 0;
    for (const rec of choices.filter((item) => selected.has(item.id))) {
      const result = addSelectedCoachRoutine(rec);
      if (result === "failed") { failed++; continue; }
      if (result === "added") added++;
      const input = [...options.querySelectorAll<HTMLInputElement>("input")].find((item) => item.value === rec.id)!;
      input.disabled = true;
      input.checked = false;
    }
    status.textContent = `${added} routine${added === 1 ? "" : "s"} added. Confirm when you actually start in the Coach tracker. No completion or points were recorded.`;
    if (failed) {
      status.textContent = `${added ? `${added} saved. ` : ""}${failed} routine${failed === 1 ? " was" : "s were"} not saved. Device storage may be unavailable or full. Try again after checking storage; no completion or points were recorded.`;
      submitted = false;
      save.disabled = false;
      save.textContent = "Retry unsaved routines";
    } else {
      options.querySelectorAll<HTMLInputElement>("input").forEach((input) => { input.disabled = true; });
      save.hidden = true;
      dialog.querySelector<HTMLButtonElement>("[data-cancel]")!.textContent = "Done";
    }
    if (!added) return;
    announceMaxConversationChanged();
    try {
      await syncMaxPlanItems(buildCoachingSnapshot(loadProfile(), readProtocols()).routines);
    } catch {
      if (dialog.isConnected && activeScanOwner() === owner) status.textContent += " Saved on this device; account sync will retry when you open Coach or send a message.";
    }
  };
  dialog.querySelector<HTMLButtonElement>("[data-cancel]")!.onclick = () => dialog.close();
  const unsubscribe = onAuthChange(() => { if (activeScanOwner() !== owner) dialog.close(); });
  dialog.addEventListener("close", () => { unsubscribe(); dialog.remove(); }, { once: true });
  document.body.append(dialog);
  dialog.showModal();
}
