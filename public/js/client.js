import { InterpolationBuffer } from '../shared/interpolation.js';
import { INTERPOLATION_DELAY_MS, TILE_SIZE, TILE } from '../shared/constants.js';

/**
 * Cliente de CyberGrid: Breach & Sync.
 * Canvas 2D desacoplado con delta time, interpolación a 60 FPS,
 * WebSockets Server-Authoritative y controles adaptativos PC / Móvil.
 */

// --- Estado Global del Cliente ---
const state = {
  socket: null,
  token: localStorage.getItem('cyber_token') || null,
  username: localStorage.getItem('cyber_user') || 'Operador_' + Math.floor(Math.random() * 8999 + 1000),
  currentRoomId: null,
  myPlayerId: null,
  map: null,
  isReady: false,
  rtt: 0,
  fps: 60,
  lastFrameTime: performance.now(),
  inputSeq: 1,

  // Interpolación de jugadores por ID -> InterpolationBuffer
  buffers: new Map(),
  currentSnapshot: null,
  lastSnapshotRecvTime: 0,

  // Entradas del jugador local
  keys: { w: false, a: false, s: false, d: false, ArrowUp: false, ArrowLeft: false, ArrowDown: false, ArrowRight: false },
  mouse: { x: 0, y: 0, shooting: false },
  touchVector: { x: 0, y: 0 },
  touchShooting: false,
};

// --- Elementos DOM ---
const elements = {
  // Stats
  pingDisplay: document.getElementById('ping-display'),
  fpsDisplay: document.getElementById('fps-display'),
  userTag: document.getElementById('user-tag'),
  btnShowAuth: document.getElementById('btn-show-auth'),

  // Vistas
  viewLobby: document.getElementById('view-lobby'),
  viewWaiting: document.getElementById('view-room-waiting'),
  viewGame: document.getElementById('view-game'),

  // Lobby
  btnCreateRoomModal: document.getElementById('btn-create-room-modal'),
  btnQuickJoin: document.getElementById('btn-quick-join'),
  btnRefreshRooms: document.getElementById('btn-refresh-rooms'),
  roomsContainer: document.getElementById('rooms-container'),

  // Waiting Room
  currentRoomName: document.getElementById('current-room-name'),
  currentRoomId: document.getElementById('current-room-id'),
  playersRoster: document.getElementById('players-roster'),
  btnLeaveRoom: document.getElementById('btn-leave-room'),
  btnToggleReady: document.getElementById('btn-toggle-ready'),

  // Game & Canvas
  canvasWrapper: document.getElementById('canvas-wrapper'),
  canvas: document.getElementById('game-canvas'),
  hudHpBar: document.getElementById('hud-hp-bar'),
  hudHpText: document.getElementById('hud-hp-text'),
  hudLevel: document.getElementById('hud-level'),
  hudShards: document.getElementById('hud-shards'),
  hudKills: document.getElementById('hud-kills'),
  playerCoordinates: document.getElementById('player-coordinates'),
  telemetryX: document.getElementById('telemetry-x'),
  telemetryY: document.getElementById('telemetry-y'),
  btnExitMatch: document.getElementById('btn-exit-match'),

  // Controles Táctiles
  touchControls: document.getElementById('touch-controls'),
  touchJoystickZone: document.getElementById('touch-joystick'),
  joystickKnob: document.getElementById('joystick-knob'),
  btnTouchFire: document.getElementById('btn-touch-fire'),

  // Modales
  modalAuth: document.getElementById('modal-auth'),
  formAuth: document.getElementById('form-auth'),
  btnCloseAuth: document.getElementById('btn-close-auth'),
  authErrorMsg: document.getElementById('auth-error-msg'),

  modalCreateRoom: document.getElementById('modal-create-room'),
  formCreateRoom: document.getElementById('form-create-room'),
  btnCloseCreateRoom: document.getElementById('btn-close-create-room'),
  checkIsPrivate: document.getElementById('check-is-private'),
  groupRoomPassword: document.getElementById('group-room-password'),
  createRoomError: document.getElementById('create-room-error'),

  modalJoinPassword: document.getElementById('modal-join-password'),
  formJoinPassword: document.getElementById('form-join-password'),
  btnCloseJoinPassword: document.getElementById('btn-close-join-password'),
  joinTargetRoomId: document.getElementById('join-target-room-id'),
  inputJoinPassword: document.getElementById('input-join-password'),
  joinPasswordError: document.getElementById('join-password-error'),
};

