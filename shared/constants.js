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
  width: 60,
  height: 38,
  wallDensity: 0.40,
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

export const CLASSES = Object.freeze({
  assault: {
    id: 'assault',
    name: 'Asalto',
    role: 'Versátil & Equilibrado',
    desc: 'Cadencia estándar y velocidad balanceada',
    speed: 190,
    baseHp: 100,
    fireCooldownMs: 280,
    projectileSpeed: 540,
    armor: 0,
    color: '#00f0ff',
    icon: '⚡',
  },
  scout: {
    id: 'scout',
    name: 'Explorador',
    role: 'Velocista Supersónico',
    desc: 'Alta movilidad y ráfaga de disparo veloz',
    speed: 230,
    baseHp: 80,
    fireCooldownMs: 200,
    projectileSpeed: 620,
    armor: 0,
    color: '#b6ff3b',
    icon: '🏹',
  },
  tank: {
    id: 'tank',
    name: 'Juggernaut',
    role: 'Blindaje Pesado',
    desc: 'Gran resistencia al daño con disparos pesados',
    speed: 155,
    baseHp: 140,
    fireCooldownMs: 360,
    projectileSpeed: 460,
    armor: 15,
    color: '#ffb020',
    icon: '🛡️',
  },
  tactical: {
    id: 'tactical',
    name: 'Táctica',
    role: 'Soporte & Bio-Tech',
    desc: 'Mayor regeneración, cadencia ágil y blindaje ligero',
    speed: 205,
    baseHp: 110,
    fireCooldownMs: 250,
    projectileSpeed: 580,
    armor: 10,
    color: '#3bffb0',
    icon: '🧬',
  },
});

export const CHARACTERS = Object.freeze({
  vanguard: {
    id: 'vanguard',
    name: 'Vanguardia Neón',
    role: 'Asalto Frontal',
    classId: 'assault',
    color: '#00f0ff',
    spriteColor: 'cyan',
    avatar: '/img/soldier_cyan_front.png',
    title: 'Operador de Choque',
    desc: 'Armadura balanceada con visor táctico de alta frecuencia y rifle de pulsos.',
    stats: { vel: 3, res: 3, cad: 3 },
  },
  spectre: {
    id: 'spectre',
    name: 'Espectro Sombra',
    role: 'Infiltración & Sigilo',
    classId: 'scout',
    color: '#ff2bd6',
    spriteColor: 'magenta',
    avatar: '/img/soldier_magenta_front.png',
    title: 'Ninja Cibernético',
    desc: 'Módulo de hiper-velocidad con ráfagas supersónicas para flanquear enemigos.',
    stats: { vel: 5, res: 2, cad: 5 },
  },
  titan: {
    id: 'titan',
    name: 'Titán Cyborg',
    role: 'Blindaje Pesado',
    classId: 'tank',
    color: '#ffb020',
    spriteColor: 'orange',
    avatar: '/img/soldier_orange_front.png',
    title: 'Unidad de Asedio',
    desc: 'Chasis de aleación pesada con cañón de plasma masivo y absorción de daño.',
    stats: { vel: 2, res: 5, cad: 2 },
  },
  nova: {
    id: 'nova',
    name: 'Operadora Nova',
    role: 'Especialista Bio-Tech',
    classId: 'tactical',
    color: '#3bffb0',
    spriteColor: 'teal',
    avatar: '/img/soldier_teal_front.png',
    title: 'Especialista Táctica',
    desc: 'Sistemas bio-cibernéticos de regeneración acelerada y asistencia de combate.',
    stats: { vel: 4, res: 4, cad: 3 },
  },
  viper: {
    id: 'viper',
    name: 'Víbora Neón',
    role: 'Acechador Ácido',
    classId: 'scout',
    color: '#b6ff3b',
    spriteColor: 'lime',
    avatar: '/img/soldier_lime_front.png',
    title: 'Velocista Radiactivo',
    desc: 'Maniobrabilidad extrema con ráfagas de plasma tóxico de alta cadencia.',
    stats: { vel: 5, res: 2, cad: 4 },
  },
  void: {
    id: 'void',
    name: 'Vacío Psiónico',
    role: 'Control Cuántico',
    classId: 'tactical',
    color: '#8a7bff',
    spriteColor: 'purple',
    avatar: '/img/soldier_purple_front.png',
    title: 'Manipulador de Energía',
    desc: 'Canalizador de pulsos de distorsión y regeneración de escudo táctico.',
    stats: { vel: 3, res: 4, cad: 4 },
  },
  inferno: {
    id: 'inferno',
    name: 'Furia Berserker',
    role: 'Asalto Térmico',
    classId: 'assault',
    color: '#ff5a5a',
    spriteColor: 'red',
    avatar: '/img/soldier_red_front.png',
    title: 'Demoledor de Fuego',
    desc: 'Armadura pesada de choque con proyectiles incandescentes y alto impacto.',
    stats: { vel: 3, res: 4, cad: 5 },
  },
  phantom: {
    id: 'phantom',
    name: 'Fantasma Polar',
    role: 'Francotirador Ártico',
    classId: 'tank',
    color: '#ffffff',
    spriteColor: 'white',
    avatar: '/img/soldier_white_front.png',
    title: 'Vigilante Crío',
    desc: 'Blindaje cerámico crío-reforzado con disparos de precisión gélida.',
    stats: { vel: 4, res: 4, cad: 4 },
  },
});

export const BIOMES = Object.freeze({
  cavern: {
    id: 'cavern',
    name: 'Caverna de Cristal',
    desc: 'Profunda gruta subterránea iluminada por cristales bioluminiscentes y rejilla de neón.',
    icon: '💎',
    themeColor: '#48ff8a',
    accentColor: '#00f0ff',
  },
  lab: {
    id: 'lab',
    name: 'Laboratorio CyberGrid',
    desc: 'Instalación científica de alta seguridad con rejillas de acero y núcleos de plasma púrpura.',
    icon: '⚡',
    themeColor: '#8a7bff',
    accentColor: '#ff2bd6',
  },
  ruins: {
    id: 'ruins',
    name: 'Ruinas de Neón',
    desc: 'Páramo de superficie calcinado con fisuras de magma sintético y monolitos derruidos.',
    icon: '🌋',
    themeColor: '#ff5a5a',
    accentColor: '#ffb020',
  },
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
  maxActive: 14,
  spawnEveryMs: 3500,
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
