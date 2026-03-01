export function buildLeadScoringPrompt(contextBlock: string): string {
  return `You are a lead scoring AI for a Caribbean service business (TTD currency).
Analyze this contact and provide an intelligent lead score (0-100) with detailed reasoning.

${contextBlock}

Scoring guidelines:
- 80-100: Hot — active engagement, revenue history, positive sentiment
- 60-79: Warm — regular interaction, some revenue, good potential
- 40-59: Neutral — moderate engagement, no red flags
- 20-39: Cool — declining engagement, no recent revenue
- 0-19: Cold — no engagement, negative signals

Respond in valid JSON:
{
  "score": 75,
  "label": "Hot|Warm|Neutral|Cool|Cold",
  "reasoning": "2-3 sentence explanation referencing actual data points",
  "factors": [
    {"name": "Engagement Frequency", "impact": "positive|neutral|negative", "detail": "brief explanation"},
    {"name": "Revenue History", "impact": "positive|neutral|negative", "detail": "brief explanation"},
    {"name": "Note Sentiment", "impact": "positive|neutral|negative", "detail": "brief explanation"},
    {"name": "Responsiveness", "impact": "positive|neutral|negative", "detail": "brief explanation"}
  ],
  "recommendation": "One specific action to improve or maintain this score"
}`;
}
