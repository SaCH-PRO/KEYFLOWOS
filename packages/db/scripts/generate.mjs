/**
 * `prisma generate`, with the Windows failure explained instead of raw.
 *
 * On Windows the generator writes query_engine-windows.dll.node by renaming a
 * .tmp file over it. If any Node process has that DLL loaded — the dev API
 * server almost always does — the rename fails:
 *
 *   EPERM: operation not permitted, rename '...query_engine-windows.dll.node.tmp35240'
 *     -> '...query_engine-windows.dll.node'
 *
 * Nothing in that message says "stop your dev server", so it reads as a broken
 * build. It was recorded as a P0 launch blocker on exactly that reading. It is
 * not: with the dev server stopped, `turbo run typecheck` passes 7/7.
 *
 * This wrapper changes only the diagnosis. It does not retry, kill anything, or
 * paper over a real failure — a non-EPERM error still surfaces unchanged.
 */
import { spawnSync } from 'node:child_process';

const result = spawnSync(
  'npx prisma generate --schema=./prisma/schema.prisma',
  { encoding: 'utf8', shell: true },
);

const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
process.stdout.write(output);

if (result.status === 0) process.exit(0);

const lockedEngine = output.includes('EPERM') && output.includes('query_engine');

if (lockedEngine) {
  process.stderr.write(
    [
      '',
      '─────────────────────────────────────────────────────────────────────',
      'The Prisma query engine is in use, so it could not be replaced.',
      '',
      'This is not a broken build. A running Node process — almost always the',
      'dev API server — has query_engine-windows.dll.node loaded, and Windows',
      'will not rename over a loaded DLL.',
      '',
      'Stop the dev servers and run this again:',
      '',
      '  netstat -ano | findstr ":3001 :5000"     # find the PIDs',
      '  taskkill /F /PID <pid>',
      '',
      'With them stopped, `turbo run typecheck` completes 7/7.',
      '─────────────────────────────────────────────────────────────────────',
      '',
    ].join('\n'),
  );
}

process.exit(result.status ?? 1);