const ctx = elements.canvas.getContext('2d');

// --- Inicialización ---
export function init() {
  updateUserDisplay();
  setupNetwork();
  setupInputListeners();
  setupTouchControls();
  setupUIEvents();
  setupCanvasResize();
  fetchRooms();

  // Iniciar bucle de renderizado desacoplado a 60 FPS
  requestAnimationFrame(gameLoop);

  // Ping periódico para medir latencia (<100ms)
  setInterval(sendPing, 1500);
}

function updateUserDisplay() {
  elements.userTag.textContent = state.username;
}

// --- Gestión de Red & WebSockets ---
function setupNetwork() {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${protocol}//${window.location.host}/ws`;

  state.socket = new WebSocket(wsUrl);

  state.socket.addEventListener('open', () => {
    sendPing();
  });

  state.socket.addEventListener('message', (event) => {
    try {
      const data = JSON.parse(event.data);
      handleServerMessage(data);
    } catch {
      // Ignorar paquetes corruptos
    }
  });

  state.socket.addEventListener('close', () => {
    elements.pingDisplay.textContent = 'DISCONNECTED';
    elements.pingDisplay.className = 'stat-val';
    setTimeout(setupNetwork, 2000);
  });
}

function sendPing() {
  if (state.socket && state.socket.readyState === WebSocket.OPEN) {
    state.socket.send(JSON.stringify({ type: 'ping', t: Date.now() }));
  }
}

function handleServerMessage(msg) {
  switch (msg.type) {
    case 'pong': {
      state.rtt = Math.max(1, Date.now() - msg.t);
      elements.pingDisplay.textContent = `${state.rtt} ms`;
      elements.pingDisplay.className =
        state.rtt < 100 ? 'stat-val ping-green' : 'stat-val';
      break;
    }

    case 'joined': {
      state.currentRoomId = msg.roomId;
      state.myPlayerId = msg.playerId;
      state.map = msg.map;
      showView('view-room-waiting');
      elements.currentRoomId.textContent = `ID: ${msg.roomId}`;
      break;
    }

    case 'lobby_update': {
      renderLobbyRoster(msg);
      if (msg.status === 'in-game') {
        showView('view-game');
      }
      break;
    }

    case 'ready_ack': {
      state.isReady = msg.ready;
      elements.btnToggleReady.setAttribute('data-ready', String(msg.ready));
      elements.btnToggleReady.textContent = msg.ready ? 'Cancelar "Listo"' : 'Marcar "Listo"';
      break;
    }

    case 'snapshot': {
      state.lastSnapshotRecvTime = performance.now();
      state.currentSnapshot = msg;

      // Almacenar en búferes de interpolación
      for (const p of msg.players) {
        let buf = state.buffers.get(p.id);
        if (!buf) {
          buf = new InterpolationBuffer(30);
          state.buffers.set(p.id, buf);
        }
        buf.push({ t: msg.t, x: p.x, y: p.y });

        // Si es el jugador local, actualizar HUD y telemetría DOM
        if (p.id === state.myPlayerId) {
          updateLocalHUD(p);
        }
      }
      break;
    }

    case 'error': {
      alert(`[Error]: ${msg.message}`);
      break;
    }
  }
}

function updateLocalHUD(p) {
  const hpPct = Math.max(0, Math.min(100, (p.hp / p.maxHp) * 100));
  elements.hudHpBar.style.width = `${hpPct}%`;
  elements.hudHpText.textContent = `${p.hp} / ${p.maxHp}`;
  elements.hudLevel.textContent = p.level;
  elements.hudShards.textContent = p.shards;
  elements.hudKills.textContent = p.kills;

  // Crucial: Actualizar coordenadas en el DOM para el Test E2E de Canvas
  elements.playerCoordinates.setAttribute('data-player-x', String(p.x));
  elements.playerCoordinates.setAttribute('data-player-y', String(p.y));
  elements.telemetryX.textContent = Math.round(p.x);
  elements.telemetryY.textContent = Math.round(p.y);
}

