/**
 * The web client's API paths are string literals with no contract to the
 * server (client.ts is 15,004 lines of them). The 2026-08-11 audit fixed 22
 * calls that 404'd in production and classified the rest; six client calls
 * remain that the server serves NO endpoint for (the whole WhatsApp manage
 * drawer, plus recurring-invoice history). Those six live in
 * architecture/os/state/ROUTE_PARITY.md as a shrink-only ledger.
 *
 * Deliberately NOT here: static client-vs-server path matching. It was built,
 * measured at a 28% false-positive rate (client literals in :param
 * positions), and rejected — a disabled gate is worse than none. Existence is
 * settled by the runtime oracle (scripts/os/probe-routes.mjs, 401=exists /
 * 404=absent), run by the audit cycle. This spec only keeps the LEDGER
 * honest:
 *
 *   - no ghosts: every ledgered path is still actually called by the client
 *     file the ledger names (a removed call site must leave the ledger);
 *   - well-formed: parseable table, dated rows;
 *   - anti-vacuity: the reader proves it saw both the ledger and the client
 *     sources before asserting anything about them.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const SERVER = path.resolve(__dirname, '..', '..', '..');
const REPO = path.resolve(SERVER, '..', '..');

const LEDGER = path.join(REPO, 'architecture', 'os', 'state', 'ROUTE_PARITY.md');

interface Row {
  routePath: string;
  source: string;
  recorded: string;
}

function parseLedger(): { rows: Row[]; raw: string } {
  const raw = fs.readFileSync(LEDGER, 'utf8');
  const rows: Row[] = [];
  for (const line of raw.split(/\r?\n/)) {
    const cells = line.split('|').map((c) => c.trim());
    if (cells.length !== 5 || cells[1] === 'path' || /^-+$/.test(cells[1])) continue;
    rows.push({
      routePath: cells[1].replace(/^`|`$/g, ''),
      source: cells[2],
      recorded: cells[3],
    });
  }
  return { rows, raw };
}

/**
 * A ledger path like /whatsapp/businesses/:id/status appears in the client as
 * a template literal: `/whatsapp/businesses/${businessId}/status`. Turn the
 * ledger form into a regex where each :param matches one ${...} interpolation
 * (or a bare identifier segment, for non-template call sites).
 */
function templateRegex(routePath: string): RegExp {
  const escaped = routePath.replace(/[.*+?^$()[\]{}|\\]/g, '\\$&');
  return new RegExp(escaped.replace(/:[A-Za-z_]+/g, '\\$\\{[^}]+\\}'));
}

describe('the ROUTE_PARITY ledger is honest about what the client still calls', () => {
  const { rows, raw } = parseLedger();

  it('the reader saw the ledger (anti-vacuity)', () => {
    expect(raw.length).toBeGreaterThan(500);
    expect(raw).toContain('| path | client source | recorded |');
    // Shrink-only floor: reaching 0 is a human edit to this line, celebrated.
    expect(rows.length).toBeGreaterThan(0);
  });

  it('every row is well-formed', () => {
    for (const r of rows) {
      expect(r.routePath.startsWith('/'), `"${r.routePath}" is not a path`).toBe(true);
      expect(r.recorded, `${r.routePath}: recorded date must be YYYY-MM-DD`).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it('every ledgered path is still called from the named client source — no ghosts', () => {
    // The ledger says "the client calls this and the server cannot answer".
    // If the call site is gone, the row overstates the debt and must leave.
    for (const r of rows) {
      const sourceFile = path.join(REPO, r.source);
      expect(fs.existsSync(sourceFile), `${r.routePath}: named source ${r.source} does not exist`).toBe(true);
      const src = fs.readFileSync(sourceFile, 'utf8');
      expect(src.length, `${r.source} is empty — the reader is blind`).toBeGreaterThan(100);
      expect(
        templateRegex(r.routePath).test(src),
        `${r.routePath} is ledgered as called from ${r.source}, but no such call exists there any more. ` +
          'Endpoint shipped or call removed? Either way the row leaves (negative control required).',
      ).toBe(true);
    }
  });
});
