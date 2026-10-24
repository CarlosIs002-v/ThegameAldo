import { describe, it, expect } from 'vitest';
import {
  authCredentialsSchema,
  createRoomSchema,
  playerInputSchema,
  seedPayloadSchema,
} from '../../shared/schemas.js';

describe('Esquemas Zod de Validación de Payloads (shared/schemas.js)', () => {
  it('valida credenciales de autenticación correctas y rechaza cadenas inválidas', () => {
    // Válido
    const valid = authCredentialsSchema.safeParse({
      username: 'NeoOperator',
      password: 'passwordSegura123',
    });
    expect(valid.success).toBe(true);

    // Usuario demasiado corto
    const invalidShort = authCredentialsSchema.safeParse({
      username: 'no',
      password: 'validPassword',
    });
    expect(invalidShort.success).toBe(false);

    // Contraseña demasiado corta
    const invalidPass = authCredentialsSchema.safeParse({
      username: 'OperadorOk',
      password: '12',
    });
    expect(invalidPass.success).toBe(false);
  });

  it('valida inputs de jugador dentro de [-1, 1] y rechaza valores anómalos o manipulados', () => {
    const valid = playerInputSchema.safeParse({
      seq: 10,
      x: 0.707,
      y: -0.707,
      aimAngle: 1.57,
      shooting: true,
      timestamp: Date.now(),
    });
    expect(valid.success).toBe(true);

    // Valor fuera de rango (ej. intento de speed hack enviando 5.0)
    const hacked = playerInputSchema.safeParse({
      seq: 11,
      x: 5.0,
      y: 0,
      aimAngle: 0,
      shooting: false,
      timestamp: Date.now(),
    });
    expect(hacked.success).toBe(false);
  });

  it('valida esquemas de creación de sala con límites de jugadores', () => {
    const valid = createRoomSchema.safeParse({
      name: 'Sector Neon',
      isPrivate: true,
      password: 'roomSecret123',
      maxPlayers: 4,
    });
    expect(valid.success).toBe(true);

    // Límite inválido (> 8 jugadores)
    const tooMany = createRoomSchema.safeParse({
      name: 'Mega Sala',
      maxPlayers: 20,
    });
    expect(tooMany.success).toBe(false);
  });

  it('exige entre 100 y 1,000 partidas en la semilla de telemetría', () => {
    const createSampleMatch = (id) => ({
      matchId: `m-${id}`,
      durationSeconds: 60,
      winner: 'Neo',
      playerStats: [
        {
          playerId: 'Neo',
          kills: 3,
          deaths: 0,
          damageDealt: 300,
          survivalTimeSeconds: 60,
          won: true,
        },
      ],
      timestamp: Date.now(),
    });

    // Menos de 100 partidas -> debe fallar
    const underflow = seedPayloadSchema.safeParse({
      matches: Array.from({ length: 99 }, (_, i) => createSampleMatch(i)),
    });
    expect(underflow.success).toBe(false);

    // 100 partidas -> debe ser válido
    const valid = seedPayloadSchema.safeParse({
      matches: Array.from({ length: 100 }, (_, i) => createSampleMatch(i)),
    });
    expect(valid.success).toBe(true);

    // Más de 1,000 partidas -> debe fallar
    const overflow = seedPayloadSchema.safeParse({
      matches: Array.from({ length: 1001 }, (_, i) => createSampleMatch(i)),
    });
    expect(overflow.success).toBe(false);
  });
});
