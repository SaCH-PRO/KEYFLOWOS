import { getCachedBusiness } from "./workspace";

/**
 * One WhatsApp helper (WA-HELPER, whatsapp ruling D-153: outbound WhatsApp is a
 * wa.me link that opens a chat with the customer's own number, the message
 * prefilled and the document's tokenized link after it).
 *
 * Every WhatsApp link in the web app is built here: a census
 * (lib/__tests__/whatsapp.test.ts) fails if any other file builds a wa.me URL.
 *
 * Numbers are read as E.164 with the business's country for a local number
 * (Business.country, a free-text name or ISO code; default Trinidad and
 * Tobago, +1 868). Stored numbers are not rewritten here: contacts saved
 * before WA-E164-SERVER are read on the fly.
 */

type CountryRule = {
  /** The calling code, digits only. */
  cc: string;
  /** NANP territories with one area code: a 7-digit local number gets it. */
  area?: string;
  /** Outside NANP: the national trunk prefix dropped before the calling code (0 in most countries). */
  trunk?: string;
  /** Outside NANP: the longest national number; a longer one already carries its country code. */
  nsn?: number;
};

const NANP = (area?: string): CountryRule => ({ cc: "1", area });
const NATIONAL = (cc: string, nsn: number, trunk?: string): CountryRule => ({ cc, nsn, trunk });

/** The default market (D-153; WA-E164-SERVER uses the same default). */
const DEFAULT_RULE: CountryRule = NANP("868");

/** Country names and codes (lower case, punctuation folded) to their dialling rule. */
const COUNTRY_RULES: Array<[string[], CountryRule]> = [
  [["tt", "tto", "trinidad and tobago", "trinidad", "tobago", "t and t", "trinbago"], DEFAULT_RULE],
  [["jm", "jam", "jamaica"], NANP("876")],
  [["bb", "brb", "barbados"], NANP("246")],
  [["bs", "bhs", "bahamas", "the bahamas"], NANP("242")],
  [["ag", "atg", "antigua and barbuda", "antigua"], NANP("268")],
  [["dm", "dma", "dominica"], NANP("767")],
  [["gd", "grd", "grenada"], NANP("473")],
  [["kn", "kna", "saint kitts and nevis", "st kitts and nevis", "st kitts"], NANP("869")],
  [["lc", "lca", "saint lucia", "st lucia"], NANP("758")],
  [["vc", "vct", "saint vincent and the grenadines", "st vincent and the grenadines", "st vincent"], NANP("784")],
  [["ky", "cym", "cayman islands", "cayman"], NANP("345")],
  [["bm", "bmu", "bermuda"], NANP("441")],
  [["vg", "vgb", "british virgin islands", "bvi"], NANP("284")],
  [["vi", "vir", "us virgin islands", "united states virgin islands", "usvi"], NANP("340")],
  [["ai", "aia", "anguilla"], NANP("264")],
  [["ms", "msr", "montserrat"], NANP("664")],
  [["tc", "tca", "turks and caicos islands", "turks and caicos"], NANP("649")],
  [["sx", "sxm", "sint maarten"], NANP("721")],
  [["us", "usa", "united states", "united states of america", "america"], NANP()],
  [["ca", "can", "canada"], NANP()],
  [["pr", "pri", "puerto rico"], NANP()],
  [["do", "dom", "dominican republic"], NANP()],
  [["gy", "guy", "guyana"], NATIONAL("592", 7)],
  [["sr", "sur", "suriname"], NATIONAL("597", 7)],
  [["bz", "blz", "belize"], NATIONAL("501", 7)],
  [["aw", "abw", "aruba"], NATIONAL("297", 7)],
  [["cw", "cuw", "curacao"], NATIONAL("5999", 7)],
  [["ht", "hti", "haiti"], NATIONAL("509", 8)],
  [["pa", "pan", "panama"], NATIONAL("507", 8)],
  [["cr", "cri", "costa rica"], NATIONAL("506", 8)],
  [["gb", "gbr", "uk", "united kingdom", "great britain", "britain", "england", "scotland", "wales", "northern ireland"], NATIONAL("44", 10, "0")],
  [["ie", "irl", "ireland"], NATIONAL("353", 9, "0")],
  [["ve", "ven", "venezuela"], NATIONAL("58", 10, "0")],
  [["co", "col", "colombia"], NATIONAL("57", 10)],
  [["br", "bra", "brazil"], NATIONAL("55", 11, "0")],
  [["mx", "mex", "mexico"], NATIONAL("52", 10)],
  [["fr", "fra", "france"], NATIONAL("33", 9, "0")],
  [["de", "deu", "germany"], NATIONAL("49", 11, "0")],
  [["nl", "nld", "netherlands", "the netherlands"], NATIONAL("31", 9, "0")],
  [["es", "esp", "spain"], NATIONAL("34", 9)],
  [["in", "ind", "india"], NATIONAL("91", 10, "0")],
  [["ng", "nga", "nigeria"], NATIONAL("234", 10, "0")],
  [["gh", "gha", "ghana"], NATIONAL("233", 9, "0")],
  [["ke", "ken", "kenya"], NATIONAL("254", 9, "0")],
  [["za", "zaf", "south africa"], NATIONAL("27", 9, "0")],
  [["au", "aus", "australia"], NATIONAL("61", 9, "0")],
  [["nz", "nzl", "new zealand"], NATIONAL("64", 10, "0")],
  [["ph", "phl", "philippines"], NATIONAL("63", 10, "0")],
  [["cn", "chn", "china"], NATIONAL("86", 11, "0")],
];

