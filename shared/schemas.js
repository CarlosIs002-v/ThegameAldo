import { z } from 'zod';

/**
 * Esquemas Zod de validación de payloads para red, APIs y pruebas automatizadas.
 * Requerimiento de lineamientos: Esquemas Zod auditados mediante tests unitarios.
 */

// Esquema de credenciales de usuario
export const authCredentialsSchema = z.object({
  username: z
    .string()
    .trim()
    .min(3, 'El usuario debe tener al menos 3 caracteres')
    .max(20, 'El usuario no puede superar 20 caracteres')
    .regex(/^[a-zA-Z0-9_-]+$/, 'Solo caracteres alfanuméricos, guiones y guión bajo'),
  password: z
    .string()
    .min(4, 'La contraseña debe tener al menos 4 caracteres')
    .max(64, 'La contraseña no puede superar 64 caracteres'),
});

// Esquema de creación de sala / lobby
export const createRoomSchema = z.object({
  name: z
    .string()
    .trim()
    .min(3, 'El nombre de la sala debe tener al menos 3 caracteres')
    .max(30, 'El nombre no puede exceder 30 caracteres'),
  isPrivate: z.boolean().default(false),
  password: z.string().max(32).optional(),
  maxPlayers: z.number().int().min(2).max(8).default(4),
  mapSeed: z.number().int().default(() => Math.floor(Math.random() * 100000)),
  biome: z.enum(['cavern', 'lab', 'ruins']).default('cavern'),
});

// Esquema de entrada de jugador (evita manipulación de velocidad o inputs anómalos)
export const playerInputSchema = z.object({
  seq: z.number().int().nonnegative(),
  x: z.number().min(-1).max(1),
  y: z.number().min(-1).max(1),
  aimAngle: z.number().finite(),
  shooting: z.boolean().default(false),
  timestamp: z.number().positive(),
});

// Esquema de una partida individual para telemetría
export const matchRecordSchema = z.object({
  matchId: z.string().min(1),
  durationSeconds: z.number().positive().max(3600),
  winner: z.string().min(1),
  playerStats: z
    .array(
      z.object({
        playerId: z.string().min(1),
        kills: z.number().int().nonnegative(),
        deaths: z.number().int().nonnegative(),
        damageDealt: z.number().nonnegative(),
        survivalTimeSeconds: z.number().nonnegative(),
        won: z.boolean(),
      })
    )
    .min(1),
  timestamp: z.number().positive(),
});

// Esquema para POST /api/test/seed (100 a 1,000 partidas controladas)
export const seedPayloadSchema = z.object({
  matches: z
    .array(matchRecordSchema)
    .min(100, 'El payload de semilla debe incluir al menos 100 partidas')
    .max(1000, 'El payload de semilla no puede exceder 1,000 partidas'),
});
