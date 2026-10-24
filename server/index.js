import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { WebSocketServer } from 'ws';

import { telemetryService } from './telemetry.js';
import { authService } from './auth.js';
import { roomManager } from './rooms.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const publicDir = path.resolve(__dirname, '../public');

export function createApp() {
  const app = express();
  app.use(express.json({ limit: '10mb' }));
  app.use(express.static(publicDir));
  app.use('/shared', express.static(path.resolve(__dirname, '../shared')));
  app.use('/img', express.static(path.resolve(__dirname, '../public/img')));
  app.use('/img', express.static(path.resolve(__dirname, '../img')));

  // --- Endpoints de Prueba Oficiales ---

  /**
   * GET /api/test/telemetry
   * Retorna métricas agregadas de partidas (Win Rate, KDR, supervivencia).
   * Requisito: Respuesta HTTP 200 en < 200ms.
   */
  app.get('/api/test/telemetry', (req, res) => {
    const start = performance.now();
    const metrics = telemetryService.getAggregatedMetrics();
    const elapsedMs = Number((performance.now() - start).toFixed(2));

    res.status(200).json({
      status: 'ok',
      latencyMs: elapsedMs,
      data: metrics,
    });
  });

  /**
   * POST /api/test/seed
   * Inyecta datos de prueba controlados (100 a 1,000 partidas) auditados con Zod.
   * Requisito: Respuesta HTTP 200 en < 200ms.
   */
  app.post('/api/test/seed', (req, res) => {
    const start = performance.now();
    try {
      const result = telemetryService.seed(req.body);
      const elapsedMs = Number((performance.now() - start).toFixed(2));

      res.status(200).json({
        status: 'ok',
        latencyMs: elapsedMs,
        result,
      });
    } catch (err) {
      res.status(400).json({
        status: 'error',
        message: err.message || 'Error de validación en datos de semilla',
        errors: err.errors,
      });
    }
  });

  // --- Endpoints de Autenticación y Salas ---

  app.post('/api/auth/login', (req, res) => {
    try {
      const { username, password } = req.body;
      const session = authService.login(username, password);
      res.status(200).json({ status: 'ok', session });
    } catch (err) {
      res.status(400).json({ status: 'error', message: err.message });
    }
  });

  app.get('/api/rooms', (req, res) => {
    const rooms = roomManager.listPublicRooms();
    res.status(200).json({ status: 'ok', rooms });
  });

  app.post('/api/rooms', (req, res) => {
    try {
      const authHeader = req.headers.authorization;
      const token = authHeader?.replace('Bearer ', '');
      const user = authService.validateSession(token);
      const creatorName = user?.username || 'Host';

      const room = roomManager.createRoom(req.body, creatorName);
      res.status(201).json({
        status: 'ok',
        room: {
          id: room.id,
          name: room.name,
          isPrivate: room.isPrivate,
          maxPlayers: room.maxPlayers,
        },
      });
    } catch (err) {
      res.status(400).json({ status: 'error', message: err.message });
    }
  });

  return app;
}

export function startServer(port = process.env.PORT || 3000) {
  const app = createApp();
  const server = http.createServer(app);
  const wss = new WebSocketServer({ server, path: '/ws' });

  wss.on('connection', (ws) => {
    let assignedPlayerId = null;

    ws.on('message', (message) => {
      try {
        const payload = JSON.parse(message.toString());

        switch (payload.type) {
          case 'ping': {
            // Medición de latencia de socket < 100ms
            ws.send(
              JSON.stringify({
                type: 'pong',
                t: payload.t,
                serverTime: Date.now(),
              })
            );

            // Actualizar ping del jugador en la sala
            const roomId = roomManager.clientToRoom.get(ws);
            if (roomId) {
              const room = roomManager.getRoom(roomId);
              const client = room?.clients.get(ws);
              if (client && payload.t) {
                const rtt = Math.max(1, Date.now() - payload.t);
                client.ping = rtt;
                const p = room.match.players.get(client.id);
                if (p) p.ping = rtt;
              }
            }
            break;
          }

          case 'join_room': {
            const { roomId, username, password } = payload;
            try {
              const info = roomManager.joinRoom(roomId, ws, username, password);
              assignedPlayerId = info.playerId;
              ws.send(
                JSON.stringify({
                  type: 'joined',
                  roomId: info.roomId,
                  playerId: info.playerId,
                  username: info.username,
                  map: info.map,
                })
              );
            } catch (err) {
              ws.send(
                JSON.stringify({
                  type: 'error',
                  code: 'JOIN_ERROR',
                  message: err.message,
                })
              );
            }
            break;
          }

          case 'set_ready': {
            const result = roomManager.setPlayerReady(ws, payload.ready);
            if (result) {
              ws.send(
                JSON.stringify({
                  type: 'ready_ack',
                  ...result,
                })
              );
            }
            break;
          }

          case 'input': {
            const roomId = roomManager.clientToRoom.get(ws);
            if (roomId && assignedPlayerId) {
              const room = roomManager.getRoom(roomId);
              if (room?.match) {
                room.match.handlePlayerInput(assignedPlayerId, payload.data);
              }
            }
            break;
          }

          default:
            break;
        }
      } catch {
        // Ignora paquetes malformados
      }
    });

    ws.on('close', () => {
      roomManager.leaveRoom(ws);
    });
  });

  return new Promise((resolve) => {
    server.listen(port, () => {
      const actualPort = server.address().port;
      console.log(`[CyberGrid Server] Escuchando en http://localhost:${actualPort}`);
      resolve({ server, wss, port: actualPort });
    });
  });
}

// Ejecución directa si se invoca vía node
if (process.argv[1] && process.argv[1].endsWith('index.js')) {
  startServer();
}
