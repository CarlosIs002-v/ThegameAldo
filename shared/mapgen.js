import { MAP_DEFAULTS, TILE, TILE_SIZE } from './constants.js';
import { createRng } from './rng.js';

/**
 * Generador procedimental de mapas basado en autómata celular.
 *
 * 1. Rellena aleatoriamente la cuadrícula según `wallDensity`.
 * 2. Suaviza con la regla 4-5 para formar cavernas orgánicas.
 * 3. Conserva solo la región transitable más grande (conectividad garantizada).
 * 4. Elige puntos de aparición distribuidos (máxima distancia entre sí).
 *
 * Es determinista: la misma semilla produce siempre el mismo mapa.
 *
 * @param {{ width?: number, height?: number, seed?: number, wallDensity?: number,
 *           smoothingPasses?: number, spawnCount?: number }} [options]
 */
export function generateMap(options = {}) {
  const width = options.width ?? MAP_DEFAULTS.width;
  const height = options.height ?? MAP_DEFAULTS.height;
  const seed = options.seed ?? 1;
  const wallDensity = options.wallDensity ?? MAP_DEFAULTS.wallDensity;
  const passes = options.smoothingPasses ?? MAP_DEFAULTS.smoothingPasses;
  const spawnCount = options.spawnCount ?? 8;

  if (width < 8 || height < 8) {
    throw new RangeError('El mapa debe medir al menos 8x8 celdas');
  }

  const rng = createRng(seed);
  let tiles = new Array(width * height);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const border = x === 0 || y === 0 || x === width - 1 || y === height - 1;
      tiles[y * width + x] = border || rng() < wallDensity ? TILE.WALL : TILE.FLOOR;
    }
  }

  for (let i = 0; i < passes; i++) {
    tiles = smooth(tiles, width, height);
  }

  keepLargestRegion(tiles, width, height);

  const biome = options.biome ?? 'cavern';

  const map = {
    width,
    height,
    seed,
    biome,
    tileSize: TILE_SIZE,
    tiles,
    spawns: [],
    crystals: [],
    labCores: [],
    ruinsVents: [],
  };
  map.spawns = pickSpawns(map, spawnCount, rng);

  if (biome === 'cavern') {
    map.crystals = pickCrystals(map, 18, rng);
  } else if (biome === 'lab') {
    map.labCores = pickEnvironmentNodes(map, 16, rng, 'core');
  } else if (biome === 'ruins') {
    map.ruinsVents = pickEnvironmentNodes(map, 16, rng, 'vent');
  }
  return map;
}

function pickEnvironmentNodes(map, count, rng, type) {
  const width = map.width;
  const height = map.height;
  const candidates = [];

  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      if (map.tiles[y * width + x] === TILE.FLOOR) {
        const hasWall =
          map.tiles[(y - 1) * width + x] === TILE.WALL ||
          map.tiles[(y + 1) * width + x] === TILE.WALL ||
          map.tiles[y * width + (x - 1)] === TILE.WALL ||
          map.tiles[y * width + (x + 1)] === TILE.WALL;
        if (hasWall) {
          candidates.push({ x, y });
        }
      }
    }
  }

  if (candidates.length === 0) return [];
  const picked = [];
  const minTileDistSq = 5 * 5;
  const shuffled = candidates.slice().sort(() => rng() - 0.5);

  for (const c of shuffled) {
    if (picked.length >= count) break;
    const tooClose = picked.some(
      (p) => (p.tx - c.x) ** 2 + (p.ty - c.y) ** 2 < minTileDistSq
    );
    if (!tooClose) {
      const center = tileCenter(map, c.x, c.y);
      picked.push({
        id: picked.length + 1,
        tx: c.x,
        ty: c.y,
        x: center.x + (rng() - 0.5) * 6,
        y: center.y + (rng() - 0.5) * 6,
        type,
        scale: 0.85 + rng() * 0.35,
        phase: rng() * Math.PI * 2,
      });
    }
  }

  return picked;
}

function countWallNeighbours(tiles, width, height, cx, cy) {
  let count = 0;
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (dx === 0 && dy === 0) continue;
      const x = cx + dx;
      const y = cy + dy;
      if (x < 0 || y < 0 || x >= width || y >= height) count++;
      else if (tiles[y * width + x] === TILE.WALL) count++;
    }
  }
  return count;
}

function smooth(tiles, width, height) {
  const next = new Array(tiles.length);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      const border = x === 0 || y === 0 || x === width - 1 || y === height - 1;
      if (border) {
        next[idx] = TILE.WALL;
        continue;
      }
      const walls = countWallNeighbours(tiles, width, height, x, y);
      if (walls > 4) next[idx] = TILE.WALL;
      else if (walls < 4) next[idx] = TILE.FLOOR;
      else next[idx] = tiles[idx];
    }
  }
  return next;
}

/** Rellena con muros todas las regiones de suelo excepto la mayor. */
function keepLargestRegion(tiles, width, height) {
  const regionOf = new Int32Array(tiles.length).fill(-1);
  const sizes = [];
  for (let i = 0; i < tiles.length; i++) {
    if (tiles[i] !== TILE.FLOOR || regionOf[i] !== -1) continue;
    const id = sizes.length;
    let size = 0;
    const stack = [i];
    regionOf[i] = id;
    while (stack.length) {
      const cur = stack.pop();
      size++;
      const cx = cur % width;
      const cy = (cur / width) | 0;
      const neighbours = [
        [cx + 1, cy],
        [cx - 1, cy],
        [cx, cy + 1],
        [cx, cy - 1],
      ];
      for (const [nx, ny] of neighbours) {
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        const n = ny * width + nx;
        if (tiles[n] === TILE.FLOOR && regionOf[n] === -1) {
          regionOf[n] = id;
          stack.push(n);
        }
      }
    }
    sizes.push(size);
  }
  if (sizes.length === 0) return;
  const largest = sizes.indexOf(Math.max(...sizes));
  for (let i = 0; i < tiles.length; i++) {
    if (tiles[i] === TILE.FLOOR && regionOf[i] !== largest) tiles[i] = TILE.WALL;
  }
}

