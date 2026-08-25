import type { NormalizedLandmark } from "@mediapipe/tasks-vision";
import { initLandmarker, isReady, setRunningMode } from "./engine/landmarker.js";
import { detectStable } from "./engine/consensus.js";
import { assessQuality } from "./engine/quality.js";
import type { QualityCheck } from "./engine/quality.js";
import { analyze, analyzeFrames, REGION_NAMES } from "./engine/scoring.js";
import type { CaptureFrame } from "./engine/scoring.js";
import { POSE_CALIBRATION, buildGeometry, landmarkIntegrityIssues } from "./engine/geometry.js";
import { extractShape, shapeSubset } from "./engine/shape.js";
import {
  compareAndStore,
  ownScans,
  readAllHistory,
  readOwnComparableHistory,
  scanStorageKey,
} from "./engine/history.js";
import { paintHeadline, pickHeadline } from "./ui/landingHeadline.js";
import { pruneTo, savePhotos, toThumb } from "./engine/photoStore.js";
import { maybeAdoptAvatar } from "./engine/avatar.js";
import { toCelebEntry } from "./engine/celebs.js";
import { readOrientation } from "./engine/exif.js";
import type { Report, Sex } from "./engine/types.js";
import { drawLandmarksAnimated, drawCalm } from "./ui/overlay.js";
import { clearResultsIdentityState, renderResults, setAdult, setDepth, setMaxAccess } from "./ui/results.js";
import { clearScoreStrip } from "./ui/scoreStrip.js";
import { unmountMaxPet } from "./ui/maxPet.js";
import { closeMaxChat } from "./ui/maxChat.js";
import { closeScanGate, ensureScanAllowed, recordScanRun } from "./ui/scanGate.js";
import { setMemberPricing } from "./engine/scanPricing.js";
import { mountGateDemo } from "./ui/gateDemo.js";
import { enablePhotoPaste, pasteHintApplies } from "./ui/pastePhoto.js";
import { mergeReports } from "./engine/scoring.js";
import { openSideAdjust, openSideCapture, close as closeSide } from "./ui/sideFlow.js";
import { openFrontEdit } from "./ui/frontEdit.js";
import { analyzeSide } from "./engine/scoring.js";
import type { SidePoints } from "./engine/sideMetrics.js";
// The scan narration quotes these counts. Read from the arrays rather than
// typed into the string: the side list said 15 for months after the
// experimental metrics were filtered out and the real number became 10.
import { SIDE_METRICS } from "./engine/sideMetrics.js";
import { METRICS } from "./engine/metrics.js";
import { submitSideCorrectionFeedback } from "./engine/sideFeedback.js";
import type { SideFeedbackIntent, SideSeedMethod } from "./engine/sideFeedbackPayload.js";
import { isSupported, overrideGlasses, resetGlassesOverride, startCamera } from "./ui/camera.js";
import { mountDemoReel } from "./ui/demoReel.js";
import { closeHistory, openHistory } from "./ui/historyView.js";
import { loadPhotos } from "./engine/photoStore.js";
import { createSettler } from "./engine/captureSettle.js";
import { mountAccountButton, openAccount } from "./ui/authModal.js";
import { currentUser, isAuthAvailable, onAuthChange } from "./engine/auth.js";
import { consumeScanCredit, hasMaxAccess, loadEntitlement, loadIsAdmin, loadScanCredits } from "./engine/entitlement.js";
import { TRIAL_SCANS, depthFor, freeScansLeft, tierOf } from "./engine/depth.js";
import type { User } from "@supabase/supabase-js";
import { revealSideScan } from "./ui/sideScan.js";
import { openSexChooser } from "./ui/sexChooser.js";
import { openSubjectChooser } from "./ui/subjectChooser.js";
import { loadProfile, saveProfile } from "./engine/goals.js";
import { createAutoCapture } from "./ui/autoCapture.js";
import type { AutoCapture } from "./ui/autoCapture.js";
import { close as closeDashboard, openDashboard } from "./ui/dashboard.js";
import { mountFaceOutline } from "./ui/faceOutline.js";
import type { CameraHandle } from "./ui/camera.js";
import { stillFrameStats } from "./engine/captureGuide.js";
import type { FrameCheck } from "./engine/captureGuide.js";
import { estimateGaze } from "./engine/gaze.js";
import { analyzeSkin } from "./engine/skin.js";
import { storeSex, storedSex } from "./engine/sexPref.js";
import { offerTutorial, playTutorial, tutorialSuppressed } from "./ui/photoTutorial.js";
import { detectOcclusion } from "./engine/occlusion.js";
import { frontPhotoRejection, frontPhotoWarnings, landmarkBox } from "./engine/photoEligibility.js";
import { headCoveringRejection } from "./engine/photoEligibility.js";
import { detectHeadCovering } from "./engine/headCovering.js";
import { REGION_LANDMARKS } from "./ui/regions.js";
import {
  claimPendingAnalysis,
  clearExpiredPendingAnalysis,
  clearPendingAnalysis,
  drawStoredPhoto,
  savePendingAnalysis,
} from "./engine/pendingAnalysis.js";
import { activateScanOwner, activeScanOwner } from "./engine/scanScope.js";
import { ScanSession } from "./engine/scanSession.js";
import type { ScanSource, ScanToken } from "./engine/scanSession.js";
import {
  brandClass,
  membershipBrand,
  MEMBERSHIP_BRAND_EVENT,
} from "./ui/membershipBrand.js";
import type { MembershipBrand } from "./ui/membershipBrand.js";
import { closeTrialFunnel, openTrialFunnel, openTrialFunnelPreview } from "./ui/onboardingFunnel.js";
import { flushPendingProfile, loadOnboardingProfile, onboardingComplete, profileIsAdult } from "./engine/onboarding.js";
import { closeSettings, openSettings } from "./ui/settings.js";
import { track } from "./engine/track.js";
import { markPlatform } from "./engine/platform.js";

const MAX_IMAGE_DIM = 1280;

// Torn down whenever the gate is replaced, so a stale reel cannot keep painting
// into a canvas that is no longer on the page.
let gateDemo: { stop(): void } | null = null;

// Read the entitlement and tell the results screen. Never throws: a billing
// read that fails leaves the plan locked, which is the safe direction — it
// shows a paywall to a paying customer, who can retry, rather than handing the
// paid product to everyone the moment Supabase has a bad minute.
async function refreshMaxAccess(): Promise<void> {
  const owner = activeScanOwner();
  const generation = scanGeneration;
  // The scan count comes from local history rather than the account, because it
  // is not a billing fact: it decides how much of the analysis to show, not
  // what anyone is charged. Reading it from the device keeps a free allowance
  // working before there is anything on the server to read.
  const scanCount = readAllHistory().length;
  try {
    // Credits and the staff flag each fall back to "no" on their own failure,
    // so one unreachable table cannot take the whole entitlement read down with
    // it — and both fail in the locked direction.
    const [entitlement, credits, admin] = await Promise.all([
      loadEntitlement(),
      loadScanCredits().catch(() => 0),
      loadIsAdmin().catch(() => false),
    ]);
    if (owner !== activeScanOwner() || generation !== scanGeneration) return;
    setMaxAccess(hasMaxAccess(entitlement) || admin);
    // Which of the two scan prices this account is quoted, everywhere it is
    // quoted. A live subscription of any tier is a member.
    setMemberPricing(tierOf(entitlement) !== "free");
    setDepth(
      depthFor({ entitlement, scanCount, credits, admin }),
      freeScansLeft({ entitlement, scanCount }),
    );

    // A credit is consumed by the scan it unlocked: free tier, past the
    // allowance, holding credits, looking at a full-depth result. Recorded
    // fire-and-forget — a spend that fails to record is a free scan, which is
    // the survivable direction of that error, where blocking a paid-for result
    // on the recording is not.
    // Staff excluded: a credit must not be spent on a scan the staff flag
    // already opened.
    if (!admin && tierOf(entitlement) === "free" && scanCount > TRIAL_SCANS && credits > 0) {
      void consumeScanCredit().catch(() => undefined);
    }
  } catch {
    if (owner !== activeScanOwner() || generation !== scanGeneration) return;
    // Both fail closed. A wall shown to a paying customer is recoverable — they
    // retry — where the paid product handed to everybody during an outage is
    // not.
    setMaxAccess(false);
    // The standard price, for the same reason: quoting the member price to
    // somebody we could not confirm is a member sets up a charge that does not
    // match what they were shown.
    setMemberPricing(false);
    setDepth(depthFor({ entitlement: null, scanCount }), freeScansLeft({ entitlement: null, scanCount }));
  }
}

markPlatform();
// Which build this browser is running, in the footer. Diagnostic only, and it
// exists because "the fix is not showing" and "the fix is not deployed" look
// identical from a screenshot otherwise.
const stamp = document.getElementById("build-stamp");
if (stamp) stamp.textContent = __BUILD__;
track("visit");

if (import.meta.env.DEV) {
  const preview = new URLSearchParams(location.search).get("preview");
  if (preview === "funnel" || preview === "offer" || preview === "offer-minor") {
    queueMicrotask(() => void openTrialFunnelPreview(preview !== "offer-minor", preview !== "funnel"));
  }
  // The dashboard is behind a sign-in, so the only way to look at it during
  // development — or to drive its tabs in a browser check — was to hold a real
  // account. Dev builds only: Vite folds import.meta.env.DEV to false for
  // production, so this whole block is removed from the shipped bundle.
  if (preview === "dash") {
    activateScanOwner(null);
    queueMicrotask(() =>
      // onSettings is a no-op here, but passing it makes the preview render
      // the profile button — which is where the avatar lives, and the whole
      // reason to look at this screen in a browser check.
      // adult: true so the preview also shows the Max tab's locked state,
      // which is the harder of its two rooms to reach with a real account.
      openDashboard({ onScan: () => {}, name: "Sam", membership: "member", onSettings: () => {}, adult: true }),
    );
  }
}

// Dev only: run a real scan straight through to the results screen.
//
// `authEnv()` falls back to a built-in project when no keys are configured, so
// isAuthAvailable() is true in every environment and a signed-out scan always
// stops at the account gate. The consequence is not a minor inconvenience: it
// means NO browser check has ever been able to reach the tabbed report, on any
// machine, without someone holding a real account and typing a password into
// it. Every region tab, every hover overlay and every population line in there
// has therefore only ever been verified by reading the source.
//
// Same shape and the same guarantee as the dashboard preview above: Vite folds
// import.meta.env.DEV to false for production, so this constant is `false` at
// build time and the branch that reads it is dropped from the shipped bundle.
const DEV_OPEN_REPORT =
  import.meta.env.DEV && new URLSearchParams(location.search).get("preview") === "report";

const el = {
  engineStatus: document.getElementById("engine-status")!,
  upload: document.getElementById("v-upload")!,
  main: document.getElementById("v-main")!,
  fileInput: document.getElementById("file-input") as HTMLInputElement,
  ovalFrame: document.getElementById("oval-frame")!,
  camVideo: document.getElementById("cam-video") as HTMLVideoElement,
  camGuide: document.getElementById("cam-guide") as HTMLCanvasElement,
  camHint: document.getElementById("cam-hint")!,
  camHintTitle: document.getElementById("cam-hint-title")!,
  camHintDetail: document.getElementById("cam-hint-detail")!,
  btnCamera: document.getElementById("btn-camera") as HTMLButtonElement,
  btnUpload: document.getElementById("btn-upload") as HTMLButtonElement,
  btnCancel: document.getElementById("btn-cancel") as HTMLButtonElement,
  btnNoGlasses: document.getElementById("btn-noglasses") as HTMLButtonElement,
  reelCanvas: document.getElementById("reel-canvas") as HTMLCanvasElement,
  outlineCanvas: document.getElementById("outline-canvas") as HTMLCanvasElement,
  reelScore: document.getElementById("reel-score")!,
  reelName: document.getElementById("reel-name")!,
  stage: document.getElementById("capture-stage")!,
  camLight: document.getElementById("cam-light")!,
  camLamp: document.getElementById("cam-lamp")!,
  camLampFill: document.getElementById("cam-lamp-fill")!,
  frame: document.getElementById("frame")!,
  zoomable: document.getElementById("zoomable")!,
  photoCanvas: document.getElementById("photo-canvas") as HTMLCanvasElement,
  overlayCanvas: document.getElementById("overlay-canvas") as HTMLCanvasElement,
  capRight: document.getElementById("capRight")!,
  status: document.getElementById("status")!,
  barFill: document.getElementById("barFill")!,
  qualityChips: document.getElementById("quality-chips")!,
  analysis: document.getElementById("analysis")!,
};

