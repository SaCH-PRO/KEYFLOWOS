export function contactWhereBase(businessId: string) {
  return { businessId, deletedAt: null } as const;
}

export function contactWhereWithId(businessId: string, contactId: string) {
  return { id: contactId, businessId, deletedAt: null } as const;
}