// --- Cambio de Vistas ---
function showView(viewId) {
  document.querySelectorAll('.view-panel').forEach((p) => p.classList.remove('active'));
  const target = document.getElementById(viewId);
  if (target) target.classList.add('active');

  // Si entramos al canvas, disparar un resize
  if (viewId === 'view-game') {
    resizeCanvas();
  }
}

// --- Controles de Entrada (PC y Móvil) ---
function setupInputListeners() {
  window.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT') return;
    if (state.keys.hasOwnProperty(e.key) || state.keys.hasOwnProperty(e.code)) {
      state.keys[e.key] = true;
    }
  });

  window.addEventListener('keyup', (e) => {
    if (state.keys.hasOwnProperty(e.key)) {
      state.keys[e.key] = false;
    }
  });

  elements.canvas.addEventListener('mousemove', (e) => {
    const rect = elements.canvas.getBoundingClientRect();
    state.mouse.x = e.clientX - rect.left;
    state.mouse.y = e.clientY - rect.top;
  });

  elements.canvas.addEventListener('mousedown', (e) => {
    if (e.button === 0) state.mouse.shooting = true;
  });

  window.addEventListener('mouseup', (e) => {
    if (e.button === 0) state.mouse.shooting = false;
  });

  // Envío periódico de inputs al servidor a 30Hz
  setInterval(sendInputToServer, 33);
}

function setupTouchControls() {
  const isTouchDevice = 'ontouchstart' in window || navigator.maxTouchPoints > 0;

  if (isTouchDevice) {
    // Regla de Oro: En dispositivos táctiles instanciar D-Pad y botón de acción
    elements.touchControls.style.display = 'block';

    let joystickActive = false;
    let originX = 0;
    let originY = 0;
    const maxRadius = 45;

    elements.touchJoystickZone.addEventListener('touchstart', (e) => {
      joystickActive = true;
      const touch = e.touches[0];
      const rect = elements.touchJoystickZone.getBoundingClientRect();
      originX = rect.left + rect.width / 2;
      originY = rect.top + rect.height / 2;
      updateJoystick(touch.clientX, touch.clientY);
    });

    window.addEventListener('touchmove', (e) => {
      if (!joystickActive) return;
      for (let i = 0; i < e.touches.length; i++) {
        const touch = e.touches[i];
        if (
          Math.hypot(touch.clientX - originX, touch.clientY - originY) <
          maxRadius * 2
        ) {
          updateJoystick(touch.clientX, touch.clientY);
          break;
        }
      }
    });

    const resetJoystick = () => {
      joystickActive = false;
      state.touchVector = { x: 0, y: 0 };
      elements.joystickKnob.style.transform = 'translate(0px, 0px)';
    };

    window.addEventListener('touchend', resetJoystick);
    window.addEventListener('touchcancel', resetJoystick);

    function updateJoystick(cx, cy) {
      let dx = cx - originX;
      let dy = cy - originY;
      const dist = Math.hypot(dx, dy);

      if (dist > maxRadius) {
        dx = (dx / dist) * maxRadius;
        dy = (dy / dist) * maxRadius;
      }

      elements.joystickKnob.style.transform = `translate(${dx}px, ${dy}px)`;
      state.touchVector = {
        x: dx / maxRadius,
        y: dy / maxRadius,
      };
    }

    // Botón de acción táctil
    elements.btnTouchFire.addEventListener('touchstart', (e) => {
      e.preventDefault();
      state.touchShooting = true;
    });

    elements.btnTouchFire.addEventListener('touchend', (e) => {
      e.preventDefault();
      state.touchShooting = false;
    });
  } else {
    // En PC se ocultan automáticamente para dar prioridad a keydown/keyup
    elements.touchControls.style.display = 'none';
  }
}

