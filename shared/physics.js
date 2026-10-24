import { isWallAt } from './mapgen.js';
export { isWallAt };

/**
 * Normaliza un vector de entrada y limita su magnitud a 1.
 * El servidor lo usa para impedir que un cliente modificado
 * envíe vectores más largos y se mueva más rápido de lo permitido.
 */
export function clampInputVector(mx, my) {
  const x = Number.isFinite(mx) ? mx : 0;
  const y = Number.isFinite(my) ? my : 0;
  const len = Math.hypot(x, y);
  if (len === 0) return { x: 0, y: 0 };
  if (len <= 1) return { x, y };
  return { x: x / len, y: y / len };
}

/** ¿El círculo (x, y, r) intersecta algún muro? Se muestrean las 4 esquinas de su AABB. */
export function collidesWithMap(map, x, y, r) {
  return (
    isWallAt(map, x - r, y - r) ||
    isWallAt(map, x + r, y - r) ||
    isWallAt(map, x - r, y + r) ||
    isWallAt(map, x + r, y + r)
  );
}

/**
 * Integra el movimiento de una entidad con resolución de colisiones por ejes.
 * Al resolver X e Y por separado la entidad "se desliza" a lo largo de los muros.
 *
 * @returns {{ x: number, y: number }} nueva posición
 */
export function stepMovement(map, pos, input, speed, dt, radius) {
  const dir = clampInputVector(input.x, input.y);
  let { x, y } = pos;

  const nx = x + dir.x * speed * dt;
  if (!collidesWithMap(map, nx, y, radius)) x = nx;

  const ny = y + dir.y * speed * dt;
  if (!collidesWithMap(map, x, ny, radius)) y = ny;

  return { x, y };
}

export function circlesOverlap(ax, ay, ar, bx, by, br) {
  const dx = ax - bx;
  const dy = ay - by;
  const rr = ar + br;
  return dx * dx + dy * dy <= rr * rr;
}
