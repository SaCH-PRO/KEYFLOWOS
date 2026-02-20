export function buildWhatsAppLink(phone: string, message?: string): string {
  const cleaned = phone.replace(/[^0-9+]/g, '').replace(/^\+/, '');
  const num = cleaned.startsWith('1') || cleaned.length > 10 ? cleaned : `1868${cleaned}`;
  const base = `https://wa.me/${num}`;
  return message ? `${base}?text=${encodeURIComponent(message)}` : base;
}

export function getContactPhone(contact: { phone?: string | null; whatsappNumber?: string | null }): string | null {
  return contact.whatsappNumber || contact.phone || null;
}
