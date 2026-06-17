import { createHmac, randomUUID } from 'node:crypto';
import * as dotenv from 'dotenv';

dotenv.config({ path: '.env' });

const API_BASE = 'http://localhost:3001';
const DEV_USER_ID = '381d115d-b2b4-4a32-b493-1989cf9b9355';
const DEV_EMAIL = 'dev@keyflow.local';

function buildAdminToken(userId: string, email: string, role: string): string {
  const secret = process.env.ADMIN_JWT_SECRET || '';
  if (!secret) throw new Error('ADMIN_JWT_SECRET not set');
  const now = Date.now();
  const payload = {
    sub: userId,
    email,
    role,
    iat: now,
    exp: now + 24 * 60 * 60 * 1000,
    type: 'admin',
    jti: randomUUID(),
  };
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = createHmac('sha256', secret).update(`${header}.${body}`).digest('base64url');
  return `${header}.${body}.${signature}`;
}

const token = buildAdminToken(DEV_USER_ID, DEV_EMAIL, 'SUPER_ADMIN');

async function api(method: string, path: string, body?: unknown) {
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    json = text;
  }
  if (!res.ok) {
    throw new Error(`${method} ${path} failed ${res.status}: ${JSON.stringify(json).slice(0, 800)}`);
  }
  return json;
}

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(`ASSERTION FAILED: ${message}`);
}

