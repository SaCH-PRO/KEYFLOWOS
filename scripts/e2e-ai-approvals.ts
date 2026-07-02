import { PrismaClient } from '@prisma/client';
import crypto from 'crypto';

const API = 'http://localhost:3001';
const BUSINESS_ID = 'cmqzajbza00009z4cv6lygpj9';
const USER_ID = '381d115d-b2b4-4a32-b493-1989cf9b9355';
const ADMIN_SECRET = process.env.ADMIN_JWT_SECRET || 'pTiuPd0a1mhp4UXqXxy/m6FCVxB/vGpPn7gSE9r6oIg=';

function makeAdminToken(sub: string, email: string, role: string) {
  const now = Date.now();
  const payload = { sub, email, role, iat: now, exp: now + 24 * 60 * 60 * 1000, type: 'admin', jti: crypto.randomUUID() };
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = crypto.createHmac('sha256', ADMIN_SECRET).update(`${header}.${body}`).digest('base64url');
  return `${header}.${body}.${signature}`;
}

const TOKEN = makeAdminToken(USER_ID, 'dev@keyflow.local', 'USER');

async function api(path: string, opts: RequestInit = {}) {
  const res = await fetch(`${API}${path}`, {
    ...opts,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      'Content-Type': 'application/json',
      ...(opts.headers || {}),
    },
  });
  const text = await res.text();
  let data: unknown = null;
  try {
    data = JSON.parse(text);
  } catch {
    data = text;
  }
  if (!res.ok) {
    throw new Error(`${opts.method || 'GET'} ${path} -> ${res.status}: ${JSON.stringify(data)}`);
  }
  return data;
}

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(`Assertion failed: ${msg}`);
}

async function main() {
  const prisma = new PrismaClient();
  try {
    console.log('1. Stats endpoint');
    const statsBefore = await api(`/ai-approvals/businesses/${BUSINESS_ID}/stats`) as any;
    assert(typeof statsBefore.pending === 'number', 'pending count missing');
    assert(Array.isArray(statsBefore.byModule), 'byModule missing');
    console.log('  stats:', statsBefore);

    console.log('2. Create test approval items');
    const approveItem = await prisma.aiApprovalItem.create({
      data: {
        businessId: BUSINESS_ID,
        status: 'pending',
        riskTier: 2,
        toolName: 'e2e_approve_test',
        module: 'operations',
        title: 'E2E approve test',
        inputPayload: { test: true },
      },
    });
    const rejectItem = await prisma.aiApprovalItem.create({
      data: {
        businessId: BUSINESS_ID,
        status: 'pending',
        riskTier: 1,
        toolName: 'e2e_reject_test',
        module: 'operations',
        title: 'E2E reject test',
        inputPayload: { test: true },
      },
    });
    console.log('  created', approveItem.id, rejectItem.id);

    console.log('3. List pending items');
    const list = await api(`/ai-approvals/businesses/${BUSINESS_ID}/items?status=pending`) as any;
    assert(list.items.some((i: any) => i.id === approveItem.id), 'approve item not in list');
    assert(list.items.some((i: any) => i.id === rejectItem.id), 'reject item not in list');
    console.log('  pending count:', list.items.length);

    console.log('4. Get single item');
    const fetched = await api(`/ai-approvals/businesses/${BUSINESS_ID}/items/${approveItem.id}`) as any;
    assert(fetched.id === approveItem.id, 'get item mismatch');
    assert(fetched.inputPayload?.test === true, 'input payload serialized incorrectly');

    console.log('5. Approve item');
    const approved = await api(`/ai-approvals/businesses/${BUSINESS_ID}/items/${approveItem.id}/resolve`, {
      method: 'POST',
      body: JSON.stringify({ resolution: 'approved' }),
    }) as any;
    assert(approved.status === 'approved', 'approve failed');
    assert(approved.resolvedBy === USER_ID, 'resolvedBy not set');
    console.log('  approved');

    console.log('6. Bulk reject item');
    const bulk = await api(`/ai-approvals/businesses/${BUSINESS_ID}/items/bulk-resolve`, {
      method: 'POST',
      body: JSON.stringify({ ids: [rejectItem.id], resolution: 'rejected' }),
    }) as any;
    assert(bulk.succeeded === 1 && bulk.failed === 0, 'bulk reject failed');

    const rejected = await prisma.aiApprovalItem.findUnique({ where: { id: rejectItem.id } });
    assert(rejected?.status === 'rejected', 'reject status not persisted');
    console.log('  bulk rejected');

    console.log('7. Stats after mutations');
    const statsAfter = await api(`/ai-approvals/businesses/${BUSINESS_ID}/stats`) as any;
    assert(statsAfter.approvedToday >= statsBefore.approvedToday + 1, 'approvedToday not incremented');
    assert(statsAfter.rejectedToday >= statsBefore.rejectedToday + 1, 'rejectedToday not incremented');
    console.log('  stats:', statsAfter);

    console.log('8. Status filter approved');
    const approvedList = await api(`/ai-approvals/businesses/${BUSINESS_ID}/items?status=approved`) as any;
    assert(approvedList.items.some((i: any) => i.id === approveItem.id), 'approved item not in approved list');

    console.log('\n✅ All AI approval endpoints passed end-to-end');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
