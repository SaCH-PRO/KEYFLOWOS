/**
 * Helpers to deep-link into native Google surfaces (Gmail, Calendar, Drive)
 * from anywhere in the app. Always opens in a new tab.
 */

export const googleDeepLinks = {
  gmailThread(threadId: string): string {
    return `https://mail.google.com/mail/u/0/#inbox/${encodeURIComponent(threadId)}`;
  },
  gmailSearch(query: string): string {
    return `https://mail.google.com/mail/u/0/#search/${encodeURIComponent(query)}`;
  },
  gmailCompose(opts: { to?: string; subject?: string; body?: string } = {}): string {
    const params = new URLSearchParams({ view: 'cm', fs: '1' });
    if (opts.to) params.set('to', opts.to);
    if (opts.subject) params.set('su', opts.subject);
    if (opts.body) params.set('body', opts.body);
    return `https://mail.google.com/mail/?${params.toString()}`;
  },
  calendarEvent(eventId: string): string {
    // Google encodes event IDs as base64; passing the raw id works for most cases.
    return `https://calendar.google.com/calendar/u/0/r/eventedit/${encodeURIComponent(eventId)}`;
  },
  calendarDay(isoDate: string): string {
    const d = isoDate.replace(/-/g, '');
    return `https://calendar.google.com/calendar/u/0/r/day/${d.slice(0, 4)}/${d.slice(4, 6)}/${d.slice(6, 8)}`;
  },
  driveFile(fileId: string): string {
    return `https://drive.google.com/file/d/${encodeURIComponent(fileId)}/view`;
  },
  driveFolder(folderId: string): string {
    return `https://drive.google.com/drive/folders/${encodeURIComponent(folderId)}`;
  },
  docsFile(fileId: string): string {
    return `https://docs.google.com/document/d/${encodeURIComponent(fileId)}/edit`;
  },
  sheetsFile(fileId: string): string {
    return `https://docs.google.com/spreadsheets/d/${encodeURIComponent(fileId)}/edit`;
  },
  formsFile(formId: string): string {
    return `https://docs.google.com/forms/d/${encodeURIComponent(formId)}/edit`;
  },
};

export function openInGoogle(url: string): void {
  if (typeof window === 'undefined') return;
  window.open(url, '_blank', 'noopener,noreferrer');
}
