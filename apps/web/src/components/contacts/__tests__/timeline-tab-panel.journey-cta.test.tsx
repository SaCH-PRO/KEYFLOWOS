/**
 * The contact timeline's journey CTA opens the record its label names.
 *
 * crm-journey.service.ts tags both invoice and quote rows with ctaModule
 * "commerce", so the panel has to tell them apart. It must do that by the
 * ENTITY the row names, not by the event type: a "quote.converted" ContactEvent
 * (revenue-event.listener.ts) carries the invoice the quote became in
 * data.invoiceId, so the journey maps it to { entityId: <invoiceId>,
 * ctaLabel: "View Invoice" }. Sending that id to commerce's quote drawer
 * renders "Quote not found" (review R0-08b F1).
 *
 * Rendered for real; only the network call the panel makes when it has a
 * business id is out of reach, and these cases pass none.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { TimelineTabPanel } from '../timeline-tab-panel';
import type { ContactDetailData } from '../contact-detail';
import type { CrossJourneyResponse } from '@/lib/client';

type JourneyItem = CrossJourneyResponse['timeline'][number];

const summary: CrossJourneyResponse['summary'] = {
  bookingsCount: 0,
  totalRevenue: 0,
  lastInteractionAt: null,
  momentum: 0,
  engagementLevel: 'low',
  moduleCounts: { crm: 0, bookings: 0, commerce: 1, marketing: 0 },
};

/** Render the panel with these journey rows, expand it, and return every CTA. */
function ctasFor(timeline: JourneyItem[]): Array<{ label: string; href: string | null }> {
  render(
    <TimelineTabPanel
      contact={{ id: 'c1' } as ContactDetailData}
      events={[]}
      crossJourney={{ timeline, summary }}
    />,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Expand timeline' }));
  return screen
    .getAllByRole('link')
    .filter((a) => /^View /.test(a.textContent ?? ''))
    .map((a) => ({ label: (a.textContent ?? '').trim(), href: a.getAttribute('href') }));
}

const at = '2026-10-01T12:00:00.000Z';

afterEach(cleanup);

describe('journey CTAs open the record the label names (R0-08b F1)', () => {
  it('a quote.converted row names the INVOICE, so it opens the invoice detail page', () => {
    // Exactly what crm-journey.service.ts emits for a ContactEvent of type
    // quote.converted whose data holds { quoteId, invoiceId }.
    const ctas = ctasFor([
      {
        id: 'ev1',
        module: 'commerce',
        type: 'quote.converted',
        title: 'Quote converted',
        timestamp: at,
        entityId: 'inv_123',
        ctaLabel: 'View Invoice',
        ctaModule: 'commerce',
      },
    ]);
    expect(ctas).toEqual([{ label: 'View Invoice', href: '/app/commerce/invoices/inv_123' }]);
  });

  it('a journey quote row opens commerce\'s quote drawer for that quote', () => {
    const ctas = ctasFor([
      {
        id: 'quote_q1',
        module: 'commerce',
        type: 'quote.created',
        title: 'Quote sent',
        timestamp: at,
        entityId: 'q1',
        ctaLabel: 'View Quote',
        ctaModule: 'commerce',
      },
    ]);
    expect(ctas).toEqual([{ label: 'View Quote', href: '/app/commerce?recordType=quote&recordId=q1' }]);
  });

  it('an accepted quote is still a quote', () => {
    const ctas = ctasFor([
      {
        id: 'quote_q2',
        module: 'commerce',
        type: 'quote.accepted',
        title: 'Quote accepted',
        timestamp: at,
        entityId: 'q2',
        ctaLabel: 'View Quote',
        ctaModule: 'commerce',
      },
    ]);
    expect(ctas).toEqual([{ label: 'View Quote', href: '/app/commerce?recordType=quote&recordId=q2' }]);
  });

  it('an invoice row opens the invoice detail page, id encoded', () => {
    const ctas = ctasFor([
      {
        id: 'inv_a/b',
        module: 'commerce',
        type: 'invoice.created',
        title: 'Invoice sent',
        timestamp: at,
        entityId: 'a/b',
        ctaLabel: 'View Invoice',
        ctaModule: 'commerce',
      },
    ]);
    expect(ctas).toEqual([{ label: 'View Invoice', href: '/app/commerce/invoices/a%2Fb' }]);
  });
});
