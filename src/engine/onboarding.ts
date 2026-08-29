import type { User } from "@supabase/supabase-js";
import { getSupabaseClient } from "./auth.js";
import { ageOnDate, isAdult } from "./age.js";

export const DISCOVERY_SOURCES = [
  ["tiktok", "TikTok"],
  ["instagram", "Instagram"],
  ["youtube", "YouTube"],
  ["search", "Google / search"],
  ["friend", "Friend or family"],
  ["other", "Somewhere else"],
] as const;

export type DiscoverySource = typeof DISCOVERY_SOURCES[number][0];

export interface OnboardingProfile {
  firstName: string;
  lastName: string;
  mobile: string;
  dateOfBirth: string;
  discoverySource: DiscoverySource | "";
  primaryObjectives: string[];
  successOutcome: string;
  expectations: string;
  strengths: string;
  supportAreas: string;
  quietTopics: string[];
  completedAt: string | null;
}

interface ProfileRow {
  first_name: string;
  last_name: string;
  mobile: string | null;
  date_of_birth: string;
  discovery_source: DiscoverySource;
  primary_objectives: string[];
  success_outcome: string;
  expectations: string;
  strengths: string | null;
  support_areas: string | null;
  quiet_topics: string[];
  completed_at: string;
}

export interface SaveProfileResult {
  ok: boolean;
  message?: string;
}

function namesFromUser(user: User): [string, string] {
  const meta = user.user_metadata as Record<string, unknown>;
  const first = typeof meta.first_name === "string" ? meta.first_name.trim() : "";
  const last = typeof meta.last_name === "string" ? meta.last_name.trim() : "";
  if (first || last) return [first, last];
  const full = typeof meta.full_name === "string" ? meta.full_name.trim() : "";
  const parts = full.split(/\s+/).filter(Boolean);
  return [parts.shift() || "", parts.join(" ")];
}

export function emptyOnboardingProfile(user: User): OnboardingProfile {
  const [firstName, lastName] = namesFromUser(user);
  return {
    firstName,
    lastName,
    mobile: "",
    dateOfBirth: "",
    discoverySource: "",
    primaryObjectives: [],
    successOutcome: "",
    expectations: "",
    strengths: "",
    supportAreas: "",
    quietTopics: [],
    completedAt: null,
  };
}

function fromRow(row: ProfileRow): OnboardingProfile {
  return {
    firstName: row.first_name,
    lastName: row.last_name,
    mobile: row.mobile || "",
    dateOfBirth: row.date_of_birth,
    discoverySource: row.discovery_source,
    primaryObjectives: row.primary_objectives || [],
    successOutcome: row.success_outcome,
    expectations: row.expectations,
    strengths: row.strengths || "",
    supportAreas: row.support_areas || "",
    quietTopics: row.quiet_topics || [],
    completedAt: row.completed_at,
  };
}

export async function loadOnboardingProfile(user: User): Promise<OnboardingProfile> {
  const client = await getSupabaseClient();
  const { data, error } = await client
    .from("profiles")
    .select("first_name,last_name,mobile,date_of_birth,discovery_source,primary_objectives,success_outcome,expectations,strengths,support_areas,quiet_topics,completed_at")
    .eq("user_id", user.id)
    .maybeSingle<ProfileRow>();
  if (error) throw new Error(error.message);
  return data ? fromRow(data) : emptyOnboardingProfile(user);
}

export function profileIsAdult(profile: OnboardingProfile): boolean {
  return isAdult(profile.dateOfBirth);
}

// A profile is only usable once it has been through the quiz. The three fields
// checked here are the three the rest of the product actually reads: the name
// the dashboard greets you by, the date of birth that decides which plan may be
// offered, and the completion stamp that stops this asking again.
//
// The date of birth is the reason there is no "skip". Everything else could
// have a sensible default; an unknown age cannot, because the fallback is
// either offering an adult subscription to a thirteen-year-old or withholding
// it from an adult, and both are wrong.
export function onboardingComplete(profile: OnboardingProfile): boolean {
  return Boolean(profile.completedAt) && Boolean(profile.firstName.trim()) && ageOnDate(profile.dateOfBirth) !== null;
}

/**
 * The first step this profile has not answered, or the last step if it has
 * answered everything.
 *
 * The funnel opens here rather than at zero. Every step re-renders the answer
 * already stored against the account, so a returning person was shown their
 * own name, their own date of birth and their own goals, and made to press
 * Continue past each of them.
 *
 * `validateOnboardingStep` is the same predicate the Continue button uses, so
 * "answered" here means exactly what "may proceed" means there and the two
 * cannot drift apart. The clamp matters: the last two steps collect optional
 * fields and so always validate, which means a fully answered profile walks
 * off the end of the loop and would open on a step that does not exist.
 */
