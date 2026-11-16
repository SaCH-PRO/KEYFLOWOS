/**
 * Readers of what a journey's page shows, shared by the journey specs, with no
 * Playwright runtime (pinned by src/__tests__/journey-specs-a-f.test.ts and
 * src/__tests__/journey-specs-g-l.test.ts). The browser side of each check
 * collects the text; these decide what it says. oneTapIn is the one DOM walk
 * here: it runs in the page (locator.evaluate), so it uses nothing outside
 * itself.
 */

/**
 * The first amount shown after a label in a block of text, with its sign, or
 * null when none follows within about 40 characters.
 *
 * Reads the totals layout the app's documents use (the invoice public page,
 * the invoice detail, the PDF templates): "Revenue TTD 400.00" -> 400,
 * "Tax (12.5%) TTD 130.00" -> 130 (a rate after the label, bracketed or not,
 * is part of the label), "Discount -TTD 104.00" -> -104 (a minus before the
 * currency or the figure is the amount's sign; compare a discount by its
 * size), "Tax TTD 130.00 (12.5%)" -> 130 (a figure followed by % is a rate,
 * never the amount).
 */
export function amountAfter(text: string, label: RegExp): number | null {
  const flags = label.flags.includes("i") ? "i" : "";
  const rateAfterLabel = String.raw`(?:\s*\(\s*-?[0-9][0-9.,]*\s*%\s*\)|\s*\([^)0-9]{1,40}\)|\s*-?[0-9][0-9.,]*\s*%)?`;
  const re = new RegExp(
    `(?:${label.source})${rateAfterLabel}[^0-9-]{0,40}?(-)?\\s*(?:[A-Za-z]{3}\\s*|[$€£]\\s*)?(-)?\\s*([0-9][0-9,]*(?:\\.[0-9]{1,2})?)(?![0-9]|[.,][0-9]|\\s*%)`,
    flags,
  );
  const m = text.match(re);
  if (!m) return null;
  const value = Number(m[3].replace(/,/g, ""));
  return m[1] || m[2] ? -value : value;
}

/** A visible text naming KEY outside the manual onboarding form, as A3's browser side collects it. */
export interface KeyTextCandidate {
  /** The text node's text. */
  text: string;
  /** Its element's top, in viewport pixels. */
  top: number;
  /**
   * True when it sits on a button or link inside the app header (<header> or
   * role=banner): the header's KEY door, which journey K requires ('KEY opens
   * only from the header button'), not a KEY card.
   */
  headerDoor: boolean;
  /** Where it is, for the report (the nearest control's tag and classes). */
  where: string;
}

/**
 * A3's rule (no KEY card above the manual form): every KEY text above the
 * form's top that is not the header's KEY door, one line each.
 */
export function keyCardsAboveForm(candidates: readonly KeyTextCandidate[], formTop: number): string[] {
  return candidates
    .filter((c) => !c.headerDoor && c.top < formTop)
    .map((c) => `"${c.text.replace(/\s+/g, " ").trim().slice(0, 60)}" at y=${Math.round(c.top)} (form at y=${Math.round(formTop)}) inside ${c.where}`);
}

const METHOD_NAMES: ReadonlyArray<[RegExp, string]> = [
  [/\bbank transfer\b/i, "bank transfer"],
  [/\bcash\b/i, "cash"],
  [/\bpaypal\b/i, "paypal"],
  [/\bwipay\b/i, "wipay"],
  [/\bstripe\b/i, "stripe"],
  [/\bCard\b/, "card"],
];

/**
 * The payment methods a checkout's Payment step names, each once, in one
 * spelling, sorted: "bank transfer", "card", "cash", "paypal", "stripe",
 * "wipay". "Card" counts only as a method's own name (capitalised), not the
 * word inside another's description ("Pay with credit/debit card via WiPay").
 */
export function offeredPaymentMethods(text: string): string[] {
  return METHOD_NAMES.filter(([re]) => re.test(text))
    .map(([, name]) => name)
    .sort();
}

// ── journey J: what a role preset grants (J2) ─────────────────────────────

