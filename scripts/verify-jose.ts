import { jwtVerify } from 'jose';

const secret = process.env.SUPABASE_JWT_SECRET || '';
const token = process.argv[2];

async function main() {
  try {
    const { payload } = await jwtVerify(token, new TextEncoder().encode(secret), { algorithms: ['HS256'], clockTolerance: 60 });
    console.log('verified', payload);
  } catch (err) {
    console.error('failed', (err as Error).message);
  }
}

main();
