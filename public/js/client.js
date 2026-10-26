import { InterpolationBuffer } from '../shared/interpolation.js';
import {
  INTERPOLATION_DELAY_MS,
  TILE_SIZE,
  TILE,
  PLAYER,
  CLIENT_INPUT_RATE,
  PREDICTION_SNAP_DISTANCE,
} from '../shared/constants.js';
import { stepMovement } from '../shared/physics.js';

/**
 * Cliente de CyberGrid: Breach & Sync.
 * Canvas 2D desacoplado con delta time, predicción local, reconciliación
 * server-authoritative, WebSockets y controles adaptativos PC / Móvil.
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
  inputAccumulator: 0,

  // Interpolación de jugadores por ID -> InterpolationBuffer
  buffers: new Map(),
  projectileBuffers: new Map(), // id -> { buffer, lastSeen, crit }
  currentSnapshot: null,
  lastSnapshotRecvTime: 0,

  // Predicción local (Server-Authoritative + Client Prediction)
  predicted: { x: 0, y: 0, initialized: false },
  pendingInputs: [],
  isLocalDead: false,

  // Entradas del jugador local
  keys: { w: false, a: false, s: false, d: false, ArrowUp: false, ArrowLeft: false, ArrowDown: false, ArrowRight: false },
  mouse: { x: 0, y: 0, shooting: false },
  touchVector: { x: 0, y: 0 },
  touchShooting: false,
  touchAim: { active: false, magnitude: 0, x: 0, y: 0, angle: 0, used: false },
  fireRequestUntil: 0,
  aimAngle: 0,
  isTouch: false,

  // Viewport lógico (CSS px) y escala real del canvas
  viewport: { width: 1280, height: 720, dpr: 1 },
  viewRect: null,
};

// --- Diccionario y Carga de Sprites de Operadores (Todos los Colores) ---
const COLOR_MAP = {
  '#00f0ff': 'cyan',
  '#ff2bd6': 'magenta',
  '#b6ff3b': 'lime',
  '#ffb020': 'orange',
  '#8a7bff': 'purple',
  '#ff5a5a': 'red',
  '#3bffb0': 'teal',
  '#ffffff': 'white',
};

const OPERATOR_COLORS = Object.values(COLOR_MAP);
const DIRECTIONS = ['front', 'back', 'right', 'left'];

// Cache de imágenes: operatorSprites[color][direction] -> HTMLImageElement
const operatorSprites = {};
for (const c of OPERATOR_COLORS) {
  operatorSprites[c] = {};
  for (const d of DIRECTIONS) {
    const img = new Image();
    img.src = `/img/soldier_${c}_${d}.png`;
    operatorSprites[c][d] = img;
  }
}

// Historial para determinar la orientación y cadencia de paso del soldado
const playerOrientations = new Map();

// Caché del mapa pre-renderizado
let mapCache = null;
let resizeFrame = 0;

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
  touchAimZone: document.getElementById('touch-aim'),
  aimKnob: document.getElementById('aim-knob'),
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
const touchResetters = [];

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
    let data;
    try {
      data = JSON.parse(event.data);
    } catch {
      return;
    }
    try {
      handleServerMessage(data);
    } catch (err) {
      console.error('[WS Message Error]:', err);
    }
  });

  state.socket.addEventListener('close', () => {
    elements.pingDisplay.textContent = 'OFFLINE';
    elements.pingDisplay.className = 'stat-val';
    resetInputs();
    clearGameState();
    if (elements.viewGame.classList.contains('active')) {
      showView('view-lobby');
    }
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
      clearGameState();
      state.currentRoomId = msg.roomId;
      state.myPlayerId = msg.playerId;
      state.map = msg.map;
      mapCache = null;
      showView('view-room-waiting');
      elements.currentRoomId.textContent = `ID: ${msg.roomId}`;
      break;
    }

    case 'lobby_update': {
      renderLobbyRoster(msg);
      if (msg.status === 'in-game' && !elements.viewGame.classList.contains('active')) {
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
      handleSnapshot(msg);
      break;
    }

    case 'left_room':
      break;

    case 'error': {
      alert(`[Error]: ${msg.message}`);
      break;
    }
  }
}

function handleSnapshot(msg) {
  const receiveTime = performance.now();
  state.lastSnapshotRecvTime = receiveTime;
  state.currentSnapshot = msg;

  for (const p of msg.players) {
    let buf = state.buffers.get(p.id);
    if (!buf) {
      buf = new InterpolationBuffer(30);
      state.buffers.set(p.id, buf);
    }

    // Los timestamps del búfer son de recepción local: elimina el sesgo
    // entre el reloj del servidor y el del dispositivo móvil.
    buf.push({ t: receiveTime, x: p.x, y: p.y });

    if (p.id === state.myPlayerId) {
      reconcileLocalPlayer(p);
      updateLocalHUD(p);
    }
  }

  const activePlayerIds = new Set(msg.players.map((p) => p.id));
  for (const id of state.buffers.keys()) {
    if (!activePlayerIds.has(id)) state.buffers.delete(id);
  }

  for (const proj of msg.projectiles || []) {
    let entry = state.projectileBuffers.get(proj.id);
    if (!entry) {
      entry = { buffer: new InterpolationBuffer(20), lastSeen: receiveTime, crit: proj.crit };
      state.projectileBuffers.set(proj.id, entry);
    }
    entry.buffer.push({ t: receiveTime, x: proj.x, y: proj.y });
    entry.lastSeen = receiveTime;
    entry.crit = proj.crit;
  }

  for (const [id, entry] of state.projectileBuffers) {
    if (receiveTime - entry.lastSeen > 500) state.projectileBuffers.delete(id);
  }
}

function reconcileLocalPlayer(p) {
  if (p.dead) {
    state.isLocalDead = true;
    state.pendingInputs = [];
    state.predicted = { x: p.x, y: p.y, initialized: true };
    return;
  }

  state.isLocalDead = false;

  const ackSeq = Number.isFinite(p.ackSeq) ? p.ackSeq : 0;
  if (state.pendingInputs.length > 0) {
    state.pendingInputs = state.pendingInputs.filter((input) => input.seq > ackSeq);
  }

  // Re-simular los inputs que el servidor aún no ha confirmado.
  let x = p.x;
  let y = p.y;
  for (const input of state.pendingInputs) {
    const next = stepMovement(
      state.map,
      { x, y },
      { x: input.x, y: input.y },
      PLAYER.speed,
      input.dt,
      PLAYER.radius
    );
    x = next.x;
    y = next.y;
  }

  if (!state.predicted.initialized) {
    state.predicted = { x, y, initialized: true };
    return;
  }

  const error = Math.hypot(x - state.predicted.x, y - state.predicted.y);
  if (error > PREDICTION_SNAP_DISTANCE) {
    // Corrección fuerte: reaparición, choque o pérdida de paquetes.
    state.predicted = { x, y, initialized: true };
  } else {
    // Corrección suave para absorber pequeñas diferencias de dt.
    state.predicted.x += (x - state.predicted.x) * 0.35;
    state.predicted.y += (y - state.predicted.y) * 0.35;
  }
}

function updateLocalHUD(p) {
  const hpPct = Math.max(0, Math.min(100, (p.hp / p.maxHp) * 100));
  elements.hudHpBar.style.width = `${hpPct}%`;
  elements.hudHpText.textContent = `${p.hp} / ${p.maxHp}`;
  elements.hudLevel.textContent = p.level;
  elements.hudShards.textContent = p.shards;
  elements.hudKills.textContent = p.kills;

  const pos = state.predicted.initialized ? state.predicted : p;
  elements.playerCoordinates.setAttribute('data-player-x', String(pos.x));
  elements.playerCoordinates.setAttribute('data-player-y', String(pos.y));
  elements.playerCoordinates.setAttribute('data-aim-angle', state.aimAngle.toFixed(3));
  elements.telemetryX.textContent = Math.round(pos.x);
  elements.telemetryY.textContent = Math.round(pos.y);
}

// --- Cambio de Vistas ---
function showView(viewId) {
  document.querySelectorAll('.view-panel').forEach((p) => p.classList.remove('active'));
  const target = document.getElementById(viewId);
  if (target) target.classList.add('active');

  document.body.classList.toggle('in-game', viewId === 'view-game');
  resetInputs();

  if (viewId === 'view-game') {
    scheduleCanvasResize();
    lockToLandscape();
  } else {
    unlockOrientation();
  }
}

function lockToLandscape() {
  try {
    if (screen.orientation && typeof screen.orientation.lock === 'function') {
      screen.orientation.lock('landscape').catch(() => {
        // Ignorar si el navegador no permite bloquear orientación
      });
    }
  } catch {
    // Ignorar errores de bloqueo de orientación
  }
}

function unlockOrientation() {
  try {
    if (screen.orientation && typeof screen.orientation.unlock === 'function') {
      screen.orientation.unlock();
    }
  } catch {
    // Ignorar errores
  }
}

// --- Controles de Entrada (PC y Móvil) ---
const KEY_BY_CODE = {
  KeyW: 'w',
  KeyA: 'a',
  KeyS: 's',
  KeyD: 'd',
  ArrowUp: 'ArrowUp',
  ArrowLeft: 'ArrowLeft',
  ArrowDown: 'ArrowDown',
  ArrowRight: 'ArrowRight',
};

function setupInputListeners() {
  window.addEventListener('keydown', (e) => {
    if (isEditableTarget(e.target)) return;
    const key = KEY_BY_CODE[e.code] || (Object.prototype.hasOwnProperty.call(state.keys, e.key) ? e.key : null);
    if (!key) return;
    state.keys[key] = true;
    if (key.startsWith('Arrow')) e.preventDefault();
  });

  window.addEventListener('keyup', (e) => {
    const key = KEY_BY_CODE[e.code] || (Object.prototype.hasOwnProperty.call(state.keys, e.key) ? e.key : null);
    if (key) state.keys[key] = false;
  });

  elements.canvas.addEventListener('mousemove', (e) => {
    const rect = elements.canvas.getBoundingClientRect();
    state.mouse.x = e.clientX - rect.left;
    state.mouse.y = e.clientY - rect.top;
  });

  elements.canvas.addEventListener('mousedown', (e) => {
    if (e.button === 0) {
      state.mouse.shooting = true;
      requestFire();
      e.preventDefault();
    }
  });

  window.addEventListener('mouseup', (e) => {
    if (e.button === 0) state.mouse.shooting = false;
  });

  elements.canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  window.addEventListener('blur', resetInputs);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) resetInputs();
  });
}

function isEditableTarget(target) {
  if (!target) return false;
  return (
    target.tagName === 'INPUT' ||
    target.tagName === 'SELECT' ||
    target.tagName === 'TEXTAREA' ||
    target.isContentEditable
  );
}

function setupTouchControls() {
  state.isTouch =
    'ontouchstart' in window ||
    navigator.maxTouchPoints > 0 ||
    window.matchMedia?.('(pointer: coarse)').matches;

  document.body.classList.toggle('is-touch', state.isTouch);
  if (!state.isTouch) return;

  const resetMove = setupJoystick(
    elements.touchJoystickZone,
    elements.joystickKnob,
    (x, y) => {
      state.touchVector = { x, y };
    },
    () => {
      state.touchVector = { x: 0, y: 0 };
    }
  );
  touchResetters.push(resetMove);

  const resetAim = setupJoystick(
    elements.touchAimZone,
    elements.aimKnob,
    (x, y, magnitude) => {
      state.touchAim.active = magnitude > 0.08;
      state.touchAim.magnitude = magnitude;
      state.touchAim.x = x;
      state.touchAim.y = y;
      if (Math.hypot(x, y) > 0.08) {
        state.touchAim.angle = Math.atan2(y, x);
        state.touchAim.used = true;
      }
    },
    () => {
      state.touchAim.active = false;
      state.touchAim.magnitude = 0;
    }
  );
  touchResetters.push(resetAim);

  const releaseFire = () => {
    state.touchShooting = false;
  };

  elements.btnTouchFire.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    try {
      elements.btnTouchFire.setPointerCapture(e.pointerId);
    } catch {
      // Puntero sintético sin captura disponible.
    }
    state.touchShooting = true;
    requestFire();
  });
  elements.btnTouchFire.addEventListener('pointerup', (e) => {
    e.preventDefault();
    releaseFire();
  });
  elements.btnTouchFire.addEventListener('pointercancel', releaseFire);
  elements.btnTouchFire.addEventListener('lostpointercapture', releaseFire);
  elements.touchControls.addEventListener('contextmenu', (e) => e.preventDefault());
}

function setupJoystick(zone, knob, onMove, onEnd) {
  let pointerId = null;
  let originX = 0;
  let originY = 0;
  let maxRadius = 32;

  const update = (e) => {
    if (pointerId === null || e.pointerId !== pointerId) return;

    let dx = e.clientX - originX;
    let dy = e.clientY - originY;
    const dist = Math.hypot(dx, dy);

    if (dist > maxRadius) {
      dx = (dx / dist) * maxRadius;
      dy = (dy / dist) * maxRadius;
    }

    knob.style.transform = `translate(${dx}px, ${dy}px)`;
    onMove(dx / maxRadius, dy / maxRadius, Math.min(1, dist / maxRadius));
    e.preventDefault();
  };

  const end = (e) => {
    if (pointerId === null) return;
    if (e && typeof e.pointerId === 'number' && e.pointerId !== pointerId) return;
    pointerId = null;
    knob.style.transform = 'translate(0px, 0px)';
    onEnd();
  };

  zone.addEventListener(
    'pointerdown',
    (e) => {
      if (pointerId !== null) return;
      pointerId = e.pointerId;
      try {
        zone.setPointerCapture(pointerId);
      } catch {
        // Puntero sintético sin captura disponible.
      }
      const base = zone.querySelector('.joystick-base') || zone;
      const baseRect = base.getBoundingClientRect();
      const knobRect = knob.getBoundingClientRect();
      originX = baseRect.left + baseRect.width / 2;
      originY = baseRect.top + baseRect.height / 2;
      maxRadius = Math.max(24, baseRect.width / 2 - knobRect.width / 2);
      update(e);
      e.preventDefault();
    },
    { passive: false }
  );

  zone.addEventListener('pointermove', update, { passive: false });
  zone.addEventListener('pointerup', end);
  zone.addEventListener('pointercancel', end);
  zone.addEventListener('lostpointercapture', end);

  return () => {
    pointerId = null;
    knob.style.transform = 'translate(0px, 0px)';
    onEnd();
  };
}

function requestFire() {
  // Mantiene "shooting" activo al menos un tick del servidor (30 Hz)
  // para que un toque rápido no se pierda entre snapshots.
  state.fireRequestUntil = performance.now() + 120;
}

function resetInputs() {
  for (const key of Object.keys(state.keys)) state.keys[key] = false;
  state.mouse.shooting = false;
  state.touchShooting = false;
  state.touchVector = { x: 0, y: 0 };
  state.touchAim.active = false;
  state.touchAim.magnitude = 0;
  state.fireRequestUntil = 0;
  for (const reset of touchResetters) reset();
}

function readMovementInput() {
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

  return { x: mx, y: my };
}

function updateAimAngle() {
  if (state.isTouch) {
    if (state.touchAim.active && state.touchAim.used) {
      state.aimAngle = state.touchAim.angle;
    } else {
      const movement = readMovementInput();
      if (Math.hypot(movement.x, movement.y) > 0.1) {
        state.aimAngle = Math.atan2(movement.y, movement.x);
      }
    }
    return;
  }

  const cx = state.viewport.width / 2;
  const cy = state.viewport.height / 2;
  state.aimAngle = Math.atan2(state.mouse.y - cy, state.mouse.x - cx);
}

function isShooting() {
  if (state.mouse.shooting || state.touchShooting) return true;
  if (state.fireRequestUntil > performance.now()) return true;
  return state.touchAim.active && state.touchAim.magnitude > 0.3;
}

function updateLocalPrediction(dt) {
  if (!state.myPlayerId || !state.map) return;
  if (!state.predicted.initialized || state.isLocalDead) return;

  const input = readMovementInput();
  const next = stepMovement(
    state.map,
    { x: state.predicted.x, y: state.predicted.y },
    input,
    PLAYER.speed,
    dt,
    PLAYER.radius
  );
  state.predicted.x = next.x;
  state.predicted.y = next.y;
}

function sendInputs(dt) {
  if (!state.socket || state.socket.readyState !== WebSocket.OPEN) return;
  if (!state.currentRoomId || !state.myPlayerId) {
    state.inputAccumulator = 0;
    return;
  }

  const interval = 1 / CLIENT_INPUT_RATE;
  state.inputAccumulator += dt;
  if (state.inputAccumulator < interval) return;

  const sendDt = Math.min(0.1, state.inputAccumulator);
  state.inputAccumulator = 0;

  const movement = readMovementInput();
  const payload = {
    seq: state.inputSeq++,
    x: movement.x,
    y: movement.y,
    aimAngle: state.aimAngle,
    shooting: isShooting(),
    timestamp: Date.now(),
  };

  state.pendingInputs.push({
    seq: payload.seq,
    x: payload.x,
    y: payload.y,
    dt: sendDt,
  });
  if (state.pendingInputs.length > 180) state.pendingInputs.shift();

  state.socket.send(JSON.stringify({ type: 'input', data: payload }));
}

// --- Bucle de Juego Canvas 2D (60 FPS con delta time) ---
let frameCount = 0;
let lastFpsCheck = performance.now();

function gameLoop(now) {
  const dt = Math.min(0.1, Math.max(0, (now - state.lastFrameTime) / 1000));
  state.lastFrameTime = now;

  frameCount++;
  if (now - lastFpsCheck >= 1000) {
    state.fps = frameCount;
    elements.fpsDisplay.textContent = state.fps;
    frameCount = 0;
    lastFpsCheck = now;
  }

  if (elements.viewGame.classList.contains('active')) {
    updateAimAngle();
    updateLocalPrediction(dt);
    sendInputs(dt);
    renderGame(now, dt);
  } else {
    state.inputAccumulator = 0;
  }

  requestAnimationFrame(gameLoop);
}

function renderGame(now, dt) {
  const { width, height } = state.viewport;
  ctx.clearRect(0, 0, width, height);

  if (!state.map) return;

  const renderTime = performance.now() - INTERPOLATION_DELAY_MS;

  let myPos;
  if (state.predicted.initialized && !state.isLocalDead) {
    myPos = { x: state.predicted.x, y: state.predicted.y };
  } else {
    const myBuf = state.buffers.get(state.myPlayerId);
    myPos = myBuf?.sample(renderTime);
  }

  if (!myPos) {
    const spawn = state.map.spawns?.[0] || { x: 400, y: 300 };
    myPos = { x: spawn.x, y: spawn.y };
  }

  const camX = width / 2 - myPos.x;
  const camY = height / 2 - myPos.y;

  state.viewRect = {
    left: -camX,
    top: -camY,
    right: -camX + width,
    bottom: -camY + height,
  };

  ctx.save();
  ctx.translate(camX, camY);

  // 1. Renderizar Mapa (cacheado)
  drawMap();

  // 2. Renderizar Pickups
  if (state.currentSnapshot?.pickups) {
    drawPickups(state.currentSnapshot.pickups, now);
  }

  // 3. Renderizar Proyectiles
  if (state.currentSnapshot?.projectiles) {
    drawProjectiles(state.currentSnapshot.projectiles, renderTime);
  }

  // 4. Renderizar Jugadores con Interpolación / Predicción
  if (state.currentSnapshot?.players) {
    drawPlayers(state.currentSnapshot.players, renderTime, dt);
  }

  ctx.restore();
}

function isVisible(x, y, margin = 64) {
  const r = state.viewRect;
  if (!r) return true;
  return x >= r.left - margin && x <= r.right + margin && y >= r.top - margin && y <= r.bottom + margin;
}

function buildMapCache() {
  if (!state.map) return;

  const dpr = state.viewport.dpr || 1;
  if (mapCache && mapCache.dpr === dpr) return;

  const ts = state.map.tileSize || TILE_SIZE;
  const width = state.map.width * ts;
  const height = state.map.height * ts;

  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width * dpr));
  canvas.height = Math.max(1, Math.round(height * dpr));
  const c = canvas.getContext('2d');
  c.setTransform(dpr, 0, 0, dpr, 0, 0);

  for (let y = 0; y < state.map.height; y++) {
    for (let x = 0; x < state.map.width; x++) {
      const tile = state.map.tiles[y * state.map.width + x];
      const px = x * ts;
      const py = y * ts;

      if (tile === TILE.WALL) {
        c.fillStyle = '#141c2b';
        c.fillRect(px, py, ts, ts);
        c.strokeStyle = '#00f0ff';
        c.lineWidth = 1;
        c.strokeRect(px + 0.5, py + 0.5, ts - 1, ts - 1);
      } else {
        c.fillStyle = '#0a0d14';
        c.fillRect(px, py, ts, ts);
      }
    }
  }

  mapCache = { canvas, dpr, width, height };
}

function drawMap() {
  buildMapCache();
  if (!mapCache) return;

  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(mapCache.canvas, 0, 0, mapCache.width, mapCache.height);
  ctx.imageSmoothingEnabled = true;
}

function drawPickups(pickups, now) {
  for (const item of pickups) {
    if (!isVisible(item.x, item.y, 32)) continue;

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

function drawProjectiles(projectiles, renderTime) {
  for (const p of projectiles) {
    const entry = state.projectileBuffers.get(p.id);
    const pos = entry ? entry.buffer.sample(renderTime) : { x: p.x, y: p.y };
    if (!pos || !isVisible(pos.x, pos.y, 24)) continue;

    ctx.save();
    ctx.beginPath();
    ctx.arc(pos.x, pos.y, p.crit ? 6 : 4, 0, Math.PI * 2);
    ctx.fillStyle = p.crit ? '#ff2bd6' : '#00f0ff';
    ctx.shadowColor = p.crit ? '#ff2bd6' : '#00f0ff';
    ctx.shadowBlur = 12;
    ctx.fill();
    ctx.restore();
  }
}

function drawPlayers(players, renderTime, dt = 0.016) {
  for (const p of players) {
    let pos;
    if (p.id === state.myPlayerId && state.predicted.initialized && !p.dead) {
      pos = { x: state.predicted.x, y: state.predicted.y };
    } else {
      const buf = state.buffers.get(p.id);
      pos = buf ? buf.sample(renderTime) : { x: p.x, y: p.y };
    }

    if (!pos) continue;
    if (p.id !== state.myPlayerId && !isVisible(pos.x, pos.y, 80)) continue;

    // Calcular desplazamiento y velocidad real entre fotogramas
    const orient = playerOrientations.get(p.id) || {
      prevX: pos.x,
      prevY: pos.y,
      lastDir: 'front',
      walkTime: 0,
    };

    const dx = pos.x - orient.prevX;
    const dy = pos.y - orient.prevY;
    orient.prevX = pos.x;
    orient.prevY = pos.y;

    const moveDist = Math.hypot(dx, dy);
    const isMoving = moveDist > 0.04;
    if (isMoving) {
      orient.walkTime += dt;
    }

    // Orientación precisa hacia donde va el operador
    let dir = orient.lastDir;

    if (isMoving) {
      const moveAngle = Math.atan2(dy, dx);
      const deg = (moveAngle * 180) / Math.PI;

      if (deg >= -45 && deg <= 45) {
        dir = 'right';
      } else if (deg > 45 && deg < 135) {
        dir = 'front'; // Hacia abajo / cámara
      } else if (deg < -45 && deg > -135) {
        dir = 'back'; // Hacia arriba / espaldas
      } else {
        dir = 'left';
      }
      orient.lastDir = dir;
    } else if (p.id === state.myPlayerId) {
      // Si está detenido y es el jugador local, orientarse hacia el ángulo de puntería (mouse o touch)
      const deg = (state.aimAngle * 180) / Math.PI;

      if (deg >= -45 && deg <= 45) {
        dir = 'right';
      } else if (deg > 45 && deg < 135) {
        dir = 'front';
      } else if (deg < -45 && deg > -135) {
        dir = 'back';
      } else {
        dir = 'left';
      }
      orient.lastDir = dir;
    }

    playerOrientations.set(p.id, orient);

    // Obtener sprite correspondiente al color y dirección del operador
    const colorKey = COLOR_MAP[p.color?.toLowerCase()] || 'cyan';
    const spriteSet = operatorSprites[colorKey] || operatorSprites['cyan'];
    const sprite = spriteSet ? spriteSet[dir] : null;

    // Efecto de paso (bobbing) e inclinación según desplazamiento
    const bob = isMoving ? Math.sin(orient.walkTime * 14) * 2.5 : 0;
    const tilt = isMoving ? Math.max(-0.10, Math.min(0.10, (dx / (Math.abs(dy) + 0.1)) * 0.07)) : 0;

    ctx.save();
    ctx.translate(pos.x, pos.y);

    if (p.dead) {
      ctx.globalAlpha = 0.3;
    }

    // Halo / sombra de energía en el suelo con el color característico del operador
    const glowColor = p.color || '#00f0ff';
    ctx.beginPath();
    ctx.ellipse(0, 12, 16, 7, 0, 0, Math.PI * 2);
    ctx.fillStyle = glowColor;
    ctx.globalAlpha = p.dead ? 0.15 : 0.35;
    ctx.shadowColor = glowColor;
    ctx.shadowBlur = state.isTouch ? 8 : 12;
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.globalAlpha = p.dead ? 0.3 : 1.0;

    // Dibujar sprite del operador
    if (sprite && sprite.complete && sprite.naturalWidth > 0) {
      ctx.save();
      ctx.rotate(tilt);
      const spriteW = 32;
      const spriteH = 46;
      ctx.drawImage(sprite, -spriteW / 2, -28 + bob, spriteW, spriteH);
      ctx.restore();
    } else {
      // Fallback a indicador geométrico
      ctx.beginPath();
      ctx.arc(0, 0, 14, 0, Math.PI * 2);
      ctx.fillStyle = glowColor;
      ctx.shadowColor = glowColor;
      ctx.shadowBlur = 14;
      ctx.fill();
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 2;
      ctx.stroke();
    }

    // Barra de salud superior
    const barW = 34;
    const barH = 4;
    ctx.fillStyle = 'rgba(0, 0, 0, 0.75)';
    ctx.fillRect(-barW / 2, -38, barW, barH);
    const hpFrac = Math.max(0, Math.min(1, p.hp / p.maxHp));
    ctx.fillStyle = '#b6ff3b';
    ctx.fillRect(-barW / 2, -38, barW * hpFrac, barH);

    // Etiqueta de nombre y nivel
    ctx.font = '10px Orbitron, sans-serif';
    ctx.fillStyle = '#fff';
    ctx.textAlign = 'center';
    ctx.shadowBlur = 0;
    ctx.fillText(`${p.username} [L${p.level}]`, 0, -44);

    ctx.restore();
  }
}

// --- Ajuste de Canvas y DPR ---
function setupCanvasResize() {
  window.addEventListener('resize', scheduleCanvasResize);
  window.addEventListener('orientationchange', () => {
    scheduleCanvasResize();
    setTimeout(scheduleCanvasResize, 50);
    setTimeout(scheduleCanvasResize, 150);
    setTimeout(scheduleCanvasResize, 300);
  });

  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', scheduleCanvasResize);
  }

  if (typeof ResizeObserver !== 'undefined') {
    const observer = new ResizeObserver(scheduleCanvasResize);
    observer.observe(elements.canvasWrapper);
  }
}

function scheduleCanvasResize() {
  if (resizeFrame) return;
  resizeFrame = requestAnimationFrame(() => {
    resizeFrame = 0;
    resizeCanvas();
  });
}

function resizeCanvas() {
  if (!elements.viewGame.classList.contains('active')) return;

  const rect = elements.canvasWrapper.getBoundingClientRect();
  if (rect.width < 1 || rect.height < 1) return;

  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const backingWidth = Math.max(1, Math.round(rect.width * dpr));
  const backingHeight = Math.max(1, Math.round(rect.height * dpr));

  if (elements.canvas.width !== backingWidth || elements.canvas.height !== backingHeight) {
    elements.canvas.width = backingWidth;
    elements.canvas.height = backingHeight;
  }

  if (state.viewport.dpr !== dpr) {
    mapCache = null;
  }

  state.viewport = { width: rect.width, height: rect.height, dpr };
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.imageSmoothingEnabled = true;
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
  elements.btnLeaveRoom.addEventListener('click', leaveCurrentRoom);

  elements.btnToggleReady.addEventListener('click', () => {
    if (!state.socket || state.socket.readyState !== WebSocket.OPEN) return;
    const nextState = !state.isReady;
    state.socket.send(JSON.stringify({ type: 'set_ready', ready: nextState }));
  });

  elements.btnExitMatch.addEventListener('click', leaveCurrentRoom);

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

function leaveCurrentRoom() {
  if (state.socket && state.socket.readyState === WebSocket.OPEN && state.currentRoomId) {
    state.socket.send(JSON.stringify({ type: 'leave_room' }));
  }
  clearGameState();
  showView('view-lobby');
  fetchRooms();
}

function clearGameState() {
  state.currentRoomId = null;
  state.myPlayerId = null;
  state.map = null;
  state.isReady = false;
  state.buffers.clear();
  state.projectileBuffers.clear();
  state.currentSnapshot = null;
  state.lastSnapshotRecvTime = 0;
  state.predicted = { x: 0, y: 0, initialized: false };
  state.pendingInputs = [];
  state.isLocalDead = false;
  state.aimAngle = 0;
  state.touchAim = { active: false, magnitude: 0, x: 0, y: 0, angle: 0, used: false };
  state.fireRequestUntil = 0;
  state.inputSeq = 1;
  state.inputAccumulator = 0;
  state.viewRect = null;
  playerOrientations.clear();
  mapCache = null;

  elements.btnToggleReady.setAttribute('data-ready', 'false');
  elements.btnToggleReady.textContent = 'Marcar "Listo"';
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
    .map((p) => {
      const colorKey = COLOR_MAP[p.color?.toLowerCase()] || 'cyan';
      return `
    <div class="roster-card">
      <div style="display: flex; align-items: center; gap: 12px;">
        <img src="/img/soldier_${colorKey}_front.png" style="width: 28px; height: 38px; object-fit: contain; filter: drop-shadow(0 0 6px ${p.color || '#00f0ff'});" alt="Operador">
        <div>
          <strong>${p.username}</strong>
          <div style="font-size: 12px; color: var(--text-muted);">Ping: ${p.ping || 20}ms</div>
        </div>
      </div>
      <span class="roster-ready-badge ${p.ready ? 'is-ready' : ''}">
        ${p.ready ? 'LISTO' : 'ESPERANDO'}
      </span>
    </div>
  `;
    })
    .join('');
}

// Iniciar al cargar el DOM
window.addEventListener('DOMContentLoaded', init);
