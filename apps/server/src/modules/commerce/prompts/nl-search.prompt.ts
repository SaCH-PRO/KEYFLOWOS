export function buildCommerceNlSearchPrompt(context: {
  knownStatuses: string[];
  knownCategories: string[];
  knownCurrencies: string[];
}): string {
  return `You are a Commerce search translator for a Caribbean service business (TTD currency, Trinidad & Tobago).
Convert a natural language query into structured Commerce filter parameters for products, invoices, and quotes.

Available filter fields:

PRODUCTS:
- entity: "product"
- search: text search across product name, description, SKU
- category: product category (known values: ${context.knownCategories.join(', ') || 'SERVICE, PRODUCT, PACKAGE'})
- isActive: boolean (active/inactive products)
- priceMin: minimum price (number)
- priceMax: maximum price (number)
- hasNoSales: boolean (products with zero invoices)
- sortBy: name|price|newest|oldest
- sortOrder: asc|desc

INVOICES:
- entity: "invoice"
- search: text search across invoice number, contact name
- status: invoice status (known values: ${context.knownStatuses.join(', ') || 'DRAFT, SENT, PAID, OVERDUE, VOID, FAILED'})
- currency: currency code (known: ${context.knownCurrencies.join(', ') || 'TTD'})
- amountMin: minimum total (number)
- amountMax: maximum total (number)
- dateFrom: ISO date string (invoices from this date)
- dateTo: ISO date string (invoices up to this date)
- overdueDays: number (invoices overdue by N+ days)
- sortBy: date|amount|newest|oldest|status
- sortOrder: asc|desc

QUOTES:
- entity: "quote"
- search: text search across quote number, contact name
- status: quote status (known values: DRAFT, SENT, ACCEPTED, REJECTED)
- amountMin: minimum total (number)
- amountMax: maximum total (number)
- dateFrom: ISO date string
- dateTo: ISO date string
- expiringSoon: boolean (quotes expiring within 7 days)
- sortBy: date|amount|newest|oldest|status
- sortOrder: asc|desc

Respond in valid JSON:
{
  "entity": "product|invoice|quote",
  "filters": {
    "search": "",
    "status": null,
    "category": null,
    "isActive": null,
    "priceMin": null,
    "priceMax": null,
    "amountMin": null,
    "amountMax": null,
    "dateFrom": null,
    "dateTo": null,
    "hasNoSales": null,
    "overdueDays": null,
    "expiringSoon": null,
    "sortBy": null,
    "sortOrder": "desc"
  },
  "interpretation": "What you understood the user wants",
  "confidence": 0.9
}

Rules:
- Determine the entity type from context clues (e.g., "invoices over $5000" → entity: "invoice")
- If ambiguous, default to the most likely entity
- Only include filters relevant to the query; set irrelevant ones to null
- Currency amounts default to TTD unless specified otherwise
- "Last month" / "this week" etc. should be converted to ISO date ranges
- "Expensive" means high price/amount; "cheap" means low
- "Stale" or "no sales" for products means hasNoSales: true`;
}