/** Una celda de suelo es "abierta" si sus 8 vecinas también son suelo. */
function isOpenCell(map, x, y) {
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (isWallTile(map, x + dx, y + dy)) return false;
    }
  }
  return true;
}

/** Selección voraz "farthest point" para repartir apariciones por el mapa. */
function pickSpawns(map, count, rng) {
  const candidates = [];
  for (let y = 1; y < map.height - 1; y++) {
    for (let x = 1; x < map.width - 1; x++) {
      if (isOpenCell(map, x, y)) candidates.push({ x, y });
    }
  }
  if (candidates.length === 0) {
    for (let i = 0; i < map.tiles.length; i++) {
      if (map.tiles[i] === TILE.FLOOR) {
        candidates.push({ x: i % map.width, y: (i / map.width) | 0 });
      }
    }
  }
  if (candidates.length === 0) return [];

  const spawns = [candidates[Math.floor(rng() * candidates.length)]];
  while (spawns.length < Math.min(count, candidates.length)) {
    let best = null;
    let bestDist = -1;
    for (const c of candidates) {
      let minD = Infinity;
      for (const s of spawns) {
        const d = (c.x - s.x) ** 2 + (c.y - s.y) ** 2;
        if (d < minD) minD = d;
      }
      if (minD > bestDist) {
        bestDist = minD;
        best = c;
      }
    }
    spawns.push(best);
  }
  return spawns.map(({ x, y }) => tileCenter(map, x, y));
}

/**
 * Selecciona posiciones para cúmulos de cristales luminiscentes verdes/limas
 * incrustados en las paredes o bordes rocosos, como en el arte subterráneo de referencia.
 */
function pickCrystals(map, count, rng) {
  const candidates = [];
  const width = map.width;
  const height = map.height;

  for (let y = 2; y < height - 2; y++) {
    for (let x = 2; x < width - 2; x++) {
      const isWall = map.tiles[y * width + x] === TILE.WALL;
      const isFloor = map.tiles[y * width + x] === TILE.FLOOR;

      if (isWall) {
        const hasFloor =
          map.tiles[(y - 1) * width + x] === TILE.FLOOR ||
          map.tiles[(y + 1) * width + x] === TILE.FLOOR ||
          map.tiles[y * width + (x - 1)] === TILE.FLOOR ||
          map.tiles[y * width + (x + 1)] === TILE.FLOOR;
        if (hasFloor) {
          candidates.push({ x, y, onWall: true });
        }
      } else if (isFloor) {
        const hasWall =
          map.tiles[(y - 1) * width + x] === TILE.WALL ||
          map.tiles[(y + 1) * width + x] === TILE.WALL ||
          map.tiles[y * width + (x - 1)] === TILE.WALL ||
          map.tiles[y * width + (x + 1)] === TILE.WALL;
        if (hasWall) {
          candidates.push({ x, y, onWall: false });
        }
      }
    }
  }

  if (candidates.length === 0) return [];

  const picked = [];
  const minTileDistSq = 5 * 5;
  const shuffled = candidates.slice().sort(() => rng() - 0.5);

  for (const c of shuffled) {
    if (picked.length >= count) break;
    const tooClose = picked.some(
      (p) => (p.tx - c.x) ** 2 + (p.ty - c.y) ** 2 < minTileDistSq
    );
    if (!tooClose) {
      const center = tileCenter(map, c.x, c.y);
      picked.push({
        id: picked.length + 1,
        tx: c.x,
        ty: c.y,
        x: center.x + (rng() - 0.5) * 8,
        y: center.y + (rng() - 0.5) * 8,
        onWall: c.onWall,
        scale: 0.85 + rng() * 0.35,
        shards: Math.floor(rng() * 2) + 3,
        phase: rng() * Math.PI * 2,
      });
    }
  }

  return picked;
}

export function tileCenter(map, tx, ty) {
  const size = map.tileSize ?? TILE_SIZE;
  return { x: tx * size + size / 2, y: ty * size + size / 2 };
}

/** Las coordenadas fuera del mapa se consideran muro. */
export function isWallTile(map, tx, ty) {
  if (tx < 0 || ty < 0 || tx >= map.width || ty >= map.height) return true;
  return map.tiles[ty * map.width + tx] === TILE.WALL;
}

/** Comprueba si un punto en píxeles cae sobre un muro. */
export function isWallAt(map, px, py) {
  const size = map.tileSize ?? TILE_SIZE;
  return isWallTile(map, Math.floor(px / size), Math.floor(py / size));
}

/** Devuelve todas las celdas de suelo (útil para spawns de objetos). */
export function floorCells(map) {
  const cells = [];
  for (let i = 0; i < map.tiles.length; i++) {
    if (map.tiles[i] === TILE.FLOOR) cells.push({ x: i % map.width, y: (i / map.width) | 0 });
  }
  return cells;
}
