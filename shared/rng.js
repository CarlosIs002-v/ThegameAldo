/**
 * Generador pseudoaleatorio determinista (mulberry32).
 * Permite reproducir mapas y datos de prueba a partir de una semilla.
 * @param {number} seed
 * @returns {() => number} función que devuelve floats en [0, 1)
 */
export function createRng(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Entero aleatorio en [min, max] (inclusive). */
export function randInt(rng, min, max) {
  return min + Math.floor(rng() * (max - min + 1));
}