// The reference population, chosen by the user and remembered on the device.
//
// It used to be inferred from face shape. That was the right instinct — a
// decision in front of the only thing that matters is a cost — but the
// inference turned out to be 58.8% accurate on held-out faces against a 54.1%
// base rate, while the choice itself moves the score by a median of 0.70 points
// and up to 4.50. sexPref.ts has the measurements. One tap beats that.
// The caption lives in a span beside an inline SVG, so writing textContent on
// the button itself would silently delete the icon. Every caption change goes
// through here instead.
function setCameraLabel(text: string): void {
  const label = document.getElementById("btn-camera-label");
  if (label) label.textContent = text;
}

let selectedSex: Sex = storedSex() ?? "male";
// Set when the current scan is of somebody other than the account holder, and
// carried through to the stored row so progress can exclude it.
let scanSubject: { name: string } | null = null;
// One-pass waiver of the head-covering heuristic, set by the "nothing
// covering your face" button on its rejection screen and consumed by the very
// next handleCanvas run. Never persisted: the next SCAN checks again.
let skipCoveringCheck = false;
// Whether the "who is this?" question was actually put to a signed-in person
// this scan. scanSubject === null is ambiguous on its own — it means "the
// owner" AND "never asked" — and the difference matters at the account gate: a
// scan captured signed-out never asked, and attributing it to whoever then
// signs in would put a friend's face in the owner's history.
let subjectAsked = false;
// Whether the reference population is a real choice yet, or still the silent
// default. A face app is used mostly by young men, so "male" is the right
// default to compute against — but computing a man a percentile "of women"
// because he never saw the toggle is the kind of thing that gets screenshotted.
// So the first scan requires the pick; a returning visitor who already chose is
// never asked again.
let sexChosen = storedSex() !== null;

// How the front photo was obtained, carried into the side step so the two
// halves of one scan use the same capture method. If you shot the front with
// the camera, the side opens the camera; if you uploaded the front, the side
// asks for a file. Null until the first capture.
let captureMethod: "camera" | "upload" | null = null;

// Changes whenever a scan is abandoned or identity changes. Async work keeps
// the generation it started under and drops its result if this value moves, so
// an old animation/upload cannot repaint the next person's screen.
let scanGeneration = 0;
const scanSession = new ScanSession();

function beginScan(source: Exclude<ScanSource, "restored">): ScanToken | null {
  const owner = activeScanOwner();
  if (!owner) return null;
  return scanSession.begin(owner, source);
}

function scanIsCurrent(token: ScanToken, generation: number): boolean {
  return generation === scanGeneration && scanSession.isCurrent(token);
}

// Calibration harness API (tools/): lets the offline pipeline measure photos
// directly, skipping the UI and its scan animation. Same engine path as a
// real scan — detect, assess, analyze — so results are identical.
(window as unknown as Record<string, unknown>).__truemaxPose = POSE_CALIBRATION;
(window as unknown as Record<string, unknown>).__truemaxMeasure = async (
  dataUrl: string,
  sex: Sex,
) => {
  const img = await new Promise<HTMLImageElement>((res, rej) => {
    const i = new Image();
    i.onload = () => res(i);
    i.onerror = () => rej(new Error("bad image"));
    i.src = dataUrl;
  });
  const s = Math.min(1, MAX_IMAGE_DIM / Math.max(img.naturalWidth, img.naturalHeight));
  const w = Math.round(img.naturalWidth * s);
  const h = Math.round(img.naturalHeight * s);
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  c.getContext("2d")!.drawImage(img, 0, 0, w, h);

  const res = detectStable(c);
  const quality = assessQuality(res);
  if (!quality.faceFound) return { faceFound: false };
  const landmarks = res.faceLandmarks[0];
  const faceBox = landmarkBox(landmarks);
  const stats = stillFrameStats(c, faceBox);
  const occlusion = detectOcclusion(c, landmarks, w, h);
  const eligibility = frontPhotoRejection(quality, stats, occlusion, landmarks, w, h);
  const report = analyze(landmarks, w, h, sex, c);
  return {
    faceFound: true,
    overall: report.overall,
    potential: report.potential,
    yaw: quality.yawDeg,
    pitch: quality.pitchDeg,
    smile: quality.smileScore,
    gaze: estimateGaze(landmarks),
    skin: analyzeSkin(c, landmarks, w, h),
    occlusion,
    photo: { eligible: eligibility === null, rejection: eligibility, ...stats },
    // Group shots are the main contaminant in scraped photo sets: the
    // detector locks onto whichever face it finds, which may not be the
    // subject. A face filling little of the frame is the tell.
    faceWidthFrac: quality.faceWidthFrac,
    entry: JSON.parse(toCelebEntry(report, "x")),
    zScores: report.zScores,
    shape: extractShape(buildGeometry(landmarks, w, h)),
    pillars: report.pillars,
    // Per-region score plus the centroid of that region's landmarks, so the
    // demo reel can point a callout at the actual spot on the face
    regions: report.regions.map((r) => {
      const ids = REGION_LANDMARKS[r.region];
      const lm = landmarks;
      let sx = 0, sy = 0;
      for (const i of ids) { sx += lm[i].x; sy += lm[i].y; }
      return {
        id: r.region,
        score: r.score,
        x: +(sx / ids.length).toFixed(4),
        y: +(sy / ids.length).toFixed(4),
      };
    }),
    // Outline points + face box for the landing-page reel builder
    reelLandmarks: shapeSubset().map((i) => [
      +res.faceLandmarks[0][i].x.toFixed(4),
      +res.faceLandmarks[0][i].y.toFixed(4),
    ]),
    reelBox: (() => {
      const lm = res.faceLandmarks[0];
      let x0 = 1, x1 = 0, y0 = 1, y1 = 0;
      for (const p of lm) { x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y); }
      return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
    })(),
  };
};
(window as unknown as Record<string, unknown>).__truemaxMeasureFull = (
  window as unknown as Record<string, unknown>
).__truemaxMeasure;

// The idle frame runs the demo reel — real scans of public-domain portraits.
mountDemoReel(el.reelCanvas, el.reelScore, el.reelName);

// The docked demo neither pins nor shrinks. Both were tried, the resize was
// re-tuned twice, and it still read as choppy on a real phone — a card that
// changes size under a moving thumb is fighting the scroll rather than riding
// it, and an interrupted 0.4s transition looks like jank whatever the
// thresholds do. It keeps one size, the big one, and scrolls with the page.
el.ovalFrame.classList.add("showing-reel");

// A build without accounts still needs an explicit anonymous owner. When Auth
// is enabled, reads remain closed until INITIAL_SESSION resolves below.
if (!isAuthAvailable()) activateScanOwner(null);

// A returning visitor with scans on this device sees the last three of them,
// as pictures and dates, rather than a link to a screen that has them. Hidden
// entirely when there is nothing to show, so a first-time visitor never sees a
// dead link or an empty shelf.
//
// The photos are per-owner and live in IndexedDB, so this can only fill in once
// identity has resolved — which is why it is called from the auth callback as
// well as at boot. Scans taken before thumbnails shipped have no picture and
// get their score in place of one; that is a real state, not an error, and it
// is worth showing rather than hiding the row over.
const RECENT_ON_LANDING = 3;
const landingRecent = document.getElementById("landing-recent");
const landingRecentRow = document.getElementById("landing-recent-row");
// The tutorial is reachable from the capture frame whether or not it was
// suppressed — playTutorial rather than offerTutorial, because someone who has
// just tapped an "i" has already answered the question offerTutorial asks.
document.getElementById("cam-info")?.addEventListener("click", () => {
  playTutorial("front", tutorialSuppressed("front"), () => {});
});
document.getElementById("side-info")?.addEventListener("click", () => {
  playTutorial("side", tutorialSuppressed("side"), () => {});
});

const landingHistory = document.getElementById("landing-history");

let recentPaintToken = 0;
function syncLandingHistory(): void {
  // "Your last scans", literally: a guest's scan is a record in the history
  // panel, labelled with their name — but this row has no labels, just a face
  // and a score, and an unlabelled friend here read as the owner's own result.
  const scans = ownScans(readAllHistory()).slice(0, RECENT_ON_LANDING);
  landingRecent?.classList.toggle("hidden", scans.length === 0);
  if (!landingRecentRow || !scans.length) return;

  const token = ++recentPaintToken;
  landingRecentRow.innerHTML = scans
    .map(
      (s) => `<button class="recent-card" data-key="${escapeAttr(scanStorageKey(s))}" type="button">
        <span class="recent-shot"><b>${s.overall.toFixed(1)}</b></span>
        <span class="recent-when">${shortDate(s.date)}</span>
      </button>`,
    )
    .join("");

  for (const card of landingRecentRow.querySelectorAll<HTMLElement>(".recent-card")) {
    card.onclick = () => openHistory();
    const shot = card.querySelector(".recent-shot");
    const key = card.dataset.key;
    if (!shot || !key) continue;
    void loadPhotos(key).then((p) => {
      // A later repaint may have replaced this row while the read was in
      // flight; writing into a detached node would be harmless but writing
      // into a REPLACED one would show the wrong face against the wrong date.
      if (token !== recentPaintToken || !shot.isConnected) return;
      const src = p?.front ?? p?.side;
      if (src) shot.innerHTML = `<img src="${src}" alt="" />`;
    });
  }
}

function shortDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

function escapeAttr(s: string): string {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
  );
}

syncLandingHistory();

// The rotating headline. See ui/landingHeadline.ts for which lines exist and
// why none of them claims a result.
//
// The counter is an unscoped key on purpose. It records how many times this
// browser has opened the page and nothing else — no score, no identity, nothing
// that would mean anything to a second person on the same device — so scoping
// it per owner would buy no privacy and would instead restart the rotation
// every time somebody signs in, which is the one moment the page most wants to
// look like it has moved on.
const VISIT_KEY = "truemax:landing-visits";

function nextVisit(): number {
  try {
    const seen = Number(localStorage.getItem(VISIT_KEY) ?? 0);
    const next = Number.isFinite(seen) ? Math.abs(Math.trunc(seen)) + 1 : 1;
    localStorage.setItem(VISIT_KEY, String(next % 1000));
    return next - 1; // this visit's index; a first-ever visit is 0
  } catch {
    return 0; // private mode, storage disabled — always the opening line
  }
}

// Read once per page load, not per auth change: signing in should re-personalise
// the current headline, not advance to the next one.
const thisVisit = nextVisit();

function syncLandingHeadline(name: string | null): void {
  const h1 = document.querySelector<HTMLElement>("#v-upload h1");
  if (!h1) return;
  // The headline counts YOUR scans and dates YOUR last one. Scans taken of
  // other people on this phone are records, not progress.
  const scans = readOwnComparableHistory();
  const newest = scans[0]; // handed back newest first
  const daysSinceLastScan = newest
    ? Math.floor((Date.now() - new Date(newest.date).getTime()) / 86_400_000)
    : null;
  paintHeadline(
    h1,
    pickHeadline({
      name,
      scanCount: scans.length,
      daysSinceLastScan: Number.isFinite(daysSinceLastScan!) ? daysSinceLastScan : null,
      visit: thisVisit,
    }),
  );
}
landingHistory?.addEventListener("click", () => openHistory());

// Accounts light up only when Supabase keys are set in the build environment.
// With no keys this call returns immediately and adds no header button, so the
// signed-out product is exactly what shipped before. See src/engine/auth.ts.
mountAccountButton();

// The idealized silhouette is a framing guide for the camera, not landing art
let outline: ReturnType<typeof mountFaceOutline> | null = null;
function showGuide(sex: Sex): void {
  outline = outline ?? mountFaceOutline(el.outlineCanvas, sex);
  outline.morphTo(sex);
}