function sendInputToServer() {
  if (!state.socket || state.socket.readyState !== WebSocket.OPEN) return;
  if (!state.currentRoomId || !state.myPlayerId) return;

  // Combinar teclado y joystick táctil
  let mx = 0;
  let my = 0;

  if (state.keys.w || state.keys.ArrowUp) my -= 1;
  if (state.keys.s || state.keys.ArrowDown) my += 1;
  if (state.keys.a || state.keys.ArrowLeft) mx -= 1;
  if (state.keys.d || state.keys.ArrowRight) mx += 1;

  if (state.touchVector.x !== 0 || state.touchVector.y !== 0) {
    mx = state.touchVector.x;
    my = state.touchVector.y;
  }

  // Ángulo de puntería respecto al centro de pantalla
  const cx = elements.canvas.width / 2;
  const cy = elements.canvas.height / 2;
  const aimAngle = Math.atan2(state.mouse.y - cy, state.mouse.x - cx);

  const shooting = state.mouse.shooting || state.touchShooting;

  const payload = {
    seq: state.inputSeq++,
    x: mx,
    y: my,
    aimAngle,
    shooting,
    timestamp: Date.now(),
  };

  state.socket.send(JSON.stringify({ type: 'input', data: payload }));
}

// --- Bucle de Juego Canvas 2D (Bloqueado a 60 FPS con delta time) ---
let frameCount = 0;
let lastFpsCheck = performance.now();

function gameLoop(now) {
  const dt = Math.min(0.1, (now - state.lastFrameTime) / 1000);
  state.lastFrameTime = now;

  // Medición de FPS
  frameCount++;
  if (now - lastFpsCheck >= 1000) {
    state.fps = frameCount;
    elements.fpsDisplay.textContent = state.fps;
    frameCount = 0;
    lastFpsCheck = now;
  }

  // Renderizado sólo si la vista de juego está activa
  if (elements.viewGame.classList.contains('active')) {
    renderGame(now, dt);
  }

  requestAnimationFrame(gameLoop);
}

function renderGame(now, dt) {
  ctx.clearRect(0, 0, elements.canvas.width, elements.canvas.height);

  if (!state.map) return;

  // Cámara centrada en el jugador local
  const renderTime = Date.now() - INTERPOLATION_DELAY_MS;
  const myBuf = state.buffers.get(state.myPlayerId);
  const myPos = myBuf ? myBuf.sample(renderTime) : { x: 400, y: 300 };

  const camX = elements.canvas.width / 2 - (myPos?.x || 400);
  const camY = elements.canvas.height / 2 - (myPos?.y || 300);

  ctx.save();
  ctx.translate(camX, camY);

  // 1. Renderizar Mapa
  drawMap();

  // 2. Renderizar Pickups
  if (state.currentSnapshot?.pickups) {
    drawPickups(state.currentSnapshot.pickups, now);
  }

  // 3. Renderizar Proyectiles
  if (state.currentSnapshot?.projectiles) {
    drawProjectiles(state.currentSnapshot.projectiles);
  }

  // 4. Renderizar Jugadores con Interpolación
  if (state.currentSnapshot?.players) {
    drawPlayers(state.currentSnapshot.players, renderTime);
  }

  ctx.restore();
}

function drawMap() {
  const map = state.map;
  const ts = map.tileSize || TILE_SIZE;

  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < map.width; x++) {
      const tile = map.tiles[y * map.width + x];
      const px = x * ts;
      const py = y * ts;

      if (tile === TILE.WALL) {
        ctx.fillStyle = '#141c2b';
        ctx.fillRect(px, py, ts, ts);
        ctx.strokeStyle = '#00f0ff';
        ctx.lineWidth = 1;
        ctx.strokeRect(px + 0.5, py + 0.5, ts - 1, ts - 1);
      } else {
        ctx.fillStyle = '#0a0d14';
        ctx.fillRect(px, py, ts, ts);
      }
    }
  }
}

function drawPickups(pickups, now) {
  for (const item of pickups) {
    ctx.save();
    ctx.translate(item.x, item.y);
    const pulse = Math.sin(now * 0.006) * 2;

    if (item.kind === 'shard') {
      ctx.fillStyle = '#00f0ff';
      ctx.shadowColor = '#00f0ff';
      ctx.shadowBlur = 10;
      ctx.rotate((now * 0.002) % (Math.PI * 2));
      ctx.fillRect(-6 - pulse / 2, -6 - pulse / 2, 12 + pulse, 12 + pulse);
    } else {
      ctx.fillStyle = '#b6ff3b';
      ctx.shadowColor = '#b6ff3b';
      ctx.shadowBlur = 10;
      ctx.fillRect(-3, -8, 6, 16);
      ctx.fillRect(-8, -3, 16, 6);
    }
    ctx.restore();
  }
}

