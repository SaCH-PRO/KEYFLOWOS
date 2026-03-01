export function buildChurnDetectionPrompt(contactProfiles: string): string {
  return `You are a churn prediction AI for a Caribbean service business (Trinidad & Tobago, TTD currency).
Analyze these contacts and identify who is at risk of churning (leaving or going inactive).

CONTACTS:
${contactProfiles}

Respond in valid JSON:
{
  "atRisk": [
    {
      "contactId": "contact ID",
      "contactName": "name",
      "churnProbability": 0.85,
      "riskLevel": "critical|high|medium",
      "reasons": ["reason1", "reason2"],
      "recommendedAction": "What to do to retain this client",
      "estimatedRevenueLoss": 0
    }
  ],
  "summary": "Overview of churn risk across the business"
}

Only include contacts with meaningful churn risk (probability > 0.4). Sort by churnProbability descending.`;
}
