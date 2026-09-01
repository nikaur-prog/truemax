/** English ordinal for an integer, including the 11th/12th/13th exceptions. */
export function ordinal(value: number): string {
  const n = Math.round(value);
  const tail = Math.abs(n) % 100;
  if (tail >= 11 && tail <= 13) return `${n}th`;
  const suffix = ["th", "st", "nd", "rd"][Math.abs(n) % 10] ?? "th";
  return `${n}${suffix}`;
}