export function firstUnansweredStep(profile: OnboardingProfile, total: number): number {
  // Only a STORED profile carries answers. A first run can already arrive with
  // a name: emptyOnboardingProfile seeds firstName/lastName from OAuth
  // metadata, splitting `full_name`, so a Google signup validates step 0
  // without anybody having seen or confirmed the name the product will greet
  // them by. Resuming past it would make step 2 of 6 the first screen they
  // ever see. `profiles.completed_at` is NOT NULL and the only writer always
  // stamps it, so this is exactly "a row came back from the database".
  if (!profile.completedAt) return 0;
  for (let i = 0; i < total; i++) {
    if (validateOnboardingStep(profile, i) !== null) return i;
  }
  return Math.max(0, total - 1);
}

export function validateOnboardingStep(profile: OnboardingProfile, step: number): string | null {
  if (step === 0) {
    if (!profile.firstName.trim() || !profile.lastName.trim()) return "Add your first and last name to continue.";
    if (profile.firstName.trim().length > 60 || profile.lastName.trim().length > 60) return "Keep each name under 60 characters.";
    if (profile.mobile && (profile.mobile.length < 5 || profile.mobile.length > 32)) return "Check the mobile number, or leave it blank.";
  }
  if (step === 1) {
    if (ageOnDate(profile.dateOfBirth) === null) return "Add a valid date of birth to continue.";
    if (!profile.discoverySource) return "Choose where you heard about TrueMax.";
  }
  if (step === 2 && profile.primaryObjectives.length === 0) return "Pick at least one goal so we can shape your pathway.";
  if (step === 3) {
    if (!profile.successOutcome.trim()) return "Tell us what a useful result would feel like for you.";
    if (!profile.expectations.trim()) return "Tell us what you expect from TrueMax.";
  }
  return null;
}

// A profile that could not be sent, kept so the answers are never lost to a
// dropped connection. Retried on the next load; the person is not asked again.
const PENDING_KEY = (userId: string) => `truemax.pendingProfile:user:${userId}`;

export function queueOnboardingProfile(user: User, profile: OnboardingProfile): void {
  try {
    localStorage.setItem(PENDING_KEY(user.id), JSON.stringify(profile));
  } catch {
    /* storage full or disabled: the in-memory copy still finishes this session */
  }
}

// Called on sign-in. Silent by design — this is housekeeping, and a person who
// has already answered the quiz should never see it mentioned again.
export async function flushPendingProfile(user: User): Promise<void> {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(PENDING_KEY(user.id));
  } catch {
    return;
  }
  if (!raw) return;
  try {
    const result = await saveOnboardingProfile(user, JSON.parse(raw) as OnboardingProfile);
    if (result.ok) localStorage.removeItem(PENDING_KEY(user.id));
  } catch {
    /* still offline: it keeps until next time */
  }
}

export async function saveOnboardingProfile(
  user: User,
  profile: OnboardingProfile,
  attempts = 3,
): Promise<SaveProfileResult> {
  // Retried, because the failure this hit in testing was a phone on one bar of
  // 4G — "TypeError: Load failed" is Safari's words for a fetch that never left
  // the handset, and it is exactly the kind of failure that succeeds on the
  // second try a second later.
  for (let attempt = 1; attempt < attempts; attempt++) {
    const result = await attemptSave(user, profile);
    if (result.ok) return result;
    await new Promise((resolve) => setTimeout(resolve, 400 * attempt));
  }
  return attemptSave(user, profile);
}

async function attemptSave(
  user: User,
  profile: OnboardingProfile,
): Promise<SaveProfileResult> {
  try {
    const client = await getSupabaseClient();
    const { error } = await client.from("profiles").upsert({
      user_id: user.id,
      first_name: profile.firstName.trim(),
      last_name: profile.lastName.trim(),
      mobile: profile.mobile.trim() || null,
      date_of_birth: profile.dateOfBirth,
      discovery_source: profile.discoverySource,
      primary_objectives: profile.primaryObjectives,
      success_outcome: profile.successOutcome.trim(),
      expectations: profile.expectations.trim(),
      strengths: profile.strengths.trim() || null,
      support_areas: profile.supportAreas.trim() || null,
      quiet_topics: profile.quietTopics,
      consent_version: "onboarding-v1",
      completed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }, { onConflict: "user_id" });
    if (error) return { ok: false, message: error.message };
    profile.completedAt = new Date().toISOString();
    // Mirror the name into the auth user so the greeting has it without a round
    // trip to the profiles table on every page load. The table stays the source
    // of truth; this is a cache, and a failure to write it is not a failure to
    // save the profile — so it is deliberately not awaited into the result.
    await client.auth
      .updateUser({ data: { first_name: profile.firstName.trim(), last_name: profile.lastName.trim() } })
      .catch(() => undefined);
    return { ok: true };
  } catch {
    return { ok: false, message: "Could not save your pathway. Check your connection and try again." };
  }
}
