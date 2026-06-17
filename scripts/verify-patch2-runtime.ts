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

const token = buildAdminToken(DEV_USER_ID, DEV_EMAIL, 'OWNER');

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
    throw new Error(`${method} ${path} failed ${res.status}: ${JSON.stringify(json).slice(0, 500)}`);
  }
  return json;
}

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(`ASSERTION FAILED: ${message}`);
}

async function main() {
  console.log('=== Patch 2 runtime verification ===\n');

  // 1. Find or create a business for the dev user.
  const businesses = (await api('GET', '/identity/businesses')) as { id: string; name: string }[];
  let businessId: string;
  if (businesses.length > 0) {
    businessId = businesses[0].id;
    console.log(`Using existing business: ${businessId} (${businesses[0].name})`);
  } else {
    const created = (await api('POST', '/identity/businesses', { name: 'Patch2 Verify' })) as { id: string };
    businessId = created.id;
    console.log(`Created business: ${businessId}`);
  }

  // 2. Seed blueprint answers including disclaimer.
  const answers = {
    businessName: 'ClinicFlow T&T',
    country: 'Trinidad and Tobago',
    industry: 'Healthcare technology',
    archetype: 'Clinic management platform',
    businessIntent: 'Digital clinic management platform for private doctors in Trinidad.',
    revenueModel: 'SaaS subscription',
    deliveryMode: 'online',
    channels: ['website', 'social media'],
    legalStructurePreference: 'LIMITED_COMPANY',
    'legalProfile.hasPhysicalLocation': true,
    'legalProfile.regulatedIndustry': true,
    'legalProfile.disclaimerAcceptedAt': new Date().toISOString(),
    hasEmployees: true,
    contractorPaymentsExpected: true,
    hasPartners: true,
    estimatedAnnualRevenue: 600000,
    startupCapital: 40000,
    monthlyFixedCosts: 8000,
    variableCostPercent: 20,
    expectedMonthlyUnits: 10,
    avgTicket: 5000,
    financialRisks: [
      { description: 'Runway shorter than 6 months', likelihood: 'HIGH', impact: 'HIGH' },
    ],
    legalRisks: [
      { description: 'Health data privacy compliance', likelihood: 'MEDIUM', impact: 'HIGH' },
    ],
    marketRisks: [
      { description: 'Slow clinic adoption', likelihood: 'MEDIUM', impact: 'MEDIUM' },
    ],
    operationalRisks: [
      { description: 'Reliance on single developer', likelihood: 'MEDIUM', impact: 'MEDIUM' },
    ],
  };

  const progress = (await api('POST', `/business-genesis/businesses/${businessId}/answers`, { answers })) as {
    readiness: { overall: number; legal: number };
    complianceItems: { id: string }[];
  };
  console.log(`Readiness after answers: ${progress.readiness.overall}`);
  assert(progress.readiness.overall > 0, 'readiness overall should be > 0');
  assert(progress.complianceItems.some((i) => i.id.includes('tt-')), 'T&T compliance items should be present');
  console.log('✅ Answers submitted and compliance computed\n');

  // 3. Readiness endpoint.
  const readiness = (await api('GET', `/business-genesis/businesses/${businessId}/readiness`)) as {
    overall: number;
    legal: number;
  };
  console.log(`Readiness endpoint: overall=${readiness.overall}, legal=${readiness.legal}`);
  assert(typeof readiness.overall === 'number', 'readiness should return overall score');
  console.log('✅ Readiness endpoint works\n');

  // 4. Generate document pack.
  const pack = (await api('POST', `/business-genesis/businesses/${businessId}/generate-document-pack`, {})) as {
    generated: { instanceId: string; documentTypeSlug: string; title: string; status: string }[];
    missing: string[];
  };
  console.log(`Generated ${pack.generated.length} docs; missing: ${pack.missing.join(', ') || 'none'}`);
  assert(pack.generated.length > 0, 'at least one document should be generated');
  assert(
    pack.generated.some((d) => d.documentTypeSlug === 'registration-checklist-tt'),
    'registration-checklist-tt should be generated (or fallback)',
  );
  console.log('✅ Document pack generated\n');

  // 5. Get document pack.
  const pack2 = (await api('GET', `/business-genesis/businesses/${businessId}/document-pack`)) as typeof pack;
  console.log(`Persisted pack: ${pack2.generated.length} docs; missing: ${pack2.missing.join(', ') || 'none'}`);
  assert(pack2.generated.length === pack.generated.length, 'persisted pack should match generated count');
  console.log('✅ Document pack persisted and retrievable\n');

  // 6. Generate risk register.
  const risks = (await api('POST', `/business-genesis/businesses/${businessId}/generate-risk-register`, {})) as {
    id: string;
    title: string;
    category: string;
  }[];
  console.log(`Created ${risks.length} risks`);
  assert(risks.length > 0, 'risk register should create risks from blueprint risk profile');
  assert(
    risks.some((r) => r.category === 'LEGAL' && r.title.toLowerCase().includes('privacy')),
    'legal privacy risk should be created',
  );
  console.log('✅ Risk register generated\n');

  console.log('=== Patch 2 runtime verification PASSED ===');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
