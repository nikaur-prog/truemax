/** Browser preferences opt in to a trial; only a current staff read opens it. */
export function createSkinTrialAccess(readOptIn: () => boolean): {
  enabled: () => boolean;
  begin: () => (staff: boolean) => boolean;
  reset: () => void;
} {
  let generation = 0;
  let allowed = false;
  const reset = () => {
    generation++;
    allowed = false;
  };
  return {
    enabled: () => {
      if (!allowed) return false;
      try { return readOptIn() === true; } catch { return false; }
    },
    begin: () => {
      reset();
      const request = generation;
      return (staff) => {
        if (request !== generation) return false;
        allowed = staff === true;
        return true;
      };
    },
    reset,
  };
}
