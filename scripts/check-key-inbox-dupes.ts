import { db } from '@keyflow/db';

async function main() {
  const messageDups = await db.$queryRaw`
    SELECT business_id, channel, external_message_id, COUNT(*)
    FROM key_inbox_messages
    WHERE external_message_id IS NOT NULL
    GROUP BY business_id, channel, external_message_id
    HAVING COUNT(*) > 1
    LIMIT 10
  `;
  console.log('message dups', JSON.stringify(messageDups, null, 2));

  const threadDups = await db.$queryRaw`
    SELECT business_id, channel, external_thread_id, COUNT(*)
    FROM key_inbox_threads
    WHERE external_thread_id IS NOT NULL
    GROUP BY business_id, channel, external_thread_id
    HAVING COUNT(*) > 1
    LIMIT 10
  `;
  console.log('thread dups', JSON.stringify(threadDups, null, 2));
}

main()
  .catch(console.error)
  .finally(() => db.$disconnect());
