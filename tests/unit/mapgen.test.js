import { describe, it, expect } from 'vitest';
import { generateMap, isWallAt } from '../../shared/mapgen.js';
import { TILE } from '../../shared/constants.js';

describe('Generador Procedimental de Mapas (shared/mapgen.js)', () => {
  it('produce mapas idénticos con la misma semilla (determinismo)', () => {
    const mapA = generateMap({ seed: 1337, width: 30, height: 20 });
    const mapB = generateMap({ seed: 1337, width: 30, height: 20 });

    expect(mapA.tiles).toEqual(mapB.tiles);
    expect(mapA.spawns).toEqual(mapB.spawns);
  });

  it('produce mapas distintos ante semillas diferentes', () => {
    const map1 = generateMap({ seed: 111, width: 30, height: 20 });
    const map2 = generateMap({ seed: 999, width: 30, height: 20 });

    expect(map1.tiles).not.toEqual(map2.tiles);
  });

  it('garantiza bordes perimetrales de muros cerrados', () => {
    const map = generateMap({ seed: 42, width: 25, height: 20 });
    const { width, height, tiles } = map;

    // Fila superior e inferior
    for (let x = 0; x < width; x++) {
      expect(tiles[0 * width + x]).toBe(TILE.WALL);
      expect(tiles[(height - 1) * width + x]).toBe(TILE.WALL);
    }
    // Columnas izquierda y derecha
    for (let y = 0; y < height; y++) {
      expect(tiles[y * width + 0]).toBe(TILE.WALL);
      expect(tiles[y * width + (width - 1)]).toBe(TILE.WALL);
    }
  });

  it('ubica puntos de aparición (spawns) exclusivamente sobre celdas transitables', () => {
    const map = generateMap({ seed: 777, spawnCount: 6 });
    expect(map.spawns.length).toBeGreaterThanOrEqual(1);

    for (const spawn of map.spawns) {
      expect(isWallAt(map, spawn.x, spawn.y)).toBe(false);
    }
  });
});
