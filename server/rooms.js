import { createRoomSchema } from '../shared/schemas.js';
import { CHARACTERS } from '../shared/constants.js';
import { GameMatch } from './game.js';

/**
 * Gestor de Salas (Lobbies) y ciclo de vida de partidas multijugador.
 * Soporta protección por contraseña, estado 'Listo' y sincronización de sockets.
 */
class RoomManager {
  constructor() {
    this.rooms = new Map(); // roomId -> Room
    this.clientToRoom = new Map(); // socket -> roomId
    this.nextRoomId = 1;

    // Crear sala pública por defecto para pruebas y acceso rápido
    this.createRoom({
      name: 'CyberGrid Sector Alfa',
      isPrivate: false,
      maxPlayers: 4,
      mapSeed: 42,
      biome: 'cavern',
    });
  }

  createRoom(payload, creatorUsername = 'Host') {
    const validated = createRoomSchema.parse(payload);
    const roomId = `room-${this.nextRoomId++}`;

    const room = {
      id: roomId,
      name: validated.name,
      isPrivate: validated.isPrivate,
      password: validated.password || null,
      maxPlayers: validated.maxPlayers,
      mapSeed: validated.mapSeed,
      biome: validated.biome || 'cavern',
      creator: creatorUsername,
      createdAt: Date.now(),
      status: 'waiting', // 'waiting' | 'in-game'
      clients: new Map(), // socket -> { id, username, characterId, classId, ready, ping }
      match: null,

      broadcast(data) {
        const message = JSON.stringify(data);
        for (const [ws] of room.clients.entries()) {
          if (ws.readyState === 1 /* OPEN */) {
            ws.send(message);
          }
        }
      },
    };

    room.match = new GameMatch(room);
    this.rooms.set(roomId, room);
    return room;
  }

  getRoom(roomId) {
    return this.rooms.get(roomId);
  }

  listPublicRooms() {
    return Array.from(this.rooms.values()).map((r) => ({
      id: r.id,
      name: r.name,
      isPrivate: r.isPrivate,
      maxPlayers: r.maxPlayers,
      playerCount: r.clients.size,
      status: r.status,
      creator: r.creator,
      biome: r.biome || 'cavern',
    }));
  }

  joinRoom(roomId, socket, username, password = null, characterId = 'vanguard') {
    const room = this.rooms.get(roomId);
    if (!room) {
      throw new Error('La sala no existe');
    }

    if (room.isPrivate && room.password && room.password !== password) {
      throw new Error('Contraseña de sala incorrecta');
    }

    if (room.clients.size >= room.maxPlayers) {
      throw new Error('La sala está llena');
    }

    // Un socket solo puede estar en una sala a la vez.
    if (this.clientToRoom.has(socket)) {
      this.leaveRoom(socket);
    }

    const playerId = `p-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    const charCfg = CHARACTERS[characterId] || CHARACTERS.vanguard;
    const clientData = {
      id: playerId,
      username: username || `Operador_${playerId.slice(-4)}`,
      characterId: charCfg.id,
      classId: charCfg.classId,
      ready: false,
      ping: 20,
    };

    room.clients.set(socket, clientData);
    this.clientToRoom.set(socket, roomId);

    // Añadir jugador al motor de la partida
    room.match.addPlayer(playerId, clientData.username, clientData.classId, clientData.characterId);

    // Si es el primer jugador o se une a una sala existente, arranca el loop si no estaba activo
    room.match.start();

    // Notificar a todos en la sala
    this.broadcastLobbyState(room);

    return {
      roomId,
      playerId,
      username: clientData.username,
      characterId: clientData.characterId,
      classId: clientData.classId,
      biome: room.biome || 'cavern',
      map: room.match.map,
    };
  }

  leaveRoom(socket) {
    const roomId = this.clientToRoom.get(socket);
    if (!roomId) return;

    this.clientToRoom.delete(socket);
    const room = this.rooms.get(roomId);
    if (!room) return;

    const client = room.clients.get(socket);
    if (client) {
      room.match.removePlayer(client.id);
      room.clients.delete(socket);
    }

    if (room.clients.size === 0) {
      room.match.stop();
      room.status = 'waiting';
      // Reiniciar la simulación para que la siguiente partida arranque limpia.
      room.match = new GameMatch(room);
    } else {
      this.broadcastLobbyState(room);
    }
  }

  setPlayerCharacter(socket, characterId) {
    const roomId = this.clientToRoom.get(socket);
    if (!roomId) return null;

    const room = this.rooms.get(roomId);
    if (!room) return null;

    const client = room.clients.get(socket);
    if (!client) return null;

    const charCfg = CHARACTERS[characterId] || CHARACTERS.vanguard;
    client.characterId = charCfg.id;
    client.classId = charCfg.classId;
    room.match.setPlayerCharacter(client.id, charCfg.id);
    this.broadcastLobbyState(room);
    return { playerId: client.id, characterId: charCfg.id, classId: charCfg.classId };
  }

  setPlayerClass(socket, classId) {
    const roomId = this.clientToRoom.get(socket);
    if (!roomId) return null;

    const room = this.rooms.get(roomId);
    if (!room) return null;

    const client = room.clients.get(socket);
    if (!client) return null;

    const validClass = ['assault', 'scout', 'tank', 'tactical'].includes(classId) ? classId : 'assault';
    client.classId = validClass;
    room.match.setPlayerClass(client.id, validClass);
    this.broadcastLobbyState(room);
    return { playerId: client.id, classId: validClass };
  }

  setPlayerReady(socket, readyState) {
    const roomId = this.clientToRoom.get(socket);
    if (!roomId) return null;

    const room = this.rooms.get(roomId);
    if (!room) return null;

    const client = room.clients.get(socket);
    if (!client) return null;

    client.ready = Boolean(readyState);

    // Verificar si todos los jugadores están listos
    const allReady =
      room.clients.size > 0 &&
      Array.from(room.clients.values()).every((c) => c.ready);

    if (allReady) {
      room.status = 'in-game';
    }

    this.broadcastLobbyState(room);
    return { playerId: client.id, ready: client.ready, allReady };
  }

  broadcastLobbyState(room) {
    const players = Array.from(room.clients.values()).map((c) => ({
      id: c.id,
      username: c.username,
      characterId: c.characterId || 'vanguard',
      classId: c.classId || 'assault',
      ready: c.ready,
      ping: c.ping,
      color: room.match.players.get(c.id)?.color || '#00f0ff',
    }));

    room.broadcast({
      type: 'lobby_update',
      roomId: room.id,
      roomName: room.name,
      status: room.status,
      biome: room.biome || 'cavern',
      players,
    });
  }
}

export const roomManager = new RoomManager();