// Reference-population control. Reflects the stored choice, writes it back, and
// re-shapes the capture silhouette to match — the guide should be the average
// face someone is about to be compared against, not a fixed one.
const refpop = document.getElementById("refpop")!;
function paintRefPop(): void {
  for (const b of refpop.querySelectorAll<HTMLButtonElement>(".seg-btn")) {
    // Until the choice is made, neither button is lit — an unmade choice should
    // look unmade, not like "male" was picked for you.
    const on = sexChosen && b.dataset.sex === selectedSex;
    b.classList.toggle("on", on);
    b.setAttribute("aria-pressed", String(on));
  }
}
refpop.addEventListener("click", (e) => {
  const b = (e.target as HTMLElement).closest<HTMLElement>(".seg-btn");
  if (!b?.dataset.sex) return;
  selectedSex = b.dataset.sex as Sex;
  sexChosen = true;
  refpop.classList.remove("ask");
  storeSex(selectedSex);
  paintRefPop();
  showGuide(selectedSex);
});
paintRefPop();

// The gate: no scan runs against an unchosen population — and the question is
// asked at the start of EVERY scan, not once per browser.
//
// It used to be chosen once and remembered forever, which is the right policy
// for a personal device and exactly wrong for how this app actually spreads: a
// phone handed across a table. The owner answers "man" on day one, and every
// friend who scans on that phone afterwards is scored against the male
// reference without ever being shown the question — a woman quietly told where
// she ranks among men, which the chooser itself calls a 0.7-to-4.5-point error.
// That is precisely what happened in the first live test.
//
// The cost is one tap per scan, against a flow that involves posing for two
// photographs; the previous answer is highlighted so the owner's repeat scans
// are a single confirm. The stored choice still seeds the results-screen
// toggle and the guide, it just no longer answers for the next face.
// Who is being scanned, and only then which population to score against.
//
// A signed-in member is asked "is this you?" first, and answering "me" ends the
// questions: the account already knows its own reference population from the
// signup quiz, so a person scanning their own face walks straight to the
// camera. That is the reward for answering once.
//
// "Someone else" collects a label for the scan and asks the population question
// about THEM — and flags the scan so it stays off the owner's chart, average,
// streak and everything Max says about their progress. See StoredScan.subject.
//
// A signed-out visitor skips the whole thing. There is no "you" to compare
// against without an account, so the question would be one more screen between
// a stranger and their first result.
function ensureSex(then: () => void): void {
  const askPopulation = (preselect: Sex | undefined, subject: { name: string } | null) => {
    openSexChooser(
      (sex) => {
        selectedSex = sex;
        sexChosen = true;
        scanSubject = subject;
        // A guest's answer is about the guest, so it must not overwrite the
        // owner's remembered population.
        if (!subject) storeSex(sex);
        paintRefPop();
        showGuide(sex);
        then();
      },
      preselect,
      undefined,
      subject?.name,
    );
  };

  const profile = loadProfile();
  const member = document.body.classList.contains("is-member");
  if (!member) {
    askPopulation(storedSex() ?? undefined, null);
    return;
  }

  openSubjectChooser((answer) => {
    subjectAsked = true;
    if (answer.self) {
      // Only the ACCOUNT'S own stored answer can skip the question. The first
      // version also fell back to the browser-global "last population used"
      // key — which an anonymous visitor, another account on this browser, or
      // a rescore of a guest's results all write — so "It's me" could silently
      // score the owner against whatever face used the phone last, and then
      // re-persist that wrong answer as theirs.
      const own = profile.sex;
      if (own) {
        selectedSex = own;
        sexChosen = true;
        scanSubject = null;
        storeSex(own);
        paintRefPop();
        showGuide(own);
        then();
        return;
      }
      // No answer on the account yet (the signup funnel predates the
      // question). Ask once, and remember it ON THE ACCOUNT — so this is the
      // last time a self-scan ever asks.
      openSexChooser(
        (sex) => {
          saveProfile({ ...loadProfile(), sex });
          selectedSex = sex;
          sexChosen = true;
          scanSubject = null;
          storeSex(sex);
          paintRefPop();
          showGuide(sex);
          then();
        },
        storedSex() ?? undefined,
      );
      return;
    }
    askPopulation(undefined, { name: answer.subject.name });
  });
}

// The late form of the same question, for a scan captured with nobody signed
// in: the subject chooser is member-gated, so the capture never asked, and the
// person now signing in at the gate may not be the person in the photographs —
// an owner whose session expired hands the phone over, a friend scans, the
// owner logs back in to see the result. Asked before the analysis is
// attributed, because the alternative is the friend's scan landing in the
// owner's trend and, on an avatar-less account, the friend's face becoming
// the owner's profile picture.
//
// Resolves false when they back out, which abandons the run — the same thing
// backing out of the chooser means at capture time.
function askLateSubject(): Promise<boolean> {
  if (subjectAsked) return Promise.resolve(true);
  return new Promise((resolve) => {
    openSubjectChooser(
      (answer) => {
        subjectAsked = true;
        scanSubject = answer.self ? null : { name: answer.subject.name };
        resolve(true);
      },
      () => {
        resetToUpload();
        resolve(false);
      },
    );
  });
}


// The engine line speaks only when the wait belongs to the user.
//
// It used to say "ENGINE READY · 478-POINT MODEL LOADED" to everyone who
// opened the page, which is a sentence for whoever built the thing rather than
// whoever is using it: the point count is not a claim anyone outside can check,
// and a model that has loaded asks nothing of them. Silence is the correct
// report for a component that is working.
//
// Two cases are still worth a line, and both are the user's problem: a load
// slow enough that an unlabelled pause reads as a broken page, and a load that
// failed. The timer covers the first without putting a flash of copy on every
// fast connection.
const SLOW_ENGINE_MS = 2500;

function showEngineNote(text: string, tone?: "error"): void {
  el.engineStatus.textContent = text;
  el.engineStatus.classList.remove("hidden");
  if (tone) el.engineStatus.classList.add(tone);
}

function clearEngineNote(): void {
  el.engineStatus.textContent = "";
  el.engineStatus.classList.add("hidden");
  el.engineStatus.classList.remove("error");
}

const slowEngineNote = window.setTimeout(
  () => showEngineNote("LOADING ANALYSIS ENGINE · ONE MOMENT"),
  SLOW_ENGINE_MS,
);

// The machine-readable half of the same fact, for the measurement tools in
// tools/ that drive this page in a headless browser and have to know when the
// landmarker is usable.
//
// They used to wait on `#engine-status.ready` — the class behind a line of
// user-facing copy. Which meant the tools were coupled to a sentence, and
// hiding that sentence silently broke twenty-one of them at once: every tool
// sat at its selector until it timed out, with nothing in the failure naming
// the real cause. A state attribute is not something anyone will delete for
// being jargon, because it is not shown to anybody.
function markEngine(state: "ready" | "failed"): void {
  document.documentElement.dataset.engine = state;
}

initLandmarker()
  .then(() => {
    window.clearTimeout(slowEngineNote);
    clearEngineNote();
    markEngine("ready");
  })
  .catch((err) => {
    window.clearTimeout(slowEngineNote);
    console.error(err);
    showEngineNote("ENGINE FAILED TO LOAD · REFRESH TO RETRY", "error");
    markEngine("failed");
  });

let filePickerGeneration = 0;
el.fileInput.addEventListener("change", () => {
  const file = el.fileInput.files?.[0];
  if (file) handleFile(file, filePickerGeneration);
});
el.btnUpload.addEventListener("click", () => {
  const generation = scanGeneration;
  void ensureScanAllowed(() => {
    if (generation !== scanGeneration) return;
    ensureSex(() => {
      if (generation !== scanGeneration) return;
      offerTutorial("front", () => {
        if (generation !== scanGeneration) return;
        filePickerGeneration = generation;
        el.fileInput.click();
      });
    });
  });
});

// Paste or drag a photo anywhere on the page rather than going through the
// picker. Same reasoning as /quick: the photo has usually just been cropped or
// screenshotted and is already on the clipboard. Routed through ensureSex so a
// pasted first photo still chooses its reference population, and held off while
// a scan is already running so a stray Cmd-V cannot restart one mid-animation.
enablePhotoPaste({
  // Only on the capture screen. Once the scan is running or the results are up,
  // a stray Cmd-V should do nothing rather than throw away the analysis on
  // screen and start again.
  busy: () => el.upload.classList.contains("hidden"),
  dropZone: el.ovalFrame,
  onImage: (file) => {
    const generation = scanGeneration;
    void ensureScanAllowed(() => {
      if (generation !== scanGeneration) return;
      ensureSex(() => handleFile(file, generation));
    });
  },
});

// Only shown where the gesture exists.
if (pasteHintApplies()) {
  const hint = document.getElementById("paste-hint");
  if (hint) {
    hint.innerHTML = "…or paste a photo with <kbd>" + (navigator.platform.startsWith("Mac") ? "⌘" : "Ctrl") + "</kbd><kbd>V</kbd>, or drag one in";
    hint.hidden = false;
  }
}
el.ovalFrame.addEventListener("dragover", (e) => {
  e.preventDefault();
  el.ovalFrame.classList.add("dragover");
});
el.ovalFrame.addEventListener("dragleave", () => el.ovalFrame.classList.remove("dragover"));
el.ovalFrame.addEventListener("drop", (e) => {
  e.preventDefault();
  el.ovalFrame.classList.remove("dragover");
  const file = (e as DragEvent).dataTransfer?.files?.[0];
  if (file) {
    const generation = scanGeneration;
    ensureSex(() => handleFile(file, generation));
  }
});

// Wordmark goes home only for a signed-in member. Signed-out visitors already
// are on the acquisition screen, so a fake "home" action would either do
// nothing or unexpectedly open auth. The disabled grey mark makes that state
// explicit; the account button remains the way to sign in.
//
// The dashboard is the signed-in surface on purpose: it is where the history,
// the streak and the personalised overview live, and all three are things an
// account is FOR. A signed-out visitor gets the one screen that works without
// one — scan your face — which is also the only screen a TikTok click needs.
// The public project settings are present in production; a build without auth
// configuration still leaves this control in its disabled guest state.
// The quiz, made compulsory.
//
// It always existed and always asked for a name and a date of birth; what it
// never did was insist. Somebody could sign in, close it, and use the app as an
// anonymous account the greeting could not address and the plan chooser could
// not safely price — which is why the greeting was reduced to guessing at email
// addresses in the first place.
//
// Date of birth is the reason this is a gate rather than a nudge. Every other
// answer has a defensible default; an unknown age does not, because the two
// available fallbacks are offering an adult subscription to a thirteen-year-old
// or withholding it from an adult.
//
// Failures open: if the profile cannot be loaded the app continues rather than
// locking somebody out of their own scan over a dropped request.
// Whether the signed-in person is 18 or over, for the surfaces main.ts opens
// itself (the dashboard's Max tab). Mirrors the results screen's own flag and
// shares its default: false, so a profile that never loads behaves like a
// minor rather than like an adult.
let knownAdult = false;

async function ensureOnboarded(user: User): Promise<void> {
  const generation = scanGeneration;
  // Answers that could not be sent last time — a phone that dropped its
  // connection mid-quiz — go up first, silently. Somebody who has already
  // answered must never be asked twice because their network blipped.
  await flushPendingProfile(user).catch(() => undefined);
  if (generation !== scanGeneration) return;
  let profile;
  try {
    profile = await loadOnboardingProfile(user);
  } catch {
    return;
  }
  if (generation !== scanGeneration) return;
  // The one place the date of birth is already in hand. Every 18+ Max surface
  // on the results screen keys off this; the default is false, so a profile
  // that never loads behaves like a minor rather than like an adult.
  knownAdult = profileIsAdult(profile);
  setAdult(knownAdult);
  if (onboardingComplete(profile)) return;
  await openTrialFunnel(user, undefined, { required: true });
}

