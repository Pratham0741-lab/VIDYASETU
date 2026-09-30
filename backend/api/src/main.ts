import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';
import { configureApp } from './app.setup';
import { AppConfigService } from './config/app-config.service';
import { buildOpenApiDocument, DOCS_PATH, setupSwagger } from './openapi/swagger';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule.forRoot(), {
    bufferLogs: true,
    bodyParser: false,
  });

  configureApp(app);

  const config = app.get(AppConfigService);
  const logger = app.get(Logger);

  if (config.swagger.enabled) {
    setupSwagger(app, buildOpenApiDocument(app));
  }

  // SIGTERM/SIGINT -> onModuleDestroy hooks (Prisma, Redis) run before exit.
  app.enableShutdownHooks();

  // Safety net: a stray rejected promise must be logged, not kill the process.
  process.on('unhandledRejection', (reason) => {
    logger.error({ err: reason }, 'Unhandled promise rejection');
  });

  await app.listen(config.port, '0.0.0.0');
  logger.log(
    `VIDYASETU API listening on port ${config.port}` +
      (config.swagger.enabled ? `; docs at /${DOCS_PATH}` : ''),
  );
}

bootstrap().catch((err: unknown) => {
  process.stderr.write(
    `${JSON.stringify({
      level: 'fatal',
      time: Date.now(),
      msg: 'API failed to start',
      err: err instanceof Error ? { message: err.message, stack: err.stack } : String(err),
    })}\n`,
  );
  process.exit(1);
});
