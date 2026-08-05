/**
 * A tool schema is a promise about what the domain will accept.
 *
 * `calendar_create_event` advertised `MEETING, REMINDER, MILESTONE, DEADLINE,
 * OTHER`. The domain enum is `BOOKING, CONTENT_POST, EMAIL_CAMPAIGN,
 * CONTACT_TASK, FOLLOW_UP, INVOICE_DUE, INVOICE_OVERDUE, QUOTE_EXPIRY,
 * PROJECT_TASK, SHIPMENT, REORDER, RECURRING_INVOICE, EXTERNAL_GOOGLE_EVENT,
 * ACTIVITY_LOG`.
 *
 * ZERO overlap. Every value the tool offered was invalid, and the handler's
 * fallback was `'OTHER'`, also invalid — so `createManualEvent` threw
 * `Unsupported event type` on 100% of calls, whichever option the model chose.
 * The tool shipped, was advertised to the model every turn, appeared in the
 * role allowlists, and could never once have worked.
 *
 * Nothing caught it because the two lists were written in different files by
 * different hands and never compared. That is the whole failure: not a typo,
 * an unchecked interface.
 *
 * This pins every tool enum that mirrors a domain enum. It is deliberately a
 * small, explicit table rather than a clever inference — a wrong inference here
 * would pass silently, which is exactly the failure mode being closed.
 */
import { describe, it, expect } from 'vitest';
import { CALENDAR_EVENT_TYPES, CALENDAR_EVENT_PRIORITIES } from '@keyflow/shared';
import { getToolByName, FLOW_TOOLS } from './flow-tool-registry';

/** tool name -> parameter -> the domain's authoritative list. */
const MIRRORED_ENUMS: Array<{
  tool: string;
  param: string;
  domain: readonly string[];
  domainName: string;
}> = [
  {
    tool: 'calendar_create_event',
    param: 'type',
    domain: CALENDAR_EVENT_TYPES,
    domainName: 'CALENDAR_EVENT_TYPES',
  },
  {
    tool: 'calendar_create_event',
    param: 'priority',
    domain: CALENDAR_EVENT_PRIORITIES,
    domainName: 'CALENDAR_EVENT_PRIORITIES',
  },
];

describe('every advertised enum value is one the domain accepts', () => {
  for (const { tool, param, domain, domainName } of MIRRORED_ENUMS) {
    it(`${tool}.${param} offers only real ${domainName}`, () => {
      const definition = getToolByName(tool);
      expect(definition, `${tool} is not registered`).toBeDefined();

      const property = definition!.parameters.properties[param] as { enum?: string[] } | undefined;
      if (!property?.enum) return; // no enum declared is not a lie

      const invalid = property.enum.filter((v) => !domain.includes(v));
      expect(
        invalid,
        `${tool}.${param} offers ${invalid.join(', ')} — the model will pick one and the write will throw`,
      ).toEqual([]);
    });
  }

  it('the calendar tool offers at least one usable type', () => {
    // The inverse failure: correcting the list by emptying it would pass the
    // assertion above and leave the tool just as unusable.
    const property = getToolByName('calendar_create_event')!.parameters.properties.type as {
      enum?: string[];
    };

    expect(property.enum?.length ?? 0).toBeGreaterThan(0);
  });
});

describe('a declared enum is not a substitute for a real default', () => {
  it('no tool declares an enum whose values are all absent from its description', () => {
    // Cheap tripwire for the same class: when a schema is rewritten from
    // imagination rather than from the domain, the description usually still
    // names the imagined values. `calendar_create_event` read
    // "Event type: MEETING, REMINDER, MILESTONE, DEADLINE, OTHER" — every one
    // of them fictional.
    for (const tool of FLOW_TOOLS) {
      for (const [name, prop] of Object.entries(tool.parameters.properties)) {
        const declared = (prop as { enum?: string[] }).enum;
        const description = (prop as { description?: string }).description ?? '';
        if (!declared?.length) continue;

        const named = declared.filter((v) => description.includes(v));
        if (description.match(/[A-Z]{3,}/) && named.length === 0) {
          expect.fail(
            `${tool.name}.${name}: the description names values that are not in the enum — ` +
              `description="${description}" enum=[${declared.join(', ')}]`,
          );
        }
      }
    }
  });
});
