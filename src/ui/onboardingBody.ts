import type { User } from "@supabase/supabase-js";
import { currentAccessToken } from "../engine/auth.js";
import { fetchBodyProfile, saveBodyProfile, type ServerBodyProfile } from "../engine/bodyProfile.js";
import { bodyMetricUsable, boundsSentence, toMetric, type BodyEntry } from "../engine/bodyUnits.js";
import { loadOnboardingProfile, profileIsAdult } from "../engine/onboarding.js";

export interface OnboardingBodyServices {
  loadProfile: typeof loadOnboardingProfile;
  token: typeof currentAccessToken;
  fetchBody: typeof fetchBodyProfile;
  saveBody: typeof saveBodyProfile;
}

const services: OnboardingBodyServices = {
  loadProfile: loadOnboardingProfile, token: currentAccessToken,
  fetchBody: fetchBodyProfile, saveBody: saveBodyProfile,
};

/** This optional screen never trusts the quiz's in-memory birthday or auth metadata. */
export async function loadOptionalOnboardingBody(
  user: User,
  current: () => boolean,
  api: OnboardingBodyServices = services,
  timeoutMs = 4000,
): Promise<ServerBodyProfile | null> {
  let expired = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const live = () => !expired && current();
  const read = async () => {
    try {
      if (!live()) return null;
      const profile = await api.loadProfile(user);
      if (!live() || !profile.completedAt || !profileIsAdult(profile)) return null;
      const token = await api.token(user.id);
      if (!token || !live()) return null;
      const body = await api.fetchBody(token);
      if (!live() || !body || bodyMetricUsable({ heightCm: body.heightCm ?? undefined, weightKg: body.weightKg ?? undefined })) return null;
      return body;
    } catch {
      // Unknown age or connectivity never becomes an adult permission or a new wall.
      return null;
    }
  };
  try {
    return await Promise.race([
      read(),
      new Promise<null>((resolve) => { timer = setTimeout(() => { expired = true; resolve(null); }, timeoutMs); }),
    ]);
  } finally {
    expired = true;
    clearTimeout(timer);
  }
}

/** Recheck the saved birthday and account immediately before the existing write-through helper. */
export async function saveOptionalOnboardingBody(
  user: User,
  entry: BodyEntry,
  current: () => boolean,
  api: OnboardingBodyServices = services,
): Promise<{ ok: boolean; message?: string }> {
  if (!bodyMetricUsable(toMetric(entry))) return { ok: false, message: boundsSentence(entry.unit) };
  const unavailable = { ok: false, message: "These optional details could not be saved. You can try again or skip for now." };
  try {
    if (!current()) return unavailable;
    const profile = await api.loadProfile(user);
    if (!current() || !profile.completedAt || !profileIsAdult(profile)) return unavailable;
    const token = await api.token(user.id);
    if (!token || !current()) return unavailable;
    const result = await api.saveBody(token, entry, "dialog");
    return current() ? result : unavailable;
  } catch {
    return unavailable;
  }
}
