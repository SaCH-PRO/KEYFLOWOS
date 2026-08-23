/**
 * Documentation that lies is worse than no documentation, because it is
 * acted on. docs/TESTING.md spent months documenting a flaky-test quarantine
 * suite — vitest.flaky.config.ts, `pnpm test:flaky`, three named quarantined
 * files — none of which ever existed in the tree, and claimed the web app had
 * no test framework while it carried vitest and 17 spec files. Nothing
 * noticed, because prose has no compiler.
 *
 * Two mechanisms here:
 *
 * 1. The DOC_DEBT ledger (architecture/os/state/DOC_DEBT.md) — prose known to
 *    be false, shrink-only, one row per doc with the disproving command. This
 *    spec keeps the ledger honest: every listed doc exists (no ghosts), every
 *    row carries a command and a valid disposition.
 *
 * 2. Mechanical truth for GATED_DOCS — the docs agents act on directly
 *    (docs/TESTING.md, AGENTS.md). Every `pnpm <script>` they mention must
 *    resolve to a real script in the right package.json; every repo-relative
 *    backticked path must exist; every `bash scripts/<x>.sh` must exist.
 *    Rename a script and the build fails until the prose follows.
 *
 * Deliberately small allowlist: an over-broad path regex would make every doc
 * edit a gate failure, breed reflexive ignore markers, and turn the gate into
 * decoration. Widen only after a quiet month.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const SERVER = path.resolve(__dirname, '..', '..', '..');
const REPO = path.resolve(SERVER, '..', '..');

const LEDGER = path.join(REPO, 'architecture', 'os', 'state', 'DOC_DEBT.md');
const GATED_DOCS = ['docs/TESTING.md', 'AGENTS.md'];
const DISPOSITIONS = ['fix', 'archive', 'delete'];

interface LedgerRow {
  doc: string;
  claim: string;
  command: string;
  disposition: string;
}

function parseLedger(): { rows: LedgerRow[]; raw: string } {
  const raw = fs.readFileSync(LEDGER, 'utf8');
  const rows: LedgerRow[] = [];
  for (const line of raw.split(/\r?\n/)) {
    const cells = line.split('|').map((c) => c.trim());
    // | doc | false claim | disproving command | disposition | → 6 cells with
    // empty first/last; skip the header and the separator row.
    if (cells.length !== 6 || cells[1] === 'doc' || /^-+$/.test(cells[1])) continue;
    rows.push({ doc: cells[1], claim: cells[2], command: cells[3], disposition: cells[4] });
  }
  return { rows, raw };
}

function readScripts(pkgDir: string): Record<string, string> {
  const p = path.join(REPO, pkgDir, 'package.json');
  return JSON.parse(fs.readFileSync(p, 'utf8')).scripts ?? {};
}

describe('the DOC_DEBT ledger is well-formed and names no ghosts', () => {
  const { rows, raw } = parseLedger();

  it('the reader saw the ledger (anti-vacuity)', () => {
    // The parser returning [] must be distinguishable from an empty ledger:
    // the file must exist, be substantial, and contain the table header.
    expect(raw.length).toBeGreaterThan(500);
    expect(raw).toContain('| doc | false claim | disproving command | disposition |');
    // Shrink-only floor: rows may reach 0 only by a human edit to this line.
    expect(rows.length).toBeGreaterThan(0);
  });

  it('every ledgered doc exists — the ledger must not overstate the debt', () => {
    for (const r of rows) {
      expect(
        fs.existsSync(path.join(REPO, r.doc)),
        `DOC_DEBT.md lists ${r.doc}, which does not exist. Fixed by deletion? Remove the row.`,
      ).toBe(true);
    }
  });

  it('every row carries a disproving command and a known disposition', () => {
    for (const r of rows) {
      expect(r.command.length, `${r.doc}: a finding you cannot re-run is an anecdote`).toBeGreaterThan(5);
      const d = DISPOSITIONS.find((x) => r.disposition.startsWith(x));
      expect(d, `${r.doc}: disposition "${r.disposition}" is not one of ${DISPOSITIONS.join('/')}`).toBeTruthy();
    }
  });
});

describe('gated docs make only true mechanical claims', () => {
  const rootScripts = readScripts('.');
  const serverScripts = readScripts('apps/server');
  const webScripts = readScripts('apps/web');
  const filterable: Record<string, Record<string, string>> = {
    server: serverScripts,
    web: webScripts,
    '@keyflow/shared': readScripts('packages/shared'),
    '@keyflow/db': readScripts('packages/db'),
    '@keyflow/api': readScripts('packages/api'),
  };

  const docs = GATED_DOCS.map((d) => ({ doc: d, text: fs.readFileSync(path.join(REPO, d), 'utf8') }));

  it('every pnpm script reference resolves to a real script', () => {
    // Two forms: `pnpm --filter <pkg> <script>` checks that package's
    // scripts; bare `pnpm <script:with-colon>` checks the root/server/web
    // union (docs often say "from apps/server"). One combined vacuity floor —
    // either form alone may legitimately be absent from a given doc revision.
    const union = { ...rootScripts, ...serverScripts, ...webScripts };
    let seen = 0;
    for (const { doc, text } of docs) {
      const filtered = /pnpm --filter ([@\w/-]+) ([\w:-]+)/g;
      let m: RegExpExecArray | null;
      while ((m = filtered.exec(text)) !== null) {
        const [, pkg, script] = m;
        if (script === 'build' || script === 'exec') continue; // build exists everywhere it is named; exec is pnpm's own
        seen++;
        const scripts = filterable[pkg];
        expect(scripts, `${doc} filters to unknown package "${pkg}"`).toBeTruthy();
        expect(
          scripts?.[script],
          `${doc} says \`pnpm --filter ${pkg} ${script}\` but ${pkg} has no such script`,
        ).toBeTruthy();
      }
      const bare = /pnpm (?!--filter)([a-z][\w-]*:[\w:-]+)/g;
      while ((m = bare.exec(text)) !== null) {
        seen++;
        expect(
          union[m[1]],
          `${doc} says \`pnpm ${m[1]}\` but no package.json (root/server/web) has that script — ` +
            'this is exactly how the phantom test:flaky survived for months',
        ).toBeTruthy();
      }
    }
    expect(seen, 'the extractor saw no pnpm commands at all — is it blind?').toBeGreaterThanOrEqual(5);
  });

  it('every referenced shell script exists', () => {
    let seen = 0;
    for (const { doc, text } of docs) {
      const re = /bash (scripts\/[\w./-]+\.sh)/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(text)) !== null) {
        seen++;
        expect(fs.existsSync(path.join(REPO, m[1])), `${doc} invokes ${m[1]}, which does not exist`).toBe(true);
      }
    }
    expect(seen, 'no shell-script references found — is the extractor blind?').toBeGreaterThanOrEqual(1);
  });

  it('every backticked repo-relative path exists', () => {
    let seen = 0;
    for (const { doc, text } of docs) {
      const re = /`((?:apps|packages|scripts|docs|infrastructure|architecture)\/[\w ./@-]+)`/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(text)) !== null) {
        const p = m[1];
        // Build artifacts and glob patterns are claims about generated or
        // matched files, not about the tree.
        if (p.includes('*') || p.includes('dist/') || p.includes('.next')) continue;
        seen++;
        expect(fs.existsSync(path.join(REPO, p)), `${doc} references \`${p}\`, which does not exist`).toBe(true);
      }
    }
    expect(seen, 'no repo-relative paths found — is the extractor blind?').toBeGreaterThanOrEqual(5);
  });
});
