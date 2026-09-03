import type { NormalizedLandmark } from "@mediapipe/tasks-vision";
import { captureAttribution } from "./engine/attribution.js";
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
import { loadArchive, pruneArchivesTo, saveArchive } from "./engine/scanArchive.js";
import { setSidePriorSuspended, writeSidePrior } from "./engine/sidePrior.js";
import { closeScanRecall, setScanReopen } from "./ui/scanRecall.js";
import type { StoredScan } from "./engine/history.js";
import { maybeAdoptAvatar } from "./engine/avatar.js";
import { toCelebEntry } from "./engine/celebs.js";
import { readOrientation } from "./engine/exif.js";
import type { Report, Sex } from "./engine/types.js";
import { drawLandmarksAnimated, drawCalm } from "./ui/overlay.js";
import { buildPassPlan, runMeasurePass } from "./ui/measurePass.js";
import { applyZoom, IDENTITY_ZOOM } from "./ui/zoomTransform.js";
import { landPhoto } from "./ui/photoLanding.js";
import { clearResultPhotoRecovery, clearResultsIdentityState, currentCeiling, renderResults, setAdult, setBirthDate, setDepth, setMaxAccess, setPathwayState } from "./ui/results.js";
import { clearScoreStrip } from "./ui/scoreStrip.js";
import { closeMaxChat } from "./ui/maxChat.js";
import {
  closeScanGate,
  consumePendingScanCredit,
  discardPendingScanCredit,
  ensureScanAllowed,
  guestOnlyNow,
  guestScansLeft,
  recordScanRun,
} from "./ui/scanGate.js";
import { setMemberPricing } from "./engine/scanPricing.js";
import { mountGateDemo } from "./ui/gateDemo.js";
import { enablePhotoPaste, pasteHintApplies } from "./ui/pastePhoto.js";
import { mergeReports } from "./engine/scoring.js";
import {
  openSideAdjust,
  openSideCapture,
  prepareSidePlacementChoice,
  close as closeSide,
} from "./ui/sideFlow.js";
import { openFrontEdit } from "./ui/frontEdit.js";
import { analyzeSide } from "./engine/scoring.js";
import type { SidePoints } from "./engine/sideMetrics.js";
import { submitSideCorrectionFeedback } from "./engine/sideFeedback.js";
import type { SideFeedbackIntent, SideSeedMethod } from "./engine/sideFeedbackPayload.js";
import { cameraCount, isSupported, overrideGlasses, resetGlassesOverride, startCamera } from "./ui/camera.js";
import {
  clearCameraTakeover,
  enterCameraTakeover,
  exitCameraTakeover,
  flipThrough,
} from "./ui/camTakeover.js";
import { mountDemoReel } from "./ui/demoReel.js";
import { closeHistory, openHistory } from "./ui/historyView.js";
import { loadPhotos } from "./engine/photoStore.js";
import { createSettler } from "./engine/captureSettle.js";
import { mountAccountButton, openAccount } from "./ui/authModal.js";
import type { OpenAccountOptions } from "./ui/authModal.js";
import { currentUser, isAuthAvailable, onAuthChange } from "./engine/auth.js";
import {
  clearPurchaseResult,
  consumePurchaseResult,
  hasMaxAccess,
  hasMaxOrStaffAccess,
  consumeScanCreditForScan,
  loadEntitlement,
  loadIsAdmin,
  loadScanCredits,
  reconcilePurchase,
} from "./engine/entitlement.js";
import { TRIAL_SCANS, depthFor, freeScansLeft, tierOf } from "./engine/depth.js";
import type { EntitlementTier } from "./engine/entitlement.js";
import type { User } from "@supabase/supabase-js";
import { openSexChooser } from "./ui/sexChooser.js";
import { openSubjectChooser, selfLockFor } from "./ui/subjectChooser.js";
import type { SelfLock } from "./ui/subjectChooser.js";
import {
  clearDeclinedCache,
  declinedNow,
  loadTrialDeclined,
  nextDeclinedCache,
  setDeclinedCache,
} from "./engine/trialDecline.js";
import { loadProfile, saveProfile } from "./engine/goals.js";
import { createAutoCapture } from "./ui/autoCapture.js";
import { automaticCaptureDetail } from "./ui/captureCopy.js";
import type { AutoCapture } from "./ui/autoCapture.js";
import { closeScanConfirm, confirmScanAction } from "./ui/scanConfirm.js";
import { close as closeDashboard, openDashboard } from "./ui/dashboard.js";
import { mountFaceOutline } from "./ui/faceOutline.js";
import type { CameraHandle } from "./ui/camera.js";
import { stillFrameStats } from "./engine/captureGuide.js";
import type { FrameCheck } from "./engine/captureGuide.js";
import { estimateGaze } from "./engine/gaze.js";
import { analyzeSkin } from "./engine/skin.js";
import { detectSkinPatterns } from "./engine/skinPatterns.js";
import { softTissueFromLandmarks } from "./engine/softTissue.js";
import { storeSex, storedSex } from "./engine/sexPref.js";
import { offerBothTutorials, playTutorial, tutorialSuppressed } from "./ui/photoTutorial.js";
import { soundChapter } from "./ui/scanSounds.js";
import { detectOcclusion } from "./engine/occlusion.js";
import { frontPhotoRejection, frontPhotoWarnings, landmarkBox } from "./engine/photoEligibility.js";
import { headCoveringRejection } from "./engine/photoEligibility.js";
import { detectHeadCovering, warmHeadCovering } from "./engine/headCovering.js";
import { REGION_LANDMARKS } from "./ui/regions.js";
import {
  claimPendingAnalysis,
  clearExpiredPendingAnalysis,
  clearPendingAnalysis,
  drawStoredPhoto,
  savePendingAnalysis,
} from "./engine/pendingAnalysis.js";
import { activateScanOwner, activeScanOwner } from "./engine/scanScope.js";
import { isIntentionalNavigation } from "./engine/navigationIntent.js";
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
import { beginAnalysisHandoff } from "./ui/analysisHandoff.js";
import type { AnalysisHandoffRun } from "./ui/analysisHandoff.js";
import { readBody } from "./engine/bodyProfile.js";
import { openBodyProfileDialog } from "./ui/bodyProfileDialog.js";

// Ingest cap, and it is an EXPORT setting as much as a detection one.
//
// This was 1280, and /quick raised its own copy to 2160 for exactly the reason
// written beside it there: the rundown frame is authored at 720x1280 and
// encoded at 1080x1920, the photograph fills most of that height, and the crop
// is roughly a face-and-a-half tall. A 1280-tall source is therefore magnified
// past 2x into every frame of the paid video, which is what "still kind of
// pixelated" looks like. The fix never reached this file, so the $2.99 product
// shipped with the softer of the two ingests.
//
// Detection cost is unchanged: MediaPipe resizes internally. Only the one-off
// skin pass pays for the extra pixels, once, off the render path.
const MAX_IMAGE_DIM = 2160;

// Torn down whenever the gate is replaced, so a stale reel cannot keep painting
// into a canvas that is no longer on the page.
let gateDemo: { stop(): void } | null = null;

// Access to the report that is currently on screen is priced against the
// history that existed BEFORE that report was stored. Otherwise the second
// included scan writes row two and immediately locks itself. A paid scan keeps
// the credit it consumed attached to this one report, even though the balance
// is now zero.
let resultAccessContext: { scanId: string; priorScanCount: number } | null = null;

// Read the entitlement and tell the results screen. Never throws: a billing
// read that fails leaves the plan locked, which is the safe direction — it
// shows a paywall to a paying customer, who can retry, rather than handing the
// paid product to everyone the moment Supabase has a bad minute.
// Whether the lead action offers to build a pathway or to open the one that
// already exists.
//
// Only the session decides it. Somebody signed in has answered the questions
// (`ensureOnboarded` makes sure of that on every route into the app) and the
// plan tab renders from their scan and their saved goals, so there is nothing
// left for a six-step quiz to collect. This is a much cheaper read than the
// entitlement one, and it deliberately does not consult billing: a free
// account still has a plan to look at, and the quiz would not sell them
// anything they have not already been offered.
//
// Failure leaves it at "build", the safe direction: worst case an account
// holder taps once more than they needed to.
async function refreshPathwayState(): Promise<void> {
  const generation = scanGeneration;
  try {
    // No owner guard around this await, deliberately, unlike refreshMaxAccess.
    // currentUser() calls activateScanOwner() itself, so comparing a
    // pre-call owner against the post-call one compares against a value this
    // very call may have just rewritten — and it rewrites it precisely when
    // the session has gone away, which is the one case the state MUST update.
    // The generation check alone is the correct guard: it discards a result
    // belonging to a previous scan without also discarding a sign-out.
    const user = await currentUser();
    if (generation !== scanGeneration) return;
    setPathwayState(user ? "plan" : "build");
  } catch {
    /* Left at "build". */
  }
}

// The tier the last entitlement read resolved to.
//
// The subject chooser needs it to know how many other people this account may
// still scan, and it runs on a path with no network read of its own — the
// `is-member` body class it already consults says member or not, which cannot
// tell Starter's three a week from Max's fifty. Defaults to "free", so a read
// that has not landed yet offers no guest scans rather than fifty.
let lastKnownTier: EntitlementTier = "free";
// Staff may inspect Max surfaces, but only an actual paid Max entitlement
// triggers the mandatory body-details setup. Access and purchase are different
// facts, and a staff flag must never masquerade as a subscription.
let lastKnownPaidMax = false;