document.getElementById("logo-home")?.addEventListener("click", async () => {
  const generation = scanGeneration;
  const user = await currentUser();
  if (generation !== scanGeneration) return;
  if (!user) {
    await refreshHomeBrand(null);
    return;
  }
  await ensureOnboarded(user);
  if (generation !== scanGeneration || activeScanOwner() !== `user:${user.id}`) return;
  if (cam) await closeCamera();
  if (generation !== scanGeneration) return;
  closeSide();
  document.getElementById("v-side")?.classList.add("hidden");
  resetToUpload();
  const dashboardGeneration = scanGeneration;
  const brand = await refreshHomeBrand(user);
  if (dashboardGeneration !== scanGeneration || activeScanOwner() !== `user:${user.id}`) return;
  openDashboard({
    onScan: () => resetToUpload(),
    name: displayName(user),
    membership: brand === "max" ? "max" : "member",
    onSettings: () => void openSettings(user),
    adult: knownAdult,
  });
});

let homeBrandToken = 0;
let homeBrandState: MembershipBrand = "guest";

function paintHomeBrand(brand: MembershipBrand): void {
  homeBrandState = brand;
  const button = document.getElementById("logo-home") as HTMLButtonElement | null;
  if (!button) return;
  button.classList.remove("brand-guest", "brand-member", "brand-max");
  button.classList.add(brandClass(brand));
  button.disabled = brand === "guest";
  button.title = brand === "guest"
    ? "Sign in to open your dashboard"
    : brand === "max"
      ? "Open your Max dashboard"
      : "Open your dashboard";
  button.setAttribute(
    "aria-label",
    brand === "guest" ? "TrueMax dashboard unavailable while signed out" : button.title,
  );
}

async function refreshHomeBrand(user: User | null): Promise<MembershipBrand> {
  const token = ++homeBrandToken;
  if (!user) {
    paintHomeBrand("guest");
    return "guest";
  }

  // Authentication unlocks the dashboard immediately. The entitlement read
  // can then upgrade the identity to Max without holding the navigation hostage
  // on a network request or trusting client-editable metadata.
  paintHomeBrand("member");
  let max = false;
  try {
    max = hasMaxAccess(await loadEntitlement());
  } catch {
    // A temporary entitlement read failure must never lock a real member out
    // of their device-local dashboard. It simply stays in the member state.
  }
  const brand = membershipBrand(true, max);
  if (token === homeBrandToken) paintHomeBrand(brand);
  return token === homeBrandToken ? brand : homeBrandState;
}

window.addEventListener(MEMBERSHIP_BRAND_EVENT, (event) => {
  const brand = (event as CustomEvent<{ brand?: MembershipBrand }>).detail?.brand;
  if (brand !== "member" && brand !== "max") return;
  homeBrandToken++;
  paintHomeBrand(brand);
});

// First name for the greeting, and only ever the name the person gave us.
//
// This used to parse one out of the email address, which turned a real tester's
// address into a capitalised fragment of their handle and would have produced
// worse from a Gmail address with digits in it. There
// is no fallback now, and there does not need to be: the quiz is compulsory and
// asks for the name before anything else, so a signed-in account that reaches
// the dashboard has one. If it somehow does not, the greeting reads "Welcome."
// and that is a better sentence than a wrong name.
function displayName(user: User): string | null {
  const meta = (user.user_metadata ?? {}) as Record<string, unknown>;
  for (const key of ["first_name", "full_name", "name"]) {
    const value = meta[key];
    if (typeof value === "string" && value.trim()) {
      const first = value.trim().split(/\s+/)[0];
      if (first.length >= 1 && first.length <= 20) return first;
    }
  }
  return null;
}

// ---- camera ----
let cam: CameraHandle | null = null;
let lastCheck: FrameCheck | null = null;
let autoFront: AutoCapture | null = null;
let frontKeyHandler: ((e: KeyboardEvent) => void) | null = null;
// Wall clock until which the opening capture instruction stays put.
let holdHintUntil = 0;
const HINT_HOLD_MS = 3200;

async function openCamera(): Promise<void> {
  const generation = scanGeneration;
  if (!isSupported()) {
    el.camHintDetail.textContent = "This browser can't open a camera, so upload a photo instead.";
    return;
  }
  const desktop = !matchMedia("(pointer: coarse)").matches;
  holdHintUntil = 0;
  resetGlassesOverride();
  el.camHintTitle.textContent = "Allow camera access";
  el.camHintDetail.textContent = desktop
    ? "Your browser will ask at the top of the window. Choose Allow"
    : "Tap Allow when your browser asks";
  try {
    const started = await startCamera({
      video: el.camVideo,
      guideCanvas: el.camGuide,
      onCheck: (c) => {
        lastCheck = c;
        // Hold the opening instruction for a beat before the live coaching
        // takes over. Glasses can be detected once the camera is running; a
        // cap or a hood cannot, so this moment — preview up, nothing shot yet
        // — is the only chance to ask about them, and a hint that is replaced
        // on the very next frame is a hint nobody reads. The lamp underneath
        // is already live, so nothing is being hidden.
        // Not while the countdown owns the hint — it has just written it, and
        // the two would flash against each other every frame.
        // Settled, not raw. The lamp and the bar below still track every frame
        // — they are continuous readouts and should be — but the sentence and
        // its colour only change when a reading has repeated. See
        // engine/captureSettle.ts for why: a face on the boundary between two
        // checks used to strobe the colour and, because the box is sized by its
        // own text, pulse the box in and out at the same time.
        const shown = frontSettle.settle({ status: c.status, hint: c.hint, detail: c.detail });
        if (performance.now() >= holdHintUntil && !autoFront?.armed()) {
          el.camHintTitle.textContent = shown.hint;
          el.camHintDetail.textContent = shown.detail;
        }
        el.camHint.classList.toggle("ready", c.ready);
        el.camHint.classList.toggle("red", shown.status === "red");
        el.camHint.classList.toggle("amber", shown.status === "amber");
        el.camLamp.className = `lamp ${c.status === "green" ? "green" : c.status}`;
        el.camLampFill.className = c.status === "green" ? "green" : c.status;
        el.camLampFill.style.width = `${Math.round((c.status === "green" ? 1 : c.progress) * 100)}%`;
        el.ovalFrame.classList.toggle("ready", c.ready);
        // Offer the way out only while the glasses block is what is stopping
        // them, so it is not a standing invitation to skip a real check.
        el.btnNoGlasses.classList.toggle("hidden", c.hint !== "Take your glasses off");
        el.ovalFrame.classList.toggle("tracking", c.gates.face);
        // Auto-capture still waits for the ideal frame. Manual capture becomes
        // available as soon as a face exists; the remaining checks are advice
        // and confidence context, not a dead end.
        el.btnCamera.disabled = !c.gates.face;
        if (!autoFront?.armed()) setCameraLabel(c.ready ? "Capture" : "Capture anyway");
        autoFront?.update(c.ready);
      },
    });
    if (generation !== scanGeneration) {
      started.stop();
      return;
    }
    cam = started;
    // The front gets the same hands-off shutter as the side. It matters less
    // here — you can see the screen — but a photo taken while reaching for a
    // button is a photo that moved, and that is true of both views.
    const frontSettle = createSettler();
    autoFront = createAutoCapture({
      onTick: (remaining) => {
        if (remaining == null) {
          el.camHint.classList.remove("counting");
          setCameraLabel("Capture");
          return;
        }
        el.camHint.classList.add("counting");
        el.camHintTitle.textContent = `Hold still · ${remaining}`;
        el.camHintDetail.textContent = "Taking it automatically · space to take it now";
        setCameraLabel(`Capturing in ${remaining}`);
      },
      onFire: () => el.btnCamera.click(),
    });
    // Space or Enter fires the shutter now instead of waiting out the count.
    frontKeyHandler = (e: KeyboardEvent) => {
      if (e.key !== " " && e.key !== "Enter") return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      if (t?.tagName === "BUTTON" && t.id !== "btn-camera") return;
      if (!cam || !lastCheck?.gates.face) return;
      e.preventDefault();
      el.btnCamera.click();
    };
    window.addEventListener("keydown", frontKeyHandler);
    el.ovalFrame.classList.add("live");
    el.stage.classList.add("live-cam");
    // Headline and sub collapse so the preview can take the space — the
    // camera becomes the subject the moment it is granted.
    el.upload.classList.add("camera-live");
    // Starts on the male silhouette and morphs once the shape vote settles —
    // waiting for the vote would leave the frame empty at the exact moment
    // someone needs help positioning.
    showGuide(selectedSex);
    el.camHintTitle.textContent = "Glasses, hats and hoods off";
    el.camHintDetail.textContent = "They sit across the eye, brow and jaw measurements";
    holdHintUntil = performance.now() + HINT_HOLD_MS;
    el.camLight.classList.remove("hidden");
    el.btnCancel.classList.remove("hidden");
    setCameraLabel("Capture");
    el.btnCamera.disabled = true;

    // Put the preview back at the top of the viewport.
    //
    // Nothing here calls scrollIntoView, and that is the point — the scroll is
    // the browser's, not ours. The headline and the sub both collapse to
    // max-height 0 the moment `camera-live` lands, which removes several
    // hundred pixels from ABOVE the button somebody has just tapped. Scroll
    // anchoring then does exactly what it is designed to do and holds that
    // button where their thumb left it, which on a phone drags the camera up
    // under the sticky header. The result is a capture screen whose subject —
    // the live preview — is the one thing off screen.
    //
    // Corrected after a frame rather than immediately: the collapse is a CSS
    // transition, so the layout this is measuring against does not exist yet on
    // the same tick.
    //
    // A hard jump, not a smooth one. This is a correction of something the
    // viewer never asked for, and animating it would read as the page moving on
    // its own a second time.
    requestAnimationFrame(() => {
      const top = el.stage.getBoundingClientRect().top + window.scrollY;
      // A little air above, so the frame is not flush under the header.
      window.scrollTo({ top: Math.max(0, top - 72), behavior: "auto" });
    });
  } catch {
    el.camHintTitle.textContent = "Camera unavailable";
    el.camHintDetail.textContent = "Permission was denied. You can still upload a photo.";
  }
}

// Tear the live preview down and put the landing screen back exactly as it
// was, celebrity reel and all. Shared by capture and cancel so the two can
// never drift apart and leave the page half in camera mode.
async function closeCamera(): Promise<void> {
  autoFront?.cancel();
  autoFront = null;
  if (frontKeyHandler) {
    window.removeEventListener("keydown", frontKeyHandler);
    frontKeyHandler = null;
  }
  cam?.stop();
  cam = null;
  lastCheck = null;
  el.ovalFrame.classList.remove("live", "ready", "tracking");
  el.stage.classList.remove("live-cam");
  el.upload.classList.remove("camera-live");
  el.camLight.classList.add("hidden");
  el.btnCancel.classList.add("hidden");
  el.btnNoGlasses.classList.add("hidden");
  setCameraLabel("Use camera");
  el.btnCamera.disabled = false;
  el.camHintTitle.textContent = "Take a photo, or upload one";
  el.camHintDetail.textContent = "The camera preview will guide your framing";
  el.camHint.classList.remove("ready", "red", "amber");
  await setRunningMode("IMAGE");
}

el.btnCamera.addEventListener("click", async () => {
  if (!cam) {
    // Gate first, questions second: being asked your reference population and
    // THEN told to wait until Thursday is the wrong order of bad news.
    const generation = scanGeneration;
    void ensureScanAllowed(() => {
      if (generation !== scanGeneration) return;
      ensureSex(() => {
        if (generation !== scanGeneration) return;
        // After the reference population is settled and before the camera
        // opens: the tutorial is about the photograph, so it belongs at the
        // last moment where the photograph does not exist yet.
        offerTutorial("front", () => {
          if (generation === scanGeneration) void openCamera();
        });
      });
    });
    return;
  }
  if (!lastCheck?.gates.face) return;
  const token = beginScan("camera");
  if (!token) {
    el.camHintDetail.textContent = "Your session is still loading. Try capture again in a moment.";
    return;
  }
  const generation = ++scanGeneration;
  // A BURST, not a shutter.
  //
  // The weighted mean reliability of the front metrics is 0.351, and a third of
  // the score's weight sits on ten measurements whose reliability is under
  // 0.15 — two photographs of one person disagree about them as much as two
  // different people do. Combining k frames whose noise is independent turns
  // reliability into 1 - (1-r)/k: 0.35 at one frame, 0.78 at three, 0.87 at
  // five. Nothing else available to us moves consistency that far.
  //
  // Spread over ~1.1s rather than taken as a burst, and that is the whole
  // design. Five frames grabbed in 200ms share one pose and one expression, so
  // their errors are the SAME error and almost nothing cancels; the subject has
  // to have moved slightly between them for the noise to be independent. Pose
  // is the dominant source here — fwhr reads 0.00 reliability precisely because
  // it tracks pose rather than bone.
  //
  // The first frame is still the photograph the user sees and everything else
  // is measured against; the rest exist only to be measured. If any of them
  // fail to grab, the scan degrades to exactly what it did before.
  const burst = await captureBurst(cam);
  const shot = burst[0] ?? null;
  // Remember that the front came from the camera, so the side step defaults to
  // the camera too rather than making the user switch capture method mid-flow.
  captureMethod = "camera";
  await closeCamera();
  if (shot) await handleCanvas(shot, 1, generation, token, burst.slice(1));
  else scanSession.reset();
});