const RULE_BY_NAME = new Map<string, CountryRule>(
  COUNTRY_RULES.flatMap(([names, rule]) => names.map((n) => [n, rule] as [string, CountryRule])),
);

/** "Trinidad & Tobago", "St. Lucia", "U.S.A." and accented names -> the map's keys. */
function foldCountry(country: string): string {
  return country
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function ruleFor(country: string | null | undefined): CountryRule {
  if (!country || !country.trim()) return DEFAULT_RULE;
  const folded = foldCountry(country);
  return RULE_BY_NAME.get(folded) ?? RULE_BY_NAME.get(folded.replace(/ /g, "")) ?? DEFAULT_RULE;
}

/** E.164 allows 15 digits; the shortest real international numbers have 8. */
function e164(digits: string): string | null {
  return digits.length >= 8 && digits.length <= 15 && !digits.startsWith("0") ? `+${digits}` : null;
}

/** The shortest national number read as one (a few small territories use 6 digits). */
const MIN_NATIONAL = 6;

/**
 * A phone number as E.164 ('+18687550123'), or null when it cannot be read.
 *
 * A number written internationally ('+', or the '00' / NANP '011' prefix) is
 * kept as written. Otherwise `businessCountry` (Business.country; default TT)
 * decides: in a NANP country 11 digits starting with 1 and 10 digits are
 * already complete, and 7 digits take the territory's area code (TT 868; the
 * US and Canada have none, so 7 digits there are unreadable); elsewhere the
 * trunk 0 is dropped and the calling code added to a national number, and a
 * number longer than any national one already carries its country code.
 */
export function toE164(phone: string | null | undefined, businessCountry?: string | null): string | null {
  if (!phone) return null;
  const raw = phone.trim().replace(/\(0\)/g, "");
  if (!raw) return null;
  const digits = raw.replace(/\D/g, "");
  if (!digits) return null;

  if (raw.startsWith("+")) return e164(digits);

  const rule = ruleFor(businessCountry);
  if (digits.startsWith("00")) return e164(digits.slice(2));
  if (rule.cc === "1" && digits.startsWith("011")) return e164(digits.slice(3));

  if (rule.cc === "1") {
    if (digits.length === 11 && digits.startsWith("1")) return e164(digits);
    if (digits.length === 10 && /^[2-9]/.test(digits)) return e164(`1${digits}`);
    if (digits.length === 7 && rule.area) return e164(`1${rule.area}${digits}`);
    // A longer number typed without its '+' (a customer abroad).
    if (digits.length > 11) return e164(digits);
    return null;
  }

  const nsn = rule.nsn ?? 10;
  const national = rule.trunk && digits.startsWith(rule.trunk) ? digits.replace(/^0+/, "") : digits;
  if (national.length < MIN_NATIONAL) return null;
  if (national.length <= nsn) return e164(`${rule.cc}${national}`);
  // Longer than a national number: it already carries its country code (typed without its '+').
  return national === digits ? e164(digits) : null;
}

export interface WhatsAppLinkInput {
  /** The chat's number: the customer's own on owner screens, the business's on customer pages. None: WhatsApp's own chooser. */
  to?: string | null;
  /** The message, prefilled. */
  text?: string | null;
  /** The tokenized link (quote, invoice, receipt, booking, store), after the text. */
  link?: string | null;
  /** The business's country (Business.country) for a local number; default TT. */
  country?: string | null;
}

function messageOf(text?: string | null, link?: string | null): string {
  if (!link) return text ?? "";
  if (!text) return link;
  return /\s$/.test(text) ? `${text}${link}` : `${text} ${link}`;
}

/**
 * The wa.me URL for a chat with `to` (read as E.164 with `country`), the text
 * prefilled and the link after it (one space, or none when the text already
 * ends in whitespace). With no readable number it opens WhatsApp's chooser
 * (wa.me/?text=...) with the same message, never a dead chat.
 *
 * The positional form (phone, message) is the contact screens' older call:
 * the same reading, with the default country.
 */
export function buildWhatsAppLink(input: WhatsAppLinkInput): string;
export function buildWhatsAppLink(phone: string, message?: string): string;
export function buildWhatsAppLink(input: WhatsAppLinkInput | string, message?: string): string {
  const { to, text, link, country } = typeof input === "string" ? { to: input, text: message } as WhatsAppLinkInput : input;
  const number = toE164(to, country);
  const base = `https://wa.me/${number ? number.slice(1) : ""}`;
  const body = messageOf(text, link);
  return body ? `${base}?text=${encodeURIComponent(body)}` : base;
}

/**
 * The signed-in business's country (the workspace's cached business), for
 * owner screens. Never for customer pages: there the visitor's own workspace
 * is not the business whose number is shown.
 */
export function ownBusinessCountry(): string | null {
  try {
    const business = getCachedBusiness() as { country?: unknown } | null;
    return typeof business?.country === "string" && business.country.trim() ? business.country : null;
  } catch {
    // Storage blocked (private mode) or a test double without the cache: the default country applies.
    return null;
  }
}

export function getContactPhone(contact: { phone?: string | null; whatsappNumber?: string | null }): string | null {
  return contact.whatsappNumber || contact.phone || null;
}
