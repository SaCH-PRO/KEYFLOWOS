export function validateEmail(value: string): string | null {
  if (!value) return null;
  const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return re.test(value) ? null : "Please enter a valid email address";
}

export function validateUrl(value: string): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return "URL must start with http:// or https://";
    }
    return null;
  } catch {
    return "Please enter a valid URL";
  }
}

export function validatePhone(value: string): string | null {
  if (!value) return null;
  const re = /^\+?[\d\s\-().]{7,20}$/;
  return re.test(value) ? null : "Please enter a valid phone number";
}

export function validateSlug(value: string): string | null {
  if (!value) return null;
  const re = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
  return re.test(value) ? null : "Slug must contain only lowercase letters, numbers, and hyphens";
}

export function validateRequired(value: string, fieldName: string): string | null {
  if (!value || !value.trim()) return `${fieldName} is required`;
  return null;
}
