import { db } from '@keyflow/db';

async function main() {
  const prisma = db;
  const businessId = process.argv[2] || 'cmpcs917u00go9z00hvf3wcw3';

  const threads = await prisma.keyInboxThread.findMany({
    where: { businessId, channel: 'whatsapp' },
    orderBy: { updatedAt: 'desc' },
    take: 5,
    include: {
      messages: {
        orderBy: { receivedAt: 'desc' },
        take: 2,
      },
    },
  });

  const events = await prisma.businessEvent.findMany({
    where: {
      businessId,
      eventType: { in: ['message.received', 'message.intake.received', 'entity.resolved', 'key_inbox.message_added', 'key_inbox.thread_upserted'] },
    },
    orderBy: { createdAt: 'desc' },
    take: 10,
    select: { id: true, eventType: true, after: true, metadata: true, createdAt: true },
  });

  console.log('=== WhatsApp KEYInbox threads ===');
  console.log(JSON.stringify(threads, null, 2));
  console.log('=== Recent business events ===');
  console.log(JSON.stringify(events, null, 2));

  const twilioThread = threads.find(t => t.externalThreadId.includes('18681234567'));
  const metaThread = threads.find(t => t.externalThreadId.includes('18689876543'));

  let ok = true;
  if (!twilioThread) { console.error('MISSING Twilio thread'); ok = false; }
  if (!metaThread) { console.error('MISSING Meta thread'); ok = false; }
  if (!threads.some(t => t.messages.some(m => m.externalMessageId === 'SMruntime001'))) {
    console.error('MISSING Twilio message SMruntime001'); ok = false;
  }
  if (!threads.some(t => t.messages.some(m => m.externalMessageId === 'wamid.runtimeM1'))) {
    console.error('MISSING Meta message wamid.runtimeM1'); ok = false;
  }

  await prisma.$disconnect();
  process.exit(ok ? 0 : 1);
}

main().catch(e => { console.error(e); process.exit(1); });