async function refreshMaxAccess(): Promise<void> {
  const owner = activeScanOwner();
  const generation = scanGeneration;
  // The scan count comes from local history rather than the account, because it
  // is not a billing fact: it decides how much of the analysis to show, not
  // what anyone is charged. Reading it from the device keeps a free allowance
  // working before there is anything on the server to read.
  const scanCount = resultAccessContext?.priorScanCount ?? ownScans(readAllHistory()).length;
  try {
    // Credits and the staff flag each fall back to "no" on their own failure,
    // so one unreachable table cannot take the whole entitlement read down with
    // it — and both fail in the locked direction.
    const [entitlement, credits, admin, declined] = await Promise.all([
      loadEntitlement(),
      loadScanCredits().catch(() => 0),
      loadIsAdmin().catch(() => false),
      // Its own catch, like credits and the staff flag: one unreachable column
      // must not take the whole entitlement read down with it. UNDEFINED is
      // the failure, though, and null is a successful read that found no
      // stamp. loadTrialDeclined throws rather than returning null precisely
      // so the caller can tell those apart, and catching to null threw that
      // away: a declined account that took this one read offline came back as
      // "never declined" and had its own face handed back to it.
      currentUser()
        .then((user) => (user ? loadTrialDeclined(user) : null))
        .catch(() => undefined),
    ]);
    if (owner !== activeScanOwner() || generation !== scanGeneration) return;
    let currentPaidScan = false;
    if (
      resultAccessContext
      && !admin
      && tierOf(entitlement) === "free"
      && scanCount >= TRIAL_SCANS
    ) {
      const use = await consumeScanCreditForScan(resultAccessContext.scanId).catch(() => null);
      if (owner !== activeScanOwner() || generation !== scanGeneration) return;
      currentPaidScan = use?.consumed === true;
    }
    setMaxAccess(hasMaxOrStaffAccess(entitlement, admin));
    lastKnownPaidMax = hasMaxAccess(entitlement);
    // Which of the two scan prices this account is quoted, everywhere it is
    // quoted. A live subscription of any tier is a member.
    lastKnownTier = tierOf(entitlement);
    // A live subscription overrides an old decline outright. Somebody who
    // declined and later subscribed has un-declined by paying, and leaving the
    // stamp in force would lock a paying customer out of their own face. That
    // holds even when the stamp itself could not be read, which is why the
    // paid branch does not consult `declined` at all.
    setDeclinedCache(nextDeclinedCache(lastKnownTier, declined, declinedNow()));
    setMemberPricing(lastKnownTier !== "free");
    setDepth(
      depthFor({ entitlement, scanCount, credits: currentPaidScan ? Math.max(1, credits) : credits, admin }),
      freeScansLeft({ entitlement, scanCount }),
    );
  } catch {
    if (owner !== activeScanOwner() || generation !== scanGeneration) return;
    // Both fail closed. A wall shown to a paying customer is recoverable — they
    // retry — where the paid product handed to everybody during an outage is
    // not.
    setMaxAccess(false);
    lastKnownPaidMax = false;
    // The standard price, for the same reason: quoting the member price to
    // somebody we could not confirm is a member sets up a charge that does not
    // match what they were shown.
    setMemberPricing(false);
    // Same direction as everything else in this catch: an unread entitlement
    // must not hand out an allowance nobody confirmed was paid for.
    lastKnownTier = "free";
    // Not reset here: a failed read is not evidence that somebody un-declined,
    // and the last known answer is better than a guess in either direction.
    setDepth(depthFor({ entitlement: null, scanCount }), freeScansLeft({ entitlement: null, scanCount }));
  }
}

markPlatform();
// Which build this browser is running, in the footer. Diagnostic only, and it
// exists because "the fix is not showing" and "the fix is not deployed" look
// identical from a screenshot otherwise.
const stamp = document.getElementById("build-stamp");
if (stamp) stamp.textContent = __BUILD__;
// Where this visit came from, read off the URL before anything else runs.
// First touch wins and it expires; see engine/attribution.ts.
captureAttribution();
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
  camSwap: document.getElementById("cam-swap") as HTMLButtonElement,
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
mountDemoReel(el.reelCanvas, el.reelScore);

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

const returnedPurchase = consumePurchaseResult();
let purchaseReconcileRunning = false;

function showPurchaseNotice(message: string, retry?: () => void): void {
  document.querySelector(".purchase-notice")?.remove();
  const notice = document.createElement("div");
  notice.className = "purchase-notice";
  notice.setAttribute("role", "status");
  notice.setAttribute("aria-live", "polite");
  const text = document.createElement("span");
  text.textContent = message;
  notice.append(text);
  if (retry) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = "Retry";
    button.addEventListener("click", retry, { once: true });
    notice.append(button);
  }
  const close = document.createElement("button");
  close.type = "button";
  close.className = "purchase-notice-close";
  close.setAttribute("aria-label", "Dismiss payment notice");
  close.textContent = "×";
  close.addEventListener("click", () => notice.remove());
  notice.append(close);
  document.body.append(notice);
}

async function reconcileReturnedPurchase(): Promise<void> {
  if (
    purchaseReconcileRunning
    || !returnedPurchase
    || returnedPurchase.status !== "success"
    || !returnedPurchase.sessionId
  ) return;
  purchaseReconcileRunning = true;
  showPurchaseNotice("Confirming your payment…");
  const kind = await reconcilePurchase(returnedPurchase.sessionId);
  purchaseReconcileRunning = false;
  if (kind === "scan") {
    clearPurchaseResult();
    await refreshMaxAccess();
    showPurchaseNotice("Payment confirmed. Your scan credit is ready.");
  } else if (kind === "voice") {
    clearPurchaseResult();
    showPurchaseNotice("Payment confirmed. Your voiced analysis credit is ready.");
  } else {
    showPurchaseNotice(
      "Payment is not confirmed yet. Nothing will be granted twice; retry in a moment.",
      () => void reconcileReturnedPurchase(),
    );
  }
}

if (returnedPurchase?.status === "cancelled") {
  showPurchaseNotice("Checkout was cancelled. Nothing was charged.");
} else if (returnedPurchase?.status === "success" && !returnedPurchase.sessionId) {
  showPurchaseNotice("The payment return was incomplete. Open your account to check your balance.");
}

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
        setSidePriorSuspended(scanSubject !== null);
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
    // Signed OUT only. `is-member` is Boolean(user), so every signed-in
    // account reaches the chooser below, free ones included — an earlier
    // comment here claimed the opposite and was wrong.
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
        setSidePriorSuspended(false);
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
          setSidePriorSuspended(false);
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
  }, undefined, guestScansLeft(lastKnownTier, declinedNow()), selfLockNow());
}

/** The two facts the chooser needs, read at the moment it opens. */
function selfLockNow(): SelfLock {
  return selfLockFor(declinedNow(), guestOnlyNow());
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
        setSidePriorSuspended(scanSubject !== null);
        resolve(true);
      },
      () => {
        resetToUpload();
        resolve(false);
      },
      // The same two limits the early chooser gets. This one was passing
      // neither, which made it the way around both: capture signed out, sign
      // in at the gate, and answer a chooser that had never heard of the
      // guest budget or the decline.
      guestScansLeft(lastKnownTier, declinedNow()),
      selfLockNow(),
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
function markEngine(state: "idle" | "loading" | "ready" | "failed"): void {
  document.documentElement.dataset.engine = state;
}
markEngine("idle");

// ---------------------------------------------------------------------------
// The engine loads when somebody is about to scan, not when the page opens.
//
// It is 6.5 MB over the wire — vision_wasm_internal.wasm at 3.14 MB brotli and
// face_landmarker.task at 3.32 MB — and it used to be fetched at 22ms and
// 287ms into the LANDING PAGE, ahead of any interaction at all. Nothing on the
// landing page needs it: the demo reel runs on pre-computed landmarks and the
// capture buttons were never gated on it. So the first visit on every browser
// paid six and a half megabytes to look at a page that does not measure
// anything, on whatever connection they happened to be on.
//
// Deferring it alone would move that cost onto the tap instead of removing it,
// so the fetch is warmed on INTENT — a pointer landing on a capture button,
// keyboard focus reaching one, a file dragged over the window. By the time the
// camera permission prompt has been answered the engine is usually already in
// memory, and the buttons are not disabled while it loads either way: an
// upload that arrives first waits on the same promise rather than being
// refused.
//
// Automation is the exception and takes the old eager path. Twenty-one tools
// in tools/ open this page and block on `html[data-engine="ready"]` without
// ever touching a button, and they should not each have to learn a new
// handshake to keep measuring faces.
// ---------------------------------------------------------------------------
let slowEngineNote = 0;
let enginePromise: Promise<void> | null = null;

function ensureEngine(): Promise<void> {
  if (enginePromise) return enginePromise;
  markEngine("loading");
  // Only after the load is genuinely slow, so a fast connection never sees a
  // line of copy about a wait that did not happen.
  slowEngineNote = window.setTimeout(
    () => showEngineNote("LOADING ANALYSIS ENGINE · ONE MOMENT"),
    SLOW_ENGINE_MS,
  );
  enginePromise = initLandmarker()
    .then(() => {
      window.clearTimeout(slowEngineNote);
      clearEngineNote();
      markEngine("ready");
    })
    .catch((err: unknown) => {
      window.clearTimeout(slowEngineNote);
      console.error(err);
      showEngineNote("ENGINE FAILED TO LOAD · REFRESH TO RETRY", "error");
      markEngine("failed");
      // Cleared so a later attempt retries rather than re-reading a failure
      // from a minute ago. A dropped connection at the wrong moment should not
      // brick the scan for the rest of the session.
      enginePromise = null;
      throw err;
    });
  return enginePromise;
}

// Intent, not commitment. Swallows its own rejection: a warm that fails is not
// an error anybody asked for, and the real attempt will report it properly.
function warmEngine(): void {
  void ensureEngine().catch(() => {});
  void warmHeadCovering().catch(() => {});
}

for (const target of [el.btnCamera, el.btnUpload]) {
  // pointerenter covers the cursor arriving on desktop; pointerdown covers the
  // thumb landing on a phone, which is a good hundred milliseconds before the
  // click it is going to become. focus covers the keyboard.
  target.addEventListener("pointerenter", warmEngine, { once: true });
  target.addEventListener("pointerdown", warmEngine, { once: true });
  target.addEventListener("focus", warmEngine, { once: true });
}
// Somebody dragging a photo onto the window has decided. Same for a paste.
window.addEventListener("dragover", warmEngine, { once: true });
window.addEventListener("paste", warmEngine, { once: true });

