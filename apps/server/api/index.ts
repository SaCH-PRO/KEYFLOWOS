import 'dotenv/config';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { NestFactory } from '@nestjs/core';
import { ExpressAdapter } from '@nestjs/platform-express';
import express from 'express';
import { AppModule } from '../src/app.module';
import { configureNestApp } from '../src/app-bootstrap';

let expressHandler:
  | ((req: VercelRequest, res: VercelResponse) => void)
  | null = null;

async function getHandler() {
  if (expressHandler) return expressHandler;

  const server = express();
  const app = await NestFactory.create(AppModule, new ExpressAdapter(server), {
    logger: ['error', 'warn', 'log'],
  });
  configureNestApp(app);
  await app.init();

  expressHandler = server as unknown as (req: VercelRequest, res: VercelResponse) => void;
  return expressHandler;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const appHandler = await getHandler();
  return appHandler(req, res);
}
