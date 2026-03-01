export const CONTACT_STATUSES = ['LEAD', 'PROSPECT', 'CLIENT', 'LOST'] as const;
export type ContactStatus = typeof CONTACT_STATUSES[number];
export const BULK_LIMIT = 500;
export const DEFAULT_PAGE_SIZE = 50;
export const MAX_PAGE_SIZE = 100;
