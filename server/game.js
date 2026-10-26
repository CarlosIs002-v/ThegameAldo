import {
  SERVER_TICK_RATE,
  PLAYER,
  PROJECTILE,
  PICKUP,
  PLAYER_COLORS,
} from '../shared/constants.js';
import { generateMap, floorCells, tileCenter } from '../shared/mapgen.js';
import { stepMovement, circlesOverlap, isWallAt } from '../shared/physics.js';
import {
  computeDamage,
  applyDamage,
  applyHeal,
  levelFromShards,
  maxHpForLevel,
} from '../shared/combat.js';
import { playerInputSchema } from '../shared/schemas.js';
import { createRng } from '../shared/rng.js';

/**
 * Instancia de simulación autoritativa en el servidor (Server-Authoritative).
 * El servidor computa todo movimiento, colisiones, proyectiles, daño y pickups.
 */
export class GameMatch {
  constructor(room) {
    this.room = room;
    this.map = generateMap({ seed: room.mapSeed });
    this.rng = createRng(room.mapSeed);
    this.floorTiles = floorCells(this.map);

    this.players = new Map(); // id -> PlayerState
    this.projectiles = []; // { id, ownerId, x, y, vx, vy, radius, born, damage, crit }
    this.pickups = []; // { id, kind, x, y, radius }

    this.tick = 0;
    this.lastTickTime = Date.now();
    this.timer = null;
    this.nextProjId = 1;
    this.nextPickupId = 1;
    this.lastPickupSpawn = Date.now();

    // Spawns iniciales de pickups
    this.spawnInitialPickups();
  }

  spawnInitialPickups() {
    for (let i = 0; i < 5; i++) {
      this.spawnPickup(i % 2 === 0 ? 'shard' : 'medkit');
    }
  }

  spawnPickup(kind = 'shard') {
    if (this.pickups.length >= PICKUP.maxActive || this.floorTiles.length === 0) return;
    const cell = this.floorTiles[Math.floor(this.rng() * this.floorTiles.length)];
    const pos = tileCenter(this.map, cell.x, cell.y);
    this.pickups.push({
      id: this.nextPickupId++,
      kind,
      x: pos.x,
      y: pos.y,
      radius: PICKUP.radius,
    });
  }

  addPlayer(id, username) {
    const spawnIndex = this.players.size % Math.max(1, this.map.spawns.length);
    const spawn = this.map.spawns[spawnIndex] || { x: 100, y: 100 };
    const colorIndex = this.players.size % PLAYER_COLORS.length;

    const player = {
      id,
      username,
      color: PLAYER_COLORS[colorIndex],
      x: spawn.x,
      y: spawn.y,
      hp: PLAYER.baseHp,
      maxHp: PLAYER.baseHp,
      level: 1,
      shards: 0,
      kills: 0,
      deaths: 0,
      radius: PLAYER.radius,
      speed: PLAYER.speed,
      lastShotTime: 0,
      deadUntil: 0,
      lastInputSeq: 0,
      latestInput: { x: 0, y: 0, aimAngle: 0, shooting: false },
      ping: 20,
    };

    this.players.set(id, player);
    return player;
  }

  removePlayer(id) {
    this.players.delete(id);
  }

  handlePlayerInput(id, rawInput) {
    const player = this.players.get(id);
    if (!player) return;

    try {
      const validated = playerInputSchema.parse(rawInput);
      if (validated.seq >= player.lastInputSeq) {
        player.lastInputSeq = validated.seq;
        player.latestInput = validated;
      }
    } catch {
      // Input descartado por no cumplir el esquema Zod (anti-cheat)
    }
  }