el.btnCancel.addEventListener("click", async () => {
  await closeCamera();
});

el.btnNoGlasses.addEventListener("click", () => {
  overrideGlasses();
  el.btnNoGlasses.classList.add("hidden");
});

// The camera never opens on its own, even for a returning visitor who has
// already granted access. The landing plays the celebrity reel until the
// moment someone clicks "Use camera" — auto-opening the preview replaced that
// reel with a shot of the viewer's own room the instant the page loaded, which
// is both worse as a first impression and startling on a page people open in
// public. Explicit intent only.

function resetToUpload(): void {
  scanGeneration++;
  scanSession.reset();
  clearPendingAnalysis();
  // A new scan is a hard privacy boundary. Clearing only localStorage left the
  // previous front landmarks, full-resolution canvas and verified side points
  // alive in this tab. A second person could then capture only the side and
  // receive a report rendered over the first person's front photo.
  pending = null;
  lastSide = null;
  captureMethod = null;
  scanSubject = null;
  subjectAsked = false;
  skipCoveringCheck = false;
  feedbackInFlight = null;
  feedbackDeliveryNote = null;
  resumePendingStarted = false;
  el.photoCanvas.width = 1;
  el.photoCanvas.height = 1;
  el.photoCanvas.getContext("2d")?.clearRect(0, 0, 1, 1);
  el.overlayCanvas.width = 1;
  el.overlayCanvas.height = 1;
  el.overlayCanvas.getContext("2d")?.clearRect(0, 0, 1, 1);
  el.main.classList.add("hidden");
  el.upload.classList.remove("hidden");
  el.zoomable.style.transform = "none";
  el.analysis.innerHTML = "";
  el.qualityChips.innerHTML = "";
  el.fileInput.value = "";
  gateDemo?.stop();
  gateDemo = null;
  delete (window as unknown as Record<string, unknown>).__truemax;
  delete (window as unknown as Record<string, unknown>).__truemaxSide;
  delete (window as unknown as Record<string, unknown>).__truemaxSidePoints;
  // Takes the scroll listener with it. A strip left behind would keep
  // shrinking a photo pane that no longer holds a photograph. The pet goes
  // with it: he belongs to a result, not to the upload screen.
  clearScoreStrip();
  unmountMaxPet();
  closeMaxChat();
}

// Two views go into the score, so the scan shows two views being measured. It
// only ever showed the front, which made the profile someone had just spent
// time verifying look like it had been filed away and ignored.
const SCAN_STAGES: Array<{ text: string; view: "front" | "side" }> = [
  { text: "Detecting facial landmarks", view: "front" },
  { text: "Normalizing to interpupillary scale", view: "front" },
  { text: `Measuring ${METRICS.length} front proportions`, view: "front" },
  { text: "Checking bilateral symmetry", view: "front" },
  { text: "Reading the profile: chin, jaw, convexity", view: "side" },
  { text: `Measuring ${SIDE_METRICS.length} side proportions`, view: "side" },
  { text: "Comparing against population", view: "side" },
  { text: "Merging both views", view: "front" },
];

async function handleFile(file: File, expectedGeneration = scanGeneration): Promise<void> {
  if (expectedGeneration !== scanGeneration) return;
  if (!isReady()) {
    showEngineNote("ENGINE STILL LOADING · ONE MOMENT");
    return;
  }
  const token = beginScan("upload");
  if (!token) {
    showEngineNote("SESSION STILL LOADING · TRY AGAIN IN A MOMENT");
    return;
  }
  const generation = ++scanGeneration;
  // An uploaded front means the side step should ask for a file too.
  captureMethod = "upload";
  let image;
  try {
    image = await loadImage(file);
  } catch (err) {
    if (!scanIsCurrent(token, generation)) return;
    showEngineNote((err as Error).message.toUpperCase(), "error");
    return;
  }
  if (!scanIsCurrent(token, generation)) return;
  // Browsers apply EXIF orientation during decode — verified against rotated
  // iPhone-style files (orientation 3 and 6 both land upright). We read the
  // flag only for diagnostics; applying it again would rotate twice, which is
  // exactly the bug this check caught.
  const exifOrientation = await readOrientation(file);
  if (!scanIsCurrent(token, generation)) return;
  const scale = Math.min(1, MAX_IMAGE_DIM / Math.max(image.width, image.height));
  const dw = Math.round(image.width * scale);
  const dh = Math.round(image.height * scale);
  const width = dw;
  const height = dh;
  const src = document.createElement("canvas");
  src.width = width;
  src.height = height;
  src.getContext("2d")!.drawImage(image, 0, 0, dw, dh);
  await handleCanvas(src, exifOrientation, generation, token);
}

// How many frames a camera capture collects, and over how long.
//
// Five is where the reliability curve 1 - (1-r)/k stops paying for itself: it
// takes 0.35 to 0.87, and a sixth frame would add 0.01 for another 220ms of
// somebody holding still. The span matters more than the count — see the
// comment at the shutter.
const BURST_FRAMES = 5;
const BURST_MS = 1100;

async function captureBurst(handle: { capture(): HTMLCanvasElement | null }): Promise<HTMLCanvasElement[]> {
  const out: HTMLCanvasElement[] = [];
  for (let i = 0; i < BURST_FRAMES; i++) {
    const frame = handle.capture();
    if (frame) out.push(frame);
    if (i < BURST_FRAMES - 1) {
      await new Promise((r) => setTimeout(r, BURST_MS / (BURST_FRAMES - 1)));
    }
  }
  return out;
}

async function handleCanvas(
  src: HTMLCanvasElement,
  exifOrientation = 1,
  generation = scanGeneration,
  token = scanSession.currentToken(),
  /**
   * Further frames of the SAME capture, to be measured but never shown.
   *
   * Only the camera path has these. A chosen file is one photograph and always
   * will be, so uploads keep single-frame behaviour and the reliability gain is
   * a reason to use the camera rather than a silent difference between them.
   */
  extraFrames: HTMLCanvasElement[] = [],
): Promise<void> {
  if (!token || !scanIsCurrent(token, generation)) return;
  void exifOrientation;
  // Uploading while the live preview is running left the landmarker in VIDEO
  // mode, and the still-image detector then threw "Landmarker is in VIDEO
  // mode". Capturing had always torn the camera down first; choosing a file
  // never did.
  if (cam) await closeCamera();
  if (!scanIsCurrent(token, generation)) return;
  const width = src.width;
  const height = src.height;
  el.photoCanvas.width = width;
  el.photoCanvas.height = height;
  el.photoCanvas.getContext("2d")!.drawImage(src, 0, 0);

  el.upload.classList.add("hidden");
  el.main.classList.remove("hidden");
  // The front photo, kept so the scan can switch back to it after showing the
  // profile being measured.
  const frontShot = document.createElement("canvas");
  frontShot.width = el.photoCanvas.width;
  frontShot.height = el.photoCanvas.height;
  frontShot.getContext("2d")!.drawImage(el.photoCanvas, 0, 0);
  el.frame.classList.add("scanning");
  el.capRight.textContent = "SCANNING";
  el.analysis.innerHTML = "";
  el.qualityChips.innerHTML = "";
  await nextFrame();
  if (!scanIsCurrent(token, generation)) return;

  // Real math (milliseconds) happens inside the theatre beat (~2.2s)
  const result = detectStable(el.photoCanvas);
  const quality = assessQuality(result);

  if (!quality.faceFound) {
    el.frame.classList.remove("scanning");
    el.capRight.textContent = "NO FACE FOUND";
    el.status.innerHTML = "<b>No face detected.</b> Try a clearer, front-facing photo.";
    el.overlayCanvas.getContext("2d")?.clearRect(0, 0, el.overlayCanvas.width, el.overlayCanvas.height);
    setTimeout(() => {
      if (scanIsCurrent(token, generation)) resetToUpload();
    }, 2600);
    return;
  }

  const landmarks = result.faceLandmarks[0];
  const faceBox = landmarkBox(landmarks);
  const stats = stillFrameStats(el.photoCanvas, faceBox);
  const occlusion = detectOcclusion(el.photoCanvas, landmarks, width, height);
  const warnings = frontPhotoWarnings(quality, stats, occlusion);
  let rejection = frontPhotoRejection(quality, stats, occlusion, landmarks, width, height);
  // The covering check is a HEURISTIC over a segmentation model, and the two
  // structural rejections above it are not — so only this one is overridable.
  // A person the model misreads (it has misread curly hair as a hood) must
  // never be locked out of their own scan by a guess; the person can see
  // their own head, and on this one question they outrank the model.
  let coveringRejection = false;
  if (!rejection && !skipCoveringCheck) {
    rejection = headCoveringRejection(await detectHeadCovering(el.photoCanvas));
    coveringRejection = rejection !== null;
  }
  skipCoveringCheck = false;
  if (!scanIsCurrent(token, generation)) return;
  if (rejection) {
    el.frame.classList.remove("scanning");
    el.capRight.textContent = "PHOTO NOT VALID";
    el.status.innerHTML = `<b>${rejection.title}</b> ${rejection.detail}${
      coveringRejection
        ? ` <button type="button" class="linkish" id="covering-override">Nothing covering your face? Use this photo</button>`
        : ""
    }`;
    el.overlayCanvas.getContext("2d")?.clearRect(0, 0, el.overlayCanvas.width, el.overlayCanvas.height);
    if (coveringRejection) {
      // Re-enter the same pipeline with the check waived for one pass. No
      // timeout here: a screen with a decision on it must not dissolve while
      // somebody is reading it.
      document.getElementById("covering-override")?.addEventListener("click", () => {
        if (!scanIsCurrent(token, generation)) return;
        skipCoveringCheck = true;
        void handleCanvas(src, exifOrientation, generation, token, extraFrames);
      });
      return;
    }
    setTimeout(() => {
      if (scanIsCurrent(token, generation)) resetToUpload();
    }, 4200);
    return;
  }

  pending = {
    landmarks,
    width,
    height,
    quality: {
      ...quality,
      issues: [...new Set([...quality.issues, ...warnings])],
    },
    autoNote: `Scored against ${selectedSex} norms`,
    // frontShot was copied off the pane above, before anything else could draw
    // on it. This is the only moment in the flow where #photo-canvas is
    // guaranteed to hold the front capture and nothing else.
    photo: frontShot,
    // The rest of the burst, measured here while the detector is warm and the
    // canvases are still alive. Frames whose mesh fails integrity are dropped
    // rather than carried: a frame that produced a broken face is not a second
    // opinion, it is a second problem, and the median is only worth taking over
    // measurements that were all valid.
    extraFrames: extraFrames.flatMap((canvas) => {
      try {
        const r = detectStable(canvas);
        const lm = r.faceLandmarks?.[0];
        if (!lm || landmarkIntegrityIssues(lm).length) return [];
        return [{ landmarks: lm, width: canvas.width, height: canvas.height, source: canvas }];
      } catch {
        return [];
      }
    }),
  };

  // The main product is two photographs: front, then side, then one analysis of
  // both. That is the whole mechanism, so the side is a required step here, not
  // an optional extra — after the front is captured the flow goes straight to
  // the profile. (Front-only lives on the separate /quick.html page, which is
  // built for filming and deliberately skips the side.)
  //
  // runFullAnalysis still accepts null so a report restored from history can
  // render front-only; the interactive flow always supplies a side report.
  el.frame.classList.remove("scanning");
  el.capRight.textContent = "FRONT CAPTURED";
  track("scan-front-done");
  el.status.innerHTML = "<b>Front captured.</b> Now the side profile.";
  drawCalm(el.overlayCanvas, landmarks, width, height);
  if (!scanSession.transition(token, "side")) return;
  startSide();
}

