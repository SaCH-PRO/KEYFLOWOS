export function buildCollectionsScoringPrompt(contextBlock: string): string {
  return `You are a collections recovery analyst for a Caribbean service business (Trinidad & Tobago, TTD currency).
Analyze each overdue invoice and estimate recovery likelihood, optimal follow-up timing, and recommended approach.

${contextBlock}

Respond in valid JSON:
{
  "scores": [
    {
      "invoiceId": "id",
      "invoiceNumber": "number",
      "contactName": "name",
      "amount": 0,
      "daysOverdue": 0,
      "recoveryScore": 0-100,
      "recoveryLabel": "very_likely|likely|uncertain|unlikely|very_unlikely",
      "optimalFollowUpDate": "ISO date",
      "recommendedChannel": "email|phone|whatsapp|in_person",
      "recommendedTone": "gentle|firm|urgent|escalation",
      "reasoning": "Why this score",
      "nextAction": "Specific action to take"
    }
  ],
  "summary": {
    "totalOverdue": 0,
    "estimatedRecovery": 0,
    "highPriorityCount": 0,
    "averageRecoveryScore": 0
  },
  "strategy": "Overall collection strategy recommendation"
}

IMPORTANT: Use the exact InvoiceID and ContactID values from the data above. Do not generate or guess IDs.
Base scores on: days overdue, amount, contact payment history, number of past reminders, and invoice age patterns.`;
}

export function buildPaymentPlanPrompt(contextBlock: string): string {
  return `You are a payment plan advisor for a Caribbean service business (Trinidad & Tobago, TTD currency).
Suggest installment structures for an overdue invoice based on the amount, customer history, and payment patterns.

${contextBlock}

Respond in valid JSON:
{
  "plans": [
    {
      "name": "plan name",
      "installments": 0,
      "frequency": "weekly|biweekly|monthly",
      "amounts": [0],
      "totalAmount": 0,
      "startDate": "ISO date",
      "reasoning": "Why this plan works",
      "riskLevel": "low|medium|high"
    }
  ],
  "recommendation": "Which plan is best and why",
  "customerProfile": {
    "paymentReliability": "excellent|good|fair|poor",
    "averagePaymentDelay": 0,
    "totalRelationshipValue": 0
  }
}

Suggest 2-3 plans ranging from aggressive (fewer installments) to accommodating (more installments).`;
}

export function buildQuoteFollowUpPrompt(contextBlock: string): string {
  return `You are a sales follow-up advisor for a Caribbean service business (Trinidad & Tobago, TTD currency).
Analyze this quote and recommend the best follow-up strategy.

${contextBlock}

Respond in valid JSON:
{
  "closeProbability": 0-100,
  "closeProbabilityLabel": "very_likely|likely|moderate|unlikely|very_unlikely",
  "bestFollowUpTime": "ISO date",
  "followUpWindow": "immediate|within_24h|within_3d|within_week|within_2w",
  "messagingApproach": {
    "tone": "consultative|assertive|value_focused|urgency_based",
    "keyPoints": ["point 1", "point 2"],
    "openingLine": "Suggested opening",
    "closingLine": "Suggested closing"
  },
  "competitiveFactors": ["factor 1"],
  "objectionHandling": [
    { "objection": "potential objection", "response": "how to address it" }
  ],
  "dealAccelerators": ["action that could speed up closure"],
  "reasoning": "Why this approach"
}

Consider: quote age, amount, contact engagement history, similar quote outcomes, and market context.`;
}

export function buildChurnRiskPrompt(contextBlock: string): string {
  return `You are a customer retention analyst for a Caribbean service business (Trinidad & Tobago, TTD currency).
Analyze recurring customers for churn risk signals.

${contextBlock}

Respond in valid JSON:
{
  "alerts": [
    {
      "contactId": "id",
      "contactName": "name",
      "riskLevel": "critical|high|medium|low",
      "riskScore": 0-100,
      "signals": ["signal description"],
      "lastPaymentDate": "ISO date or null",
      "monthlyRevenue": 0,
      "recommendedAction": "What to do",
      "urgency": "immediate|this_week|this_month"
    }
  ],
  "summary": {
    "totalAtRisk": 0,
    "revenueAtRisk": 0,
    "criticalCount": 0,
    "highCount": 0
  },
  "retentionStrategies": ["strategy 1", "strategy 2"]
}

IMPORTANT: Use the exact ContactID values from the data above. Do not generate or guess IDs.
Risk signals include: declining payment frequency, increasing payment delays, failed recurring runs, inactive contacts, reduced order values, and long gaps between transactions.`;
}

export function buildRevenueJourneyPrompt(contextBlock: string): string {
  return `You are a revenue funnel analyst for a Caribbean service business (Trinidad & Tobago, TTD currency).
Analyze the full revenue journey from CRM contact through to payment.

${contextBlock}

Respond in valid JSON:
{
  "funnel": {
    "totalContacts": 0,
    "contactsWithQuotes": 0,
    "quotesToInvoices": 0,
    "invoicesToPayments": 0,
    "contactToQuoteRate": 0,
    "quoteToInvoiceRate": 0,
    "invoiceToPaymentRate": 0,
    "overallConversionRate": 0
  },
  "dropOffPoints": [
    {
      "stage": "contact_to_quote|quote_to_invoice|invoice_to_payment",
      "dropOffRate": 0,
      "estimatedLostRevenue": 0,
      "reason": "Why contacts drop off here",
      "improvement": "How to fix it"
    }
  ],
  "topPaths": [
    {
      "path": "Contact → Quote → Invoice → Paid",
      "count": 0,
      "avgValue": 0,
      "avgDuration": "time description"
    }
  ],
  "insights": ["insight 1", "insight 2"],
  "recommendations": [
    { "title": "action", "description": "details", "priority": "high|medium|low", "estimatedImpact": "TTD value" }
  ]
}`;
}