  start() {
    if (this.timer) return;
    this.lastTickTime = Date.now();
    const intervalMs = Math.round(1000 / SERVER_TICK_RATE);
    this.timer = setInterval(() => this.update(), intervalMs);
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  update() {
    const now = Date.now();
    const dt = Math.min(0.1, (now - this.lastTickTime) / 1000);
    this.lastTickTime = now;
    this.tick++;

    // 1. Simulación de jugadores
    for (const player of this.players.values()) {
      if (player.deadUntil > 0) {
        if (now >= player.deadUntil) {
          // Reaparición
          const spawn = this.map.spawns[Math.floor(this.rng() * this.map.spawns.length)] || {
            x: 100,
            y: 100,
          };
          player.x = spawn.x;
          player.y = spawn.y;
          player.hp = player.maxHp;
          player.deadUntil = 0;
        } else {
          continue; // Jugador en tiempo de respawn
        }
      }

      // Movimiento con resolución de colisiones en el mapa
      const newPos = stepMovement(
        this.map,
        { x: player.x, y: player.y },
        { x: player.latestInput.x, y: player.latestInput.y },
        player.speed,
        dt,
        player.radius
      );
      player.x = newPos.x;
      player.y = newPos.y;

      // Disparo
      if (player.latestInput.shooting && now - player.lastShotTime >= PLAYER.fireCooldownMs) {
        player.lastShotTime = now;
        this.fireProjectile(player, player.latestInput.aimAngle);
      }

      // Recolección de pickups
      for (let i = this.pickups.length - 1; i >= 0; i--) {
        const item = this.pickups[i];
        if (circlesOverlap(player.x, player.y, player.radius, item.x, item.y, item.radius)) {
          if (item.kind === 'shard') {
            player.shards++;
            player.level = levelFromShards(player.shards);
            player.maxHp = maxHpForLevel(player.level);
          } else if (item.kind === 'medkit') {
            player.hp = applyHeal(player.hp, PICKUP.medkitHeal, player.maxHp);
          }
          this.pickups.splice(i, 1);
        }
      }
    }

    // 2. Aparición periódica de nuevos pickups
    if (now - this.lastPickupSpawn >= PICKUP.spawnEveryMs) {
      this.lastPickupSpawn = now;
      this.spawnPickup(this.rng() > 0.5 ? 'shard' : 'medkit');
    }

    // 3. Simulación de proyectiles
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i];
      p.x += p.vx * dt;
      p.y += p.vy * dt;

      // Colisión con muros o caducidad por tiempo
      if (
        now - p.born > PROJECTILE.lifetimeMs ||
        isWallAt(this.map, p.x, p.y)
      ) {
        this.projectiles.splice(i, 1);
        continue;
      }

      // Colisión de proyectil con jugadores
      let hit = false;
      for (const target of this.players.values()) {
        if (target.id === p.ownerId || target.deadUntil > 0) continue;

        if (circlesOverlap(p.x, p.y, p.radius, target.x, target.y, target.radius)) {
          const outcome = applyDamage(target.hp, p.damage);
          target.hp = outcome.hp;

          if (outcome.killed) {
            target.deaths++;
            target.deadUntil = now + PLAYER.respawnMs;
            const attacker = this.players.get(p.ownerId);
            if (attacker) attacker.kills++;
          }

          hit = true;
          break;
        }
      }

      if (hit) {
        this.projectiles.splice(i, 1);
      }
    }

    // 4. Emitir snapshot autoritativo a la sala
    this.broadcastSnapshot();
  }

  fireProjectile(player, angle) {
    const isCrit = this.rng() < PROJECTILE.critChance;
    const damage = computeDamage({
      base: PROJECTILE.baseDamage,
      attackerLevel: player.level,
      crit: isCrit,
    });

    const vx = Math.cos(angle) * PROJECTILE.speed;
    const vy = Math.sin(angle) * PROJECTILE.speed;

    this.projectiles.push({
      id: this.nextProjId++,
      ownerId: player.id,
      x: player.x + Math.cos(angle) * (player.radius + 4),
      y: player.y + Math.sin(angle) * (player.radius + 4),
      vx,
      vy,
      radius: PROJECTILE.radius,
      born: Date.now(),
      damage,
      crit: isCrit,
    });
  }

  getSnapshot() {
    return {
      type: 'snapshot',
      tick: this.tick,
      t: Date.now(),
      players: Array.from(this.players.values()).map((p) => ({
        id: p.id,
        username: p.username,
        color: p.color,
        x: Number(p.x.toFixed(2)),
        y: Number(p.y.toFixed(2)),
        hp: p.hp,
        maxHp: p.maxHp,
        level: p.level,
        shards: p.shards,
        kills: p.kills,
        deaths: p.deaths,
        dead: p.deadUntil > 0,
        ping: p.ping,
        ackSeq: p.lastInputSeq,
      })),
      projectiles: this.projectiles.map((p) => ({
        id: p.id,
        ownerId: p.ownerId,
        x: Number(p.x.toFixed(2)),
        y: Number(p.y.toFixed(2)),
        vx: Number(p.vx.toFixed(2)),
        vy: Number(p.vy.toFixed(2)),
        crit: p.crit,
      })),
      pickups: this.pickups.map((item) => ({
        id: item.id,
        kind: item.kind,
        x: item.x,
        y: item.y,
      })),
    };
  }

  broadcastSnapshot() {
    const snapshot = this.getSnapshot();
    this.room.broadcast(snapshot);
  }
}
