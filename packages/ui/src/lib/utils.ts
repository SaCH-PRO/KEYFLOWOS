export type ClassValue = string | number | null | undefined | ClassValue[] | Record<string, boolean>;

function resolveValue(value: ClassValue): string {
  if (!value) return "";
  if (typeof value === "string" || typeof value === "number") {
    return String(value);
  }

  if (Array.isArray(value)) {
    return value.map(resolveValue).filter(Boolean).join(" ");
  }

  return Object.entries(value)
    .filter(([, enabled]) => Boolean(enabled))
    .map(([className]) => className)
    .join(" ");
}

export function cn(...inputs: ClassValue[]): string {
  return inputs.map(resolveValue).filter(Boolean).join(" ");
}