if (navigator.webdriver || new URLSearchParams(location.search).has("eager")) {
  warmEngine();
}

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
      offerBothTutorials(() => {
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
// The owner's first name once their profile has loaded, for Coach Max's
// greeting. Null until then; the greeting drops the name rather than guessing.
let knownFirstName: string | null = null;

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
  knownFirstName = profile.firstName?.trim() || null;
  setAdult(knownAdult);
  // The macro calculator's gate reads the date rather than the flag, because an
  // age it derives itself cannot be a tick box somebody set.
  setBirthDate(profile.dateOfBirth ?? null);
  if (onboardingComplete(profile)) return;
  await openTrialFunnel(user, undefined, { required: true });
}

async function requirePaidMaxBodyProfile(user: User): Promise<void> {
  if (!lastKnownPaidMax || readBody()) return;
  const generation = scanGeneration;
  let profile;
  try {
    profile = await loadOnboardingProfile(user);
  } catch {
    return;
  }
  if (generation !== scanGeneration || activeScanOwner() !== `user:${user.id}`) return;
  // Missing or under-18 dates fail closed. Body and diet planning are never
  // opened by a client-side flag, and an unfinished signup keeps its own gate.
  if (!onboardingComplete(profile) || !profileIsAdult(profile)) return;
  await openBodyProfileDialog({ required: true });
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
    const [entitlement, admin] = await Promise.all([
      loadEntitlement(),
      loadIsAdmin().catch(() => false),
    ]);
    max = hasMaxOrStaffAccess(entitlement, admin);
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
let camOpening = false;
let lastCheck: FrameCheck | null = null;
let autoFront: AutoCapture | null = null;
let frontKeyHandler: ((e: KeyboardEvent) => void) | null = null;
// Wall clock until which the opening capture instruction stays put.
let holdHintUntil = 0;
const HINT_HOLD_MS = 3200;

async function openCamera(): Promise<void> {
  if (cam || camOpening) return;
  camOpening = true;
  const generation = scanGeneration;
  if (!isSupported()) {
    el.camHintDetail.textContent = "This browser can't open a camera, so upload a photo instead.";
    camOpening = false;
    return;
  }
  // Started, not awaited. The camera permission prompt and the engine download
  // are independent, and the guidance loop needs landmarks only once there is
  // a live frame to run them on — so both should be in flight at once rather
  // than the preview waiting behind six megabytes.
  warmEngine();
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
      // Both cameras refused during a swap and the working one is already
      // released: close the viewfinder rather than leave controls over a dead
      // frame, and say why.
      onLost: () => {
        void closeCamera().then(() => {
          el.camHintTitle.textContent = "Camera unavailable";
          el.camHintDetail.textContent = "Switching cameras failed. Try again, or upload a photo.";
        });
      },
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
        el.camHintDetail.textContent = automaticCaptureDetail();
        setCameraLabel(`Capturing in ${remaining}`);
      },
      onFire: () => el.btnCamera.click(),
    });
    // Space or Enter fires the shutter now instead of waiting out the count.
    frontKeyHandler = (e: KeyboardEvent) => {
      // Escape backs out of the viewfinder — a full-screen surface without an
      // Escape route reads as a trap on a keyboard machine.
      if (e.key === "Escape") {
        e.preventDefault();
        el.btnCancel.click();
        return;
      }
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
    // The viewfinder takes the screen. The landing behind it does not move —
    // no headline collapse, no scroll correction, nothing for scroll anchoring
    // to fight about; the directive pill is on screen because the whole
    // interface is.
    enterCameraTakeover(document.getElementById("capture-stage"));
    // Offer the switch only when there is something to switch to. The count is
    // trustworthy here — permission was just granted, so the device list is
    // fully labeled.
    void cameraCount().then((n) => {
      el.camSwap.classList.toggle("hidden", n < 2 || !cam);
    });
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

  } catch {
    el.camHintTitle.textContent = "Camera unavailable";
    el.camHintDetail.textContent = "Permission was denied. You can still upload a photo.";
  } finally {
    camOpening = false;
  }
}