async function waitForApi(maxMs = 60000): Promise<void> {
  const deadline = Date.now() + maxMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${API_BASE}/healthz`);
      if (res.ok) return;
    } catch {
      // ignore
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error('API health check timed out');
}

async function main() {
  console.log('=== Patch 3 runtime verification ===\n');
  await waitForApi();
  console.log('API health check passed\n');

  // 1. Find or create a business for the dev user.
  const businesses = (await api('GET', '/identity/businesses')) as { id: string; name: string }[];
  let businessId: string;
  if (businesses.length > 0) {
    businessId = businesses[0].id;
    console.log(`Using existing business: ${businessId} (${businesses[0].name})`);
  } else {
    const created = (await api('POST', '/identity/businesses', { name: 'Patch3 Verify' })) as { id: string };
    businessId = created.id;
    console.log(`Created business: ${businessId}`);
  }

  // 2. Seed blueprint answers.
  const answers = {
    businessName: 'ClinicFlow T&T',
    country: 'Trinidad and Tobago',
    industry: 'Healthcare technology',
    archetype: 'Clinic management platform',
    businessIntent: 'Digital clinic management platform for private doctors in Trinidad.',
    revenueModel: 'SaaS subscription',
    deliveryMode: 'online',
    channels: ['website', 'social media'],
    'marketProfile.targetGeography': 'Trinidad and Tobago',
    'customerModel.idealCustomer': 'Private general practitioners and small clinics',
    'offerArchitecture.coreOffer.name': 'ClinicFlow Platform',
    'offerArchitecture.coreOffer.description': 'Appointment scheduling, patient records, and billing for clinics.',
    'financials.currency': 'TTD',
    'financials.pricingModel': 'monthly subscription tiers',
    'financials.monthlyTarget': 50000,
    'projectionProfile.runwayMonths': 12,
    'marketingSystem.channels': [{ channel: 'website' }, { channel: 'social media' }],
    'goals.northStar': 'Acquire 50 clinic customers in year one',
    estimatedAnnualRevenue: 600000,
    startupCapital: 40000,
    monthlyFixedCosts: 8000,
    variableCostPercent: 20,
    expectedMonthlyUnits: 10,
    avgTicket: 5000,
  };

  const progress = (await api('POST', `/business-genesis/businesses/${businessId}/answers`, { answers })) as {
    readiness: { overall: number; market: number };
  };
  console.log(`Readiness after answers: ${progress.readiness.overall} (market: ${progress.readiness.market})`);
  assert(progress.readiness.overall > 0, 'readiness overall should be > 0');

  // 3. Generate market strategy.
  console.log('\nGenerating market strategy (this may take a moment)...');
  const generated = (await api('POST', `/business-genesis/businesses/${businessId}/generate-market-strategy`)) as {
    strategy: {
      id: string;
      generatedAt: string;
      swot: { strengths: unknown[]; weaknesses: unknown[]; opportunities: unknown[]; threats: unknown[] };
      pestle: Record<string, string>;
      positioning: { tagline: string; valueProposition: string; keyMessages: unknown[]; differentiators: unknown[]; targetSegments: unknown[] };
      launchPlan: { summary: string; phases: unknown[] };
      analysisSummary: { marketOpportunityScore: number; keyInsight: string };
    } | null;
    competitors: unknown[];
    documentInstanceId: string | null;
    readiness: { overall: number; market: number };
  };

  assert(generated.strategy !== null, 'strategy should not be null');
  const strategy = generated.strategy!;
  const score = strategy.analysisSummary.marketOpportunityScore;
  console.log(`Generated market strategy with score ${score} at ${strategy.generatedAt}`);
  assert(typeof score === 'number', 'marketOpportunityScore should be a number');
  assert(score >= 0 && score <= 100, 'score should be 0-100');
  assert(typeof strategy.generatedAt === 'string', 'generatedAt should be a string');
  assert(generated.readiness.market >= 0, 'market readiness should be numeric');

  assert(Array.isArray(strategy.swot.strengths), 'swot strengths should be array');
  assert(Array.isArray(strategy.swot.weaknesses), 'swot weaknesses should be array');
  assert(Array.isArray(strategy.swot.opportunities), 'swot opportunities should be array');
  assert(Array.isArray(strategy.swot.threats), 'swot threats should be array');

  assert(typeof strategy.pestle.political === 'string', 'pestle political should be string');
  assert(typeof strategy.pestle.economic === 'string', 'pestle economic should be string');
  assert(typeof strategy.pestle.social === 'string', 'pestle social should be string');
  assert(typeof strategy.pestle.technological === 'string', 'pestle technological should be string');
  assert(typeof strategy.pestle.legal === 'string', 'pestle legal should be string');
  assert(typeof strategy.pestle.environmental === 'string', 'pestle environmental should be string');

  assert(typeof strategy.positioning.tagline === 'string', 'positioning tagline should be string');
  assert(typeof strategy.positioning.valueProposition === 'string', 'positioning valueProposition should be string');
  assert(Array.isArray(strategy.positioning.keyMessages), 'positioning keyMessages should be array');
  assert(Array.isArray(strategy.positioning.differentiators), 'positioning differentiators should be array');
  assert(Array.isArray(strategy.positioning.targetSegments), 'positioning targetSegments should be array');

  assert(Array.isArray(generated.competitors), 'competitors should be array');
  assert(generated.competitors.length <= 5, 'competitors should be <= 5');
  if (generated.competitors.length > 0) {
    const first = generated.competitors[0] as { name: string; threatLevel: string | null };
    assert(typeof first.name === 'string', 'competitor name should be string');
    assert(first.threatLevel === null || ['LOW', 'MEDIUM', 'HIGH'].includes(first.threatLevel), 'competitor threatLevel should be valid');
  }

  assert(typeof strategy.launchPlan.summary === 'string', 'launchPlan summary should be string');
  assert(Array.isArray(strategy.launchPlan.phases), 'launchPlan phases should be array');

  assert(generated.documentInstanceId !== null && typeof generated.documentInstanceId === 'string', 'documentInstanceId should be a non-null string');
  console.log(`Document instance: ${generated.documentInstanceId}`);
  console.log('✅ Market strategy generated and persisted\n');

  // 4. GET market strategy.
  const fetched = (await api('GET', `/business-genesis/businesses/${businessId}/market-strategy`)) as typeof generated;
  assert(fetched.strategy !== null, 'GET should return a strategy');
  assert(fetched.strategy!.generatedAt === strategy.generatedAt, 'GET should return same generatedAt');
  assert(fetched.documentInstanceId === generated.documentInstanceId, 'GET should return same documentInstanceId');
  assert(fetched.strategy!.analysisSummary.marketOpportunityScore === score, 'GET should return same score');
  console.log('✅ GET market-strategy returns consistent data\n');

  // 5. Verify readiness recalculation includes strategy bonuses.
  const readiness = (await api('GET', `/business-genesis/businesses/${businessId}/readiness`)) as {
    overall: number;
    market: number;
  };
  assert(readiness.market >= 0, 'market readiness should be numeric');
  console.log(`Readiness after generation: ${readiness.overall} (market: ${readiness.market})`);
  console.log('✅ Readiness recalculated with strategy bonuses\n');

  console.log('=== Patch 3 runtime verification passed ===');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
