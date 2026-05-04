import type { PrismaService } from '../../core/prisma/prisma.service';
import { contactWhereBase } from './crm.helpers';

export function normalizeEmail(email?: string | null): string | null {
  return email ? email.trim().toLowerCase() : null;
}

export function normalizePhone(phone?: string | null): string | null {
  return phone ? phone.replace(/[^0-9+]/g, '') : null;
}

const DUPLICATE_SELECT = {
  id: true,
  firstName: true,
  lastName: true,
  email: true,
  emailNormalized: true,
  phone: true,
  phoneNormalized: true,
} as const;

export async function findExistingBulk(
  prisma: PrismaService,
  businessId: string,
  emails: string[],
  phones: string[],
) {
  const existingByEmail = emails.length > 0
    ? await prisma.client.contact.findMany({
        where: { ...contactWhereBase(businessId), emailNormalized: { in: emails } },
        select: DUPLICATE_SELECT,
      })
    : [];

  const existingByPhone = phones.length > 0
    ? await prisma.client.contact.findMany({
        where: { ...contactWhereBase(businessId), phoneNormalized: { in: phones } },
        select: DUPLICATE_SELECT,
      })
    : [];

  return { existingByEmail, existingByPhone };
}
