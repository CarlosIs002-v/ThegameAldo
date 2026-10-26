import { PLAYER, PROJECTILE } from './constants.js';

/**
 * Fórmulas matemáticas de daño y escalado.
 * Se ejecutan exclusivamente en el servidor (autoridad); el cliente solo
 * las importa para mostrar información estimada en el HUD.
 */

/** Nivel del jugador según fragmentos de datos recogidos (1..maxLevel). */
export function levelFromShards(shards) {
  const safe = Math.max(0, Math.floor(shards || 0));
  return Math.min(PLAYER.maxLevel, 1 + Math.floor(safe / PLAYER.shardsPerLevel));
}

/** Vida máxima escalada linealmente con el nivel según la clase (baseHp). */
export function maxHpForLevel(level, baseHp = PLAYER.baseHp) {
  const lvl = clampLevel(level);
  return (baseHp || PLAYER.baseHp) + PLAYER.hpPerLevel * (lvl - 1);
}

/** Multiplicador ofensivo: +15 % por nivel por encima de 1. */
export function damageMultiplier(level) {
  return 1 + 0.15 * (clampLevel(level) - 1);
}

/** Reducción por armadura con rendimientos decrecientes: armor / (armor + 100). */
export function armorReduction(armor) {
  const a = Math.max(0, armor || 0);
  return a / (a + 100);
}

/**
 * Daño final de un impacto.
 * damage = round(base · mult(nivel) · (1 − reducción(armadura)) · crit), mínimo 1.
 *
 * @param {{ base?: number, attackerLevel?: number, defenderArmor?: number, crit?: boolean }} p
 */
export function computeDamage({
  base = PROJECTILE.baseDamage,
  attackerLevel = 1,
  defenderArmor = 0,
  crit = false,
} = {}) {
  const raw =
    base *
    damageMultiplier(attackerLevel) *
    (1 - armorReduction(defenderArmor)) *
    (crit ? PROJECTILE.critMultiplier : 1);
  return Math.max(1, Math.round(raw));
}

/** Aplica daño sin bajar de 0 y devuelve el nuevo estado. */
export function applyDamage(hp, damage) {
  const next = Math.max(0, hp - Math.max(0, damage));
  return { hp: next, killed: next === 0 };
}

/** Curación limitada a la vida máxima. */
export function applyHeal(hp, amount, maxHp) {
  return Math.min(maxHp, hp + Math.max(0, amount));
}

function clampLevel(level) {
  const n = Number.isFinite(level) ? Math.floor(level) : 1;
  return Math.min(PLAYER.maxLevel, Math.max(1, n));
}
