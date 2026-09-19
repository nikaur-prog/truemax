export interface SideFeedbackEligibility {
  knownAdult: boolean;
  subjectAsked: boolean;
  isGuest: boolean;
  owner: string | null | undefined;
  profileOwner: string | null;
}

/** Unknown subject or stale account facts never authorize a photo contribution. */
export function sideFeedbackEligible(state: SideFeedbackEligibility): boolean {
  return state.knownAdult && state.subjectAsked && !state.isGuest
    && !!state.profileOwner && state.owner === `user:${state.profileOwner}`;
}
