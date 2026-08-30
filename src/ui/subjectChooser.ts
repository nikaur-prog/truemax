// ---------------------------------------------------------------------------
// Whose face is this?
//
// The phone gets handed across a table. That is not an edge case, it is how
// this app spreads — and until now every scan taken that way landed in the
// owner's history as though it were their own face: their trend moved, their
// average moved, their streak extended, and Max talked about "your progress"
// over somebody else's jaw.
//
// The sex chooser already exists because of the same handover (a woman scored
// against male norms is a 0.7-to-4.5-point error). This asks the question one
// step earlier, and answering it earns the owner something: say "it's me" and
// there is nothing else to answer, because an account already knows its own
// details. Only a guest is asked anything, and only what a scan actually needs.
//
// ON THE OPTIONAL FIELD. Ethnicity here is SELF-REPORTED, optional, and never
// reaches the engine: it is not inferred from a photograph, and it does not
// select a different reference population or a different idea of what a good
// face is. There is one scale. It is collected so the reference set's own
// coverage can eventually be described honestly — "this set is mostly X" is a
// limitation worth being able to state — and for nothing else. A field that
// cannot be shown to change a score is the only version of this question worth
// asking.
// ---------------------------------------------------------------------------

export interface GuestSubject {
  name: string;
  ethnicity?: string;
}

export type SubjectAnswer = { self: true } | { self: false; subject: GuestSubject };

// Broad, self-selected, and explicitly skippable. Deliberately coarse: a long
// taxonomy implies the answer is load-bearing somewhere, and this one is not.
export const ETHNICITY_OPTIONS = [
  "African / Black",
  "East Asian",
  "South Asian",
  "Southeast Asian",
  "Middle Eastern / North African",
  "White / European",
  "Hispanic / Latino",
  "Pacific Islander",
  "Indigenous",
  "Mixed",
  "Prefer not to say",
] as const;

let host: HTMLDivElement | null = null;

export function closeSubjectChooser(): void {
  host?.remove();
  host = null;
}

/**
 * Ask who is being scanned. `onPick` runs once; `onCancel` if they back out.
 *
 * Callers only reach this when there is an account to compare against — a
 * signed-out visitor has no "you" for the question to mean anything against,
 * and asking would be one more screen between them and their first result.
 */
export type SelfLock = "declined" | "weekly" | null;

/**
 * Why "It's me" is closed, or null when it is open.
 *
 * The decline outranks the weekly limit when both apply, because it is the
 * larger fact and the more permanent one: telling somebody their week is up
 * when their own scans are closed indefinitely answers a smaller question
 * than the one they have.
 *
 * A pure function rather than a pair of reads at the call site, because the
 * precedence is the part worth pinning: the two callers must not disagree
 * about which sentence a person sees, and the weekly lock was added to close
 * a route around the gate rather than to change what a declined account is
 * told.
 */
export function selfLockFor(declined: boolean, guestOnly: boolean): SelfLock {
  if (declined) return "declined";
  if (guestOnly) return "weekly";
  return null;
}

