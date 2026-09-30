// Phase 13E proof 1: time from app.close() to process exit, Redis unreachable (127.0.0.1:1).
import request from 'supertest';
import { createTestApp } from '../../vidyasetu/api/test/support/create-test-app';
import { RedisService } from '../../vidyasetu/api/src/redis/redis.service';

(async () => {
  const app = await createTestApp();
  await request(app.getHttpServer()).get('/health/ready'); // Redis now 'reconnecting'
  const client = app.get(RedisService).client;
  const stream = client.stream as unknown as { destroyed?: boolean; listenerCount?(e: string): number } | undefined;
  console.log(`redis status before close: ${client.status}; socket destroyed: ${stream?.destroyed}; 'close' listeners: ${stream?.listenerCount?.('close')}`);
  const t0 = Date.now();
  await app.close();
  console.log(`app.close() took ${Date.now() - t0} ms; redis status after: ${client.status}; 'close' listeners now: ${stream?.listenerCount?.('close')}`);
  process.on('exit', () => console.log(`process exit ${Date.now() - t0} ms after close() began`));
})();
