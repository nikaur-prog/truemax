export function ageOnDate(dateOfBirth: string, onDate = new Date()): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateOfBirth);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const birth = new Date(Date.UTC(year, month - 1, day));
  if (
    birth.getUTCFullYear() !== year ||
    birth.getUTCMonth() !== month - 1 ||
    birth.getUTCDate() !== day
  ) return null;

  const today = new Date(Date.UTC(
    onDate.getUTCFullYear(),
    onDate.getUTCMonth(),
    onDate.getUTCDate(),
  ));
  if (birth > today) return null;

  let age = today.getUTCFullYear() - year;
  const beforeBirthday = today.getUTCMonth() < month - 1 ||
    (today.getUTCMonth() === month - 1 && today.getUTCDate() < day);
  if (beforeBirthday) age--;
  return age;
}

export function isAdult(dateOfBirth: string, onDate = new Date()): boolean {
  const age = ageOnDate(dateOfBirth, onDate);
  return age !== null && age >= 18;
}
