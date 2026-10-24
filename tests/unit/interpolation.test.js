import { describe, it, expect } from 'vitest';
import { lerp, clamp01, interpolateState, InterpolationBuffer } from '../../shared/interpolation.js';

describe('Interpolación de Posiciones de Jugadores (shared/interpolation.js)', () => {
  it('realiza interpolación lineal (lerp) con precisión', () => {
    expect(lerp(0, 100, 0.5)).toBe(50);
    expect(lerp(10, 20, 0)).toBe(10);
    expect(lerp(10, 20, 1)).toBe(20);
    expect(clamp01(-0.5)).toBe(0);
    expect(clamp01(1.5)).toBe(1);
  });

  it('interpola un estado 2D {x, y} dado un instante de tiempo renderTime', () => {
    const s0 = { t: 1000, x: 0, y: 0 };
    const s1 = { t: 1100, x: 100, y: 200 };

    const mid = interpolateState(s0, s1, 1050);
    expect(mid.x).toBeCloseTo(50, 4);
    expect(mid.y).toBeCloseTo(100, 4);

    // Fuera de límites temporales no extrapola
    const before = interpolateState(s0, s1, 900);
    expect(before.x).toBe(0);

    const after = interpolateState(s0, s1, 1500);
    expect(after.x).toBe(100);
  });

  it('el búfer de interpolación almacena snapshots y muestrea correctamente', () => {
    const buffer = new InterpolationBuffer(10);
    expect(buffer.sample(1000)).toBeNull();

    buffer.push({ t: 100, x: 10, y: 20 });
    expect(buffer.sample(50)).toEqual({ x: 10, y: 20 });

    buffer.push({ t: 200, x: 30, y: 60 });
    const sampled = buffer.sample(150);
    expect(sampled.x).toBeCloseTo(20, 4);
    expect(sampled.y).toBeCloseTo(40, 4);
  });
});