// Tear the live preview down and put the landing screen back exactly as it
// was, celebrity reel and all. Shared by capture and cancel so the two can
// never drift apart and leave the page half in camera mode.
//
// `instant` skips the fold-back animation only. Everything else — the stream,
// the listeners, the HUD, the landmarker mode — is torn down identically, so
// the two paths still cannot drift.
//
// Cancel folds back, because the person really is returning to the landing
// screen and should watch themselves get there. Capture must NOT: the photo
// is taken, the scan is about to run, and a 560ms fold-back of the viewfinder
// into the small landing card put the pre-photo screen on the display for
// half a second in between. Reported as "it takes you back to the pre-photo
// screen, and then it will go through and scan the photo", and that is
// exactly what it was doing.
async function closeCamera(opts: { instant?: boolean } = {}): Promise<void> {
  autoFront?.cancel();
  autoFront = null;
  if (frontKeyHandler) {
    window.removeEventListener("keydown", frontKeyHandler);
    frontKeyHandler = null;
  }
  cam?.stop();
  cam = null;
  lastCheck = null;
  if (opts.instant) clearCameraTakeover();
  else exitCameraTakeover(document.getElementById("capture-stage"));
  el.camSwap.classList.add("hidden");
  el.ovalFrame.classList.remove("live", "ready", "tracking");
  el.stage.classList.remove("live-cam");
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
        // opens: the tutorial is about the photographs, so it belongs at the
        // last moment where neither of them exists yet. Both, here, rather
        // than the front now and the profile later — see offerBothTutorials.
        offerBothTutorials(() => {
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
  // No fold-back: the scan stage takes the screen over from the viewfinder,
  // so animating the viewfinder back down into the landing card would be
  // showing the person a screen they are not going to.
  if (shot) {
    // handleCanvas closes the camera itself, after it has put the scan on the
    // screen. Closing it here as well would reopen the gap this ordering
    // exists to shut.
    await handleCanvas(shot, 1, generation, token, burst.slice(1));
  } else {
    await closeCamera({ instant: true });
    scanSession.reset();
  }
});

el.btnCancel.addEventListener("click", async () => {
  await closeCamera();
});

el.camSwap.addEventListener("click", async () => {
  if (!cam) return;
  // Disabled while the switch is in flight: a second tap mid-switch would race
  // two getUserMedia calls for one camera.
  el.camSwap.disabled = true;
  await cam.swap();
  el.camSwap.disabled = false;
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

// ---------------------------------------------------------------------------
// The leave guard: a finished report is expensive to lose.
//
// A refresh, a back-swipe, or a mis-tap on the browser chrome used to throw
// the whole analysis away silently — and on a phone the back gesture sits a
// centimetre from where a thumb scrolls. Both exits now ask first, only while
// a report is actually on screen: the guard arms when results render and
// disarms the moment the person deliberately starts over, so the landing page
// and the capture flow stay exactly as cheap to leave as they should be.
//
// Two mechanisms because the browser splits the exits in two. beforeunload
// covers refresh, tab close and typed navigation with the browser's own
// dialog. The back button is a history pop, which beforeunload does not see —
// so arming pushes one sentinel history entry, and popping it while guarded
// asks in words. Declining re-pushes the sentinel; accepting steps back past
// where the sentinel sat.
// ---------------------------------------------------------------------------
type LeaveGuard = "scan" | "report";

let leaveGuard: LeaveGuard | null = null;
let guardEntryPushed = false;
let leavePromptOpen = false;

function pushLeaveGuardEntry(): boolean {
  try {
    history.pushState({ tmReport: true }, "");
    guardEntryPushed = true;
    return true;
  } catch {
    guardEntryPushed = false;
    return false;
  }
}

function armLeaveGuard(kind: LeaveGuard): void {
  leaveGuard = kind;
  if (!guardEntryPushed) pushLeaveGuardEntry();
}

function disarmLeaveGuard(): void {
  leaveGuard = null;
}

window.addEventListener("beforeunload", (event) => {
  if (!leaveGuard || isIntentionalNavigation()) return;
  event.preventDefault();
  // Ignored by modern browsers in favour of their own wording; required by
  // older ones for the dialog to appear at all.
  event.returnValue = "";
});

window.addEventListener("popstate", () => {
  if (!leaveGuard) {
    guardEntryPushed = false;
    return;
  }
  // This pop consumed the sentinel. Reinstall it even if the first leave
  // question is still open: repeated iOS back-swipes otherwise walk behind
  // the dialog and leave no guard for a later gesture.
  guardEntryPushed = false;
  if (leavePromptOpen) {
    pushLeaveGuardEntry();
    return;
  }
  leavePromptOpen = true;
  const kind = leaveGuard;
  // Put the sentinel back before waiting for an asynchronous app dialog. A
  // second iOS back-swipe while the question is open must not leave the page
  // behind the dialog. Accepting then skips both the replacement sentinel and
  // this document's original entry.
  pushLeaveGuardEntry();
  void confirmScanAction({
    title: kind === "scan" ? "Leave this scan?" : "Leave this report?",
    copy: kind === "scan"
      ? "Your captured photo and current scan progress will be discarded."
      : "This report will close. You can stay here if that back gesture was accidental.",
    confirmLabel: kind === "scan" ? "Leave scan" : "Leave report",
    cancelLabel: kind === "scan" ? "Keep scanning" : "Keep this report",
  }).then((leave) => {
    leavePromptOpen = false;
    // The scan may have been reset or the account changed while this question
    // was open. A stale answer never rebuilds history for a different run.
    if (leaveGuard !== kind) return;
    if (leave) {
      const sentinelPresent = guardEntryPushed;
      disarmLeaveGuard();
      guardEntryPushed = false;
      if (sentinelPresent) history.go(-2);
      else history.back();
      return;
    }
    if (!guardEntryPushed) pushLeaveGuardEntry();
  });
});

// ---------------------------------------------------------------------------
// Reopening an archived scan as the full interactive report.
//
// The recall sheet stays what it is — the summary — and this is the way
// through it: the stored report, landmarks and side points re-enter the same
// renderResults the live flow uses, so the hover-to-draw measurements, the
// region tabs and the metric drill-down all work on a scan taken weeks ago.
// The photographs are the stored 320px thumbnails, which is soft on a big
// screen and irrelevant to the overlays: landmarks are normalised, so every
// line lands on the anatomy at any resolution.
//
// Rendered as ctx.archived: observations and numbers only. Max reads the
// present and the plan is built from the current scan, so neither speaks
// over a record — the same gating a guest's scan gets.
// ---------------------------------------------------------------------------
function canvasFromDataURL(url: string): Promise<HTMLCanvasElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement("canvas");
      c.width = img.naturalWidth;
      c.height = img.naturalHeight;
      c.getContext("2d")!.drawImage(img, 0, 0);
      resolve(c);
    };
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

async function reopenArchivedScan(scan: StoredScan): Promise<void> {
  const owner = activeScanOwner();
  const generation = scanGeneration;
  const key = scanStorageKey(scan);
  const [archive, photos] = await Promise.all([loadArchive(key), loadPhotos(key)]);
  if (!archive || owner !== activeScanOwner() || generation !== scanGeneration) return;
  const front = photos?.front ? await canvasFromDataURL(photos.front) : null;
  if (owner !== activeScanOwner() || generation !== scanGeneration) return;
  if (!front) {
    // The archive survived a photo prune, or the thumbnail never saved. The
    // report cannot be walked without the face it was measured on.
    window.alert("The photograph for this scan is no longer stored on this device, so it cannot be reopened in full.");
    return;
  }
  const side = photos?.side ? await canvasFromDataURL(photos.side) : null;
  if (owner !== activeScanOwner() || generation !== scanGeneration) return;
  closeHistory();
  closeScanRecall();
  // History is also mounted inside the dashboard. In that route closeHistory
  // has no overlay to remove, so the freshly rendered report used to open
  // correctly *under* the dashboard and the button appeared to do nothing.
  closeDashboard();
  // The results machinery lives on the main screen; a reopen from the landing
  // page has to reveal it exactly as a finished analysis would.
  el.main.classList.remove("hidden");
  el.frame.classList.remove("scanning");
  el.capRight.textContent = "RECALLED";
  el.status.textContent = "";
  armLeaveGuard("report");
  renderResults({
    report: archive.report,
    delta: null,
    landmarks: archive.landmarks,
    photoW: front.width,
    photoH: front.height,
    analysis: el.analysis,
    zoomable: el.zoomable,
    overlay: el.overlayCanvas,
    onNewPhoto: () => resetToUpload(),
    subjectName: archive.subjectName,
    sideReport: archive.sideReport ?? undefined,
    sidePhoto: side ?? undefined,
    sidePoints: archive.sidePoints ?? undefined,
    frontPhoto: front,
    archived: true,
    archivedDate: archive.date,
  });
  el.frame.scrollIntoView({ behavior: "smooth", block: "start" });
}

setScanReopen((scan) => void reopenArchivedScan(scan));

// Another go at the front photograph, inside the same scan.
//
// A retake used to be a reset followed by a press of the capture button, and
// the capture button is the front door: it runs the allowance gate, asks whose
// face this is and which reference population, and offers the tutorial. All
// of that had been answered a minute earlier by the person now pressing
// "Retake photo", and asking again read as the app forgetting. The upload
// path was worse: it reset to the landing card and did nothing at all.
//
// So the answers survive the reset and the capture reopens directly: the
// viewfinder when the front came from the camera, the file picker when it was
// uploaded. The allowance gate is not re-run because this is the SAME scan,
// which is what ensureScanAllowed's own resume path already treats it as; the
// rest of the reset (canvases, pending state, the privacy boundary between two
// people's photographs) still happens, because a retake is still a new capture.
function retakeFront(method: "camera" | "upload" | null): void {
  const kept = {
    sex: selectedSex,
    sexChosen,
    subject: scanSubject,
    subjectAsked,
  };
  resetToUpload();
  selectedSex = kept.sex;
  sexChosen = kept.sexChosen;
  scanSubject = kept.subject;
  subjectAsked = kept.subjectAsked;
  setSidePriorSuspended(scanSubject !== null);
  if (method === "camera") {
    void openCamera();
    return;
  }
  if (method === "upload") {
    filePickerGeneration = scanGeneration;
    el.fileInput.click();
  }
}

function resetToUpload(): void {
  closeScanConfirm();
  disarmLeaveGuard();
  scanGeneration++;
  scanSession.reset();
  clearPendingAnalysis();
  discardPendingScanCredit();
  resultAccessContext = null;
  // A new scan is a hard privacy boundary. Clearing only localStorage left the
  // previous front landmarks, full-resolution canvas and verified side points
  // alive in this tab. A second person could then capture only the side and
  // receive a report rendered over the first person's front photo.
  pending = null;
  lastSide = null;
  captureMethod = null;
  scanSubject = null;
  setSidePriorSuspended(false);
  subjectAsked = false;
  skipCoveringCheck = false;
  feedbackInFlight = null;
  // The sweeping scan animation belongs to a run that no longer exists. Every
  // abandon path inside the scan clears this class; the reset that ends the
  // run from the outside did not, so a scan reset mid-analysis left the upload
  // screen wearing it and the next capture inherited it.
  el.frame.classList.remove("scanning");
  feedbackDeliveryNote = null;
  resumePendingStarted = false;
  // The next capture gets its own film. Keyed by scan ID, so this is belt and
  // braces rather than the mechanism — but a reset is exactly the moment a
  // stale "already measured" would be worth nothing and cost everything.
  clearMeasuredOnScreen();
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
  // shrinking a photo pane that no longer holds a photograph.
  clearScoreStrip();
  clearResultPhotoRecovery();
  closeMaxChat();
}


async function handleFile(file: File, expectedGeneration = scanGeneration): Promise<void> {
  if (expectedGeneration !== scanGeneration) return;
  // Wait for the engine rather than refusing the photo. It used to say "engine
  // still loading" and drop the file on the floor, which asks somebody to
  // guess how long to wait and then pick the same picture again. Now the
  // upload queues behind the load it triggered.
  if (!isReady()) {
    try {
      await ensureEngine();
    } catch {
      return;
    }
    if (expectedGeneration !== scanGeneration) return;
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
  // The photo goes up, and the scan stage takes the screen, BEFORE the camera
  // is torn down. The order matters and it is not cosmetic: closeCamera awaits
  // the landmarker's mode switch, and MediaPipe's setOptions is asynchronous
  // and occasionally slow. Tearing the takeover down first meant the landing
  // layout was what sat under the awaited call, so a slow switch put the
  // pre-photo screen back on the display for as long as it took. Painting
  // first means whatever the await costs is spent behind the scan.
  const width = src.width;
  const height = src.height;
  el.photoCanvas.width = width;
  el.photoCanvas.height = height;
  el.photoCanvas.getContext("2d")!.drawImage(src, 0, 0);

  el.upload.classList.add("hidden");
  el.main.classList.remove("hidden");
  // The photograph settles into the frame before the reading treatment starts
  // over it. Both together would be two things happening to one picture in the
  // same 600ms, and the landing is the one that has to be read.
  landPhoto(el.frame);
  el.frame.classList.add("scanning");
  el.capRight.textContent = "SCANNING";
  el.analysis.innerHTML = "";
  el.qualityChips.innerHTML = "";

  // Uploading while the live preview is running left the landmarker in VIDEO
  // mode, and the still-image detector then threw "Landmarker is in VIDEO
  // mode". Capturing had always torn the camera down first; choosing a file
  // never did. Both go through here now, so both are safe.
  if (cam) await closeCamera({ instant: true });
  if (!scanIsCurrent(token, generation)) {
    // Abandoned mid-handoff. The stage was put up above, so it has to come
    // back down here rather than being left on screen for the next thing.
    el.frame.classList.remove("scanning");
    return;
  }

  // The front photo, kept so the scan can switch back to it after showing the
  // profile being measured.
  const frontShot = document.createElement("canvas");
  frontShot.width = el.photoCanvas.width;
  frontShot.height = el.photoCanvas.height;
  frontShot.getContext("2d")!.drawImage(el.photoCanvas, 0, 0);
  await nextFrame();
  if (!scanIsCurrent(token, generation)) {
    el.frame.classList.remove("scanning");
    return;
  }

  // Real math (milliseconds) happens inside the theatre beat (~2.2s)
  const result = detectStable(el.photoCanvas);
  const quality = assessQuality(result);

  if (!quality.faceFound) {
    el.frame.classList.remove("scanning");
    el.capRight.textContent = "NO FACE FOUND";
    // A real button, not a silent 2.6s timeout. The timeout used to be the
    // only way out of this screen — nothing to press, nothing to read as
    // "try again", just a wait that looked like the app had stalled. Same
    // decision-screen rule as the rejection branch below: it holds until
    // somebody presses something.
    el.status.innerHTML = `<b>No face detected.</b> Try a clearer, front-facing photo.
      <span class="reject-actions">
        <button type="button" class="btn pri" id="noface-retake">Retake the photo</button>
      </span>`;
    el.overlayCanvas.getContext("2d")?.clearRect(0, 0, el.overlayCanvas.width, el.overlayCanvas.height);
    document.getElementById("noface-retake")?.addEventListener("click", () => {
      if (scanIsCurrent(token, generation)) resetToUpload();
    });
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
  if (!scanIsCurrent(token, generation)) {
    // The same tidy-up every other abandon path above does, and the one that
    // was missing. detectHeadCovering is the longest await on this screen, so
    // it is the likeliest place to be abandoned in, and a bare return left the
    // scanning class on the frame: the next screen inherited a sweeping
    // animation belonging to a scan that had already been thrown away.
    el.frame.classList.remove("scanning");
    return;
  }
  if (rejection) {
    el.frame.classList.remove("scanning");
    el.capRight.textContent = "PHOTO NOT VALID";
    // Real buttons, not a footnote. The old screen offered the override as a
    // small text link and no retake at all — the two things a person actually
    // does from here are "take a better photo" and, on the overridable check,
    // "the scanner is wrong, analyse it". Both are decisions, so both get
    // buttons, and the screen holds until one is pressed.
    el.status.innerHTML = `<b>${rejection.title}</b> ${rejection.detail}
      <span class="reject-actions">
        <button type="button" class="btn pri" id="reject-retake">Retake the photo</button>
        ${
          coveringRejection
            ? `<button type="button" class="btn gho" id="covering-override">Nothing is covering, analyse it anyway</button>`
            : ""
        }
      </span>`;
    el.overlayCanvas.getContext("2d")?.clearRect(0, 0, el.overlayCanvas.width, el.overlayCanvas.height);
    document.getElementById("reject-retake")?.addEventListener("click", () => {
      if (scanIsCurrent(token, generation)) resetToUpload();
    });
    if (coveringRejection) {
      // Re-enter the same pipeline with the check waived for one pass. The
      // override exists because the covering check is a heuristic over a
      // segmentation model and the person can see their own head — on this
      // one question they outrank the model.
      document.getElementById("covering-override")?.addEventListener("click", () => {
        if (!scanIsCurrent(token, generation)) return;
        skipCoveringCheck = true;
        void handleCanvas(src, exifOrientation, generation, token, extraFrames);
      });
    }
    // No auto-dissolve in either case: a screen with a decision on it must
    // not vanish while somebody is reading it.
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

  // The side view adds measurements the front cannot see, but it must not hold
  // the front result hostage. Ask for it as a clearly valuable second view and
  // keep a complete front-only path for somebody who is not ready to turn away
  // from the camera or does not have a suitable profile photograph.
  el.frame.classList.remove("scanning");
  el.capRight.textContent = "FRONT CAPTURED";
  drawCalm(el.overlayCanvas, landmarks, width, height);
  armLeaveGuard("scan");
  const method = captureMethod;
  const accepted = await confirmScanAction({
    eyebrow: "CHECK YOUR PHOTO",
    title: "Happy with this front photo?",
    copy: "Use a clear, straight-on photo you are happy to be measured from. Retake it now if it is blurry, tilted or not the photo you want rated.",
    confirmLabel: "Use this photo",
    cancelLabel: "Retake photo",
    preview: frontShot,
    tone: "positive",
  });
  if (!scanIsCurrent(token, generation)) return;
  if (!accepted) {
    retakeFront(method);
    return;
  }
  track("scan-front-done");
  el.status.innerHTML = "<b>Front captured.</b> Add a profile for the full analysis, or continue with the front.";
  const takeSide = await confirmScanAction({
    eyebrow: "OPTIONAL SECOND VIEW",
    title: "And now the side photo",
    copy: "Turn your head 90 degrees so one ear faces the camera. Keep your head level and your full forehead and chin visible. This adds projection, jaw-angle and profile measurements, but you can skip it and see your front analysis now.",
    confirmLabel: "Take side photo",
    cancelLabel: "Skip side photo",
    tone: "positive",
  });
  if (!scanIsCurrent(token, generation)) return;
  if (takeSide) {
    startSide();
    return;
  }
  track("scan-side-skipped");
  await gateAnalysis(null, token);
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
let analysisHandoff: AnalysisHandoffRun | null = null;
// The verified side points, kept so a change of reference population can
// re-score the profile too rather than only the front.
interface LastSide {
  points: SidePoints;
  faceDir: number;
  photo?: HTMLCanvasElement;
  automaticPoints?: SidePoints;
  seedMethod?: SideSeedMethod;
  seedVersion?: string;
  feedback?: SideFeedbackIntent;
  feedbackSubmitted?: boolean;
  /**
   * Whether a human stood behind the thirteen side points.
   *
   * False only when somebody took the automatic placement, was asked whether
   * it looked right, said no, was offered the walkthrough and declined it. The
   * scan is still run: refusing it loses the scan and teaches us nothing, and
   * somebody who will not spend thirty seconds on the rings will not spend
   * them on a retake either. But the report says what it is built on.
   */
  verified?: boolean;
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
      message: "Enough side-landmark feedback shared today: this one was not needed",
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
/**
 * Paint the FRONT capture into the photo pane.
 *
 * The front capture comes from `pending`, which has owned its own copy since
 * the moment it was accepted. It used to be cloned off el.photoCanvas at the
 * top of the analysis — and that runs a second time when a sign-in mid-scan
 * resumes it, by which point the pane may be showing the profile. See
 * PendingFront.
 *
 * Called wherever the pane must agree with the FRONT caption underneath it,
 * regardless of what the measurement pass, or the side flow, left behind.
 */
function paintFrontPane(frontShot: HTMLCanvasElement): void {
  el.photoCanvas.width = frontShot.width;
  el.photoCanvas.height = frontShot.height;
  el.photoCanvas.getContext("2d")!.drawImage(frontShot, 0, 0);
}

/**
 * Which scan has already had its measurement film played on screen.
 *
 * A signed-out capture watches the whole pass BEFORE the account wall goes up,
 * so the wall interrupts a finished measurement instead of an empty screen.
 * Signing in then re-enters runFullAnalysis for the same scan, and without
 * this it would play the identical film a second time.
 *
 * IT HAS TO OUTLIVE THE PAGE, and the first version did not.
 *
 * Module memory alone covers the password sign-in, which never leaves the
 * document. It does not cover the two paths most people take: Google, and the
 * emailed link. Both navigate away and come back to a fresh document, so the
 * variable is null again and resumePendingAfterAuth replays the whole pass on
 * somebody who watched it ninety seconds earlier and has since typed a
 * password into Google. That is the single worst moment in the flow to spend a
 * minute of somebody's attention on a repeat.
 *
 * So the fact is mirrored into localStorage against the scan ID. Not scoped to
 * an identity: it is written while signed OUT and read after signing IN, and an
 * identity-scoped key would be looked for under a scope that did not exist when
 * it was written. The value is a scan UUID and nothing else, one at a time.
 *
 * Cleared when a new scan STARTS rather than when one finishes, which is the
 * difference that matters on the resume path: a finished scan's flag has to
 * survive the redirect that finishes it, so clearing it at the end of
 * runFullAnalysis would delete the thing on the way past the moment it exists
 * for. resetToUpload is the honest boundary, and it is the only one that ever
 * needs to be.
 *
 * A storage failure resolves to "not measured", which replays the film. That
 * is the harmless direction: this flag gates an animation, not an entitlement,
 * so a false negative costs a repeat and a false positive would cost somebody
 * the only demonstration the product gives them.
 */
const MEASURED_KEY = "truemax.measured-scan";
let measuredOnScreenFor: string | null = null;

function markMeasuredOnScreen(scanId: string): void {
  measuredOnScreenFor = scanId;
  try {
    localStorage.setItem(MEASURED_KEY, scanId);
  } catch {
    // Private mode, or storage full. The module copy still covers every
    // same-document path, which is all this could do before.
  }
}

function measuredOnScreen(scanId: string): boolean {
  if (measuredOnScreenFor === scanId) return true;
  try {
    return localStorage.getItem(MEASURED_KEY) === scanId;
  } catch {
    return false;
  }
}

function clearMeasuredOnScreen(): void {
  measuredOnScreenFor = null;
  try {
    localStorage.removeItem(MEASURED_KEY);
  } catch {
    // Nothing to do: the module copy is cleared either way, and a stale entry
    // names a scan ID that can never be current again.
  }
}

/**
 * The measurement film: the mesh landing, then every construction drawn on the
 * face that produced it. It uses the computed metrics to choose the real lines
 * but deliberately leaves their numeric values for the authenticated report.
 *
 * Split out of runFullAnalysis because it is now played from two places. It
 * paints, animates and waits, and it persists nothing: everything it needs is
 * the front report, the optional side report and the two captures. That is
 * what makes it safe to run before there is an account to attribute anything
 * to.
 *
 * Returns false when the scan was superseded while it ran, in which case the
 * caller must stop rather than paint over whatever replaced it.
 */
async function playMeasurePass(
  front: Report,
  sideReport: Report | null,
  token: ScanToken,
  generation: number,
): Promise<boolean> {
  if (!pending) return false;
  const { landmarks, width, height, photo: frontShot } = pending;
  el.main.classList.remove("hidden");
  paintFrontPane(frontShot);
  el.frame.classList.add("scanning");
  el.capRight.textContent = "SCANNING";
  el.analysis.innerHTML = "";
  await nextFrame();
  // The mesh landing is the opening beat, handed to the pass so it waits for
  // the reveal to finish rather than clearing it off the canvas underneath.
  const reveal = drawLandmarksAnimated(el.overlayCanvas, landmarks, width, height);
  const sideShot = lastSide?.photo;
  const plan = buildPassPlan(front, sideReport);
  const progressStart = analysisHandoff?.finish() ?? 0;
  analysisHandoff = null;
  const pass = runMeasurePass(
    {
      zoomable: el.zoomable,
      photoCanvas: el.photoCanvas,
      overlayCanvas: el.overlayCanvas,
      status: el.status,
      barFill: el.barFill,
      capLeft: document.querySelector(".photo-caption span"),
      frame: el.frame,
    },
    {
      front: { photo: frontShot, landmarks, width, height },
      side: sideShot && lastSide
        ? { photo: sideShot, points: lastSide.points, width: sideShot.width, height: sideShot.height }
        : null,
    },
    plan,
    {
      open: reveal.done,
      // The front photograph is already painted and the reveal owns the
      // overlay; repainting would blank it on the pass's first frame.
      startPainted: "front",
      progressStart,
    },
  );
  await pass.done;
  reveal.cancel();
  if (!scanIsCurrent(token, generation) || !pending) {
    pass.cancel();
    return false;
  }
  markMeasuredOnScreen(token.scanId);
  // Back to rest, and with no camera transition attached: the results screen
  // owns this element's zoom from here and must not inherit a half-finished
  // push-in on somebody's chin.
  applyZoom(el.zoomable, IDENTITY_ZOOM);
  return true;
}

async function runFullAnalysis(
  sideReport: Report | null,
  token = scanSession.currentToken(),
): Promise<void> {
  if (!pending || !token || !scanSession.isCurrent(token)) return;
  if (!scanSession.transition(token, "analyzing")) return;
  const generation = scanGeneration;
  const { landmarks, width, height, quality, autoNote, photo: frontShot } = pending;
  el.main.classList.remove("hidden");
  // MEASURE FIRST, THEN SHOW THE MEASURING.
  //
  // This used to run the other way round: eight sentences on a timer, then the
  // analysis. The animation therefore could not show a single real number, and
  // the score arrived with no visible parentage — the exact opposite of what a
  // measurement product should look like while it works. The engine is
  // synchronous and takes milliseconds, so there was never a reason for the
  // wait to come first except that it had always been written that way.
  const front = analyzeFrames(
    [{ landmarks, width, height, source: frontShot }, ...pending.extraFrames],
    selectedSex,
  );
  // Front-only is a real result: mergeReports already returns the front report
  // untouched when the side is absent, so the same call covers both and the
  // results screen's own front-only branch (OVERALL · FRONT ONLY, with an
  // "Add side profile" nudge) does the rest.
  const report = sideReport ? mergeReports(front, sideReport) : front;
  // Beside the score, never in it. The soft-tissue group and the visible skin
  // patterns need the photograph and the landmarks, so they are attached here
  // rather than computed in scoring, and an observation that throws must
  // never cost somebody their scan.
  try {
    const soft = softTissueFromLandmarks(landmarks, width, height);
    if (soft) report.softTissue = soft;
    const patterns = detectSkinPatterns(frontShot, landmarks, width, height);
    if (patterns) report.skinPatterns = patterns;
  } catch {
    // Observations are optional by design.
  }

  // The film may already have played, in front of the account wall rather than
  // behind it — see playMeasurePass. Playing it twice for one capture is the
  // one thing this must not do, so a scan that has already been measured on
  // screen goes straight to its result.
  if (measuredOnScreen(token.scanId)) {
    paintFrontPane(frontShot);
    // The wall was standing in this pane. It is answered, so it goes before
    // renderResults gets here rather than being overwritten by it a few
    // hundred milliseconds later with a Coach Max demo still animating inside.
    gateDemo?.stop();
    gateDemo = null;
    el.analysis.innerHTML = "";
  } else if (!(await playMeasurePass(front, sideReport, token, generation))) {
    return;
  }
  if (!scanIsCurrent(token, generation) || !pending) return;
  const historyBefore = readAllHistory();
  const existingScan = historyBefore.some((scan) => scanStorageKey(scan) === token.scanId);
  const priorScanCount = Math.max(
    0,
    ownScans(historyBefore).length - (existingScan && !scanSubject ? 1 : 0),
  );
  const delta = compareAndStore(report, token.scanId, scanSubject ?? undefined);
  resultAccessContext = { scanId: token.scanId, priorScanCount };
  // The weekly free-scan clock starts when an analysis finishes, not when a
  // photo is chosen — an abandoned capture must not cost the week's scan. A
  // guest's scan does not start it at all: it cannot move the owner's chart,
  // so it should not spend the week that would have.
  recordScanRun(scanSubject !== null);
  // A credit used only to skip the weekly cadence is committed here, after a
  // valid report exists. Bad photos, cancelled cameras and abandoned side
  // flows never reach this point and therefore never spend it.
  await consumePendingScanCredit(token.scanId).catch(() => false);
  if (!scanIsCurrent(token, generation) || !pending) return;

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
    const subjectName = scanSubject?.name;
    const sidePoints = lastSide?.points ?? null;
    const sideDims = lastSide?.photo ? { w: lastSide.photo.width, h: lastSide.photo.height } : null;
    // The owner's confirmed points become the prior for their next scan —
    // their own ears instead of the population template. Never a guest's.
    if (!guest && sidePoints && sideDims) writeSidePrior(sidePoints, sideDims.w, sideDims.h);
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
    // Everything the recall sheet needs to REOPEN this scan interactively —
    // the full report, the landmarks, the side points — beside the thumbnails
    // and pruned by the same history list. See engine/scanArchive.ts.
    await saveArchive(token.scanId, {
      report,
      sideReport: sideReport ?? null,
      landmarks,
      sidePoints,
      subjectName,
      date: new Date().toISOString(),
    });
    if (!scanSession.isCurrent(token, owner)) return;
    // The first front photo a member scans OF THEMSELVES becomes their
    // profile picture. A guest's face must never become the owner's avatar,
    // and an avatar already chosen is never overwritten from here — settings
    // owns changes.
    if (!guest) maybeAdoptAvatar(frontShot);
    const keep = readAllHistory().map(scanStorageKey);
    await pruneTo(keep);
    await pruneArchivesTo(keep);
  })();

  // Leaving `scanning` is what drops the photograph out of the full-screen
  // scan stage and back into the report's 38% column, so it is a geometry
  // change of the same size the camera takeover makes — and it gets the same
  // FLIP rather than a cut.
  flipThrough(el.frame, () => el.frame.classList.remove("scanning"));
  el.capRight.textContent = "ANALYZED";
  el.status.textContent = "";
  el.status.classList.remove("swapping");
  // Retire the bar without animating it backwards. It used to be set straight
  // to width 0 with the 0.4s transition still attached, so the finished bar
  // visibly DRAINED right as the results arrived — the least premium pixel on
  // the screen. Fade it out where it stands, snap the width while invisible,
  // and hand the transition back for whoever runs next.
  el.barFill.parentElement?.classList.add("spent");
  window.setTimeout(() => {
    el.barFill.style.width = "0";
    el.barFill.classList.remove("driven");
    window.setTimeout(() => el.barFill.parentElement?.classList.remove("spent"), 250);
  }, 260);
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
    // The owner's first name, for Coach Max's greeting on their own scans.
    selfName: knownFirstName ?? undefined,
    // Same destination as "continue" — the plan chooser, which already handles
    // signed-out users and the under-18 rule. The upgrade button is not a
    // second, parallel billing path.
    // Both plan doors carry this scan's ceiling onto the offer screen, so the
    // before-and-after strip beside the plan cards is the person's own
    // photograph and their own two numbers. currentCeiling() returns null
    // until a scan is in hand, and the funnel draws nothing rather than
    // reaching for a stand-in face.
    onUpgrade: async () => {
      const ceiling = currentCeiling();
      const user = await currentUser();
      if (user) {
        await openTrialFunnel(user, undefined, { ceiling });
        await refreshMaxAccess();
        return;
      }
      await openAccount({
        reason: "analysis",
        notice: "Create your account to choose a plan.",
        onAuthenticated: async (signedInUser) => {
          await openTrialFunnel(signedInUser, undefined, { ceiling });
          await refreshMaxAccess();
        },
      });
    },
    onContinue: async () => {
      const ceiling = currentCeiling();
      const user = await currentUser();
      if (user) {
        await openTrialFunnel(user, undefined, { ceiling });
        return;
      }
      await openAccount({
        reason: "analysis",
        notice: "Create your account to save your pathway and choose a trial.",
        onAuthenticated: (signedInUser) => openTrialFunnel(signedInUser, undefined, { ceiling }),
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
    // Undefined for a scan restored from history, which predates the flag and
    // cannot be re-litigated. `=== false` is the test downstream, so an absent
    // answer reads as "not told otherwise" rather than as an accusation.
    sideVerified: lastSide?.verified,
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
        seedVersion: lastSide.seedVersion,
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
            seedVersion: review.seedVersion,
            feedback: review.feedback ?? undefined,
            verified: review.verified,
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
      // The corrected cloud when there is one: switching population must not
      // silently throw away the points somebody just fixed by hand.
      const f = analyze(editedLandmarks ?? landmarks, width, height, sex, frontShot);
      const rescored = lastSide
        ? mergeReports(f, analyzeSide(lastSide.points, lastSide.faceDir, sex))
        : f;
      const rescoredDelta = compareAndStore(rescored, token.scanId, scanSubject ?? undefined);
      renderQualityChips(quality, `Scored against ${sex} norms`);
      renderResults({ ...ctxArgs, report: rescored, delta: rescoredDelta });
    },
  };
  track("results-shown");
  armLeaveGuard("report");
  // The report does not cut in — it arrives. The pass has just spent ten
  // seconds moving smoothly over the face; a hard innerHTML swap at the end
  // of it is the one jolt that would undo all of that. The class fades and
  // lifts the whole analysis column in (see .analysis-arrive), and is removed
  // after the animation so later re-renders (tab changes, unlocks) do not
  // replay an entrance nobody is entering.
  el.analysis.classList.add("analysis-arrive");
  window.setTimeout(() => el.analysis.classList.remove("analysis-arrive"), 900);
  renderResults(ctxArgs);
  scanSession.transition(token, "results");

  // The plan renders locked and unlocks in place if this comes back positive.
  // Deliberately not awaited: a finished analysis must never wait on a billing
  // read, and a failed read leaves the paywall up rather than giving Max away.
  void refreshMaxAccess();
  // Same treatment for the lead button's wording: it renders as "Build my
  // pathway" and becomes "See my current plan" in place once the session read
  // says there is an account behind it.
  void refreshPathwayState();

  exposeDev(report, landmarks, quality);
  // Any redirect-survival copy has served its one purpose. The full-size
  // captures remain in memory for this result; the reduced temporary copies
  // are removed from device storage immediately.
  clearPendingAnalysis();
  resumePendingStarted = false;
}

// The visitor has completed the front photograph and, when they chose it, the
// optional profile before we ask for an account. That ordering is the
// acquisition flow: let them experience the scan first, then ask for identity
// only at the moment the result becomes valuable.
async function gateAnalysis(
  sideReport: Report | null,
  token = scanSession.currentToken(),
): Promise<void> {
  if (!pending || !token || !scanSession.isCurrent(token)) return;
  const generation = scanGeneration;
  // Visible before the first await. currentUser() is a network-backed session
  // read and took five seconds on a real iPhone; closeSide() had already
  // removed the profile screen, so waiting to restore #v-main left only the
  // header and footer. The existing scan animation now owns that entire wait.
  analysisHandoff?.finish();
  analysisHandoff = beginAnalysisHandoff(
    {
      upload: el.upload,
      main: el.main,
      frame: el.frame,
      analysis: el.analysis,
      capRight: el.capRight,
      status: el.status,
      barFill: el.barFill,
    },
    () => {
      if (!pending) return;
      paintFrontPane(pending.photo);
      drawCalm(el.overlayCanvas, pending.landmarks, pending.width, pending.height);
    },
  );
  // A temporary auth/session read failure must never strand a signed-out user
  // on an empty result view. Treat an unreadable session as signed out and
  // present the account gate, which remains usable as the fallback screen even
  // if the modal itself cannot open.
  const user = await currentUser().catch(() => null);
  if (!scanIsCurrent(token, generation) || !pending) {
    analysisHandoff?.finish();
    analysisHandoff = null;
    return;
  }
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
    if (user) {
      await continueAuthenticatedAnalysis(sideReport, token, generation);
      return;
    }
    if (!scanIsCurrent(token, generation) || !pending) return;
    if (!scanSession.transition(token, "analyzing")) return;
    startConsentedSideFeedback();
    await runFullAnalysis(sideReport, token);
    return;
  }

  const saved = pending
    ? savePendingAnalysis({
        scanId: token.scanId,
        sex: selectedSex,
        front: { ...pending, canvas: el.photoCanvas },
        ...(lastSide ? {
          side: {
            points: lastSide.points,
            faceDir: lastSide.faceDir,
            canvas: lastSide.photo,
            automaticPoints: lastSide.automaticPoints,
            seedMethod: lastSide.seedMethod,
            seedVersion: lastSide.seedVersion,
            feedback: lastSide.feedback,
          },
        } : {}),
      })
    : false;
  if (!scanSession.transition(token, "gate")) return;

  // THE FILM RUNS BEFORE THE WALL.
  //
  // It used to run after it: two captures, then a sign-up screen, then — once
  // there was an account — the measurement pass. Which meant the one thing on
  // this whole flow that demonstrates the product was on the far side of the
  // only screen asking somebody to commit to it. They were being asked to buy
  // the measuring on the strength of having taken two photographs.
  //
  // So the pass plays here, on their own face, showing the measurement
  // constructions without printing the score values, and the wall goes up at
  // the end of it — at the exact
  // moment the result would otherwise appear. Nothing about what is being
  // withheld changes: the scan is still not stored, attributed or counted
  // until there is an account. What changes is that by the time the question
  // is asked, they have watched the answer being computed.
  //
  // The film itself stores nothing. The reduced device-local redirect copy was
  // already written above when this browser supported it; nothing is sent to a
  // server, attributed, counted or charged before authentication.
  let front: Report | null = null;
  try {
    if (pending) {
      // analyzeFrames, not analyze: the same multi-frame median the finished
      // analysis will use. A single-frame reading here would show one score
      // during the pass, blur a second one behind the wall, and print a third
      // after sign-in, all for one face.
      front = analyzeFrames(
        [
          {
            landmarks: pending.landmarks,
            width: pending.width,
            height: pending.height,
            source: pending.photo,
          },
          ...pending.extraFrames,
        ],
        selectedSex,
      );
    }
  } catch {
    // An analysis that cannot be computed skips the film and falls through to
    // the wall, which is exactly what this screen did before the film existed.
    front = null;
  }
  if (!front) {
    analysisHandoff?.finish();
    analysisHandoff = null;
  }
  if (front && !(await playMeasurePass(front, sideReport, token, generation))) return;
  if (!scanIsCurrent(token, generation) || !pending) return;
  if (front) {
    // The pass leaves the profile on the pane and a construction on the
    // overlay. The wall is a front-facing screen with a FRONT caption on it.
    paintFrontPane(pending.photo);
    drawCalm(el.overlayCanvas, pending.landmarks, pending.width, pending.height);
  }
  // The result exists before the account does. The analysis is pure, on-device
  // arithmetic, so it is computed here while the gate shows only the shape of
  // a finished report. Exact values never enter the signed-out DOM: CSS blur
  // is presentation rather than access control. "Sign up to see what is already there"
  // and "sign up and then we will run it" are different promises, and only the
  // first one is the acquisition flow this screen was meant to be.
  let preview = "";
  let teaser: OpenAccountOptions["teaser"];
  try {
    if (pending && front) {
      const merged = sideReport ? mergeReports(front, sideReport) : front;
      // The photographs make the shell recognisably theirs without putting a
      // score, tone or ladder position behind a cosmetic blur.
      //
      // From `pending`, not from the pane. The pane is whatever the pass last
      // painted, which for a two-view scan is the PROFILE — thumbnailing it
      // would have put the side capture in the front slot of the teaser.
      teaser = {
        regionCount: merged.regions.length,
        front: toThumb(pending.photo),
        side: lastSide?.photo ? toThumb(lastSide.photo) : null,
        regions: merged.regions.map((g) => ({ label: REGION_NAMES[g.region] })),
      };
      preview = `<div class="lockblur gate-preview" aria-hidden="true" inert>
        <div class="gate-prev-score">•••<small>/10</small></div>
        <div class="gate-prev-grid">${merged.regions
          .slice(0, 8)
          .map((g) => `<div class="gate-prev-cell"><span>${REGION_NAMES[g.region]}</span><b>•••</b></div>`)
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
    <p>${front
      ? "That was your own face being measured, on this device. The result is behind the blur and it never left."
      : "Your result is computed and sitting behind this blur: it never left this device."} Sign up or log in to open it. ${lastSide?.feedback
      ? "The side feedback you approved is sent privately after sign-in."
      : ""}</p>
    ${saved ? "" : `<p class="analysis-gate-warn">This browser could not preserve the scan through an email or social redirect. Use an existing password login to keep this result.</p>`}
    <button type="button" class="btn pri analysis-gate-open">Create account and see my results</button>
  </section></div>`;

  el.capRight.textContent = "SCAN READY";
  // The pass fades the status line out and back in between sentences, so a run
  // that ended mid-swap can leave `swapping` (opacity: 0) behind. Without this
  // the wall's own line would be set and then not shown.
  el.status.classList.remove("swapping");
  // "Analysis complete" only where an analysis actually ran. A capture whose
  // measurement threw skips the film above, and this line must not tell
  // somebody they watched something they did not.
  // The card directly below already says "Results are ready", asks for the
  // account and names both doors. Repeating the ask up here was the same
  // sentence twice, eighty pixels apart, and it was the half that collided
  // with the card. The line keeps the completion beat and gives up the ask.
  el.status.innerHTML = front
    ? "<b>Analysis complete.</b>"
    : lastSide ? "<b>Both views captured.</b>" : "<b>Front captured.</b>";
  el.barFill.style.width = "100%";
  // Last, and after the pane above has been filled. Leaving `scanning` is what
  // drops the photograph out of the full-screen scan stage and back into the
  // report column beside the analysis, so the wall and the blurred result
  // arrive in the same movement rather than the frame shrinking onto an empty
  // column that fills in a frame later. Same FLIP the finished analysis uses,
  // for the same reason: this is a geometry change the size of the camera
  // takeover, and it must not be a cut.
  flipThrough(el.frame, () => el.frame.classList.remove("scanning"));

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
        const continued = await continueAuthenticatedAnalysis(sideReport, token, generation);
        if (!continued) resumePendingStarted = false;
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

/**
 * The one authenticated continuation for an in-memory capture.
 *
 * Entitlement and decline are refreshed before either the weekly gate or the
 * subject chooser reads their caches. Keeping every route here prevents a
 * signed-in-at-start scan and a signed-in-at-the-wall scan from enforcing two
 * different products. A film already played before the wall is skipped by
 * runFullAnalysis's persistent scan-ID guard from PR #199.
 */
async function continueAuthenticatedAnalysis(
  sideReport: Report | null,
  token: ScanToken,
  generation: number,
): Promise<boolean> {
  await refreshMaxAccess();
  if (!scanIsCurrent(token, generation) || !pending) return false;
  // A scan that asked the subject question before capture already passed the
  // allowance gate at its upload/camera entry point. A signed-out capture has
  // not, so it must pass after authentication before the late chooser opens.
  if (!subjectAsked && !(await ensureScanAllowed(() => undefined))) return false;
  if (!scanIsCurrent(token, generation) || !pending) return false;
  if (!(await askLateSubject())) return false;
  if (!scanIsCurrent(token, generation) || !pending) return false;
  startConsentedSideFeedback();
  await runFullAnalysis(sideReport, token);
  return true;
}

let resumePendingStarted = false;
let pendingResumeFlight: Promise<boolean> | null = null;

async function resumePendingAfterAuth(): Promise<boolean> {
  if (resumePendingStarted) return false;
  if (pendingResumeFlight) return pendingResumeFlight;
  pendingResumeFlight = runPendingResume().finally(() => {
    pendingResumeFlight = null;
  });
  return pendingResumeFlight;
}

async function runPendingResume(): Promise<boolean> {
  const generation = scanGeneration;
  const user = await currentUser();
  if (generation !== scanGeneration || !user) return false;
  const saved = claimPendingAnalysis(user.id);
  if (!saved) return false;

  // Claim the redirect continuation before its first network read. Supabase
  // may emit INITIAL_SESSION and SIGNED_IN for the same navigation; without
  // the latch both callbacks can reach the allowance gate concurrently.
  resumePendingStarted = true;

  // A redirect starts with default module state. Read this account before the
  // allowance gate consults tier or decline caches.
  await refreshMaxAccess();
  if (generation !== scanGeneration) {
    resumePendingStarted = false;
    return false;
  }

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
  if (!(await ensureScanAllowed(() => undefined))) {
    resumePendingStarted = false;
    return false;
  }
  if (generation !== scanGeneration) {
    resumePendingStarted = false;
    return false;
  }

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
  if (!scanIsCurrent(token, generation)) return false;
  if (!frontOk) {
    resumePendingStarted = false;
    el.status.innerHTML = "<b>Your saved scan is still here.</b> This browser could not reopen the photo. Refresh once to retry.";
    return false;
  }
  el.photoCanvas.width = frontShot.width;
  el.photoCanvas.height = frontShot.height;
  el.photoCanvas.getContext("2d")!.drawImage(frontShot, 0, 0);

  let sidePhoto: HTMLCanvasElement | undefined;
  if (saved.side?.photo) {
    sidePhoto = document.createElement("canvas");
    const sideOk = await drawStoredPhoto(
      sidePhoto,
      saved.side.photo,
      saved.side.width,
      saved.side.height,
    );
    if (!scanIsCurrent(token, generation)) return false;
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
  lastSide = saved.side ? {
    points: saved.side.points,
    faceDir: saved.side.faceDir,
    photo: sidePhoto,
    automaticPoints: saved.side.automaticPoints,
    seedMethod: saved.side.seedMethod,
    seedVersion: saved.side.seedVersion,
    feedback: saved.side.feedback,
  } : null;
  closeSide();
  el.upload.classList.add("hidden");
  el.main.classList.remove("hidden");
  // A resumed scan crossed a redirect, so whatever the subject chooser knew is
  // gone with the page it was answered on — and this scan may have been
  // captured before sign-in ever happened. Ask before attributing.
  if (!(await askLateSubject())) return false;
  if (!scanIsCurrent(token, generation)) return false;
  // Remember the population only once it is known to be the OWNER's answer —
  // a resumed scan can turn out to be a guest's, and the global key seeds the
  // owner's next preselect.
  if (!scanSubject) storeSex(saved.sex);
  startConsentedSideFeedback();
  const sideReport = saved.side
    ? analyzeSide(saved.side.points, saved.side.faceDir, saved.sex)
    : null;
  await runFullAnalysis(sideReport, token);
  return true;
}

// One step back from the side capture, rather than out of the scan.
//
// Cancelling the profile camera used to run resetToUpload(), which threw away
// a finished front photograph to escape a shot that had not been taken yet.
// The step back lands here instead: the front capture is put back on screen
// with the three things somebody actually wants from this point — carry on to
// the profile, shoot the front again, or leave.
//
// The scan stays in the `side` phase throughout. Nothing about the front has
// been undone; this screen is a stop on the way to the profile, and the
// forward button re-enters startSide() (side -> side is a no-op transition).
function showFrontReview(): void {
  const token = scanSession.currentToken();
  // No front to show means there is nothing to come back to. Not reachable
  // from the capture flow, which always has `pending` by the time the side
  // step opens, but the fallback keeps the cancel button honest either way.
  if (!token || !pending) {
    closeSide();
    resetToUpload();
    return;
  }
  const { photo, landmarks, width, height } = pending;
  // The pane is shared — the side flow draws its own photograph on it — so the
  // front is repainted from the copy this scan owns rather than assumed to
  // still be there. Same reason PendingFront owns its canvas at all.
  closeSide();
  el.main.classList.remove("hidden");
  el.frame.classList.remove("scanning");
  el.photoCanvas.width = photo.width;
  el.photoCanvas.height = photo.height;
  el.photoCanvas.getContext("2d")!.drawImage(photo, 0, 0);
  drawCalm(el.overlayCanvas, landmarks, width, height);
  el.capRight.textContent = "FRONT CAPTURED";
  el.analysis.innerHTML = "";
  el.status.innerHTML = `<b>Front captured.</b> The profile has not been taken yet.
    <span class="reject-actions">
      <button type="button" class="btn pri" id="front-continue">Continue to the side profile</button>
      <button type="button" class="btn gho" id="front-skip-side">See my front analysis</button>
      <button type="button" class="btn gho" id="front-redo">Retake the front photo</button>
      <button type="button" class="btn cancel" id="front-quit">Cancel the scan</button>
    </span>`;
  document.getElementById("front-continue")?.addEventListener("click", () => {
    if (scanSession.isCurrent(token)) startSide();
  });
  document.getElementById("front-skip-side")?.addEventListener("click", () => {
    if (!scanSession.isCurrent(token)) return;
    track("scan-side-skipped");
    void gateAnalysis(null, token);
  });
  // Retake reopens the camera when the front came from one, because that is
  // the whole reason somebody backs out here — they want another go at the
  // front, not the chooser. Read before resetToUpload(), which clears it.
  const method = captureMethod;
  document.getElementById("front-redo")?.addEventListener("click", () => retakeFront(method));
  document.getElementById("front-quit")?.addEventListener("click", () => resetToUpload());
  el.frame.scrollIntoView({ behavior: "smooth", block: "start" });
}

function startSide(): void {
  const token = scanSession.currentToken();
  if (!token) return;
  const openSide = () => openSideCapture({
    scanId: token.scanId,
    sex: selectedSex,
    // Carry the front's capture method so the side does not make the user
    // switch: camera stays camera, upload stays upload.
    method: captureMethod ?? undefined,
    // There is no "back to results" here, because there are no results yet —
    // so back means back one step, to the front photograph that was just
    // taken. Leaving the scan entirely is a button on that screen.
    onBack: () => showFrontReview(),
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
        seedVersion: review.seedVersion,
        feedback: review.feedback ?? undefined,
        verified: review.verified,
      };
      (window as unknown as Record<string, unknown>).__truemaxSide = sideReport;
      // The verified points, for the calibration harnesses — re-scoring the
      // profile under a different reference population needs the input, not
      // the finished report.
      (window as unknown as Record<string, unknown>).__truemaxSidePoints = { points, faceDir };
      await gateAnalysis(sideReport, token);
    },
  });
  // No offer here any more. Both tutorials are shown together before the
  // FRONT photograph (see offerBothTutorials), because asking again at this
  // point meant interrupting the same scan twice — and doing it at the moment
  // somebody has just been told to turn away from the screen, with a dialogue
  // on the screen. The information button on the frame reaches the profile
  // tutorial on demand for anyone who wants it again.
  //
  // A bell first. This is the one boundary in a scan — one photograph is
  // finished and a different one is being asked for — and it arrives at the
  // exact moment the instructions are telling somebody to turn their head away
  // from the screen those instructions are on. A sound is the only channel
  // that still reaches them.
  // Automatic cloud placement needs one explicit, remembered permission, but
  // the decision belongs before capture. Asking after the photograph is taken
  // makes a normal continuation look like an unexpected upload request and
  // leaves the user staring at a modal instead of the promised loading state.
  void (async () => {
    if (!(await prepareSidePlacementChoice())) {
      // Escape means "do not send the profile", not "discard the completed
      // front scan". Continue to the result that is already available.
      if (scanSession.isCurrent(token)) {
        track("scan-side-skipped");
        await gateAnalysis(null, token);
      }
      return;
    }
    if (!scanSession.transition(token, "side")) return;
    feedbackDeliveryNote = null;
    el.main.classList.add("hidden");
    soundChapter();
    openSide();
  })();
}

function renderQualityChips(q: QualityCheck, autoNote = ""): void {
  // What went wrong with the photograph, and the neutral provenance of how it
  // was scored, are two different kinds of statement and they get two
  // different treatments.
  //
  // Every issue used to be printed as its own red chip, and on a phone the
  // whole block sat ABOVE the photograph — so a first scan opened on four
  // outlined warnings ("head is off level", "smiling detected", "turned from
  // the camera") with the score below the fold. The notes are honest and
  // worth keeping; leading with them is not. Somebody came for a number and
  // the first thing the product did was list what they had done wrong.
  //
  // So: more than one issue collapses behind a single quiet chip that says
  // how many there are and opens in place. A lone issue stays inline, because
  // hiding one short sentence behind a disclosure is worse than showing it.
  const warnings = q.issues.slice();
  if (feedbackDeliveryNote && !feedbackDeliveryNote.ok) warnings.push(feedbackDeliveryNote.message);

  const neutral: string[] = [];
  if (autoNote) neutral.push(autoNote);
  if (feedbackDeliveryNote?.ok) neutral.push(feedbackDeliveryNote.message);
  // Surfacing the correction is part of showing the math: the user can see
  // that an off-axis photo was accounted for rather than silently mismeasured.
  const off = Math.max(Math.abs(q.yawDeg), Math.abs(q.pitchDeg));
  if (off >= 6) neutral.push(`Pose-corrected · ${off.toFixed(0)}° off-axis`);

  const parts: string[] = [];
  if (warnings.length > 1) {
    parts.push(
      `<details class="qnotes">
        <summary><span class="qchip warn qnotes-sum">${warnings.length} notes on this photo</span></summary>
        <div class="qnotes-body">${warnings.map((i) => `<span class="qchip warn">${i}</span>`).join("")}</div>
      </details>`,
    );
  } else {
    parts.push(...warnings.map((i) => `<span class="qchip warn">${i}</span>`));
  }
  parts.push(...neutral.map((n) => `<span class="qchip">${n}</span>`));
  if (!parts.length) parts.push(`<span class="qchip">Capture quality: good</span>`);
  el.qualityChips.innerHTML = parts.join("");
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
      // Both of these are module state describing the PREVIOUS account, and
      // neither was reset here. A Max holder finishing a scan and a free user
      // signing in on the same tab left the second one holding the first one's
      // guest allowance; a decline belonging to one account disabled the
      // other's self-scan. They go back to the closed defaults and are
      // repopulated by the next entitlement read.
      lastKnownTier = "free";
      // CLEAR rather than set-false. setDeclinedCache(false) is a claim that
      // this account has not declined, and it writes that claim through to the
      // device: on an identity change it would erase the incoming account's
      // stamp before that account's entitlement had ever been read. Forgetting
      // is the honest operation here; the next read supplies the answer.
      clearDeclinedCache();
      clearResultsIdentityState();
      closeScanGate();
      closeDashboard();
      closeHistory();
      closeSettings();
      closeTrialFunnel();
      closeScanRecall();
      discardPendingScanCredit();
      resultAccessContext = null;
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
    // Signing in or out while a report is on screen changes what its lead
    // button should offer. Without this the label stays whatever it was when
    // the report rendered, which is how somebody who signed in mid-session
    // still got sent back to the quiz.
    void refreshPathwayState();
    // Give an in-page password flow the first chance to continue with its
    // full-resolution canvases. OAuth and email-confirmation returns have no
    // in-page callback, so the saved scan resumes on the next navigation.
    if (user) {
      // Reward a person who made an account from the scan wall with the result
      // first. Onboarding used to race this continuation on a fresh OAuth
      // document, which is why phones could land back on the capture screen.
      // The delay still gives the in-page password callback first use of its
      // full-resolution canvases.
      setTimeout(() => {
        void (async () => {
          await refreshMaxAccess();
          await reconcileReturnedPurchase();
          const resumed = await resumePendingAfterAuth();
          if (!resumed && !resumePendingStarted) {
            await ensureOnboarded(user);
            await requirePaidMaxBodyProfile(user);
          }
        })();
      }, 0);
    } else if (returnedPurchase?.status === "success") {
      showPurchaseNotice("Sign in to confirm the payment and add it to this account.");
    }
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
