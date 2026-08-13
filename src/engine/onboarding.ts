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

export async function saveOnboardingProfile(
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
    return { ok: true };
  } catch {
    return { ok: false, message: "Could not save your pathway. Check your connection and try again." };
  }
}