interface PendingFront {
  landmarks: NormalizedLandmark[];
  width: number;
  height: number;
  quality: QualityCheck;
  autoNote: string;
  /**
   * The front capture, as its OWN canvas, copied at the moment it was accepted.
   *
   * Not optional, and deliberately not recovered later by reading #photo-canvas.
   * That pane is shared: the scan animation swaps the profile onto it, the side
   * flow draws on it, and a resume repaints it. Every previous attempt at this
   * cloned whatever the pane happened to hold at some later instant, and every
   * one of them eventually cloned the SIDE photograph — which is how the front
   * tabs came to render front landmarks, front region zooms and a 468-point
   * mesh over a profile labelled FRONT. Twice now the fix has been to move the
   * clone earlier; moving it earlier only narrows the window. Owning the pixels
   * here closes it.
   */
  photo: HTMLCanvasElement;
  /**
   * Further measured frames of the same capture, beyond the one shown.
   *
   * Empty for an uploaded photograph, which is one frame and always will be.
   * See analyzeFrames for why these exist and why they are combined at the
   * measurement layer rather than the landmark layer.
   */
  extraFrames: CaptureFrame[];
}
let pending: PendingFront | null = null;
// The verified side points, kept so a change of reference population can
// re-score the profile too rather than only the front.
interface LastSide {
  points: SidePoints;
  faceDir: number;
  photo?: HTMLCanvasElement;
  automaticPoints?: SidePoints;
  seedMethod?: SideSeedMethod;
  feedback?: SideFeedbackIntent;
  feedbackSubmitted?: boolean;
}
let lastSide: LastSide | null = null;
let feedbackDeliveryNote: { ok: boolean; message: string } | null = null;

// Upload exists only after an explicit Yes. It is deliberately best-effort:
// optional product-improvement feedback must never hold a person's analysis
// hostage if Storage or the network is unavailable.
// Held so the analysis can overlap the upload instead of queueing behind it.
// See startConsentedSideFeedback.
let feedbackInFlight: Promise<void> | null = null;

// Fire the upload WITHOUT waiting for it.
//
// This is the fix for a three-to-five second dead screen. The upload encodes
// the side photograph to JPEG and POSTs it, and every caller used to await it
// before starting the analysis — so after confirming their landmark
// corrections, somebody sat looking at nothing while an optional
// product-improvement upload finished. Blank, no spinner, entirely at the mercy
// of their connection, immediately before the animation that is supposed to be
// the best moment in the product.
//
// The function's own comment always said this must never happen — "optional
// product-improvement feedback must never hold a person's analysis hostage" —
// and awaiting it did precisely that. One call site already used void; the four
// that mattered did not.
//
// Not simply dropping the await, though: the delivery note becomes a quality
// chip on the results screen, and a fire-and-forget upload would still be in
// flight when those chips render, so the chip would silently go missing. The
// promise is kept instead and awaited at the one point that needs it — after
// the reveal animation, by which time a ~100KB POST has almost always landed.
// The upload now runs underneath the animation rather than in front of it.
function startConsentedSideFeedback(): void {
  const generation = scanGeneration;
  feedbackInFlight = submitConsentedSideFeedback(generation);
}

async function submitConsentedSideFeedback(generation = scanGeneration): Promise<void> {
  const side = lastSide;
  if (!side?.feedback || side.feedbackSubmitted || !side.photo) return;
  const token = scanSession.currentToken();
  if (!token || side.feedback.scanId !== token.scanId || !scanIsCurrent(token, generation)) return;
  const result = await submitSideCorrectionFeedback(
    side.photo,
    side.points,
    side.faceDir,
    side.feedback,
  );
  if (!scanIsCurrent(token, generation)) return;
  if (result.ok) {
    side.feedbackSubmitted = true;
    feedbackDeliveryNote = { ok: true, message: "Optional side-landmark feedback sent privately" };
  } else if (result.rateLimited) {
    // A limit is not a failure, and saying "could not be sent" for one is a lie
    // that costs us the corrections we most want. Somebody working through a
    // run of profiles used to see the same vague line on every submission past
    // the cap, with no way to tell that the earlier ones had landed.
    feedbackDeliveryNote = {
      ok: true,
      message: "Enough side-landmark feedback shared today — this one was not needed",
    };
  } else {
    feedbackDeliveryNote = {
      ok: false,
      message: "Optional side-landmark feedback could not be sent; analysis was unaffected",
    };
    console.warn("Optional side correction feedback was not sent:", result.message);
  }
}

// Both photographs are in. One analysis, one reveal, one score.
async function runFullAnalysis(
  sideReport: Report | null,
  token = scanSession.currentToken(),
): Promise<void> {
  if (!pending || !token || !scanSession.isCurrent(token)) return;
  if (!scanSession.transition(token, "analyzing")) return;
  const generation = scanGeneration;
  const { landmarks, width, height, quality, autoNote, photo: frontShot } = pending;
  // The scan sequence only narrates the side view when there is one. Front-only
  // is now a complete result rather than an unfinished one, so its loading bar
  // must not claim to be reading a profile that was never taken.
  const stages = sideReport ? SCAN_STAGES : SCAN_STAGES.filter((s) => s.view === "front");
  el.main.classList.remove("hidden");
  // The front capture comes from `pending`, which has owned its own copy since
  // the moment it was accepted. It used to be cloned off el.photoCanvas right
  // here — and this function can run a second time (sign-in mid-scan resumes
  // it), by which point the pane may be showing the profile. See PendingFront.
  //
  // Paint it too, so the pane always agrees with the FRONT caption underneath
  // regardless of what the previous run, or the side flow, left behind.
  el.photoCanvas.width = frontShot.width;
  el.photoCanvas.height = frontShot.height;
  el.photoCanvas.getContext("2d")!.drawImage(frontShot, 0, 0);
  el.frame.classList.add("scanning");
  el.capRight.textContent = "SCANNING";
  el.analysis.innerHTML = "";
  await nextFrame();
  const reveal = drawLandmarksAnimated(el.overlayCanvas, landmarks, width, height);

  // Staged status lines, ~360ms each, with the photo pane following whichever
  // view the current stage is about.
  const sideShot = lastSide?.photo;
  let showing: "front" | "side" = "front";
  const swapTo = (view: "front" | "side") => {
    if (view === showing) return;
    if (view === "side" && !sideShot) return;
    showing = view;
    const cap = document.querySelector(".photo-caption span");
    if (cap) cap.textContent = view === "side" ? "SIDE" : "FRONT";
    el.overlayCanvas.getContext("2d")?.clearRect(0, 0, el.overlayCanvas.width, el.overlayCanvas.height);
    if (view === "side") {
      const t = sideShot!;
      el.photoCanvas.width = t.width;
      el.photoCanvas.height = t.height;
      el.photoCanvas.getContext("2d")!.drawImage(t, 0, 0);
      // The profile gets its own reveal: a synthesised mesh sweeping the face,
      // matched to the front scan's density, with the thirteen measured anchors
      // lighting up on top. Without this the side half of the scan was a photo
      // sitting still while the text claimed it was being measured.
      if (lastSide) revealSideScan(el.overlayCanvas, lastSide.points, t.width, t.height);
    } else {
      el.photoCanvas.width = width;
      el.photoCanvas.height = height;
      el.photoCanvas.getContext("2d")!.drawImage(frontShot, 0, 0);
      drawCalm(el.overlayCanvas, landmarks, width, height);
    }
  };
  await new Promise<void>((done) => {
    let s = 0;
    const step = () => {
      if (!scanIsCurrent(token, generation)) {
        reveal.cancel();
        done();
        return;
      }
      if (s < stages.length) {
        el.status.innerHTML = `<b>${stages[s].text}</b> …`;
        el.barFill.style.width = `${((s + 1) / stages.length) * 100}%`;
        swapTo(stages[s].view);
        s++;
        setTimeout(step, stages[s - 1].view === "side" ? 520 : 360);
      } else done();
    };
    setTimeout(step, 200);
  });
  await reveal.done;
  if (!scanIsCurrent(token, generation) || !pending) return;

  // The shown frame first, then the rest of the burst. analyzeFrames falls
  // straight through to analyze when there is only one, so an uploaded photo
  // takes exactly the path it always did.
  const front = analyzeFrames(
    [{ landmarks, width, height, source: frontShot }, ...pending.extraFrames],
    selectedSex,
  );
  // Front-only is a real result: mergeReports already returns the front report
  // untouched when the side is absent, so the same call covers both and the
  // results screen's own front-only branch (OVERALL · FRONT ONLY, with an
  // "Add side profile" nudge) does the rest.
  const report = sideReport ? mergeReports(front, sideReport) : front;
  const delta = compareAndStore(report, token.scanId, scanSubject ?? undefined);
  // The weekly free-scan clock starts when an analysis finishes, not when a
  // photo is chosen — an abandoned capture must not cost the week's scan.
  recordScanRun();

  // Keep a thumbnail of each view against this scan's immutable ID. Thumbnails
  // only — see engine/photoStore.
  // Fire-and-forget: a storage failure must never interrupt a finished
  // analysis, and the report does not depend on it.
  void (async () => {
    const owner = activeScanOwner();
    if (!owner || !scanSession.isCurrent(token, owner)) return;
    // Read BEFORE the await. scanSubject is module state that resetToUpload
    // nulls, and the IndexedDB write below is a real gap — an owner tapping
    // "New photo" mid-write must not turn a guest's scan into "not a guest".
    const guest = scanSubject !== null;
    const frontThumb = toThumb(frontShot);
    const sideThumb = lastSide?.photo ? toThumb(lastSide.photo) : null;
    await savePhotos(token.scanId, {
      front: frontThumb ?? undefined,
      side: sideThumb ?? undefined,
    });
    // Re-checked AFTER the await and BEFORE anything is written for the owner:
    // the suspended closure can resume under a different signed-in account
    // (cross-tab auth swaps the scope synchronously), and this scan's face
    // must not become THAT account's anything.
    if (!scanSession.isCurrent(token, owner)) return;
    // The first front photo a member scans OF THEMSELVES becomes their
    // profile picture. A guest's face must never become the owner's avatar,
    // and an avatar already chosen is never overwritten from here — settings
    // owns changes.
    if (!guest) maybeAdoptAvatar(frontShot);
    await pruneTo(readAllHistory().map(scanStorageKey));
  })();

  el.frame.classList.remove("scanning");
  el.capRight.textContent = "ANALYZED";
  el.status.textContent = "";
  el.barFill.style.width = "0";
  drawCalm(el.overlayCanvas, landmarks, width, height);
  // The one place the upload's outcome is actually needed: it decides a quality
  // chip. By now the reveal animation has run, so the POST fired underneath it
  // has almost always landed and this waits for nothing. A slow connection
  // costs a slightly later chip rather than a blank screen up front, and a
  // rejection must never surface here — it is optional feedback and the note
  // itself already records the failure.
  await feedbackInFlight?.catch(() => {});
  if (!scanIsCurrent(token, generation) || !pending) return;
  renderQualityChips(quality, autoNote);

  // The corrected cloud, once the person has corrected one. Held so re-opening
  // the editor shows their own work rather than starting again from the
  // detector's reading, and so a population switch after an edit re-scores the
  // corrected face instead of quietly reverting it.
  let editedLandmarks: NormalizedLandmark[] | null = null;

  const ctxArgs = {
    report,
    delta,
    landmarks,
    // The clean front capture, as its own canvas. The results screen used to
    // recover this by cloning whatever #photo-canvas happened to display,
    // which after a side-profile flow was the SIDE photograph — so the front
    // tabs drew front measurements over a profile labelled FRONT.
    frontPhoto: frontShot,
    photoW: width,
    photoH: height,
    // How far off level the front capture was, for the honesty note on the
    // Basic grid: a corrected pose is still the first suspect when a
    // pose-sensitive region reads far below everything else.
    offAxisDeg: Math.max(Math.abs(quality.yawDeg), Math.abs(quality.pitchDeg)),
    // The conditions this photograph was taken under, carried into the
    // diagnostics dump. Two scans of one person only mean something together
    // if you can see whether one of them was taken at 20 degrees of yaw.
    capture: {
      yawDeg: quality.yawDeg,
      pitchDeg: quality.pitchDeg,
      rollDeg: quality.rollDeg,
      smileScore: quality.smileScore,
      at: new Date().toISOString(),
      scanId: token.scanId,
    },
    analysis: el.analysis,
    zoomable: el.zoomable,
    overlay: el.overlayCanvas,
    onNewPhoto: resetToUpload,
    // Who the scan is OF, so the results screen can stop speaking to the
    // owner about a guest's numbers — "first scan on record" was rendered
    // over a friend's face because a guest's delta is deliberately null.
    subjectName: scanSubject?.name,
    // Same destination as "continue" — the plan chooser, which already handles
    // signed-out users and the under-18 rule. The upgrade button is not a
    // second, parallel billing path.
    onUpgrade: async () => {
      const user = await currentUser();
      if (user) {
        await openTrialFunnel(user);
        await refreshMaxAccess();
        return;
      }
      await openAccount({
        reason: "analysis",
        notice: "Create your account to choose a plan.",
        onAuthenticated: async (signedInUser) => {
          await openTrialFunnel(signedInUser);
          await refreshMaxAccess();
        },
      });
    },
    onContinue: async () => {
      const user = await currentUser();
      if (user) {
        await openTrialFunnel(user);
        return;
      }
      await openAccount({
        reason: "analysis",
        notice: "Create your account to save your pathway and choose a trial.",
        onAuthenticated: (signedInUser) => openTrialFunnel(signedInUser),
      });
    },
    // Correct the front points, then score the corrected face.
    //
    // The same shape as onSexChange below: nothing is re-detected and no photo
    // is retaken — the corrected cloud goes back through the identical
    // analysis path, merges with the side if there is one, and re-stores under
    // this scan's own ID so the history holds one scan rather than two.
    //
    // The burst frames are kept. Dropping to a single-frame analyse() would
    // change the score for a reason that has nothing to do with the edit, so
    // the edited frame replaces the shown one at the head of the same list and
    // the median across frames still runs.
    onEditFront: () => {
      openFrontEdit({
        photo: frontShot,
        landmarks: editedLandmarks ?? landmarks,
        onClose: () => {},
        onApply: (corrected) => {
          if (!scanIsCurrent(token, generation)) return;
          editedLandmarks = corrected;
          const f = analyzeFrames(
            [
              { landmarks: corrected, width, height, source: frontShot },
              // Optional, not asserted. `pending` is module state that
              // resetToUpload clears, and this closure outlives the render it
              // was built in — a correction applied on a screen whose pending
              // burst has already been dropped must re-measure from the one
              // frame it still has, not throw.
              ...(pending?.extraFrames ?? []),
            ],
            selectedSex,
          );
          const merged = sideReport ? mergeReports(f, sideReport) : f;
          const rescored = compareAndStore(merged, token.scanId, scanSubject ?? undefined);
          drawCalm(el.overlayCanvas, corrected, width, height);
          renderQualityChips(quality, "Re-measured from your corrected points");
          renderResults({ ...ctxArgs, report: merged, delta: rescored, landmarks: corrected });
        },
      });
    },
    onSideProfile: () => startSide(),
    sideReport: sideReport ?? undefined,
    sidePhoto: lastSide?.photo,
    sidePoints: lastSide?.points,
    // Correct the points on the profile already taken, rather than shooting it
    // again. The photograph is usually fine; it is the seed that missed.
    onRedoSide: () => {
      feedbackDeliveryNote = null;
      if (!lastSide?.photo) {
        startSide();
        return;
      }
      if (!scanSession.transition(token, "side")) return;
      el.main.classList.add("hidden");
      openSideAdjust(lastSide.photo, {
        points: lastSide.points,
        faceDir: lastSide.faceDir,
        automaticPoints: lastSide.automaticPoints,
        method: lastSide.seedMethod,
      }, {
        scanId: token.scanId,
        sex: selectedSex,
        onBack: () => {
          closeSide();
          scanSession.transition(token, "results");
          el.main.classList.remove("hidden");
        },
        onDone: async (sideReport, points, faceDir, review) => {
          closeSide();
          lastSide = {
            points,
            faceDir,
            // The reviewed copy the flow now hands back, falling back to the
            // one captured earlier in this scan. Preferring the handoff means
            // the photo submitted with a correction is exactly the photo the
            // correction was made on, rather than whatever the earlier step
            // happened to leave behind.
            photo: review.photo ?? lastSide?.photo,
            automaticPoints: review.automaticPoints,
            seedMethod: review.seedMethod,
            feedback: review.feedback ?? undefined,
          };
          startConsentedSideFeedback();
          await runFullAnalysis(sideReport, token);
        },
      });
    },
    // Changing the reference population re-runs BOTH views and the merge. It
    // cannot just relabel: every percentile, every region and the side metrics
    // are all scored against the chosen population, so a relabel would leave
    // the numbers describing a group the header no longer names.
    onSexChange: (sex: Sex) => {
      selectedSex = sex;
      // A toggle on a GUEST's results is about the guest — it must not
      // overwrite the browser's remembered population, which seeds the
      // owner's next preselect.
      if (!scanSubject) storeSex(sex);
      paintRefPop();
      if (!lastSide) return;
      // The corrected cloud when there is one: switching population must not
      // silently throw away the points somebody just fixed by hand.
      const f = analyze(editedLandmarks ?? landmarks, width, height, sex, frontShot);
      const sd = analyzeSide(lastSide.points, lastSide.faceDir, sex);
      const merged = mergeReports(f, sd);
      const rescoredDelta = compareAndStore(merged, token.scanId, scanSubject ?? undefined);
      renderQualityChips(quality, `Scored against ${sex} norms`);
      renderResults({ ...ctxArgs, report: merged, delta: rescoredDelta });
    },
  };
  track("results-shown");
  renderResults(ctxArgs);
  scanSession.transition(token, "results");

  // The plan renders locked and unlocks in place if this comes back positive.
  // Deliberately not awaited: a finished analysis must never wait on a billing
  // read, and a failed read leaves the paywall up rather than giving Max away.
  void refreshMaxAccess();

  exposeDev(report, landmarks, quality);
  // Any redirect-survival copy has served its one purpose. The full-size
  // captures remain in memory for this result; the reduced temporary copies
  // are removed from device storage immediately.
  clearPendingAnalysis();
  resumePendingStarted = false;
}

