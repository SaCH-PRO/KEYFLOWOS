/**
 * ModuleScopeGuard's refusals as the web says them (PR195-BOOKS-DOORS, PR195-KEY-GATES).
 *
 * No client imports: a client page (through module-access.ts) and a server component (the finance insight strip,
 * which reads the server's answer itself) read a refusal by the same rule.
 */

/**
 * PR195-BOOKS-DOORS (review finding CRR-P195JS-2): whether a refused request is ModuleScopeGuard's
 * refusal of `module` ("Insufficient permissions: revenue requires write access (you have read)"), the
 * one answer that says the member lacks that module's access. Any other 403 (BusinessGuard's transient
 * "Unable to verify business access" or "Service unavailable", "No access to this business", another
 * module's refusal) says nothing about it, so a screen must not tell the member they lack the module.
 */
export function isModuleScopeRefusal(
  res: { error?: string | null; status?: number } | null | undefined,
  module: string,
): boolean {
  if (!res || res.status !== 403 || !res.error) return false;
  const named = /\b([a-z]+) requires (?:none|read|write|admin) access \(you have (?:none|read|write|admin)\)/.exec(res.error);
  return Boolean(named) && named![1] === module && /^Insufficient permissions: /.test(res.error);
}

/**
 * PR195-KEY-GATES (review finding CRR-P195BD-1): what a page says when one of its writes is answered with an
 * error, or null when the write went through. The api client answers a refusal as { data: null, error, status }
 * and does not throw, so a page that only catches never sees one. ModuleScopeGuard's refusal of `module` is said
 * with what the action needs (`what`: "change bank rules", "run depreciation"); any other error in the server's
 * own words. A page shows this and claims nothing: no success, no row dropped that the server kept.
 */
export function moduleWriteRefusal(
  res: { error?: string | null; status?: number } | null | undefined,
  module: string,
  what: string,
): string | null {
  if (!res || !res.error) return null;
  if (isModuleScopeRefusal(res, module)) return `You can't ${what} in this business: it needs ${module} write access. ${res.error}`;
  return res.error;
}

/**
 * PR195-KEY-GATES (review finding SEC-P195BW-4; owner ruling D-146: Books reads need revenue read): the words of a
 * refusal state for a list the server refused this member (ModuleScopeGuard's refusal of `module`), or null for
 * any other answer. A refused read is said as a refusal, never shown as an empty list.
 */
export function moduleReadRefusal(
  res: { error?: string | null; status?: number } | null | undefined,
  module: string,
  what: string,
): string | null {
  if (!isModuleScopeRefusal(res, module)) return null;
  return `You don't have access to ${what} in this business. ${res!.error}`;
}