/** Module access levels, weakest first (apps/server/src/core/authority/module-vocabulary.ts ACCESS_LEVELS). */
export type AccessLevel = "none" | "read" | "write" | "admin";
const LEVEL_RANK: Record<string, number> = { none: 0, read: 1, write: 2, admin: 3 };

/** A role preset on the Team screen's invite: the role it sends and the scope set it must grant. */
export interface RolePreset {
  role: "ADMIN" | "STAFF";
  /** Modules the preset grants, each at least at this level. */
  grants: Record<string, AccessLevel>;
  /** Modules the preset withholds: each at most at this level (a module an explicit map leaves out is none). */
  withholds: Record<string, AccessLevel>;
}

/**
 * Journey J's presets (core_journeys_v1 J: 'a role preset: Admin, Front desk
 * or Bookkeeper'; SWP-TEAM-WEB: 'presets map to existing scope sets'). What
 * each must grant and withhold, so an invite that grants more (an ADMIN for a
 * front desk, or STAFF with no map, which stores the STAFF defaults: revenue
 * and expenses read) is caught:
 *   - Admin: role ADMIN, settings admin (D-150's owner-or-admin settings) and
 *     team write (the ADMIN defaults).
 *   - Front desk: role STAFF, bookings and customers (crm) at least read; no
 *     money (revenue, expenses), no settings, no team.
 *   - Bookkeeper: role STAFF, money (revenue, expenses) at least read; no
 *     settings, no team.
 */
export const ROLE_PRESETS: Record<"Admin" | "Front desk" | "Bookkeeper", RolePreset> = {
  Admin: { role: "ADMIN", grants: { settings: "admin", team: "write" }, withholds: {} },
  "Front desk": {
    role: "STAFF",
    grants: { bookings: "read", crm: "read" },
    withholds: { revenue: "none", expenses: "none", settings: "none", team: "none" },
  },
  Bookkeeper: { role: "STAFF", grants: { revenue: "read", expenses: "read" }, withholds: { settings: "none", team: "none" } },
};

/** A row of GET /identity/businesses/:id/team: its role and its scope map (the read writes the role defaults out when none is stored). */
export interface TeamRowGrant {
  role: string;
  permissionScopes?: Record<string, string> | null;
}

/** What a team row grants that its preset does not, or lacks that it does; [] when the row is the preset. */
export function presetFindings(row: TeamRowGrant, preset: RolePreset): string[] {
  const findings: string[] = [];
  if (row.role !== preset.role) findings.push(`role ${row.role}, not ${preset.role}`);
  const map = row.permissionScopes;
  if (!map || typeof map !== "object") {
    findings.push("no scope map on the team row");
    return findings;
  }
  const levelOf = (module: string) => map[module] ?? "none";
  const rank = (level: string) => LEVEL_RANK[level] ?? 0;
  for (const [module, least] of Object.entries(preset.grants)) {
    if (rank(levelOf(module)) < LEVEL_RANK[least]) findings.push(`${module} ${levelOf(module)}, needs at least ${least}`);
  }
  for (const [module, most] of Object.entries(preset.withholds)) {
    if (rank(levelOf(module)) > LEVEL_RANK[most]) findings.push(`${module} ${levelOf(module)}, must be at most ${most}`);
  }
  return findings;
}

// ── journey K: KEY's reply, and what it may not name (K5) ─────────────────

const fold = (s: string) => s.replace(/[  ]/g, " ").replace(/\s+/g, " ").trim();

/**
 * KEY's reply in the drawer: the lines of the drawer's text (innerText, one
 * line per block) that were not there before the question was sent, less the
 * question itself and the messages' times. An earlier exchange the drawer
 * still shows is not the reply; "" means KEY has not replied.
 */
export function replyLines(before: string, after: string, question: string): string {
  const lines = (s: string) => s.split(/\n+/).map(fold).filter(Boolean);
  const seen = new Map<string, number>();
  for (const line of lines(before)) seen.set(line, (seen.get(line) ?? 0) + 1);
  const asked = fold(question);
  let questionSeen = false;
  const fresh: string[] = [];
  for (const line of lines(after)) {
    const left = seen.get(line) ?? 0;
    if (left > 0) {
      seen.set(line, left - 1);
      continue;
    }
    if (!questionSeen && line === asked) {
      questionSeen = true;
      continue;
    }
    if (/^\d{1,2}:\d{2}(?::\d{2})?(?:\s?[ap]\.?m\.?)?$/i.test(line)) continue;
    fresh.push(line);
  }
  return fresh.join(" ");
}