function drawProjectiles(projectiles) {
  for (const p of projectiles) {
    ctx.save();
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.crit ? 6 : 4, 0, Math.PI * 2);
    ctx.fillStyle = p.crit ? '#ff2bd6' : '#00f0ff';
    ctx.shadowColor = p.crit ? '#ff2bd6' : '#00f0ff';
    ctx.shadowBlur = 12;
    ctx.fill();
    ctx.restore();
  }
}

function drawPlayers(players, renderTime) {
  for (const p of players) {
    const buf = state.buffers.get(p.id);
    const pos = buf ? buf.sample(renderTime) : { x: p.x, y: p.y };
    if (!pos) continue;

    ctx.save();
    ctx.translate(pos.x, pos.y);

    if (p.dead) {
      ctx.globalAlpha = 0.3;
    }

    // Cuerpo del jugador
    ctx.beginPath();
    ctx.arc(0, 0, 14, 0, Math.PI * 2);
    ctx.fillStyle = p.color || '#00f0ff';
    ctx.shadowColor = p.color || '#00f0ff';
    ctx.shadowBlur = 14;
    ctx.fill();
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2;
    ctx.stroke();

    // Barra de salud superior
    const barW = 32;
    const barH = 4;
    ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
    ctx.fillRect(-barW / 2, -26, barW, barH);
    const hpFrac = Math.max(0, Math.min(1, p.hp / p.maxHp));
    ctx.fillStyle = '#b6ff3b';
    ctx.fillRect(-barW / 2, -26, barW * hpFrac, barH);

    // Etiqueta de nombre y nivel
    ctx.font = '10px Orbitron, sans-serif';
    ctx.fillStyle = '#fff';
    ctx.textAlign = 'center';
    ctx.shadowBlur = 0;
    ctx.fillText(`${p.username} [L${p.level}]`, 0, -32);

    ctx.restore();
  }
}

// --- Ajuste de Canvas ---
function setupCanvasResize() {
  window.addEventListener('resize', resizeCanvas);
}

function resizeCanvas() {
  const rect = elements.canvasWrapper.getBoundingClientRect();
  elements.canvas.width = rect.width;
  elements.canvas.height = rect.height;
}

// --- Eventos de UI y Modales ---
function setupUIEvents() {
  // Autenticación
  elements.btnShowAuth.addEventListener('click', () => {
    elements.authErrorMsg.style.display = 'none';
    elements.modalAuth.classList.add('open');
  });

  elements.btnCloseAuth.addEventListener('click', () => {
    elements.modalAuth.classList.remove('open');
  });

  elements.formAuth.addEventListener('submit', async (e) => {
    e.preventDefault();
    const username = document.getElementById('input-username').value;
    const password = document.getElementById('input-password').value;

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'Error de credenciales');

      state.token = data.session.token;
      state.username = data.session.username;
      localStorage.setItem('cyber_token', state.token);
      localStorage.setItem('cyber_user', state.username);
      updateUserDisplay();
      elements.modalAuth.classList.remove('open');
    } catch (err) {
      elements.authErrorMsg.textContent = err.message;
      elements.authErrorMsg.style.display = 'block';
    }
  });

  // Crear Sala
  elements.btnCreateRoomModal.addEventListener('click', () => {
    elements.createRoomError.style.display = 'none';
    elements.modalCreateRoom.classList.add('open');
  });

  elements.btnCloseCreateRoom.addEventListener('click', () => {
    elements.modalCreateRoom.classList.remove('open');
  });

  elements.checkIsPrivate.addEventListener('change', (e) => {
    elements.groupRoomPassword.style.display = e.target.checked ? 'block' : 'none';
  });

  elements.formCreateRoom.addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = document.getElementById('input-room-name').value;
    const isPrivate = elements.checkIsPrivate.checked;
    const password = document.getElementById('input-room-password').value;
    const maxPlayers = parseInt(document.getElementById('select-max-players').value, 10);

    try {
      const headers = { 'Content-Type': 'application/json' };
      if (state.token) headers['Authorization'] = `Bearer ${state.token}`;

      const res = await fetch('/api/rooms', {
        method: 'POST',
        headers,
        body: JSON.stringify({ name, isPrivate, password, maxPlayers }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'Error al crear la sala');

      elements.modalCreateRoom.classList.remove('open');
      joinRoom(data.room.id, isPrivate ? password : null);
    } catch (err) {
      elements.createRoomError.textContent = err.message;
      elements.createRoomError.style.display = 'block';
    }
  });

  // Lista y Entrada a Salas
  elements.btnRefreshRooms.addEventListener('click', fetchRooms);
  elements.btnQuickJoin.addEventListener('click', () => joinRoom('room-1'));

  // Sala de Espera
  elements.btnLeaveRoom.addEventListener('click', () => {
    showView('view-lobby');
    state.currentRoomId = null;
    fetchRooms();
  });

  elements.btnToggleReady.addEventListener('click', () => {
    const nextState = !state.isReady;
    state.socket.send(JSON.stringify({ type: 'set_ready', ready: nextState }));
  });

  elements.btnExitMatch.addEventListener('click', () => {
    showView('view-lobby');
    state.currentRoomId = null;
    fetchRooms();
  });

  // Modal contraseña de sala protegida
  elements.btnCloseJoinPassword.addEventListener('click', () => {
    elements.modalJoinPassword.classList.remove('open');
  });

  elements.formJoinPassword.addEventListener('submit', (e) => {
    e.preventDefault();
    const roomId = elements.joinTargetRoomId.value;
    const password = elements.inputJoinPassword.value;
    elements.modalJoinPassword.classList.remove('open');
    joinRoom(roomId, password);
  });
}

