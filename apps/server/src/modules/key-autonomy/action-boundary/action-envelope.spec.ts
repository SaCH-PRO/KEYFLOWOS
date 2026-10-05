import { describe, expect, it } from 'vitest';
import {
  ActionEnvelopeError,
  HELPDESK_CREATE_TICKET,
  HELPDESK_CREATE_TICKET_FINGERPRINT_FIELDS,
  buildHelpdeskCreateTicketEnvelope,
  canonicalJson,
  fingerprintEnvelope,
  isBoundaryCapability,
  parseStoredEnvelope,
  type HelpdeskCreateTicketMaterial,
} from './action-envelope';

const build = (rawArgs: unknown, businessId = 'biz_1', capabilityVersion = 1) =>
  buildHelpdeskCreateTicketEnvelope({ businessId, capabilityVersion, rawArgs });

const FULL = {
  title: 'Printer is on fire',
  description: 'Second floor',
  contactId: 'contact_1',
  priority: 'HIGH',
  source: 'EMAIL',
};

describe('ActionEnvelope: helpdesk_create_ticket', () => {
  it('adopts exactly one capability', () => {
    expect(isBoundaryCapability(HELPDESK_CREATE_TICKET)).toBe(true);
    expect(isBoundaryCapability('helpdesk_update_ticket')).toBe(false);
    expect(isBoundaryCapability('EXECUTE_TOOL')).toBe(false);
    expect(isBoundaryCapability('key_autonomy.EXECUTE_TOOL')).toBe(false);
    expect(isBoundaryCapability(null)).toBe(false);
  });

  it('builds the material server-side and carries nothing else', () => {
    const envelope = build({ ...FULL, businessId: 'someone_else', status: 'CLOSED', assignedToId: 'u9' });
    expect(envelope).toEqual({
      v: 1,
      capability: HELPDESK_CREATE_TICKET,
      capabilityVersion: 1,
      businessId: 'biz_1',
      material: FULL,
    });
  });

  it('canonicalizes: trims, and resolves absent optionals to the values a KEY ticket has always had', () => {
    const envelope = build({ title: '  Hello  ', description: '   ', contactId: '' });
    expect(envelope.material).toEqual({
      title: 'Hello',
      description: null,
      contactId: null,
      priority: 'NORMAL',
      source: 'MANUAL',
    });
  });

  it('is frozen, all the way down', () => {
    const envelope = build(FULL);
    expect(Object.isFrozen(envelope)).toBe(true);
    expect(Object.isFrozen(envelope.material)).toBe(true);
    expect(() => {
      (envelope.material as { title: string }).title = 'changed';
    }).toThrow(TypeError);
    expect(envelope.material.title).toBe(FULL.title);
  });

  it.each([
    ['no title', { description: 'x' }],
    ['a blank title', { title: '   ' }],
    ['a non-string title', { title: 42 }],
    ['a non-string description', { title: 'x', description: { $ne: null } }],
    ['a priority outside the enum', { title: 'x', priority: 'urgent' }],
    ['a source outside the enum', { title: 'x', source: 'PHONE' }],
    ['an array of arguments', ['title']],
    ['null arguments', null],
  ])('refuses %s instead of coercing it', (_label, rawArgs) => {
    expect(() => build(rawArgs)).toThrow(ActionEnvelopeError);
  });

  it('refuses an envelope with no business', () => {
    expect(() => build(FULL, '')).toThrow(ActionEnvelopeError);
  });
});

describe('fingerprint', () => {
  it('is a sha256 hex digest and is deterministic', () => {
    const a = fingerprintEnvelope(build(FULL));
    const b = fingerprintEnvelope(build({ source: 'EMAIL', priority: 'HIGH', contactId: 'contact_1', description: 'Second floor', title: 'Printer is on fire' }));
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(b).toBe(a);
  });

  it('names every material field of the envelope', () => {
    const material: HelpdeskCreateTicketMaterial = build(FULL).material;
    expect([...HELPDESK_CREATE_TICKET_FINGERPRINT_FIELDS].sort()).toEqual(Object.keys(material).sort());
  });

  // One case per material field. Dropping a field from the fingerprint lets
  // that field change after an approval without invalidating the approval, and
  // exactly the case for that field fails.
  it.each([
    ['title', { title: 'Printer is fine' }],
    ['description', { description: 'Third floor' }],
    ['contactId', { contactId: 'contact_2' }],
    ['priority', { priority: 'LOW' }],
    ['source', { source: 'WHATSAPP' }],
  ])('changes when only %s changes', (_field, change) => {
    const before = fingerprintEnvelope(build(FULL));
    const after = fingerprintEnvelope(build({ ...FULL, ...change }));
    expect(after).not.toBe(before);
  });

  it('binds the tenant and the capability version', () => {
    const base = fingerprintEnvelope(build(FULL, 'biz_1', 1));
    expect(fingerprintEnvelope(build(FULL, 'biz_2', 1))).not.toBe(base);
    expect(fingerprintEnvelope(build(FULL, 'biz_1', 2))).not.toBe(base);
  });

  it('distinguishes an absent description from an empty-looking one only by value', () => {
    expect(fingerprintEnvelope(build({ title: 'x' }))).toBe(fingerprintEnvelope(build({ title: 'x', description: '  ' })));
    expect(fingerprintEnvelope(build({ title: 'x' }))).not.toBe(fingerprintEnvelope(build({ title: 'x', description: 'null' })));
  });

  it('canonicalJson sorts keys at every depth', () => {
    expect(canonicalJson({ b: 1, a: { d: null, c: [2, { z: 1, y: 2 }] } })).toBe('{"a":{"c":[2,{"y":2,"z":1}],"d":null},"b":1}');
  });
});

describe('parseStoredEnvelope', () => {
  it('round-trips an envelope through JSON storage', () => {
    const envelope = build(FULL);
    const stored = JSON.parse(JSON.stringify(envelope));
    const parsed = parseStoredEnvelope(stored);
    expect(parsed).toEqual(envelope);
    expect(fingerprintEnvelope(parsed)).toBe(fingerprintEnvelope(envelope));
  });

  it.each([
    ['null', null],
    ['another capability', { v: 1, capability: 'helpdesk_update_ticket', capabilityVersion: 1, businessId: 'b', material: FULL }],
    ['another format version', { v: 2, capability: HELPDESK_CREATE_TICKET, capabilityVersion: 1, businessId: 'b', material: FULL }],
    ['no business', { v: 1, capability: HELPDESK_CREATE_TICKET, capabilityVersion: 1, material: FULL }],
    ['material the builder would refuse', { v: 1, capability: HELPDESK_CREATE_TICKET, capabilityVersion: 1, businessId: 'b', material: { ...FULL, priority: 'NOW' } }],
  ])('refuses %s', (_label, stored) => {
    expect(() => parseStoredEnvelope(stored)).toThrow(ActionEnvelopeError);
  });
});
