export interface ProfileCompletenessField {
  key: string;
  label: string;
  description: string;
}

export const PROFILE_COMPLETENESS_FIELDS: ProfileCompletenessField[] = [
  { key: 'name', label: 'Business Name', description: 'Your business name is required.' },
  { key: 'logoUrl', label: 'Logo', description: 'Upload a logo to represent your business.' },
  { key: 'headline', label: 'Headline', description: 'A short professional headline for your business.' },
  { key: 'bio', label: 'Bio', description: 'A brief bio introducing your business to the community.' },
  { key: 'industry', label: 'Industry', description: 'The industry your business operates in.' },
  { key: 'skills', label: 'Skills', description: 'Skills and expertise your business offers.' },
  { key: 'businessStage', label: 'Business Stage', description: 'The current stage of your business.' },
  { key: 'location', label: 'Location', description: 'Your city or country.' },
  { key: 'interests', label: 'Interests', description: 'Topics and areas your business is interested in.' },
  { key: 'taglineOrDescription', label: 'Tagline or Description', description: 'A tagline or description of your business.' },
];

export function computeProfileCompleteness(biz: {
  name?: string | null;
  logoUrl?: string | null;
  headline?: string | null;
  bio?: string | null;
  industry?: string | null;
  skills?: string[] | null;
  businessStage?: string | null;
  city?: string | null;
  country?: string | null;
  interests?: string[] | null;
  tagline?: string | null;
  description?: string | null;
}): number {
  const checks = [
    !!biz.name,
    !!biz.logoUrl,
    !!biz.headline,
    !!biz.bio,
    !!biz.industry,
    biz.skills != null && biz.skills.length > 0,
    !!biz.businessStage,
    !!biz.city || !!biz.country,
    biz.interests != null && biz.interests.length > 0,
    !!biz.tagline || !!biz.description,
  ];
  return Math.round((checks.filter(Boolean).length / checks.length) * 100);
}
