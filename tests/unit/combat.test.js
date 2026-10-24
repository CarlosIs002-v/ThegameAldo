import { describe, it, expect } from 'vitest';
import {
  levelFromShards,
  maxHpForLevel,
  damageMultiplier,
  armorReduction,
  computeDamage,
  applyDamage,
  applyHeal,
} from '../../shared/combat.js';

describe('Fórmulas Matemáticas de Combate y Escalado (shared/combat.js)', () => {
  it('calcula el nivel correcto según fragmentos recogidos y vida máxima', () => {
    expect(levelFromShards(0)).toBe(1);
    expect(levelFromShards(2)).toBe(1);
    expect(levelFromShards(3)).toBe(2);
    expect(levelFromShards(6)).toBe(3);
    expect(levelFromShards(100)).toBe(10); // Límite máximo (PLAYER.maxLevel)

    expect(maxHpForLevel(1)).toBe(100);
    expect(maxHpForLevel(2)).toBe(110);
    expect(maxHpForLevel(5)).toBe(140);
  });

  it('calcula la reducción por armadura con rendimientos decrecientes', () => {
    expect(armorReduction(0)).toBe(0);
    expect(armorReduction(100)).toBeCloseTo(0.5, 4); // 100 / (100 + 100) = 50%
    expect(armorReduction(300)).toBeCloseTo(0.75, 4); // 300 / 400 = 75%
  });

  it('aplica escalado de daño por nivel del atacante', () => {
    const lvl1 = damageMultiplier(1);
    const lvl2 = damageMultiplier(2);
    const lvl3 = damageMultiplier(3);

    expect(lvl1).toBe(1.0);
    expect(lvl2).toBe(1.15);
    expect(lvl3).toBe(1.3);
  });

  it('calcula el daño final con crítico y mitigación de armadura', () => {
    const baseDamage = 20;

    // Sin armadura ni crítico
    const normal = computeDamage({
      base: baseDamage,
      attackerLevel: 1,
      defenderArmor: 0,
      crit: false,
    });
    expect(normal).toBe(20);

    // Con impacto crítico (1.5x)
    const crit = computeDamage({
      base: baseDamage,
      attackerLevel: 1,
      defenderArmor: 0,
      crit: true,
    });
    expect(crit).toBe(30);

    // Con armadura del 50% (armor = 100)
    const mitigated = computeDamage({
      base: baseDamage,
      attackerLevel: 1,
      defenderArmor: 100,
      crit: false,
    });
    expect(mitigated).toBe(10);
  });

  it('gestiona la reducción y curación de vida dentro de límites saludables', () => {
    // Daño no letal
    const hit1 = applyDamage(100, 30);
    expect(hit1.hp).toBe(70);
    expect(hit1.killed).toBe(false);

    // Daño letal
    const hit2 = applyDamage(25, 50);
    expect(hit2.hp).toBe(0);
    expect(hit2.killed).toBe(true);

    // Curación limitada al tope de vida máxima
    expect(applyHeal(50, 30, 100)).toBe(80);
    expect(applyHeal(95, 20, 100)).toBe(100);
  });
});
