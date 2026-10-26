/**
 * Constantes compartidas entre servidor (autoridad) y cliente (render).
 * Mantenerlas en un único módulo evita desincronizaciones de reglas.
 */
export const TILE_SIZE = 32;

export const TILE = Object.freeze({
  FLOOR: 0,
  WALL: 1,
});

export const MAP_DEFAULTS = Object.freeze({
  width: 40,
  height: 26,
  wallDensity: 0.42,
  smoothingPasses: 4,
});

/** Frecuencia de simulación del servidor (ticks por segundo). */
export const SERVER_TICK_RATE = 30;

/** FPS objetivo del cliente (bucle bloqueado a 60 FPS vía delta time). */
export const TARGET_FPS = 60;

/** Retardo de interpolación de entidades remotas en ms (≈ 2-3 ticks de servidor). */
export const INTERPOLATION_DELAY_MS = 80;

/** Frecuencia de envío de inputs del cliente. */
export const CLIENT_INPUT_RATE = 60;

/** Umbral de corrección brusca de la predicción local (px). */
export const PREDICTION_SNAP_DISTANCE = 28;

export const PLAYER = Object.freeze({
  radius: 12,
  speed: 190, // px / s
  baseHp: 100,
  hpPerLevel: 10,
  respawnMs: 3000,
  fireCooldownMs: 280,
  maxLevel: 10,
  shardsPerLevel: 3,
});

export const PROJECTILE = Object.freeze({
  radius: 4,
  speed: 540, // px / s
  lifetimeMs: 1100,
  baseDamage: 20,
  critChance: 0.12,
  critMultiplier: 1.5,
});

export const PICKUP = Object.freeze({
  radius: 10,
  maxActive: 8,
  spawnEveryMs: 4000,
  medkitHeal: 35,
  kinds: ['shard', 'medkit'],
});

export const MATCH = Object.freeze({
  durationMs: 90_000,
  minPlayers: 1,
  maxPlayers: 8,
  maxBots: 3,
  returnToLobbyMs: 6000,
});

export const PLAYER_COLORS = Object.freeze([
  '#00f0ff',
  '#ff2bd6',
  '#b6ff3b',
  '#ffb020',
  '#8a7bff',
  '#ff5a5a',
  '#3bffb0',
  '#ffffff',
]);
