import type * as Results from "./results.js";

type ResultsModule = typeof Results;
type State = {
  adult: boolean; birthDate: string | null; max: boolean;
  pathway: Parameters<ResultsModule["setPathwayState"]>[0];
  depth: Parameters<ResultsModule["setDepth"]>[0]; remaining: number;
};
const defaults = (): State => ({ adult: false, birthDate: null, max: false, pathway: "build", depth: "rating", remaining: 0 });

/** Auth can update report permissions without downloading the report. */
export function createLazyResults(load: () => Promise<ResultsModule>) {
  let module: ResultsModule | null = null;
  let pending: Promise<void> | null = null;
  let state = defaults();
  let staffEpoch = 0;
  let staff: boolean | null = null;
  let resolveStaff: ((value: boolean) => void) | null = null;
  const ready = (): Promise<void> => {
    if (module) return Promise.resolve();
    if (!pending) pending = load().then((loaded) => {
      // Replay the latest state, never a snapshot captured before an account change.
      loaded.clearResultsIdentityState();
      loaded.setAdult(state.adult);
      loaded.setBirthDate(state.birthDate);
      loaded.setMaxAccess(state.max);
      loaded.setPathwayState(state.pathway);
      loaded.setDepth(state.depth, state.remaining);
      resolveStaff = loaded.beginSkinTrialStaffCheck();
      if (staff !== null) resolveStaff(staff);
      module = loaded;
    }).finally(() => { pending = null; });
    return pending;
  };
  return {
    ready,
    renderResults(...args: Parameters<ResultsModule["renderResults"]>): void {
      if (!module) throw new Error("Prepare the report before rendering it");
      module.renderResults(...args);
    },
    currentCeiling: () => module?.currentCeiling() ?? null,
    clearResultPhotoRecovery: () => module?.clearResultPhotoRecovery(),
    clearResultsIdentityState(): void {
      state = defaults(); staffEpoch++; staff = null; resolveStaff = null;
      module?.clearResultsIdentityState();
    },
    setAdult(value: boolean): void { state.adult = value; module?.setAdult(value); },
    setBirthDate(value: string | null): void { state.birthDate = value; module?.setBirthDate(value); },
    setMaxAccess(value: boolean): void { state.max = value; module?.setMaxAccess(value); },
    setPathwayState(value: State["pathway"]): void { state.pathway = value; module?.setPathwayState(value); },
    setDepth(value: State["depth"], remaining = 0): void { state.depth = value; state.remaining = remaining; module?.setDepth(value, remaining); },
    beginSkinTrialStaffCheck(): (value: boolean) => void {
      const epoch = ++staffEpoch;
      staff = null;
      resolveStaff = module?.beginSkinTrialStaffCheck() ?? null;
      return (value) => {
        if (epoch !== staffEpoch) return;
        staff = value === true;
        resolveStaff?.(staff);
      };
    },
  };
}

const results = createLazyResults(() => import("./results.js"));
export const prepareResults = results.ready;
export const { renderResults, currentCeiling, clearResultPhotoRecovery, clearResultsIdentityState,
  setAdult, setBirthDate, setMaxAccess, setPathwayState, setDepth, beginSkinTrialStaffCheck } = results;
