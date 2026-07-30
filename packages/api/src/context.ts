import { CreateNextContextOptions } from '@trpc/server/adapters/next';
import { db } from '@keyflow/db';

/**
 * Creates context for an incoming request
 * @link https://trpc.io/docs/v11/context
 */
export async function createContext(opts: CreateNextContextOptions): Promise<{ db: typeof db }> {
  // Here you can get the user session
  return {
    db,
  };
}

export type Context = Awaited<ReturnType<typeof createContext>>;