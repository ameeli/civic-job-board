/** A board's date with no time of day (`YYYY-MM-DD`) as that day's midnight UTC; null for anything else. */
export function dayDate(text: string | null | undefined): Date | null {
  return text && /^\d{4}-\d{2}-\d{2}$/.test(text) ? new Date(`${text}T00:00:00Z`) : null;
}