const REFUSAL =
  /\bno access\b|\b(?:don't|dont|do not|doesn't|does not)\s+have\s+(?:access|permission)\b|\b(?:can't|cannot|can not)\s+(?:access|see|view|show|share)\b|\bnot (?:allowed|permitted|authori[sz]ed)\b|\bask (?:the|your) (?:business )?owner\b|\b(?:outside|beyond) (?:your|the member's|the member’s) (?:access|scopes?|permissions?)\b/i;

/** KEY told the person no: 'no access', 'you don't have access', 'ask the owner', ... */
export function isRefusal(text: string): boolean {
  return REFUSAL.test(text.replace(/[‘’]/g, "'"));
}

const ONES = ["", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen"];
const TENS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];
const NUMBER_WORD = [...ONES.slice(1), ...TENS.slice(2), "hundred", "thousand"].join("|");

/** An integer from 1 to 999,999 in words: 600 -> "six hundred", 1000 -> "one thousand", 777 -> "seven hundred seventy seven". */
function inWords(n: number): string {
  const below1000 = (m: number): string[] => {
    const out: string[] = [];
    if (m >= 100) out.push(ONES[Math.floor(m / 100)], "hundred");
    const rest = m % 100;
    if (rest >= 20) out.push(TENS[Math.floor(rest / 10)], ...(rest % 10 ? [ONES[rest % 10]] : []));
    else if (rest > 0) out.push(ONES[rest]);
    return out;
  };
  const thousands = Math.floor(n / 1000);
  return [...(thousands ? [...below1000(thousands), "thousand"] : []), ...below1000(n % 1000)].join(" ");
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Whether a text names an amount, written any common way: 1,000 / 1000 /
 * 1,000.00 / TTD 1000 / one thousand (a thousand). A figure inside another
 * number (10,000, 21000, 1000.50) or inside an id or a phone number is not it.
 */
export function amountMentioned(text: string, amount: number): boolean {
  const t = text.replace(/[  ]/g, " ");
  const whole = Number.isInteger(amount);
  const forms = whole
    ? [amount.toLocaleString("en-US"), String(amount)]
    : [amount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }), amount.toFixed(2)];
  const digits = new RegExp(`(?<![\\w.,])(?:${[...new Set(forms)].map(escapeRe).join("|")})${whole ? "(?:\\.0{1,2})?" : ""}(?![\\w]|[.,]\\d)`);
  if (digits.test(t)) return true;
  if (!whole || amount < 1 || amount > 999_999) return false;
  const spelled = inWords(amount).split(" ");
  const variants = [spelled];
  if (spelled[0] === "one" && (spelled[1] === "hundred" || spelled[1] === "thousand")) variants.push(["a", ...spelled.slice(1)]);
  return variants.some((words) =>
    new RegExp(`\\b${words.map(escapeRe).join("[\\s-]+(?:and[\\s-]+)?")}\\b(?![\\s-]+(?:and[\\s-]+)?(?:${NUMBER_WORD})\\b)`, "i").test(t),
  );
}

/** What a text must not name: people, invoice numbers, amounts. */
export interface SeededData {
  names?: string[];
  invoiceNumbers?: string[];
  amounts?: number[];
}

/** Each seeded thing a text names ("names 'X'", "invoice INV-0001", "amount 600"); [] when it names none. */
export function answerLeaks(text: string, seeded: SeededData): string[] {
  const leaks: string[] = [];
  const lower = text.toLowerCase();
  for (const name of seeded.names ?? []) if (name && lower.includes(name.toLowerCase())) leaks.push(`names '${name}'`);
  for (const number of seeded.invoiceNumbers ?? []) if (number && text.includes(number)) leaks.push(`invoice ${number}`);
  for (const amount of seeded.amounts ?? []) if (amountMentioned(text, amount)) leaks.push(`amount ${amount}`);
  return leaks;
}

