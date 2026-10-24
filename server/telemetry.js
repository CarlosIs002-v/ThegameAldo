import { seedPayloadSchema } from '../shared/schemas.js';

/**
 * Servicio de Telemetría para métricas agregadas de partidas.
 * Requerimiento: GET /api/test/telemetry (<200ms) y POST /api/test/seed (100 a 1,000 partidas).
 */
class TelemetryService {
  constructor() {
    this.matches = [];
    this.cachedAggregates = null;
    this.seedDefaultData(150);
  }

  /**
   * Genera un conjunto inicial de partidas controladas para que el endpoint
   * responda con datos válidos inmediatamente tras iniciar el servidor.
   */
  seedDefaultData(count = 150) {
    const sampleMatches = [];
    const samplePlayers = ['NeoCyber', 'GlitchRunner', 'GhostProtocol', 'Valkyrie99', 'BinaryPulse'];

    for (let i = 1; i <= count; i++) {
      const winner = samplePlayers[i % samplePlayers.length];
      const matchDuration = 45 + ((i * 17) % 75);

      const playerStats = samplePlayers.map((name) => {
        const won = name === winner;
        const kills = won ? 3 + (i % 6) : i % 4;
        const deaths = won ? (i % 2 === 0 ? 0 : 1) : 1 + (i % 3);
        const survivalTime = won ? matchDuration : Math.max(10, matchDuration - (i % 25));
        const damageDealt = kills * 120 + ((i * 31) % 150);
        return {
          playerId: name,
          kills,
          deaths,
          damageDealt,
          survivalTimeSeconds: survivalTime,
          won,
        };
      });

      sampleMatches.push({
        matchId: `match-${i.toString().padStart(4, '0')}`,
        durationSeconds: matchDuration,
        winner,
        playerStats,
        timestamp: Date.now() - (count - i) * 60_000,
      });
    }

    this.matches = sampleMatches;
    this.invalidateCache();
  }

  invalidateCache() {
    this.cachedAggregates = null;
  }

  /**
   * Inyecta partidas de prueba controladas (100 a 1,000 partidas)
   * Valida con esquema Zod según especificación oficial.
   */
  seed(payload) {
    const validated = seedPayloadSchema.parse(payload);
    this.matches = [...validated.matches];
    this.invalidateCache();
    return {
      success: true,
      insertedCount: this.matches.length,
      sampleMatchId: this.matches[0]?.matchId,
    };
  }

  /**
   * Retorna métricas agregadas: Win Rate, KDR, Supervivencia promedio.
   * Optimizado en memoria para responder en < 5ms (muy inferior a 200ms).
   */
  getAggregatedMetrics() {
    if (this.cachedAggregates) {
      return this.cachedAggregates;
    }

    if (this.matches.length === 0) {
      const empty = {
        totalMatches: 0,
        winRate: 0,
        kdr: 0,
        averageSurvivalSeconds: 0,
        totalKills: 0,
        totalDeaths: 0,
        calculatedAt: new Date().toISOString(),
      };
      this.cachedAggregates = empty;
      return empty;
    }

    let totalKills = 0;
    let totalDeaths = 0;
    let totalSurvivalTime = 0;
    let totalPlayerParticipations = 0;
    let totalWins = 0;

    for (const match of this.matches) {
      for (const p of match.playerStats) {
        totalPlayerParticipations++;
        totalKills += p.kills;
        totalDeaths += p.deaths;
        totalSurvivalTime += p.survivalTimeSeconds;
        if (p.won) totalWins++;
      }
    }

    const winRate =
      totalPlayerParticipations > 0
        ? Number((totalWins / totalPlayerParticipations).toFixed(4))
        : 0;

    const kdr =
      totalDeaths > 0
        ? Number((totalKills / totalDeaths).toFixed(3))
        : Number(totalKills.toFixed(3));

    const averageSurvivalSeconds =
      totalPlayerParticipations > 0
        ? Number((totalSurvivalTime / totalPlayerParticipations).toFixed(2))
        : 0;

    const aggregates = {
      totalMatches: this.matches.length,
      winRate,
      kdr,
      averageSurvivalSeconds,
      totalKills,
      totalDeaths,
      totalPlayerParticipations,
      calculatedAt: new Date().toISOString(),
    };

    this.cachedAggregates = aggregates;
    return aggregates;
  }
}

export const telemetryService = new TelemetryService();
