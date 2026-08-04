import * as fs from 'fs';
import { getOpenAiToolDefinitions } from './apps/server/src/modules/ai/flow-tool-registry';

const src = fs.readFileSync(
  'apps/server/src/modules/ai/flow-orchestrator.service.ts',
  'utf8',
);
const start = src.indexOf('const FLOW_SYSTEM_PROMPT = `');
const bodyStart = src.indexOf('`', start) + 1;
const bodyEnd = src.indexOf('`;', bodyStart);
const prompt = src.slice(bodyStart, bodyEnd);

console.log('FLOW_SYSTEM_PROMPT total chars:', prompt.length);

const dateIdx = prompt.indexOf('{{CURRENT_DATE}}');
const onbIdx = prompt.indexOf('{{ONBOARDING_DIRECTIVE}}');
const bcIdx = prompt.indexOf('{{BUSINESS_CONTEXT}}');
console.log('ONBOARDING_DIRECTIVE at char:', onbIdx);
console.log('CURRENT_DATE at char:', dateIdx);
console.log('BUSINESS_CONTEXT at char:', bcIdx);

// Stable prefix = text before the first volatile interpolation.
// ONBOARDING_DIRECTIVE is at index 0, so if it varies nothing caches at all.
console.log('--- assuming onboardingDirective is empty/stable ---');
console.log('stable chars before CURRENT_DATE:', dateIdx);
console.log('  approx tokens (chars/4):', Math.round(dateIdx / 4));
console.log('  OpenAI cache minimum is 1024 tokens -> cacheable?', Math.round(dateIdx / 4) >= 1024);

const defs = getOpenAiToolDefinitions();
const toolJson = JSON.stringify(defs);
console.log('--- tools ---');
console.log('tools serialized chars:', toolJson.length);
console.log('tools approx tokens (chars/4):', Math.round(toolJson.length / 4));
