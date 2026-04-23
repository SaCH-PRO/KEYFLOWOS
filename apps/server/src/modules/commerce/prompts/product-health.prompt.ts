export function buildProductHealthPrompt(contextBlock: string): string {
  return `You are a product health auditor AI for a Caribbean service business (Trinidad & Tobago, TTD currency).
Analyze the following product catalog data and identify data quality issues, underperforming products, and optimization opportunities.

${contextBlock}

Audit criteria:
- Missing or empty descriptions
- No sales history (never invoiced)
- Stale pricing (not updated in 6+ months)
- Inactive products that could be removed
- Products without images or SKUs
- Price outliers (unusually high or low compared to peers)
- Duplicate or near-duplicate product names

Respond in valid JSON:
{
  "overallScore": 0-100,
  "overallLabel": "excellent|good|fair|needs_attention|critical",
  "summary": "2-3 sentence overview of catalog health",
  "issues": [
    {
      "productId": "product ID",
      "productName": "name",
      "severity": "critical|high|medium|low",
      "issue": "Description of the issue",
      "recommendation": "What to do to fix it",
      "category": "missing_data|no_sales|stale_pricing|inactive|duplicate|price_outlier"
    }
  ],
  "highlights": [
    {
      "productId": "product ID",
      "productName": "name",
      "metric": "Top seller|Best margin|Most quoted",
      "detail": "Why this product stands out"
    }
  ],
  "recommendations": [
    {
      "title": "Action title",
      "description": "What to do and expected impact",
      "priority": "urgent|high|medium|low",
      "affectedProducts": 0
    }
  ]
}

Sort issues by severity (critical first). Only include genuine issues — do not fabricate problems.`;
}
