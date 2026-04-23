export function sanitize(input: string | null | undefined): string | null {
  if (input === null || input === undefined) return null;
  return input.replace(/<[^>]*>/g, '').trim() || null;
}