/** Keys whose numbers are counters, times or codes, never business data. */
const NOT_DATA = /(?:tokens?|ms|latency|duration|elapsed|time|timestamp|count|index|version|status|statuscode|cost)$/i;

/**
 * What KEY's chat answer carried to the browser, as text: the reply (a JSON
 * answer's fields, or an SSE stream's content deltas joined), and every other
 * string or business number it holds (tool results, cards, errors), so a
 * figure the drawer does not show still counts. Usage chunks, chunk types and
 * counter, time or status numbers are left out.
 */
export function chatBodyText(body: string): string {
  const raw = body.trim();
  if (!raw) return "";
  const chunks: unknown[] = [];
  const parse = (s: string) => {
    try {
      chunks.push(JSON.parse(s));
    } catch {
      chunks.push(s);
    }
  };
  if (/^\s*data:/m.test(raw)) {
    for (const line of raw.split("\n")) {
      const m = line.match(/^\s*data:\s?(.*)$/);
      if (m && m[1].trim() && m[1].trim() !== "[DONE]") parse(m[1].trim());
    }
  } else parse(raw);
  let reply = "";
  const rest: string[] = [];
  const walk = (value: unknown, key: string): void => {
    if (typeof value === "string") rest.push(value);
    else if (typeof value === "number") {
      if (!NOT_DATA.test(key)) rest.push(String(value));
    } else if (Array.isArray(value)) for (const v of value) walk(v, key);
    else if (value && typeof value === "object") {
      for (const [k, v] of Object.entries(value)) if (k !== "type" && k !== "usage") walk(v, k);
    }
  };
  for (const chunk of chunks) {
    const c = chunk as { type?: unknown; content?: unknown } | null;
    if (c && typeof c === "object" && c.type === "usage") continue;
    if (c && typeof c === "object" && c.type === "content_delta" && typeof c.content === "string") {
      reply += c.content;
      continue;
    }
    walk(chunk, "");
  }
  return fold([reply, ...rest].join(" "));
}

// ── journey H: the accountant export (H9) ─────────────────────────────────

/**
 * What an accountant-export answer means:
 *   - "sent": POST .../accountant-export/email answered 2xx;
 *   - "no-mail-sender": the same route on a stack with no mail sender (the CI
 *     stack: 400 'Email sender is not configured', or the R0-07 503);
 *   - "zip": GET .../accountant-export.zip answered 200, or POST
 *     .../accountant-export answered 2xx (a signed download URL);
 *   - "wrong": anything else (a missing period, a server error).
 */
export type AccountantExportAnswer = "sent" | "no-mail-sender" | "zip" | "wrong";

export function accountantExportAnswer(path: string, status: number, body: string): AccountantExportAnswer {
  const ok = status >= 200 && status < 300;
  if (/\/accountant-export\/email$/.test(path)) {
    if (ok) return "sent";
    if ((status === 400 && /email sender is not configured/i.test(body)) || status === 503) return "no-mail-sender";
    return "wrong";
  }
  if (/\/accountant-export\.zip$/.test(path)) return status === 200 ? "zip" : "wrong";
  if (/\/accountant-export$/.test(path)) return ok ? "zip" : "wrong";
  return "wrong";
}

// ── journey I: Today (I3, I6) ─────────────────────────────────────────────

/**
 * Whether the row showing `text` inside `root` carries its own action: from
 * the element showing the text up to (not past) the first ancestor that also
 * shows another listed item, a link or a button is found (or the row is one).
 * `others` must be what only their own rows show (an invoice number, a task's
 * title, an order number, a booking's service), never a name every row may
 * carry, such as the customer's. Runs in the page (locator.evaluate) and in
 * jsdom, so it uses nothing outside itself.
 */
export function oneTapIn(root: Element, { text, others }: { text: string; others: string[] }): boolean {
  const leaf = Array.from(root.querySelectorAll("*")).find((e) => e.children.length === 0 && (e.textContent ?? "").includes(text));
  for (let node: Element | null = leaf ?? null; node && node !== root; node = node.parentElement) {
    if (node.matches("a[href], button")) return true;
    const shown = node.textContent ?? "";
    if (others.some((o) => shown.includes(o))) return false;
    if (node.querySelector("a[href], button")) return true;
  }
  return false;
}

