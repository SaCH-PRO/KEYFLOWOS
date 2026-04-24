import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { configureNestApp } from './app-bootstrap';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  configureNestApp(app);
  const port = Number(process.env.PORT) || 3001;
  await app.listen(port, '0.0.0.0');
  console.log(`Application is running on: http://localhost:${port}`);
}
bootstrap();