export function openSubjectChooser(
  onPick: (answer: SubjectAnswer) => void,
  onCancel?: () => void,
  // How many other people this account may still scan this week. Undefined
  // means "not known here", which reads as no cap — the gate that does know is
  // the one that must refuse, and a chooser guessing would be worse than a
  // chooser staying quiet.
  guestsLeft?: number,
  // Why "It's me" is closed, or null when it is open. Two different facts
  // reach this chooser and they need two different sentences, so it carries a
  // reason rather than a boolean:
  //
  //   "declined"  this account turned down the trial. It keeps its scans and
  //               can still scan other people; what it gave up is scanning
  //               ITSELF, which is the consequence the decline sheet named.
  //   "weekly"    the personal scan for this week is already spent, and they
  //               arrived here from the gate's "scan someone else instead".
  //               The gate closed on the self scan; the chooser must not
  //               reopen it.
  selfLock?: SelfLock,
): void {
  closeSubjectChooser();
  const el = document.createElement("div");
  host = el;
  el.className = "subjpick";
  el.innerHTML = `
    <div class="subjpick-card" role="dialog" aria-modal="true" aria-labelledby="subj-h">
      <button class="subjpick-cancel" type="button" aria-label="Cancel">✕</button>
      <div class="subjpick-step" data-step="who">
        <h2 id="subj-h">Who's getting scanned?</h2>
        <p>Only your own scans count toward your progress, so a friend's face never moves your trend.</p>
        <div class="subjpick-opts">
          <button class="subjpick-opt" data-who="me" type="button"${selfLock ? " disabled" : ""}>
            <b>It's me</b><span>${selfLock === "declined"
              ? "You turned down the trial, so your own scans are closed"
              : selfLock === "weekly"
                ? "This week's scan of your own face is already used"
                : "Counts toward your progress"}</span>
          </button>
          <button class="subjpick-opt" data-who="other" type="button"${guestsLeft === 0 ? " disabled" : ""}>
            <b>Someone else</b><span>${guestsLeft === 0
              ? "You have used this week's scans of other people"
              : "Saved separately, kept off your chart"}</span>
          </button>
        </div>
      </div>
      <div class="subjpick-step hidden" data-step="guest">
        <h2>Who are you scanning?</h2>
        <p>A label for this scan on this device. It is never uploaded and never matched against anything.</p>
        <input class="q-input" id="subj-name" maxlength="40" placeholder="Their name" autocomplete="off" />
        <label class="subjpick-label" for="subj-eth">Background <em>optional</em></label>
        <select class="q-input" id="subj-eth">
          <option value="">Prefer not to say</option>
          ${ETHNICITY_OPTIONS.filter((o) => o !== "Prefer not to say")
            .map((o) => `<option value="${o}">${o}</option>`)
            .join("")}
        </select>
        <p class="subjpick-note">This does not change a single measurement. There is one scale, and it is the same one for everybody: it is recorded so we can describe honestly who the reference set actually covers.</p>
        <div class="subjpick-actions">
          <button class="btn gho" data-back type="button">Back</button>
          <button class="btn pri" data-go type="button">Continue</button>
        </div>
      </div>
    </div>`;

  const step = (id: "who" | "guest") => {
    for (const s of el.querySelectorAll<HTMLElement>(".subjpick-step")) {
      s.classList.toggle("hidden", s.dataset.step !== id);
    }
    if (id === "guest") setTimeout(() => el.querySelector<HTMLInputElement>("#subj-name")?.focus(), 80);
  };

  let done = false;
  const finish = (a: SubjectAnswer) => {
    if (done) return;
    done = true;
    closeSubjectChooser();
    document.removeEventListener("keydown", onKey);
    onPick(a);
  };
  const cancel = () => {
    if (done) return;
    done = true;
    closeSubjectChooser();
    document.removeEventListener("keydown", onKey);
    onCancel?.();
  };

  for (const b of el.querySelectorAll<HTMLButtonElement>("[data-who]")) {
    b.onclick = () => (b.dataset.who === "me" ? finish({ self: true }) : step("guest"));
  }
  el.querySelector<HTMLButtonElement>("[data-back]")!.onclick = () => step("who");
  el.querySelector<HTMLButtonElement>("[data-go]")!.onclick = () => {
    const name = el.querySelector<HTMLInputElement>("#subj-name")!.value.trim();
    const ethnicity = el.querySelector<HTMLSelectElement>("#subj-eth")!.value || undefined;
    // An unnamed guest is still a guest: the point of the flag is keeping the
    // scan off the owner's chart, and that must not depend on typing a name.
    finish({ self: false, subject: { name: name || "Guest", ethnicity } });
  };
  el.querySelector<HTMLButtonElement>(".subjpick-cancel")!.onclick = cancel;
  el.onclick = (e) => { if (e.target === el) cancel(); };
  const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") cancel(); };
  document.addEventListener("keydown", onKey);

  document.body.appendChild(el);
  requestAnimationFrame(() => el.classList.add("in"));
}