/** Fields of a Today answer that carry money (Pulse and its figures, the ledger's totals). */
const MONEY_FIELD = /^(?:pulse|cash|cashBalance|cashOnHand|owedToYou|youOwe|profit|netProfit|monthProfit|safeToSpend|receivables?|payables?|revenue|moneyIn|moneyOut|outstanding|totalOutstanding)$/i;

/**
 * What a member without revenue read must not receive in GET .../today: a
 * Pulse block or any money field holding a value, a seeded invoice number,
 * or a seeded amount (as a number, or written in a string). [] when the
 * answer carries none.
 */
export function revenueLeaks(body: unknown, seeded: { invoiceNumbers: string[]; amounts: number[] }): string[] {
  const leaks: string[] = [];
  const empty = (v: unknown) =>
    v === null || v === undefined || (Array.isArray(v) && v.length === 0) || (typeof v === "object" && !Array.isArray(v) && Object.keys(v as object).length === 0);
  const walk = (value: unknown, at: string): void => {
    if (typeof value === "string") {
      for (const number of seeded.invoiceNumbers) if (value.includes(number)) leaks.push(`${at}: invoice ${number}`);
      for (const amount of seeded.amounts) if (amountMentioned(value, amount)) leaks.push(`${at}: ${amount} in '${value.slice(0, 60)}'`);
    } else if (typeof value === "number") {
      if (seeded.amounts.includes(value)) leaks.push(`${at}: ${value}`);
    } else if (Array.isArray(value)) value.forEach((v, i) => walk(v, `${at}[${i}]`));
    else if (value && typeof value === "object") {
      for (const [key, v] of Object.entries(value)) {
        const here = at ? `${at}.${key}` : key;
        if (MONEY_FIELD.test(key) && !empty(v)) leaks.push(`${here}: a money field`);
        walk(v, here);
      }
    }
  };
  walk(body, "");
  return leaks;
}

// ── journey G: framing (G9) ───────────────────────────────────────────────

/**
 * Whether a page's answer forbids `framer` (another site's origin) to frame it,
 * as Chromium reads the headers: CSP frame-ancestors when the answer has one
 * (it overrides X-Frame-Options), else X-Frame-Options (DENY; SAMEORIGIN for
 * another origin). No header at all: anyone may frame it.
 */
export function framingRefused(headers: Record<string, string | undefined>, framer: string, page: string): boolean {
  const header = (name: string) => Object.entries(headers).find(([k]) => k.toLowerCase() === name)?.[1] ?? "";
  const framerUrl = new URL(framer);
  const pageOrigin = new URL(page).origin;
  const ancestors = header("content-security-policy")
    .split(";")
    .map((d) => d.trim())
    .find((d) => /^frame-ancestors(\s|$)/i.test(d));
  if (ancestors !== undefined) {
    const sources = ancestors.split(/\s+/).slice(1);
    if (sources.length === 0 || sources.includes("'none'")) return true;
    for (const source of sources) {
      if (source === "*") return false;
      if (source === "'self'") {
        if (framerUrl.origin === pageOrigin) return false;
        continue;
      }
      if (/^[a-z][a-z0-9+.-]*:$/i.test(source)) {
        if (framerUrl.protocol === source.toLowerCase()) return false;
        continue;
      }
      const hostSource = source.replace(/^[a-z][a-z0-9+.-]*:\/\//i, "").replace(/\/.*$/, "");
      const scheme = source.match(/^([a-z][a-z0-9+.-]*):\/\//i)?.[1];
      if (scheme && `${scheme.toLowerCase()}:` !== framerUrl.protocol) continue;
      if (hostSource === framerUrl.host || hostSource === framerUrl.hostname) return false;
      if (hostSource.startsWith("*.") && framerUrl.hostname.endsWith(hostSource.slice(1))) return false;
    }
    return true;
  }
  const xfo = header("x-frame-options").trim().toUpperCase();
  if (xfo === "DENY") return true;
  if (xfo === "SAMEORIGIN") return framerUrl.origin !== pageOrigin;
  return false;
}