async function fetchRooms() {
  try {
    const res = await fetch('/api/rooms');
    const data = await res.json();
    renderRoomsList(data.rooms || []);
  } catch {
    elements.roomsContainer.innerHTML = '<div class="loading-text">Error al consultar salas</div>';
  }
}

function renderRoomsList(rooms) {
  if (rooms.length === 0) {
    elements.roomsContainer.innerHTML = '<div class="loading-text">No hay salas abiertas activas</div>';
    return;
  }

  elements.roomsContainer.innerHTML = rooms
    .map(
      (r) => `
    <div class="room-item" data-room-id="${r.id}">
      <div>
        <div class="room-meta-name">${r.name} ${r.isPrivate ? '🔒' : ''}</div>
        <div class="room-meta-sub">Host: ${r.creator} | Jugadores: ${r.playerCount}/${r.maxPlayers} | Estado: ${r.status}</div>
      </div>
      <button class="cyber-btn cyber-btn-secondary btn-join-room" data-room-id="${r.id}" data-private="${r.isPrivate}">
        Unirse
      </button>
    </div>
  `
    )
    .join('');

  document.querySelectorAll('.btn-join-room').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      const roomId = e.target.getAttribute('data-room-id');
      const isPrivate = e.target.getAttribute('data-private') === 'true';

      if (isPrivate) {
        elements.joinTargetRoomId.value = roomId;
        elements.inputJoinPassword.value = '';
        elements.joinPasswordError.style.display = 'none';
        elements.modalJoinPassword.classList.add('open');
      } else {
        joinRoom(roomId);
      }
    });
  });
}

function joinRoom(roomId, password = null) {
  if (!state.socket || state.socket.readyState !== WebSocket.OPEN) {
    alert('Conexión con el servidor no lista');
    return;
  }

  state.socket.send(
    JSON.stringify({
      type: 'join_room',
      roomId,
      username: state.username,
      password,
    })
  );
}

function renderLobbyRoster(lobby) {
  elements.currentRoomName.textContent = lobby.roomName;
  elements.playersRoster.innerHTML = lobby.players
    .map(
      (p) => `
    <div class="roster-card">
      <div>
        <strong>${p.username}</strong>
        <div style="font-size: 12px; color: var(--text-muted);">Ping: ${p.ping || 20}ms</div>
      </div>
      <span class="roster-ready-badge ${p.ready ? 'is-ready' : ''}">
        ${p.ready ? 'LISTO' : 'ESPERANDO'}
      </span>
    </div>
  `
    )
    .join('');
}

// Iniciar al cargar el DOM
window.addEventListener('DOMContentLoaded', init);
