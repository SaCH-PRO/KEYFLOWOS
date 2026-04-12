export interface ProfileBusinessData {
  id?: string;
  name?: string;
  logoUrl?: string | null;
  industry?: string;
  businessStage?: string;
  teamSize?: string;
  city?: string;
  country?: string;
  tagline?: string | null;
  description?: string | null;
  businessHours?: Record<string, { open: string; close: string; closed: boolean }> | null;
  headline?: string | null;
  bio?: string | null;
  skills?: string[];
  interests?: string[];
  profileCompleteness?: number;
  primaryColor?: string | null;
  facebook?: string | null;
  instagram?: string | null;
  twitter?: string | null;
  linkedin?: string | null;
}

export interface IdentityMe {
  id: string;
  email: string;
  name?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  phone?: string | null;
  avatarUrl?: string | null;
}

export interface ProfileCompletenessField {
  key: string;
  label: string;
  description: string;
}

export type TabId = "profile" | "brand" | "documents";

export interface StatusMessage {
  type: "success" | "error";
  message: string;
}
