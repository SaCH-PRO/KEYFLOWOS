import { config } from 'dotenv';
import { resolve } from 'path';
import { defineConfig } from '@prisma/config';

// Explicitly load the .env file from the project root
config({ path: resolve(__dirname, '../../.env') });

export default defineConfig({
  // You can add programmatic configuration here if needed in the future
});