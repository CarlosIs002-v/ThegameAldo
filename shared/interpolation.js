/**
 * Interpolación de posiciones de jugadores en el cliente.
 *
 * El servidor envía snapshots a 30 Hz; el cliente renderiza a 60 FPS
 * con un pequeño retardo (INTERPOLATION_DELAY_MS) e interpola entre los
 * dos snapshots que rodean el instante de render para un movimiento suave.
 */

export function lerp(a, b, t) {
  return a + (b - a) * t;
}

export function clamp01(t) {
  return t < 0 ? 0 : t > 1 ? 1 : t;
}

/**
 * Interpola entre dos estados {t, x, y} para el tiempo `renderTime`.
 * Fuera del intervalo se fija al extremo más cercano (sin extrapolar).
 */
export function interpolateState(from, to, renderTime) {
  const span = to.t - from.t;
  const alpha = span <= 0 ? 1 : clamp01((renderTime - from.t) / span);
  return { x: lerp(from.x, to.x, alpha), y: lerp(from.y, to.y, alpha) };
}

/**
 * Búfer de snapshots de una entidad, ordenado por tiempo.
 */
export class InterpolationBuffer {
  constructor(maxSize = 30) {
    this.maxSize = maxSize;
    this.states = [];
  }

  push(state) {
    const last = this.states[this.states.length - 1];
    if (last && state.t <= last.t) return; // descarta paquetes desordenados
    this.states.push(state);
    if (this.states.length > this.maxSize) this.states.shift();
  }

  /** Posición interpolada para `renderTime`, o null si el búfer está vacío. */
  sample(renderTime) {
    const s = this.states;
    if (s.length === 0) return null;
    if (s.length === 1 || renderTime <= s[0].t) return { x: s[0].x, y: s[0].y };
    for (let i = s.length - 1; i > 0; i--) {
      if (s[i - 1].t <= renderTime) {
        return interpolateState(s[i - 1], s[i], renderTime);
      }
    }
    const last = s[s.length - 1];
    return { x: last.x, y: last.y };
  }

  clear() {
    this.states.length = 0;
  }
}
