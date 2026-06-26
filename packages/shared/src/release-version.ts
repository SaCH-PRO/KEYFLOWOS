import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const execFileAsync = promisify(execFile);

/**
 * Resolve the git commit SHA the running container was built from.
 *
 * Lookup order:
 *   1. GIT_COMMIT / REPL_COMMIT_SHA / SOURCE_COMMIT environment variable
 *      (set by the platform, CI, or scripts/start-prod.sh)
 *   2. .deploy-version file written at build time by the CI/build step,
 *      walking up from the current working directory until found
 *   3. live `git rev-parse HEAD` (works in dev when .git is present)
 *   4. "unknown"
 *
 * Computed once and cached for the life of the process — the commit cannot
 * change without a restart.
 */

let cached: string | null = null;
let pending: Promise<string> | null = null;

function readDeployVersionFile(): string | null {
  let dir = process.cwd();
  for (let i = 0; i < 6; i++) {
    const candidate = resolve(dir, ".deploy-version");
    if (existsSync(candidate)) {
      try {
        const value = readFileSync(candidate, "utf8").trim();
        if (value) return value;
      } catch {
        return null;
      }
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

async function readGitHead(): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync("git", ["rev-parse", "HEAD"], {
      cwd: process.cwd(),
      timeout: 1500,
    });
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

export async function getReleaseVersion(): Promise<{ full: string; short: string }> {
  if (cached !== null) {
    return { full: cached, short: cached.slice(0, 12) };
  }

  if (!pending) {
    pending = (async () => {
      const fromEnv =
        process.env.GIT_COMMIT ||
        process.env.REPL_COMMIT_SHA ||
        process.env.SOURCE_COMMIT ||
        "";
      const value = (
        fromEnv ||
        readDeployVersionFile() ||
        (await readGitHead()) ||
        "unknown"
      ).trim();
      cached = value;
      return value;
    })();
  }

  const value = await pending;
  return { full: value, short: value.slice(0, 12) };
}
