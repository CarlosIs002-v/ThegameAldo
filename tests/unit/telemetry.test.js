import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../../server/index.js';
import { telemetryService } from '../../server/telemetry.js';

describe('Endpoints de Telemetría y Agregación (server/telemetry.js & API)', () => {
  const app = createApp();

  it('GET /api/test/telemetry responde con HTTP 200 y latencia inferior a 200ms', async () => {
    const start = performance.now();
    const res = await request(app).get('/api/test/telemetry');
    const elapsed = performance.now() - start;

    expect(res.status).toBe(200);
    expect(elapsed).toBeLessThan(200); // Requerimiento estricto de lineamientos

    const body = res.body;
    expect(body.status).toBe('ok');
    expect(body.data).toBeDefined();
    expect(typeof body.data.winRate).toBe('number');
    expect(typeof body.data.kdr).toBe('number');
    expect(typeof body.data.averageSurvivalSeconds).toBe('number');
    expect(body.data.totalMatches).toBeGreaterThanOrEqual(100);
  });

  it('POST /api/test/seed inyecta partidas controladas y actualiza métricas agregadas', async () => {
    const sampleMatches = Array.from({ length: 120 }, (_, i) => ({
      matchId: `custom-seed-${i}`,
      durationSeconds: 90,
      winner: 'PlayerOne',
      playerStats: [
        {
          playerId: 'PlayerOne',
          kills: 5,
          deaths: 1,
          damageDealt: 500,
          survivalTimeSeconds: 90,
          won: true,
        },
        {
          playerId: 'PlayerTwo',
          kills: 1,
          deaths: 5,
          damageDealt: 120,
          survivalTimeSeconds: 40,
          won: false,
        },
      ],
      timestamp: Date.now(),
    }));

    const start = performance.now();
    const res = await request(app)
      .post('/api/test/seed')
      .send({ matches: sampleMatches });
    const elapsed = performance.now() - start;

    expect(res.status).toBe(200);
    expect(elapsed).toBeLessThan(200);
    expect(res.body.result.insertedCount).toBe(120);

    // Comprobar que las métricas reflejan los datos inyectados
    const telemetryRes = await request(app).get('/api/test/telemetry');
    expect(telemetryRes.status).toBe(200);
    expect(telemetryRes.body.data.totalMatches).toBe(120);
    expect(telemetryRes.body.data.winRate).toBe(0.5); // 120 victorias de 240 participaciones
  });

  it('POST /api/test/seed rechaza payloads con menos de 100 partidas con error 400', async () => {
    const insufficientMatches = Array.from({ length: 50 }, (_, i) => ({
      matchId: `m-${i}`,
      durationSeconds: 30,
      winner: 'Tester',
      playerStats: [
        {
          playerId: 'Tester',
          kills: 1,
          deaths: 0,
          damageDealt: 100,
          survivalTimeSeconds: 30,
          won: true,
        },
      ],
      timestamp: Date.now(),
    }));

    const res = await request(app)
      .post('/api/test/seed')
      .send({ matches: insufficientMatches });

    expect(res.status).toBe(400);
    expect(res.body.status).toBe('error');
  });
});
