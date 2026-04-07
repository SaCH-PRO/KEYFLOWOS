export const SUPPORTED_CURRENCIES = [
  { code: "TTD", name: "Trinidad & Tobago Dollar", symbol: "TT$", locale: "en-TT" },
  { code: "USD", name: "US Dollar", symbol: "$", locale: "en-US" },
  { code: "EUR", name: "Euro", symbol: "€", locale: "en-IE" },
  { code: "GBP", name: "British Pound", symbol: "£", locale: "en-GB" },
  { code: "CAD", name: "Canadian Dollar", symbol: "CA$", locale: "en-CA" },
  { code: "JMD", name: "Jamaican Dollar", symbol: "J$", locale: "en-JM" },
  { code: "BBD", name: "Barbadian Dollar", symbol: "Bds$", locale: "en-BB" },
  { code: "GYD", name: "Guyanese Dollar", symbol: "G$", locale: "en-GY" },
  { code: "XCD", name: "East Caribbean Dollar", symbol: "EC$", locale: "en-AG" },
  { code: "BZD", name: "Belize Dollar", symbol: "BZ$", locale: "en-BZ" },
  { code: "BSD", name: "Bahamian Dollar", symbol: "B$", locale: "en-BS" },
  { code: "HTG", name: "Haitian Gourde", symbol: "G", locale: "fr-HT" },
  { code: "AWG", name: "Aruban Florin", symbol: "ƒ", locale: "nl-AW" },
  { code: "SRD", name: "Surinamese Dollar", symbol: "SRD", locale: "nl-SR" },
  { code: "ANG", name: "Netherlands Antillean Guilder", symbol: "NAƒ", locale: "nl-CW" },
  { code: "INR", name: "Indian Rupee", symbol: "₹", locale: "en-IN" },
  { code: "NGN", name: "Nigerian Naira", symbol: "₦", locale: "en-NG" },
  { code: "KES", name: "Kenyan Shilling", symbol: "KSh", locale: "en-KE" },
  { code: "ZAR", name: "South African Rand", symbol: "R", locale: "en-ZA" },
  { code: "AUD", name: "Australian Dollar", symbol: "A$", locale: "en-AU" },
  { code: "NZD", name: "New Zealand Dollar", symbol: "NZ$", locale: "en-NZ" },
  { code: "MXN", name: "Mexican Peso", symbol: "MX$", locale: "es-MX" },
  { code: "BRL", name: "Brazilian Real", symbol: "R$", locale: "pt-BR" },
  { code: "COP", name: "Colombian Peso", symbol: "COL$", locale: "es-CO" },
] as const;

export type CurrencyCode = (typeof SUPPORTED_CURRENCIES)[number]["code"];

const currencyMap = new Map(SUPPORTED_CURRENCIES.map((c) => [c.code, c]));

export function getCurrencyInfo(code: string | CurrencyCode) {
  return currencyMap.get(code as CurrencyCode) ?? currencyMap.get("TTD")!;
}

export function getCurrencySymbol(code: string): string {
  return getCurrencyInfo(code).symbol;
}

export function formatCurrency(amount: number, currency: string = "TTD"): string {
  const info = getCurrencyInfo(currency);
  return `${currency} ${amount.toLocaleString(info.locale, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export function formatCurrencyCompact(amount: number, currency: string = "TTD"): string {
  if (amount >= 1_000_000) return `${currency} ${(amount / 1_000_000).toFixed(1)}M`;
  if (amount >= 1_000) return `${currency} ${(amount / 1_000).toFixed(1)}k`;
  return `${currency} ${amount.toFixed(0)}`;
}

export function formatCurrencyShort(amount: number, currency: string = "TTD"): string {
  const info = getCurrencyInfo(currency);
  return `${info.symbol}${amount.toLocaleString(info.locale, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}
