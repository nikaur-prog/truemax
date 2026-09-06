/** Input callbacks outlive native file pickers, so each capture owns them. */
export function createSideInputGuard(readOwner: () => string | null) {
  let generation = 0;
  return {
    begin(): () => boolean {
      const attempt = ++generation;
      const owner = readOwner();
      return () => owner !== null && generation === attempt && readOwner() === owner;
    },
    cancel(): void { generation++; },
  };
}
