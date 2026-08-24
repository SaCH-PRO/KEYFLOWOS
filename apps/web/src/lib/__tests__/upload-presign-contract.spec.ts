/**
 * Every upload in the app was refused, and the test suite was green.
 *
 * `POST /uploads/request-url` is protected by BusinessGuard, which reads
 * businessId from params, then body, then query, and throws
 * `ForbiddenException('businessId is required')` when it finds none. Both call
 * sites sent `{ name, size, contentType }` and no businessId, so the route
 * returned 403 to everyone who is not a SUPER_ADMIN — the avatar picker,
 * expense receipts, the social composer and device capture, all of which funnel
 * through this single path by design.
 *
 * WHY NOTHING CAUGHT IT. upload-real-surfaces.spec.ts mounts the real
 * components and then mocks the presign endpoint. It drives production code
 * against a fixture of what the server was assumed to return, so it passed
 * against a route that always refused. The mock could not disagree with the
 * code that wrote it.
 *
 * A runtime test here would repeat that mistake — it would assert against
 * another fixture. So this gate is static: it reads the call sites and checks
 * the property the server actually enforces, which is that businessId is in the
 * request. It cannot prove the upload succeeds. It can prove the one thing that
 * was wrong, and it fails when a fifth surface is added without it.
 *
 * The composer is here for a different reason: it posted multipart to
 * `/upload/businesses/:id/media`, a route the server has never had. Singular
 * "upload", a path shape used nowhere else. It failed with a toast that named
 * the file and not the cause.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const WEB_SRC = path.join(__dirname, '..', '..');

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === 'node_modules' || e.name === '__tests__') continue;
      sourceFiles(p, out);
    } else if (/\.tsx?$/.test(e.name)) {
      out.push(p);
    }
  }
  return out;
}

/**
 * Comments must be stripped BEFORE anything is counted, in both directions.
 *
 * Without it the e2e fixture pages, which only describe the handshake in a
 * docblock, register as call sites — and worse, the first version of this gate
 * passed while the defect was present, because the explanatory comment sitting
 * above the fetch says "businessId" five times. It read its own prose and
 * called the contract satisfied. That is the same mistake as the mocked e2e
 * test this file exists to compensate for, made one level up.
 *
 * The `[^:\\]` guard keeps `https://` and the trailing `//` of a regex literal
 * from starting a line comment.
 */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:\\])\/\/[^\n]*/g, '$1');
}

/** Files containing a real call to the presign route (not just a mention). */
function presignCallSites(): string[] {
  return sourceFiles(WEB_SRC).filter((f) =>
    stripComments(fs.readFileSync(f, 'utf8')).includes('/uploads/request-url'),
  );
}

/**
 * The request PAYLOAD object, not merely the text near the call.
 *
 * Anchoring on "businessId appears within N characters of the presign path"
 * passed with the defect in place twice: first on the comment, then on
 * `const businessId = getStoredBusinessId()` — a line that reads the value and
 * proves nothing about whether it is sent. The property is that businessId is a
 * key of the object handed to the request, so that object is what gets checked.
 *
 * Every presign payload carries contentType, which is what identifies it among
 * the object literals following the call.
 */
function presignPayload(src: string): string | null {
  const code = stripComments(src);
  const at = code.indexOf('/uploads/request-url');
  if (at < 0) return null;
  const region = code.slice(at, at + 900);

  // Anchor on contentType and walk OUTWARD to the brace that encloses it.
  //
  // Scanning forward for the first `{` containing contentType finds the
  // enclosing FUNCTION BODY, which also contains the `const businessId = …`
  // guard — so the check passed with the payload still missing the key. The
  // object wanted is the innermost one contentType is a member of.
  const key = region.indexOf('contentType');
  if (key < 0) return null;

  let depth = 0;
  let open = -1;
  for (let i = key; i >= 0; i--) {
    if (region[i] === '}') depth++;
    else if (region[i] === '{') {
      if (depth === 0) {
        open = i;
        break;
      }
      depth--;
    }
  }
  if (open < 0) return null;

  let d = 0;
  let j = open;
  do {
    if (region[j] === '{') d++;
    else if (region[j] === '}') d--;
    j++;
  } while (j < region.length && d > 0);
  return region.slice(open, j);
}

describe('presigned upload contract', () => {
  it('finds the call sites — this gate is not vacuous', () => {
    // If this drops to zero the gate has gone blind and would pass on anything.
    expect(presignCallSites().length).toBeGreaterThanOrEqual(2);
  });

  it('every presign request sends businessId', () => {
    const missing = presignCallSites()
      .filter((f) => {
        const payload = presignPayload(fs.readFileSync(f, 'utf8'));
        // A call site whose payload cannot be located is reported too: an
        // unreadable payload is not evidence of a correct one.
        return payload === null || !payload.includes('businessId');
      })
      .map((f) => path.relative(WEB_SRC, f).split(path.sep).join('/'));

    expect(
      missing,
      'BusinessGuard refuses POST /uploads/request-url without a businessId, so ' +
        'this upload returns 403 for every non-SUPER_ADMIN user. Send the active ' +
        'businessId in the request body.',
    ).toEqual([]);
  });

  it('nothing posts to the media route the server does not have', () => {
    const offenders = sourceFiles(WEB_SRC)
      .filter((f) => /\/upload\/businesses\/\$\{[^}]*\}\/media/.test(fs.readFileSync(f, 'utf8')))
      .map((f) => path.relative(WEB_SRC, f).split(path.sep).join('/'));

    expect(
      offenders,
      'POST /upload/businesses/:id/media does not exist on the server. Uploads go ' +
        'through POST /uploads/request-url followed by a PUT to the returned URL.',
    ).toEqual([]);
  });

  it('the composer stores the durable path, not the signed URL', () => {
    // uploadURL carries a signature that expires; persisting it would leave
    // saved posts pointing at links that stop resolving.
    const src = fs.readFileSync(
      path.join(WEB_SRC, 'app', 'app', 'marketing', 'components', 'unified', 'unified-composer.tsx'),
      'utf8',
    );
    expect(src).toContain('setMediaUrls((prev) => [...prev, objectPath])');
  });
});
