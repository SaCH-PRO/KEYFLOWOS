// Thin git readers shared by status.mjs and bundle.mjs. Local git only: no network.
import { execFileSync } from 'node:child_process';

const git = (args, cwd) => execFileSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });

export const repoRoot = () => git(['rev-parse', '--show-toplevel'], process.cwd()).trim();
export const revParse = (root, ref) => git(['rev-parse', ref], root).trim();
export const commitDate = (root, ref) => git(['log', '-1', '--format=%cI', ref], root).trim();
export const show = (root, ref, path) => git(['show', `${ref}:${path}`], root);

export function tryShow(root, ref, path) {
  try {
    return show(root, ref, path);
  } catch {
    return null;
  }
}

/** The commit on `ref` that added `path`, or null. */
export function firstCommitAdding(root, ref, path) {
  const out = git(['log', '--diff-filter=A', '--format=%H', ref, '--', path], root).trim().split('\n').filter(Boolean);
  return out.at(-1) ?? null;
}

/** Commits reachable from `ref` but not from `base` (all of history when base is null). */
export function commitsSince(root, base, ref) {
  const range = base ? `${base}..${ref}` : ref;
  return git(['log', '--format=%H%x09%cI%x09%s', range], root)
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const i1 = line.indexOf('\t');
      const i2 = i1 === -1 ? -1 : line.indexOf('\t', i1 + 1);
      if (i1 === -1 || i2 === -1) return { sha: line, date: null, subject: '' };
      return { sha: line.slice(0, i1), date: line.slice(i1 + 1, i2), subject: line.slice(i2 + 1) };
    });
}

/** Names (without "origin/") of local remote-tracking pkt/V1-* branches not merged into `ref`. */
export function unmergedPacketBranches(root, ref) {
  return git(['for-each-ref', '--no-merged', ref, '--format=%(refname:short)', 'refs/remotes/origin/pkt/'], root)
    .split('\n')
    .filter(Boolean)
    .map((b) => b.replace(/^origin\//, ''));
}

/** Set of every file path in the tree at `ref`. */
export function treeFiles(root, ref) {
  return new Set(git(['ls-tree', '-r', '--name-only', ref], root).split('\n').filter(Boolean));
}