// The visitor has completed both photographs before we ask for an account.
// That ordering is the acquisition flow: let them experience the scan first,
// then ask for identity only at the moment the result becomes valuable.
async function gateAnalysis(
  sideReport: Report,
  token = scanSession.currentToken(),
): Promise<void> {
  if (!pending || !token || !scanSession.isCurrent(token)) return;
  const generation = scanGeneration;
  // A temporary auth/session read failure must never strand a signed-out user
  // on an empty result view. Treat an unreadable session as signed out and
  // present the account gate, which remains usable as the fallback screen even
  // if the modal itself cannot open.
  const user = await currentUser().catch(() => null);
  if (!scanIsCurrent(token, generation) || !pending) return;
  if (!isAuthAvailable() || user || DEV_OPEN_REPORT) {
    if (DEV_OPEN_REPORT && !user) {
      activateScanOwner(null);
      // The gate is only the first door. Without an entitlement every region
      // tab renders as the blurred preview, so a browser check that got past
      // sign-in would still never see a real measurement row — which is where
      // the overlay, the ideal window and the population line all live.
      setMaxAccess(true);
      setAdult(true);
      setDepth("plan");
    }
    const owner = activeScanOwner();
    if (owner && scanSession.snapshot().owner !== owner) scanSession.claim(token, owner);
    // A signed-in account reached without the capture ever asking whose face
    // this is (signed in from another tab mid-scan) is asked now, before the
    // scan is attributed to anyone.
    if (user && !(await askLateSubject())) return;
    if (!scanIsCurrent(token, generation) || !pending) return;
    if (!scanSession.transition(token, "analyzing")) return;
    startConsentedSideFeedback();
    await runFullAnalysis(sideReport, token);
    return;
  }

  const saved = pending && lastSide
    ? savePendingAnalysis({
        scanId: token.scanId,
        sex: selectedSex,
        front: { ...pending, canvas: el.photoCanvas },
        side: {
          points: lastSide.points,
          faceDir: lastSide.faceDir,
          canvas: lastSide.photo,
          automaticPoints: lastSide.automaticPoints,
          seedMethod: lastSide.seedMethod,
          feedback: lastSide.feedback,
        },
      })
    : false;
  if (!scanSession.transition(token, "gate")) return;

  el.upload.classList.add("hidden");
  el.main.classList.remove("hidden");
  el.frame.classList.remove("scanning");
  el.capRight.textContent = "SCAN READY";
  el.status.innerHTML = saved
    ? "<b>Both views captured.</b> Sign up or log in to run the analysis."
    : "<b>Both views captured.</b> Sign in with an existing account to continue.";
  el.barFill.style.width = "100%";
  // The result exists before the account does. The analysis is pure, on-device
  // arithmetic, so it is computed here and shown BLURRED behind the gate: the
  // person sees the shape of their own finished result — the big number, their
  // region scores, all unreadable — instead of a wall claiming a result that,
  // for all they know, might not exist. "Sign up to see what is already there"
  // and "sign up and then we will run it" are different promises, and only the
  // first one is the acquisition flow this screen was meant to be.
  let preview = "";
  let teaser: { overall: number; regionCount: number } | undefined;
  try {
    if (pending) {
      const front = analyze(pending.landmarks, pending.width, pending.height, selectedSex);
      const merged = sideReport ? mergeReports(front, sideReport) : front;
      teaser = { overall: merged.overall, regionCount: merged.regions.length };
      preview = `<div class="lockblur gate-preview" aria-hidden="true" inert>
        <div class="gate-prev-score">${merged.overall.toFixed(1)}<small>/10</small></div>
        <div class="gate-prev-grid">${merged.regions
          .slice(0, 8)
          .map((g) => `<div class="gate-prev-cell"><span>${REGION_NAMES[g.region]}</span><b>${g.score.toFixed(1)}</b></div>`)
          .join("")}</div>
      </div>`;
    }
  } catch {
    // A preview that cannot be computed just is not shown; the gate still works.
  }
  track("gate-shown");
  el.analysis.innerHTML = `<div class="lockwrap">
    ${preview}
    <section class="analysis-gate${preview ? " over-preview" : ""}">
    <span class="klabel">RESULTS ARE READY</span>
    <h2>Create an account to see your analysis</h2>
    <p>Your result is computed and sitting behind this blur — it never left this device. Sign up or log in to open it. ${lastSide?.feedback
      ? "The side feedback you approved is sent privately after sign-in."
      : ""}</p>
    ${saved ? "" : `<p class="analysis-gate-warn">This browser could not preserve the scan through an email or social redirect. Use an existing password login to keep this result.</p>`}
    <button type="button" class="btn pri analysis-gate-open">Create account and see my results</button>
  </section></div>`;

  // Under the button, never above it. The demo is there to make the wait worth
  // it, not to compete with the thing being asked for.
  gateDemo?.stop();
  const gateSection = el.analysis.querySelector<HTMLElement>(".analysis-gate");
  if (gateSection) gateDemo = mountGateDemo(gateSection);

  const openGate = async () => {
    await openAccount({
      initialMode: saved ? "signup" : "password",
      reason: "analysis",
      teaser,
      onDeferred: () => {
        el.status.innerHTML = "<b>Scan saved on this device.</b> Open the newest email link to continue.";
      },
      onAuthenticated: async (signedInUser) => {
        // Supabase emits SIGNED_IN before signInWithPassword resolves. Claim
        // this continuation before the deferred auth listener gets a turn, so
        // one password login cannot analyze and append history twice.
        if (saved) resumePendingStarted = true;
        scanSession.claim(token, `user:${signedInUser.id}`);
        // The capture ran signed out, so nobody was ever asked whose face
        // this is — and the person signing in at the gate is not necessarily
        // the person in the photographs (an owner's expired session, a
        // friend's scan). Attribution happens only after the answer.
        if (!(await askLateSubject())) return;
        startConsentedSideFeedback();
        await runFullAnalysis(sideReport, token);
      },
    }).catch(() => {
      // Keep the visible inline gate available if a browser blocks or fails to
      // mount the modal. The user can retry without losing the scan.
      el.status.innerHTML = "<b>Your scan is ready.</b> Sign up or log in to continue.";
    });
  };
  el.analysis.querySelector(".analysis-gate-open")?.addEventListener("click", () => void openGate());
  // Mount after the result shell has painted. This avoids mobile browsers
  // dropping the overlay while the capture view is being replaced.
  requestAnimationFrame(() => void openGate());
}

