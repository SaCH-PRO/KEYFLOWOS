/**
 * Dev-only helper: generate a local admin JWT.
 *
 * NEVER run this in production or against a real user database.
 * The script exits unless NODE_ENV=development.
 */
import { buildAdminToken } from '../../apps/server/src/core/auth/admin-token.util';

if (process.env.NODE_ENV !== 'development') {
  console.error('This script is only allowed in NODE_ENV=development');
  process.exit(1);
}

const secret = process.env.ADMIN_JWT_SECRET || '';
if (!secret) {
  console.error('ADMIN_JWT_SECRET not set');
  process.exit(1);
}

const token = buildAdminToken({
  id: '381d115d-b2b4-4a32-b493-1989cf9b9355',
  email: 'dev@keyflow.local',
  role: 'USER',
}, secret);

console.log(token);
