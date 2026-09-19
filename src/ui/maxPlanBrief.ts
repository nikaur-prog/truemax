import { GOALS, loadProfile } from "../engine/goals.js";
import { activeScanOwner } from "../engine/scanScope.js";
import { onAuthChange } from "../engine/auth.js";
import { readProtocols } from "../engine/protocol.js";
import { cleanCoachPlanBrief, coachPlanQuestion, saveCoachPlanBrief } from "../engine/maxPlanBrief.js";
import "./maxRoutinePicker.css";

/** A review step before a billable chat turn, not another compulsory quiz. */
export function openMaxPlanBrief(onBuild: (question: string) => void): void {
  if (document.querySelector(".max-plan-brief")) return;
  const owner = activeScanOwner();
  if (!owner?.startsWith("user:")) return;
  const profile = cleanCoachPlanBrief(loadProfile());
  const previousFocus = document.activeElement as HTMLElement | null;
  const dialog = document.createElement("dialog");
  dialog.className = "max-routine-picker max-plan-brief";
  dialog.setAttribute("aria-labelledby", "max-plan-brief-title");
  dialog.innerHTML = `<form method="dialog">
    <span class="klabel">YOUR PLAN WITH MAX</span>
    <h2 id="max-plan-brief-title">What should we work on?</h2>
    <p>Pick up to three priorities. Max will suggest a short plan around these, then you choose which routines to track.</p>
    <fieldset class="max-plan-goals"><legend>Your priorities</legend></fieldset>
    <label class="max-plan-field">In your own words <small>Optional</small>
      <textarea name="goal" rows="2" maxlength="140" placeholder="What would make this useful to you?"></textarea>
    </label>
    <p class="max-plan-existing"></p>
    <label class="max-plan-field">Anything to work around? <small>Optional, for this chat</small>
      <textarea name="routine" rows="3" maxlength="170" placeholder="Products you already use, available time, budget, or advice you do not want."></textarea>
    </label>
    <p class="max-plan-privacy">Priorities are saved on this device. Your brief is sent to Max and saved with this chat. Nothing is started or completed automatically.</p>
    <p class="max-routine-status" role="status"></p>
    <footer><button type="button" data-cancel>Not now</button><button type="submit" data-save>Build my plan</button></footer>
  </form>`;
  const form = dialog.querySelector<HTMLFormElement>("form")!;
  const goals = dialog.querySelector<HTMLFieldSetElement>("fieldset")!;
  const goalText = dialog.querySelector<HTMLTextAreaElement>("[name=goal]")!;
  goalText.value = profile.endGoal.slice(0, 140);
  const routineText = dialog.querySelector<HTMLTextAreaElement>("[name=routine]")!;
  const status = dialog.querySelector<HTMLElement>("[role=status]")!;
  let pendingQuestion: string | null = null;
  const active = readProtocols().filter((p) => p.status === "running" || p.status === "committed");
  dialog.querySelector<HTMLElement>(".max-plan-existing")!.textContent = active.length
    ? `Already in your tracker: ${active.slice(0, 4).map((p) => p.title).join(", ")}${active.length > 4 ? ", and others" : ""}. Max will use that context.`
    : "No active routines in your tracker yet. You can tell Max what you already do below.";
  for (const goal of GOALS) {
    const label = document.createElement("label");
    const input = document.createElement("input");
    input.type = "checkbox";
    input.value = goal.id;
    input.checked = profile.goals.includes(goal.id);
    const span = document.createElement("span");
    span.textContent = goal.label;
    label.append(input, span);
    goals.append(label);
  }
  form.onsubmit = (event) => {
    event.preventDefault();
    if (activeScanOwner() !== owner) { dialog.close(); return; }
    const selected = [...goals.querySelectorAll<HTMLInputElement>("input:checked")].map((input) => input.value);
    if (selected.length > 3) { status.textContent = "Choose up to three priorities so the plan stays manageable."; return; }
    const brief = { goals: selected, endGoal: goalText.value, currentRoutine: routineText.value };
    if (!saveCoachPlanBrief(brief, owner)) {
      status.textContent = "Your priorities could not be saved. Check that device storage is available, then try again. No chat was sent.";
      return;
    }
    pendingQuestion = coachPlanQuestion(brief);
    dialog.close();
  };
  dialog.querySelector<HTMLButtonElement>("[data-cancel]")!.onclick = () => dialog.close();
  const unsubscribe = onAuthChange(() => { if (activeScanOwner() !== owner) dialog.close(); });
  dialog.addEventListener("close", () => {
    unsubscribe(); dialog.remove();
    if (activeScanOwner() !== owner) return;
    if (previousFocus?.isConnected) previousFocus.focus();
    // Complete native-dialog cleanup before the next modal takes focus.
    if (pendingQuestion !== null) onBuild(pendingQuestion);
  }, { once: true });
  document.body.append(dialog);
  dialog.showModal();
}