let resumePendingStarted = false;
async function resumePendingAfterAuth(): Promise<void> {
  if (resumePendingStarted) return;
  const generation = scanGeneration;
  const user = await currentUser();
  if (generation !== scanGeneration || !user) return;
  const saved = claimPendingAnalysis(user.id);
  if (!saved) return;

  // The weekly gate is asked HERE, because this is the first point where there
  // is an account to ask about. scanGate.ts lets signed-out capture run to the
  // end for that reason, so without this check the limit would be bypassed by
  // simply signing out before scanning.
  //
  // Asked before anything is torn down: a blocked resume leaves the upload
  // screen exactly as it was and the capture still in storage, so buying a
  // credit and coming back finishes the scan rather than restarting it.
  // ensureScanAllowed spends a held credit when it passes, so the answer is
  // also the payment.
  if (!(await ensureScanAllowed(() => undefined))) return;
  if (generation !== scanGeneration) return;

  resumePendingStarted = true;
  const token = scanSession.resume(`user:${user.id}`, saved.scanId);

  // Decoded into a canvas this scan OWNS, then copied onto the shared pane —
  // rather than decoded straight onto the pane and read back later. The pane is
  // repainted by the scan animation and by the side flow; pending.photo must
  // survive both. See PendingFront.
  const frontShot = document.createElement("canvas");
  const frontOk = await drawStoredPhoto(
    frontShot,
    saved.front.photo,
    saved.front.width,
    saved.front.height,
  );
  if (!scanIsCurrent(token, generation)) return;
  if (!frontOk) {
    resumePendingStarted = false;
    resetToUpload();
    return;
  }
  el.photoCanvas.width = frontShot.width;
  el.photoCanvas.height = frontShot.height;
  el.photoCanvas.getContext("2d")!.drawImage(frontShot, 0, 0);

  let sidePhoto: HTMLCanvasElement | undefined;
  if (saved.side.photo) {
    sidePhoto = document.createElement("canvas");
    const sideOk = await drawStoredPhoto(
      sidePhoto,
      saved.side.photo,
      saved.side.width,
      saved.side.height,
    );
    if (!scanIsCurrent(token, generation)) return;
    if (!sideOk) sidePhoto = undefined;
  }

  selectedSex = saved.sex;
  sexChosen = true;
  paintRefPop();
  pending = {
    landmarks: saved.front.landmarks,
    width: saved.front.width,
    height: saved.front.height,
    quality: saved.front.quality,
    autoNote: saved.front.autoNote,
    photo: frontShot,
    // A resumed scan has only the one stored photograph. Storing the whole
    // burst would multiply what a paused scan keeps on the device by five for a
    // gain that is gone the moment the frames are measured — so a resume scores
    // from one frame and says so by simply having none.
    extraFrames: [],
  };
  lastSide = {
    points: saved.side.points,
    faceDir: saved.side.faceDir,
    photo: sidePhoto,
    automaticPoints: saved.side.automaticPoints,
    seedMethod: saved.side.seedMethod,
    feedback: saved.side.feedback,
  };
  closeSide();
  el.upload.classList.add("hidden");
  el.main.classList.remove("hidden");
  // A resumed scan crossed a redirect, so whatever the subject chooser knew is
  // gone with the page it was answered on — and this scan may have been
  // captured before sign-in ever happened. Ask before attributing.
  if (!(await askLateSubject())) return;
  if (!scanIsCurrent(token, generation)) return;
  // Remember the population only once it is known to be the OWNER's answer —
  // a resumed scan can turn out to be a guest's, and the global key seeds the
  // owner's next preselect.
  if (!scanSubject) storeSex(saved.sex);
  startConsentedSideFeedback();
  await runFullAnalysis(analyzeSide(saved.side.points, saved.side.faceDir, saved.sex), token);
}

function startSide(): void {
  const token = scanSession.currentToken();
  if (!token || !scanSession.transition(token, "side")) return;
  feedbackDeliveryNote = null;
  el.main.classList.add("hidden");
  const openSide = () => openSideCapture({
    scanId: token.scanId,
    sex: selectedSex,
    // Carry the front's capture method so the side does not make the user
    // switch: camera stays camera, upload stays upload.
    method: captureMethod ?? undefined,
    // There is no "back to results" any more, because there are no results yet.
    // The only way out of this step is forward, or starting over.
    onBack: () => resetToUpload(),
    onDone: async (sideReport, points, faceDir, review) => {
      // Copy the profile out before the side screen is torn down — the results
      // panel shows it under the Side tab, and after closeSide() the canvas it
      // lives on is fair game.
      const shot = document.getElementById("side-canvas") as HTMLCanvasElement | null;
      let photo: HTMLCanvasElement | undefined;
      if (shot?.width) {
        photo = document.createElement("canvas");
        photo.width = shot.width;
        photo.height = shot.height;
        photo.getContext("2d")!.drawImage(shot, 0, 0);
      }
      closeSide();
      // Counted here and not in the redo path, so adjusting the points on the
      // same profile cannot count one person's side scan twice.
      track("scan-side-done");
      lastSide = {
        points,
        faceDir,
        photo,
        automaticPoints: review.automaticPoints,
        seedMethod: review.seedMethod,
        feedback: review.feedback ?? undefined,
      };
      (window as unknown as Record<string, unknown>).__truemaxSide = sideReport;
      // The verified points, for the calibration harnesses — re-scoring the
      // profile under a different reference population needs the input, not
      // the finished report.
      (window as unknown as Record<string, unknown>).__truemaxSidePoints = { points, faceDir };
      await gateAnalysis(sideReport, token);
    },
  });
  // The profile is the shot people get wrong most, so it gets its own offer
  // and its own memory of the answer: somebody who has the front down may
  // still be turning only halfway.
  offerTutorial("side", openSide);
}

function renderQualityChips(q: QualityCheck, autoNote = ""): void {
  const chips = q.issues.map((i) => `<span class="qchip warn">${i}</span>`);
  if (autoNote) chips.push(`<span class="qchip">${autoNote}</span>`);
  if (feedbackDeliveryNote) {
    chips.push(`<span class="qchip${feedbackDeliveryNote.ok ? "" : " warn"}">${feedbackDeliveryNote.message}</span>`);
  }
  // Surfacing the correction is part of showing the math: the user can see
  // that an off-axis photo was accounted for rather than silently mismeasured.
  const off = Math.max(Math.abs(q.yawDeg), Math.abs(q.pitchDeg));
  if (off >= 6) chips.push(`<span class="qchip">Pose-corrected · ${off.toFixed(0)}° off-axis</span>`);
  if (!chips.length) chips.push(`<span class="qchip">Capture quality: good</span>`);
  el.qualityChips.innerHTML = chips.join("");
}

function exposeDev(report: Report, landmarks: unknown, quality: unknown): void {
  (window as unknown as Record<string, unknown>).__truemax = {
    report,
    landmarks,
    quality,
    // Console helper for building the celebrity DB from real scans:
    // copy(window.__truemax.celebEntry("Name")) → paste into src/engine/celebs.ts
    celebEntry: (name: string) => toCelebEntry(report, name),
    poseCalibration: POSE_CALIBRATION,
  };
}

// Phone photos are the hard case: they carry EXIF rotation (a portrait shot
// decodes sideways unless honoured) and iPhones default to HEIC, which only
// Safari can decode. createImageBitmap applies EXIF for us where supported;
// the <img> path is the fallback, and browsers apply EXIF there too.
async function loadImage(file: File): Promise<CanvasImageSource & { width: number; height: number }> {
  if (typeof createImageBitmap === "function") {
    try {
      return await createImageBitmap(file, { imageOrientation: "from-image" } as ImageBitmapOptions);
    } catch {
      /* fall through to the <img> decoder */
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return Object.assign(img, { width: img.naturalWidth, height: img.naturalHeight });
  } catch {
    const heic = /.hei[cf]$/i.test(file.name) || /hei[cf]/i.test(file.type);
    throw new Error(
      heic
        ? "HEIC photos can't be read by this browser. On iPhone: Settings › Camera › Formats › Most Compatible, or share the photo as JPEG."
        : "That image couldn't be read. Try a JPG or PNG.",
    );
  } finally {
    URL.revokeObjectURL(url);
  }
}

function nextFrame(): Promise<void> {
  return new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));
}

// INITIAL_SESSION handles an OAuth or confirmation redirect, while SIGNED_IN
// covers an immediate password flow. The guard makes the two events harmless
// when Supabase emits both for one navigation.
if (isAuthAvailable()) {
  // Also performs expiry cleanup for a signed-out visitor returning later.
  clearExpiredPendingAnalysis();
  let previousUserId: string | null | undefined;
  onAuthChange((user) => {
    // Acquisition copy is for people who have not signed up. A member scrolling
    // under their own capture stage does not need to be re-sold the free score
    // or walked through what an account is for — style.css hides the proof and
    // journey sections behind this class.
    document.body.classList.toggle("is-member", Boolean(user));
    const nextUserId = user?.id ?? null;
    const identityChanged = previousUserId !== undefined && previousUserId !== nextUserId;
    if (identityChanged) {
      clearResultsIdentityState();
      closeScanGate();
      closeDashboard();
      closeHistory();
      closeSettings();
      closeTrialFunnel();
    }
    // Signing out, or replacing one authenticated identity with another, is a
    // hard scan boundary. Anonymous -> authenticated is the intentional claim
    // path and keeps the just-captured canvases alive.
    if (previousUserId && previousUserId !== nextUserId) {
      void closeCamera();
      closeSide();
      resetToUpload();
    }
    // Anonymous -> authenticated is the only identity transition allowed to
    // keep an active scan. It is the same tab claiming the in-memory capture;
    // redirect-restored captures still pass the separate one-time token check.
    if (!previousUserId && user) {
      const token = scanSession.currentToken();
      if (token && scanSession.snapshot().owner?.startsWith("anonymous:")) {
        scanSession.claim(token, `user:${user.id}`);
      }
    }
    previousUserId = nextUserId;
    syncLandingHistory();
    // Repainted here rather than at module load because both halves of the
    // headline — the name and the scan history — only exist once the session
    // has resolved. Until then the static markup stands, and the static markup
    // is the visit-0 line, so there is no flash of a wrong headline.
    syncLandingHeadline(user ? displayName(user) : null);
    void refreshHomeBrand(user);
    // A new account has answered nothing yet. Asking here — rather than at the
    // first moment the app needs a name or an age — means the questions arrive
    // as part of signing up instead of interrupting a scan.
    if (user) void ensureOnboarded(user);
    // Give an in-page password flow the first chance to continue with its
    // full-resolution canvases. OAuth and email-confirmation returns have no
    // in-page callback, so the saved scan resumes on the next navigation.
    if (user) setTimeout(() => void resumePendingAfterAuth(), 0);
    // Consented side-landmark feedback that could not be sent earlier because
    // there was no session yet. The consent flow runs BEFORE the account gate
    // on a first scan, so the first attempt always lacked a token and the note
    // read "could not be sent" to exactly the people whose corrections matter
    // most. The photo and points are still held in lastSide; send them now.
    if (user) void submitConsentedSideFeedback();
  });
} else {
  paintHomeBrand("guest");
  // No-accounts build: nobody can ever be named, so the headline rotates
  // through the signed-out set only.
  syncLandingHeadline(null);
}
