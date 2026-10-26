import { InterpolationBuffer } from '../shared/interpolation.js';
import {
  INTERPOLATION_DELAY_MS,
  TILE_SIZE,
  TILE,
  PLAYER,
  CLIENT_INPUT_RATE,
  PREDICTION_SNAP_DISTANCE,
  CHARACTERS,
  BIOMES,
} from '../shared/constants.js';
import { stepMovement } from '../shared/physics.js';
import { isWallTile } from '../shared/mapgen.js';

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

  // Sistema de Audio SFX procedural
  soundEnabled: localStorage.getItem('cyber_sound') !== 'false',
  audioCtx: null,

  // Clase de Operador seleccionada y Especialista (Personaje)
  selectedClass: 'assault',
  selectedCharacter: localStorage.getItem('cyber_char') || 'vanguard',
  currentBiome: 'cavern',
  isLeaderboardOpen: false,

  // Partículas y Efectos Visuales
  particles: [],
  floatingTexts: [],
  screenTrauma: 0,
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

// Cache de imágenes con ciclo multi-frame para todos los colores:
// operatorSprites[color][direction] -> Array de HTMLImageElement
const operatorSprites = {};
for (const c of OPERATOR_COLORS) {
  operatorSprites[c] = {
    front: [new Image(), new Image()],
    back: [new Image(), new Image()],
    right: [new Image(), new Image(), new Image(), new Image()],
    left: [new Image(), new Image(), new Image(), new Image()],
  };

  operatorSprites[c].front[0].src = `/img/soldier_${c}_front.png`;
  operatorSprites[c].front[1].src = `/img/soldier_${c}_front2.png`;

  operatorSprites[c].back[0].src = `/img/soldier_${c}_back.png`;
  operatorSprites[c].back[1].src = `/img/soldier_${c}_back2.png`;

  operatorSprites[c].right[0].src = `/img/soldier_${c}_right.png`;
  operatorSprites[c].right[1].src = `/img/soldier_${c}_right2.png`;
  operatorSprites[c].right[2].src = `/img/soldier_${c}_right3.png`;
  operatorSprites[c].right[3].src = `/img/soldier_${c}_right4.png`;

  operatorSprites[c].left[0].src = `/img/soldier_${c}_left.png`;
  operatorSprites[c].left[1].src = `/img/soldier_${c}_left2.png`;
  operatorSprites[c].left[2].src = `/img/soldier_${c}_left3.png`;
  operatorSprites[c].left[3].src = `/img/soldier_${c}_left4.png`;
}

// Sprite del Botiquín de Salud Pixel Art (Medkit)
const medkitSprite = new Image();
medkitSprite.src = '/img/medkit.png';

// Historial para determinar la orientación y cadencia de paso del soldado
const playerOrientations = new Map();

// Mapeos bidireccionales entre Clases y Especialistas (Personajes)
const CHARACTER_TO_CLASS = {
  vanguard: 'assault',
  spectre: 'scout',
  titan: 'tank',
  nova: 'tactical',
  viper: 'scout',
  void: 'tactical',
  inferno: 'assault',
  phantom: 'tank',
};

const CLASS_TO_CHARACTER = {
  assault: 'vanguard',
  scout: 'spectre',
  tank: 'titan',
  tactical: 'nova',
};

// Caché del mapa y radar pre-renderizados
let mapCache = null;
let radarCacheCanvas = null;
let radarCacheBiome = null;
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
  btnRoomFullscreen: document.getElementById('btn-room-fullscreen'),
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
  btnToggleFullscreen: document.getElementById('btn-toggle-fullscreen'),
  btnExitMatch: document.getElementById('btn-exit-match'),
  rotateOverlay: document.getElementById('rotate-overlay'),
  btnRotateFullscreen: document.getElementById('btn-rotate-fullscreen'),

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

  // Sonido y Game Juice
  btnToggleSound: document.getElementById('btn-toggle-sound'),
  btnHeaderSound: document.getElementById('btn-header-sound'),
  soundIcon: document.getElementById('sound-icon'),
  headerSoundIcon: document.getElementById('header-sound-icon'),
  killFeed: document.getElementById('kill-feed'),
  classCardsGrid: document.getElementById('class-cards-grid'),

  // Personajes, Biomas, Radar y Leaderboard
  currentRoomBiome: document.getElementById('current-room-biome'),
  characterCardsGrid: document.getElementById('character-cards-grid'),
  inputRoomBiome: document.getElementById('input-room-biome'),
  biomeCardsGrid: document.getElementById('biome-cards-grid'),
  hudRadarContainer: document.getElementById('hud-radar-container'),
  radarCanvas: document.getElementById('radar-canvas'),
  radarBiomeBadge: document.getElementById('radar-biome-badge'),
  hudLeaderboard: document.getElementById('hud-leaderboard'),
  leaderboardBody: document.getElementById('leaderboard-body'),
  btnToggleLeaderboard: document.getElementById('btn-toggle-leaderboard'),
  btnCloseLeaderboard: document.getElementById('btn-close-leaderboard'),

  // Intro / Title Screen & Menú Renovado
  viewTitle: document.getElementById('view-title'),
  btnStartGame: document.getElementById('btn-start-game'),
  btnTitleControls: document.getElementById('btn-title-controls'),
  btnTitleSound: document.getElementById('btn-title-sound'),
  btnTitleCredits: document.getElementById('btn-title-credits'),
  btnBackToTitle: document.getElementById('btn-back-to-title'),
  btnOpenHowToPlay: document.getElementById('btn-open-how-to-play'),
  modalControls: document.getElementById('modal-controls'),
  btnCloseControls: document.getElementById('btn-close-controls'),
  modalCredits: document.getElementById('modal-credits'),
  btnCloseCredits: document.getElementById('btn-close-credits'),
  lobbyUserName: document.getElementById('lobby-user-name'),
  lobbyAvatarImg: document.getElementById('lobby-avatar-img'),
  lobbySpecialistName: document.getElementById('lobby-specialist-name'),
  btnQuickEditName: document.getElementById('btn-quick-edit-name'),
  roomsCountHint: document.getElementById('rooms-count-hint'),
};

const ctx = elements.canvas.getContext('2d');
const touchResetters = [];

// --- Inicialización ---
export function init() {
  updateUserDisplay();
  updateSoundUI();
  setupNetwork();
  setupInputListeners();
  setupTouchControls();
  setupUIEvents();
  setupTitleScreen();
  setupCharacterSelection();
  setupBiomeSelection();
  setupClassSelection();
  setupAudioListeners();
  setupCanvasResize();
  setupFullscreenListeners();
  fetchRooms();

  // Gestión de vista inicial: Los runners automatizados (Playwright) van directo al lobby a menos que se solicite show_intro
  const forceIntro = window.location.search.includes('show_intro');
  const isAutomated = (Boolean(navigator.webdriver) && !forceIntro) || window.location.search.includes('no_intro');
  if (isAutomated) {
    showView('view-lobby');
  } else {
    showView('view-title');
  }

  // Iniciar bucle de renderizado desacoplado a 60 FPS
  requestAnimationFrame(gameLoop);

  // Ping periódico para medir latencia (<100ms)
  setInterval(sendPing, 1500);
}

function updateUserDisplay() {
  if (elements.userTag) elements.userTag.textContent = state.username;
  if (elements.lobbyUserName) elements.lobbyUserName.textContent = state.username;

  const char = CHARACTERS[state.selectedCharacter] || CHARACTERS.vanguard;
  if (elements.lobbySpecialistName) {
    elements.lobbySpecialistName.textContent = char.name;
    elements.lobbySpecialistName.style.color = char.color || 'var(--color-cyan)';
  }
  if (elements.lobbyAvatarImg) {
    const colorKey = COLOR_MAP[char.color?.toLowerCase()] || char.spriteColor || 'cyan';
    elements.lobbyAvatarImg.src = `/img/soldier_${colorKey}_front.png`;
    elements.lobbyAvatarImg.alt = char.name;
  }
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
      state.currentBiome = msg.biome || msg.map?.biome || 'cavern';
      mapCache = null;
      radarCacheCanvas = null;
      showView('view-room-waiting');
      elements.currentRoomId.textContent = `ID: ${msg.roomId}`;
      updateBiomeBadge(state.currentBiome);
      selectCharacter(state.selectedCharacter || 'vanguard');
      break;
    }

    case 'lobby_update': {
      if (msg.biome) {
        state.currentBiome = msg.biome;
        updateBiomeBadge(msg.biome);
      }
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
      if (state.isLeaderboardOpen && msg.players) {
        renderLeaderboard(msg.players);
      }
      break;
    }

    case 'left_room':
      break;

    case 'error': {
      if (elements.modalJoinPassword?.classList.contains('open')) {
        displayFormError(elements.joinPasswordError, msg.message, 'Error al ingresar a la sala');
      } else {
        alert(`[Error]: ${msg.message}`);
      }
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

  // Procesar eventos discretos de audio, partículas, trauma y feed
  if (Array.isArray(msg.events)) {
    for (const ev of msg.events) {
      processSnapshotEvent(ev);
    }
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
  document.body.classList.toggle('on-title-screen', viewId === 'view-title');
  resetInputs();

  if (viewId === 'view-game') {
    scheduleCanvasResize();
    enterFullscreen();
  } else {
    unlockOrientation();
  }
}

// --- Control de Pantalla Completa y Orientación (Móvil y Escritorio) ---
async function enterFullscreen() {
  try {
    const docEl = document.documentElement;
    if (!document.fullscreenElement && !document.webkitFullscreenElement) {
      if (docEl.requestFullscreen) {
        await docEl.requestFullscreen({ navigationUI: 'hide' });
      } else if (docEl.webkitRequestFullscreen) {
        await docEl.webkitRequestFullscreen();
      }
    }
  } catch {
    // Si las políticas de seguridad del navegador restringen fullscreen sin gesto, se captura limpiamente
  }
  lockToLandscape();
}

async function exitFullscreen() {
  try {
    if (document.fullscreenElement || document.webkitFullscreenElement) {
      if (document.exitFullscreen) {
        await document.exitFullscreen();
      } else if (document.webkitExitFullscreen) {
        await document.webkitExitFullscreen();
      }
    }
  } catch {
    // Ignorar errores al salir de pantalla completa
  }
  unlockOrientation();
}

async function toggleFullscreen() {
  if (document.fullscreenElement || document.webkitFullscreenElement) {
    await exitFullscreen();
  } else {
    await enterFullscreen();
  }
}

function setupFullscreenListeners() {
  const onFsChange = () => {
    const isFs = Boolean(document.fullscreenElement || document.webkitFullscreenElement);
    document.body.classList.toggle('is-fullscreen', isFs);
    if (elements.btnToggleFullscreen) {
      const icon = elements.btnToggleFullscreen.querySelector('.fs-icon');
      const label = elements.btnToggleFullscreen.querySelector('.fs-label');
      if (icon) icon.textContent = isFs ? '🗗' : '⛶';
      if (label) label.textContent = isFs ? 'Salir Pantalla Completa' : 'Pantalla Completa';
    }
    scheduleCanvasResize();
  };

  document.addEventListener('fullscreenchange', onFsChange);
  document.addEventListener('webkitfullscreenchange', onFsChange);
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
    if (e.key === 'Tab') {
      e.preventDefault();
      toggleLeaderboard(true);
      return;
    }
    const key = KEY_BY_CODE[e.code] || (Object.prototype.hasOwnProperty.call(state.keys, e.key) ? e.key : null);
    if (!key) return;
    state.keys[key] = true;
    if (key.startsWith('Arrow')) e.preventDefault();
  });

  window.addEventListener('keyup', (e) => {
    if (e.key === 'Tab') {
      e.preventDefault();
      toggleLeaderboard(false);
      return;
    }
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

  const mapW = state.map.width * (state.map.tileSize || TILE_SIZE);
  const mapH = state.map.height * (state.map.tileSize || TILE_SIZE);

  let camX = width / 2 - myPos.x;
  let camY = height / 2 - myPos.y;

  if (mapW > width) {
    camX = Math.min(0, Math.max(width - mapW, camX));
  } else {
    camX = (width - mapW) / 2;
  }

  if (mapH > height) {
    camY = Math.min(0, Math.max(height - mapH, camY));
  } else {
    camY = (height - mapH) / 2;
  }

  state.viewRect = {
    left: -camX,
    top: -camY,
    right: -camX + width,
    bottom: -camY + height,
  };

  // Cálculo de Screen Shake / Trauma de cámara desacoplado del HUD
  let shakeX = 0;
  let shakeY = 0;
  if (state.screenTrauma > 0) {
    state.screenTrauma = Math.max(0, state.screenTrauma - dt * 1.8);
    const mag = state.screenTrauma * state.screenTrauma * 14;
    shakeX = (Math.random() * 2 - 1) * mag;
    shakeY = (Math.random() * 2 - 1) * mag;
  }

  ctx.save();
  ctx.translate(camX + shakeX, camY + shakeY);

  // 1. Renderizar Mapa (cacheado)
  drawMap();

  // 2. Renderizar Elementos de Bioma / Entorno (Cristales, Reactores, Ventilaciones)
  drawEnvironmentDecorations(now);

  // 3. Renderizar Pickups
  if (state.currentSnapshot?.pickups) {
    drawPickups(state.currentSnapshot.pickups, now);
  }

  // 4. Renderizar Proyectiles
  if (state.currentSnapshot?.projectiles) {
    drawProjectiles(state.currentSnapshot.projectiles, renderTime);
  }

  // 5. Renderizar Partículas de Impactos y Chispas
  updateAndDrawParticles(dt);

  // 6. Renderizar Jugadores con Interpolación / Predicción
  if (state.currentSnapshot?.players) {
    drawPlayers(state.currentSnapshot.players, renderTime, dt);
  }

  // 7. Renderizar Daño y Textos Flotantes
  updateAndDrawFloatingTexts(dt);

  ctx.restore();

  // 8. Renderizar Radar / Minimapa Táctico en HUD
  renderRadar(now, myPos);
}

function isVisible(x, y, margin = 64) {
  const r = state.viewRect;
  if (!r) return true;
  return x >= r.left - margin && x <= r.right + margin && y >= r.top - margin && y <= r.bottom + margin;
}

function tileHash(x, y) {
  let h = (x * 374761393 + y * 668265263) ^ 0x5bf03635;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return (h ^ (h >>> 16)) >>> 0;
}

function buildMapCache() {
  if (!state.map) return;

  const dpr = state.viewport.dpr || 1;
  const biome = state.map.biome || 'cavern';
  if (mapCache && mapCache.dpr === dpr && mapCache.biome === biome) return;

  const ts = state.map.tileSize || TILE_SIZE;
  const width = state.map.width * ts;
  const height = state.map.height * ts;

  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width * dpr));
  canvas.height = Math.max(1, Math.round(height * dpr));
  const c = canvas.getContext('2d');
  c.setTransform(dpr, 0, 0, dpr, 0, 0);

  const map = state.map;
  const mw = map.width;
  const mh = map.height;

  // 1. Paletas de Fondo, Suelo, Rejilla Neón y Muros según el Bioma
  let bgFill = '#06080e';
  let floorShades = ['#080c14', '#090e17', '#0a101a', '#0c121e'];
  let gridStroke = 'rgba(0, 240, 255, 0.36)';
  let gridNode = 'rgba(0, 240, 255, 0.75)';
  let wallBase = '#111722';
  let wallBlock1 = '#1a2433';
  let wallBlock2 = '#243246';
  let cliffStart = '#263447';
  let cliffMid = '#1b2432';
  let cliffEnd = '#0e141d';
  let cliffEdge = '#3a4b63';
  let cliffHighlight = '#576f8e';

  if (biome === 'lab') {
    bgFill = '#050711';
    floorShades = ['#070b16', '#090f1e', '#0c1428', '#0e182f'];
    gridStroke = 'rgba(138, 123, 255, 0.35)';
    gridNode = 'rgba(255, 43, 214, 0.8)';
    wallBase = '#101322';
    wallBlock1 = '#191e34';
    wallBlock2 = '#232a48';
    cliffStart = '#222a40';
    cliffMid = '#171c2e';
    cliffEnd = '#0f1322';
    cliffEdge = '#4d597a';
    cliffHighlight = '#7083b0';
  } else if (biome === 'ruins') {
    bgFill = '#0a0404';
    floorShades = ['#110808', '#170b0b', '#1d0e0e', '#231111'];
    gridStroke = 'rgba(255, 90, 40, 0.38)';
    gridNode = 'rgba(255, 176, 32, 0.85)';
    wallBase = '#1a0b0b';
    wallBlock1 = '#261111';
    wallBlock2 = '#381919';
    cliffStart = '#2e1515';
    cliffMid = '#200e0e';
    cliffEnd = '#140808';
    cliffEdge = '#522525';
    cliffHighlight = '#7d3838';
  }

  // Fondo del bioma
  c.fillStyle = bgFill;
  c.fillRect(0, 0, width, height);

  // 2. Renderizar Suelos (Floor) y Rejilla Neón CyberGrid
  for (let y = 0; y < mh; y++) {
    for (let x = 0; x < mw; x++) {
      const tile = map.tiles[y * mw + x];
      if (tile !== TILE.FLOOR) continue;

      const px = x * ts;
      const py = y * ts;
      const h = tileHash(x, y);

      // Variación sutil de baldosas según el bioma
      c.fillStyle = floorShades[h % floorShades.length];
      c.fillRect(px, py, ts, ts);

      // Textura rocosa / granular o patrones de circuito
      if (h % 3 === 0) {
        c.fillStyle = biome === 'lab' ? '#17203b' : biome === 'ruins' ? '#2c1212' : '#121a28';
        const gx = px + (h % 20) + 4;
        const gy = py + ((h >> 4) % 20) + 4;
        c.fillRect(gx, gy, 2, 2);
        if (h % 5 === 0) c.fillRect(gx + 2, gy + 1, 1, 2);
      }

      // Rejilla Neón CyberGrid
      c.strokeStyle = gridStroke;
      c.lineWidth = 1;
      c.beginPath();
      c.moveTo(px + 0.5, py + 0.5);
      c.lineTo(px + ts + 0.5, py + 0.5);
      c.moveTo(px + 0.5, py + 0.5);
      c.lineTo(px + 0.5, py + ts + 0.5);
      c.stroke();

      // Nodos brillantes en intersecciones
      c.fillStyle = gridNode;
      c.fillRect(px - 1, py - 1, 2, 2);

      // Sombras arrojadas por acantilados y muros
      const wallAbove = isWallTile(map, x, y - 1);
      const wallLeft = isWallTile(map, x - 1, y);
      const wallRight = isWallTile(map, x + 1, y);

      if (wallAbove) {
        const topShadow = c.createLinearGradient(px, py, px, py + 14);
        topShadow.addColorStop(0, 'rgba(0, 0, 0, 0.65)');
        topShadow.addColorStop(1, 'rgba(0, 0, 0, 0)');
        c.fillStyle = topShadow;
        c.fillRect(px, py, ts, 14);
      }
      if (wallLeft) {
        const leftShadow = c.createLinearGradient(px, py, px + 8, py);
        leftShadow.addColorStop(0, 'rgba(0, 0, 0, 0.45)');
        leftShadow.addColorStop(1, 'rgba(0, 0, 0, 0)');
        c.fillStyle = leftShadow;
        c.fillRect(px, py, 8, ts);
      }
      if (wallRight) {
        const rightShadow = c.createLinearGradient(px + ts - 8, py, px + ts, py);
        rightShadow.addColorStop(0, 'rgba(0, 0, 0, 0)');
        rightShadow.addColorStop(1, 'rgba(0, 0, 0, 0.45)');
        c.fillStyle = rightShadow;
        c.fillRect(px + ts - 8, py, 8, ts);
      }
    }
  }

  // 3. Renderizar Muros Orgánicos, Aleaciones y Acantilados
  for (let y = 0; y < mh; y++) {
    for (let x = 0; x < mw; x++) {
      const tile = map.tiles[y * mw + x];
      if (tile !== TILE.WALL) continue;

      const px = x * ts;
      const py = y * ts;
      const h = tileHash(x, y);

      const top = isWallTile(map, x, y - 1);
      const bottom = isWallTile(map, x, y + 1);
      const left = isWallTile(map, x - 1, y);
      const right = isWallTile(map, x + 1, y);

      const isCliffFace = !bottom;
      const isBackEdge = !top;
      const isLeftEdge = !left;
      const isRightEdge = !right;
      const isInterior = top && bottom && left && right;

      // Base del bloque de muro
      c.fillStyle = wallBase;
      c.fillRect(px, py, ts, ts);

      if (isInterior) {
        const b1x = px + ((h % 8) + 2);
        const b1y = py + (((h >> 3) % 8) + 2);
        const b1w = 14 + (h % 8);
        const b1h = 12 + ((h >> 2) % 6);

        c.fillStyle = wallBlock1;
        c.beginPath();
        c.roundRect(b1x, b1y, b1w, b1h, 4);
        c.fill();

        c.fillStyle = wallBlock2;
        c.beginPath();
        c.roundRect(b1x + 1, b1y + 1, b1w - 2, 3, 2);
        c.fill();
      } else {
        c.fillStyle = wallBlock1;
        c.fillRect(px, py, ts, ts);

        c.fillStyle = wallBlock2;
        c.beginPath();
        c.roundRect(px + 4, py + 4, ts - 8, ts - 8, 4);
        c.fill();
      }

      if (isCliffFace) {
        c.fillStyle = cliffEdge;
        c.beginPath();
        c.arc(px + 8, py + 6, 8, Math.PI, 0);
        c.arc(px + 24, py + 6, 8, Math.PI, 0);
        c.fill();

        c.fillStyle = cliffHighlight;
        c.beginPath();
        c.arc(px + 8, py + 4, 7, Math.PI, Math.PI * 1.6);
        c.arc(px + 24, py + 4, 7, Math.PI, Math.PI * 1.6);
        c.stroke();

        const cliffGrad = c.createLinearGradient(px, py + 8, px, py + ts);
        cliffGrad.addColorStop(0, cliffStart);
        cliffGrad.addColorStop(0.4, cliffMid);
        cliffGrad.addColorStop(1, cliffEnd);
        c.fillStyle = cliffGrad;
        c.fillRect(px, py + 8, ts, ts - 8);

        // Fisuras en acantilados
        c.strokeStyle = biome === 'ruins' ? '#ff4a1c' : biome === 'lab' ? '#00f0ff' : '#32445c';
        c.lineWidth = 1;
        c.beginPath();
        c.moveTo(px + 7, py + 8);
        c.lineTo(px + 6, py + ts - 2);
        if (biome !== 'lab') {
          c.moveTo(px + 23, py + 9);
          c.lineTo(px + 25, py + ts - 2);
        }
        c.stroke();

        // Labio rocoso inferior
        c.fillStyle = '#05070a';
        c.fillRect(px, py + ts - 2, ts, 2);
      }

      if (isBackEdge) {
        c.fillStyle = cliffEdge;
        c.beginPath();
        c.arc(px + 8, py + 4, 7, 0, Math.PI);
        c.arc(px + 24, py + 4, 7, 0, Math.PI);
        c.fill();

        c.fillStyle = cliffHighlight;
        c.fillRect(px, py, ts, 2);
      }

      if (isLeftEdge) {
        c.fillStyle = '#0a0e14';
        c.fillRect(px, py, 3, ts);
      }

      if (isRightEdge) {
        c.fillStyle = cliffEdge;
        c.fillRect(px + ts - 3, py, 3, ts);
      }

      // Detalles específicos de cada bioma en los muros
      if ((isCliffFace || isLeftEdge || isRightEdge) && h % 2 === 0) {
        if (biome === 'cavern') {
          // Musgo bio-luminiscente verde
          c.fillStyle = '#275238';
          const mx = px + (h % 18) + 4;
          const my = py + ((h >> 3) % 14) + 6;
          c.beginPath();
          c.arc(mx, my, 4, 0, Math.PI * 2);
          c.arc(mx + 3, my + 3, 3, 0, Math.PI * 2);
          c.fill();
          c.fillStyle = '#42875b';
          c.fillRect(mx - 1, my - 1, 2, 2);
        } else if (biome === 'lab') {
          // Líneas de circuitos cian y bandas de advertencia
          c.fillStyle = h % 4 === 0 ? '#ffb020' : '#00f0ff';
          const lx = px + (h % 22) + 2;
          const ly = py + ((h >> 2) % 18) + 4;
          c.fillRect(lx, ly, 6, 2);
        } else if (biome === 'ruins') {
          // Grietas de magma incandescente
          c.fillStyle = 'rgba(255, 74, 28, 0.75)';
          const rx = px + (h % 20) + 4;
          const ry = py + ((h >> 3) % 16) + 5;
          c.fillRect(rx, ry, 3, 3);
          c.fillStyle = '#ffe234';
          c.fillRect(rx + 1, ry + 1, 1, 1);
        }
      }
    }
  }

  // 4. Renderizar Base Estática de Entorno según Bioma
  if (biome === 'cavern' && map.crystals) {
    for (const cr of map.crystals) renderCrystalStaticBase(c, cr);
  } else if (biome === 'lab' && map.labCores) {
    for (const core of map.labCores) renderLabCoreStaticBase(c, core);
  } else if (biome === 'ruins' && map.ruinsVents) {
    for (const vent of map.ruinsVents) renderRuinsVentStaticBase(c, vent);
  }

  // 5. Pre-renderizar Caché de Radar Táctico (120x120)
  buildRadarCache(map, biome);

  mapCache = { canvas, dpr, width, height, biome };
}

function buildRadarCache(map, biome) {
  const radarCanvas = document.createElement('canvas');
  radarCanvas.width = 120;
  radarCanvas.height = 120;
  const rc = radarCanvas.getContext('2d');

  rc.clearRect(0, 0, 120, 120);

  const mw = map.width;
  const mh = map.height;
  const scale = 120 / Math.max(mw, mh);

  // Paleta de muros en minimapa según bioma
  let wallColor = 'rgba(72, 255, 138, 0.45)';
  if (biome === 'lab') wallColor = 'rgba(138, 123, 255, 0.5)';
  if (biome === 'ruins') wallColor = 'rgba(255, 90, 40, 0.55)';

  rc.fillStyle = wallColor;
  for (let y = 0; y < mh; y++) {
    for (let x = 0; x < mw; x++) {
      if (map.tiles[y * mw + x] === TILE.WALL) {
        rc.fillRect(x * scale, y * scale, Math.ceil(scale), Math.ceil(scale));
      }
    }
  }

  radarCacheCanvas = radarCanvas;
  radarCacheBiome = biome;
}

function renderCrystalStaticBase(c, cr) {
  const s = cr.scale || 1;
  c.save();
  c.translate(cr.x, cr.y);

  c.fillStyle = '#0f1520';
  c.beginPath();
  c.ellipse(0, 4, 12 * s, 6 * s, 0, 0, Math.PI * 2);
  c.fill();

  const spikes = [
    { dx: -7 * s, dy: 2, w: 6 * s, h: 16 * s, tilt: -0.28 },
    { dx: 7 * s, dy: 2, w: 6 * s, h: 17 * s, tilt: 0.28 },
    { dx: 0, dy: 0, w: 8 * s, h: 24 * s, tilt: 0.02 },
  ];

  for (const sp of spikes) {
    c.save();
    c.translate(sp.dx, sp.dy);
    c.rotate(sp.tilt);

    c.fillStyle = '#1e7840';
    c.beginPath();
    c.moveTo(0, -sp.h);
    c.lineTo(-sp.w / 2, 0);
    c.lineTo(0, 2);
    c.closePath();
    c.fill();

    c.fillStyle = '#48ff8a';
    c.beginPath();
    c.moveTo(0, -sp.h);
    c.lineTo(0, 2);
    c.lineTo(sp.w / 2, 0);
    c.closePath();
    c.fill();

    c.fillStyle = '#b6ff3b';
    c.beginPath();
    c.moveTo(0, -sp.h);
    c.lineTo(1.5, -sp.h * 0.4);
    c.lineTo(0, 2);
    c.lineTo(-1.5, -sp.h * 0.4);
    c.closePath();
    c.fill();

    c.fillStyle = '#ffffff';
    c.fillRect(-1, -sp.h, 2, 4);
    c.restore();
  }
  c.restore();
}

function renderLabCoreStaticBase(c, core) {
  const s = core.scale || 1;
  c.save();
  c.translate(core.x, core.y);

  // Anillo de aleación industrial exterior
  c.fillStyle = '#141829';
  c.strokeStyle = '#323c66';
  c.lineWidth = 2;
  c.beginPath();
  c.arc(0, 0, 18 * s, 0, Math.PI * 2);
  c.fill();
  c.stroke();

  // Pernos de titanio en el perímetro
  c.fillStyle = '#8a7bff';
  for (let i = 0; i < 6; i++) {
    const a = (i * Math.PI) / 3;
    c.fillRect(Math.cos(a) * 14 * s - 1.5, Math.sin(a) * 14 * s - 1.5, 3, 3);
  }

  // Cámara interior de plasma
  c.fillStyle = '#0a0d17';
  c.beginPath();
  c.arc(0, 0, 10 * s, 0, Math.PI * 2);
  c.fill();

  c.restore();
}

function renderRuinsVentStaticBase(c, vent) {
  const s = vent.scale || 1;
  c.save();
  c.translate(vent.x, vent.y);

  // Caldera volcánica de basalto
  c.fillStyle = '#1b0c0c';
  c.strokeStyle = '#421a1a';
  c.lineWidth = 2.5;
  c.beginPath();
  c.ellipse(0, 2, 17 * s, 11 * s, 0, 0, Math.PI * 2);
  c.fill();
  c.stroke();

  // Cráter interno de magma
  c.fillStyle = '#61160d';
  c.beginPath();
  c.ellipse(0, 2, 11 * s, 6.5 * s, 0, 0, Math.PI * 2);
  c.fill();

  c.restore();
}

function drawCrystals(now) {
  if (!state.map?.crystals) return;

  for (const cr of state.map.crystals) {
    if (!isVisible(cr.x, cr.y, 64)) continue;

    const pulse = Math.sin(now * 0.003 + cr.phase) * 0.18 + 0.82;
    const radius = 42 * cr.scale * pulse;

    const glow = ctx.createRadialGradient(cr.x, cr.y - 8, 2, cr.x, cr.y - 8, radius);
    glow.addColorStop(0, 'rgba(72, 255, 138, 0.42)');
    glow.addColorStop(0.35, 'rgba(182, 255, 59, 0.18)');
    glow.addColorStop(1, 'rgba(72, 255, 138, 0)');

    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(cr.x, cr.y - 8, radius, 0, Math.PI * 2);
    ctx.fill();

    for (let i = 0; i < 3; i++) {
      const angle = (now * 0.0015 + i * 2.1 + cr.phase) % (Math.PI * 2);
      const dist = 14 + Math.sin(now * 0.002 + i) * 6;
      const px = cr.x + Math.cos(angle) * dist;
      const py = cr.y - 12 + Math.sin(angle) * (dist * 0.6);

      const sparkleAlpha = (Math.sin(now * 0.006 + i * 1.5) + 1) * 0.45;
      ctx.fillStyle = `rgba(182, 255, 59, ${sparkleAlpha})`;
      ctx.shadowColor = '#b6ff3b';
      ctx.shadowBlur = 6;
      ctx.fillRect(px - 1, py - 1, 2, 2);
      ctx.shadowBlur = 0;
    }
  }
}

function drawLabCores(now) {
  if (!state.map?.labCores) return;

  for (const core of state.map.labCores) {
    if (!isVisible(core.x, core.y, 64)) continue;

    const pulse = Math.sin(now * 0.004 + core.phase) * 0.2 + 0.8;
    const radius = 46 * core.scale * pulse;

    const glow = ctx.createRadialGradient(core.x, core.y, 2, core.x, core.y, radius);
    glow.addColorStop(0, 'rgba(255, 43, 214, 0.45)');
    glow.addColorStop(0.4, 'rgba(138, 123, 255, 0.2)');
    glow.addColorStop(1, 'rgba(138, 123, 255, 0)');

    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(core.x, core.y, radius, 0, Math.PI * 2);
    ctx.fill();

    // Núcleo brillante giratorio de plasma
    ctx.save();
    ctx.translate(core.x, core.y);
    ctx.rotate(now * 0.002 + core.phase);

    ctx.fillStyle = '#ff2bd6';
    ctx.shadowColor = '#ff2bd6';
    ctx.shadowBlur = 10;
    ctx.beginPath();
    ctx.arc(0, 0, 7 * core.scale * pulse, 0, Math.PI * 2);
    ctx.fill();

    // Arcos de energía violeta
    ctx.strokeStyle = '#00f0ff';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(0, 0, 12 * core.scale, 0, Math.PI * 1.2);
    ctx.stroke();

    ctx.restore();
  }
}

function drawRuinsVents(now) {
  if (!state.map?.ruinsVents) return;

  for (const vent of state.map.ruinsVents) {
    if (!isVisible(vent.x, vent.y, 64)) continue;

    const pulse = Math.sin(now * 0.0035 + vent.phase) * 0.22 + 0.78;
    const radius = 44 * vent.scale * pulse;

    const glow = ctx.createRadialGradient(vent.x, vent.y, 2, vent.x, vent.y, radius);
    glow.addColorStop(0, 'rgba(255, 74, 28, 0.55)');
    glow.addColorStop(0.45, 'rgba(255, 176, 32, 0.2)');
    glow.addColorStop(1, 'rgba(255, 74, 28, 0)');

    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(vent.x, vent.y, radius, 0, Math.PI * 2);
    ctx.fill();

    // Chispas y ascuas de magma ascendentes
    for (let i = 0; i < 4; i++) {
      const emberT = (now * 0.0018 + i * 0.28 + vent.phase) % 1;
      const ex = vent.x + Math.sin(now * 0.003 + i * 2) * (10 * vent.scale);
      const ey = vent.y - emberT * 32 * vent.scale;
      const alpha = (1 - emberT) * 0.85;

      ctx.fillStyle = `rgba(255, 226, 52, ${alpha})`;
      ctx.shadowColor = '#ff5a5a';
      ctx.shadowBlur = 6;
      ctx.fillRect(ex - 1.5, ey - 1.5, 3, 3);
      ctx.shadowBlur = 0;
    }
  }
}

function drawEnvironmentDecorations(now) {
  const biome = state.map?.biome || 'cavern';
  if (biome === 'cavern') {
    drawCrystals(now);
  } else if (biome === 'lab') {
    drawLabCores(now);
  } else if (biome === 'ruins') {
    drawRuinsVents(now);
  }
}

function renderRadar(now, myPos) {
  if (!elements.radarCanvas || !state.map) return;
  const rc = elements.radarCanvas.getContext('2d');
  if (!rc) return;

  const rw = 120;
  const rh = 120;
  rc.clearRect(0, 0, rw, rh);

  // 1. Fondo de radar cibernético
  rc.fillStyle = 'rgba(5, 10, 20, 0.92)';
  rc.fillRect(0, 0, rw, rh);

  // 2. Dibujar silueta estática de muros
  if (radarCacheCanvas) {
    rc.drawImage(radarCacheCanvas, 0, 0, rw, rh);
  }

  const mw = state.map.width;
  const mh = state.map.height;
  const ts = state.map.tileSize || TILE_SIZE;
  const mapW = mw * ts;
  const mapH = mh * ts;
  const scaleX = rw / mapW;
  const scaleY = rh / mapH;

  // 3. Anillos de alcance y retícula
  rc.strokeStyle = 'rgba(0, 240, 255, 0.2)';
  rc.lineWidth = 1;
  rc.beginPath();
  rc.arc(rw / 2, rh / 2, 26, 0, Math.PI * 2);
  rc.arc(rw / 2, rh / 2, 52, 0, Math.PI * 2);
  rc.moveTo(rw / 2, 0);
  rc.lineTo(rw / 2, rh);
  rc.moveTo(0, rh / 2);
  rc.lineTo(rw, rh / 2);
  rc.stroke();

  // 4. Haz giratorio del barrido de radar
  const sweepAngle = (now * 0.0022) % (Math.PI * 2);
  rc.save();
  rc.translate(rw / 2, rh / 2);
  rc.rotate(sweepAngle);

  const sweepGrad = rc.createRadialGradient(0, 0, 0, 0, 0, rw / 2);
  sweepGrad.addColorStop(0, 'rgba(0, 240, 255, 0.4)');
  sweepGrad.addColorStop(1, 'rgba(0, 240, 255, 0)');
  rc.fillStyle = sweepGrad;
  rc.beginPath();
  rc.moveTo(0, 0);
  rc.arc(0, 0, rw / 2, -0.4, 0);
  rc.closePath();
  rc.fill();

  rc.strokeStyle = '#00f0ff';
  rc.lineWidth = 1.2;
  rc.beginPath();
  rc.moveTo(0, 0);
  rc.lineTo(rw / 2, 0);
  rc.stroke();
  rc.restore();

  // 5. Blips de pickups en el radar
  if (state.currentSnapshot?.pickups) {
    for (const item of state.currentSnapshot.pickups) {
      const rx = item.x * scaleX;
      const ry = item.y * scaleY;
      rc.fillStyle = item.kind === 'shard' ? '#00f0ff' : '#48ff8a';
      rc.fillRect(rx - 1.5, ry - 1.5, 3, 3);
    }
  }

  // 6. Blips de otros jugadores
  if (state.currentSnapshot?.players) {
    for (const p of state.currentSnapshot.players) {
      if (p.id === state.myPlayerId || p.dead) continue;
      const rx = p.x * scaleX;
      const ry = p.y * scaleY;
      rc.fillStyle = '#ff4343';
      rc.beginPath();
      rc.arc(rx, ry, 2.5, 0, Math.PI * 2);
      rc.fill();
    }
  }

  // 7. Blip del Jugador Local con cono de orientación
  if (myPos) {
    const mx = myPos.x * scaleX;
    const my = myPos.y * scaleY;

    rc.save();
    rc.translate(mx, my);

    // Cono de visión / puntería
    rc.fillStyle = 'rgba(0, 240, 255, 0.35)';
    rc.beginPath();
    rc.moveTo(0, 0);
    rc.arc(0, 0, 10, state.aimAngle - 0.45, state.aimAngle + 0.45);
    rc.closePath();
    rc.fill();

    // Punto del operador
    rc.fillStyle = '#00f0ff';
    rc.shadowColor = '#00f0ff';
    rc.shadowBlur = 6;
    rc.beginPath();
    rc.arc(0, 0, 3.5, 0, Math.PI * 2);
    rc.fill();
    rc.shadowBlur = 0;

    rc.restore();
  }
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

    const bob = Math.sin(now * 0.005 + item.id * 1.8) * 3.5;
    const pulse = Math.sin(now * 0.008 + item.id) * 0.15 + 0.85;

    if (item.kind === 'shard') {
      // 1. Sombra cian en el suelo bajo el cristal flotante
      ctx.beginPath();
      ctx.ellipse(0, 12, 10 * pulse, 4.5 * pulse, 0, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(0, 240, 255, 0.32)';
      ctx.shadowColor = '#00f0ff';
      ctx.shadowBlur = 10;
      ctx.fill();
      ctx.shadowBlur = 0;

      // 2. Halo de resplandor del cristal
      const glow = ctx.createRadialGradient(0, bob, 1, 0, bob, 22 * pulse);
      glow.addColorStop(0, 'rgba(0, 240, 255, 0.45)');
      glow.addColorStop(1, 'rgba(0, 240, 255, 0)');
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(0, bob, 22 * pulse, 0, Math.PI * 2);
      ctx.fill();

      // 3. Cristal de Diamante Cian Facetado (como en la imagen de referencia)
      ctx.save();
      ctx.translate(0, bob);

      // Faceta superior izquierda
      ctx.fillStyle = '#9cf9ff';
      ctx.beginPath();
      ctx.moveTo(0, -14);
      ctx.lineTo(-8, -2);
      ctx.lineTo(0, 0);
      ctx.closePath();
      ctx.fill();

      // Faceta superior derecha
      ctx.fillStyle = '#45e9ff';
      ctx.beginPath();
      ctx.moveTo(0, -14);
      ctx.lineTo(0, 0);
      ctx.lineTo(8, -2);
      ctx.closePath();
      ctx.fill();

      // Faceta inferior izquierda
      ctx.fillStyle = '#00b7d8';
      ctx.beginPath();
      ctx.moveTo(-8, -2);
      ctx.lineTo(0, 12);
      ctx.lineTo(0, 0);
      ctx.closePath();
      ctx.fill();

      // Faceta inferior derecha
      ctx.fillStyle = '#008ba8';
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(0, 12);
      ctx.lineTo(8, -2);
      ctx.closePath();
      ctx.fill();

      // Resalte central y destello brillante
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, -14);
      ctx.lineTo(0, 12);
      ctx.stroke();

      ctx.fillStyle = '#ffffff';
      ctx.fillRect(-1, -4, 2, 4);

      ctx.restore();
    } else {
      // Medkit: Maletín médico de salud (Pixel Art) con sombra y flotación sutil
      ctx.beginPath();
      ctx.ellipse(0, 11, 10, 4, 0, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255, 67, 67, 0.3)';
      ctx.fill();

      ctx.save();
      ctx.translate(0, bob);
      ctx.shadowColor = '#ff4343';
      ctx.shadowBlur = 10;

      if (medkitSprite.complete && medkitSprite.naturalWidth > 0) {
        const mw = 26;
        const mh = 26;
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(medkitSprite, -mw / 2, -mh / 2, mw, mh);
        ctx.imageSmoothingEnabled = true;
      } else {
        // Respaldo vectorial en caso de carga pendiente
        ctx.fillStyle = '#1a0d0d';
        ctx.strokeStyle = '#ff4343';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.roundRect(-10, -9, 20, 18, 4);
        ctx.fill();
        ctx.stroke();

        ctx.fillStyle = '#ffffff';
        ctx.fillRect(-2.5, -6, 5, 12);
        ctx.fillRect(-6, -2.5, 12, 5);
      }
      ctx.restore();
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

    // Obtener sprite correspondiente al color y dirección del operador con ciclo multi-frame
    const colorKey = COLOR_MAP[p.color?.toLowerCase()] || 'cyan';
    const spriteSet = operatorSprites[colorKey] || operatorSprites['cyan'];
    let sprite = null;

    if (spriteSet) {
      if (isMoving) {
        if (dir === 'right' || dir === 'left') {
          // Ciclo de carrera de 4 fotogramas sincronizado a ~11 FPS
          const frameIdx = Math.floor((orient.walkTime * 11) % 4);
          const list = spriteSet[dir] || [];
          sprite = list[frameIdx] || list[0];
        } else if (dir === 'front') {
          // Ciclo de marcha frontal de 2 fotogramas
          const frameIdx = Math.floor((orient.walkTime * 8) % 2);
          const list = spriteSet.front || [];
          sprite = list[frameIdx] || list[0];
        } else {
          // Ciclo de marcha de espaldas de 2 fotogramas
          const frameIdx = Math.floor((orient.walkTime * 8) % 2);
          const list = spriteSet.back || [];
          sprite = list[frameIdx] || list[0];
        }
      } else {
        // En reposo (idle): postura base limpia
        const dirList = spriteSet[dir];
        sprite = Array.isArray(dirList) ? dirList[0] : dirList;
      }
    }

    const glowColor = p.color || '#00f0ff';

    // Fluidez de movimiento: respiración idle sutil y balanceo en carrera
    const idleBreathe = !isMoving ? Math.sin((renderTime + (p.id ? p.id.charCodeAt(0) * 120 : 0)) * 0.004) * 0.9 : 0;
    const walkBob = isMoving ? Math.sin(orient.walkTime * 15) * 1.6 : 0;
    const bob = walkBob + idleBreathe;
    const tilt = isMoving ? Math.max(-0.09, Math.min(0.09, (dx / (Math.abs(dy) + 0.1)) * 0.06)) : 0;

    // Estela de partículas de fluidez de movimiento al desplazarse
    if (isMoving && Math.random() < 0.28) {
      state.particles.push({
        x: pos.x + (Math.random() - 0.5) * 8,
        y: pos.y + 10 + (Math.random() - 0.5) * 3,
        vx: -dx * 6 + (Math.random() - 0.5) * 8,
        vy: -dy * 6 - Math.random() * 6,
        color: glowColor,
        size: Math.random() * 2.2 + 1.2,
        life: 0.26,
        maxLife: 0.26,
      });
    }

    ctx.save();
    ctx.translate(pos.x, pos.y);

    if (p.dead) {
      ctx.globalAlpha = 0.3;
    }

    // Halo / sombra de energía en el suelo con el color característico del operador
    ctx.beginPath();
    ctx.ellipse(0, 12, 16, 7, 0, 0, Math.PI * 2);
    ctx.fillStyle = glowColor;
    ctx.globalAlpha = p.dead ? 0.15 : 0.35;
    ctx.shadowColor = glowColor;
    ctx.shadowBlur = state.isTouch ? 8 : 12;
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.globalAlpha = p.dead ? 0.3 : 1.0;

    // Dibujar sprite del operador centrado en los pies con alta resolución
    if (sprite && sprite.complete && sprite.naturalWidth > 0) {
      ctx.save();
      ctx.rotate(tilt);
      const spriteW = 34;
      const spriteH = 46;
      ctx.drawImage(sprite, -spriteW / 2, -32 + bob, spriteW, spriteH);
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
function setupTitleScreen() {
  function startFromTitle() {
    playSfx('start_game');
    showView('view-lobby');
    fetchRooms();
  }

  // Botón Start Arcade
  elements.btnStartGame?.addEventListener('click', () => {
    startFromTitle();
  });

  // Presionar Enter o Barra espaciadora en la pantalla de inicio
  window.addEventListener('keydown', (e) => {
    if (elements.viewTitle?.classList.contains('active')) {
      if (e.key === 'Enter' || e.code === 'Space') {
        e.preventDefault();
        startFromTitle();
      }
    }
  });

  // Regresar al título desde el lobby
  elements.btnBackToTitle?.addEventListener('click', () => {
    playSfx('menu_click');
    showView('view-title');
  });

  // Modal de Controles / Guía
  elements.btnTitleControls?.addEventListener('click', () => {
    playSfx('menu_click');
    elements.modalControls?.classList.add('open');
  });
  elements.btnOpenHowToPlay?.addEventListener('click', () => {
    playSfx('menu_click');
    elements.modalControls?.classList.add('open');
  });
  elements.btnCloseControls?.addEventListener('click', () => {
    elements.modalControls?.classList.remove('open');
  });

  // Modal de Créditos
  elements.btnTitleCredits?.addEventListener('click', () => {
    playSfx('menu_click');
    elements.modalCredits?.classList.add('open');
  });
  elements.btnCloseCredits?.addEventListener('click', () => {
    elements.modalCredits?.classList.remove('open');
  });

  // Botón de sonido en el título
  elements.btnTitleSound?.addEventListener('click', () => {
    toggleSound();
  });

  // Edición rápida de nombre de operador desde el lobby
  elements.btnQuickEditName?.addEventListener('click', () => {
    playSfx('menu_click');
    elements.authErrorMsg.style.display = 'none';
    elements.modalAuth?.classList.add('open');
  });
}

// Formateador universal de errores para modales (evita JSON crudo de Zod/APIs)
function displayFormError(container, errorSource, fallback = 'Ha ocurrido un error') {
  if (!container) return;
  let formattedText = '';

  if (Array.isArray(errorSource)) {
    formattedText = errorSource
      .map((e) => (typeof e === 'object' && e !== null ? e.message || JSON.stringify(e) : String(e)))
      .filter(Boolean)
      .join('\n');
  } else if (typeof errorSource === 'object' && errorSource !== null) {
    if (Array.isArray(errorSource.errors) && errorSource.errors.length > 0) {
      formattedText = errorSource.errors
        .map((e) => (typeof e === 'object' && e !== null ? e.message || JSON.stringify(e) : String(e)))
        .filter(Boolean)
        .join('\n');
    } else if (errorSource.message) {
      formattedText = String(errorSource.message);
    }
  } else if (typeof errorSource === 'string') {
    formattedText = errorSource;
  }

  // Si formattedText contiene JSON crudo (ej: "[ { \"origin\": \"string\", ... } ]")
  if (
    typeof formattedText === 'string' &&
    (formattedText.trim().startsWith('[') || formattedText.trim().startsWith('{'))
  ) {
    try {
      const parsed = JSON.parse(formattedText);
      if (Array.isArray(parsed)) {
        formattedText = parsed
          .map((item) =>
            typeof item === 'object' && item !== null ? item.message || JSON.stringify(item) : String(item)
          )
          .filter(Boolean)
          .join('\n');
      } else if (parsed?.message) {
        formattedText = String(parsed.message);
      }
    } catch {
      // Dejar la cadena original si no es JSON válido
    }
  }

  if (!formattedText || formattedText.trim() === '') {
    formattedText = fallback;
  }

  const lines = formattedText
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

  if (lines.length > 1) {
    container.innerHTML = `<ul class="form-error-list">${lines.map((l) => `<li>${escapeHtml(l)}</li>`).join('')}</ul>`;
  } else {
    container.textContent = lines[0] || fallback;
  }

  container.style.display = 'block';
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function setupUIEvents() {
  // Autenticación
  elements.btnShowAuth.addEventListener('click', () => {
    elements.authErrorMsg.style.display = 'none';
    elements.authErrorMsg.innerHTML = '';
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
      if (!res.ok) throw data;

      state.token = data.session.token;
      state.username = data.session.username;
      localStorage.setItem('cyber_token', state.token);
      localStorage.setItem('cyber_user', state.username);
      updateUserDisplay();
      elements.modalAuth.classList.remove('open');
    } catch (err) {
      displayFormError(elements.authErrorMsg, err, 'Error de autenticación');
    }
  });

  // Crear Sala
  elements.btnCreateRoomModal.addEventListener('click', () => {
    elements.createRoomError.style.display = 'none';
    elements.createRoomError.innerHTML = '';
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
    const biome = elements.inputRoomBiome?.value || 'cavern';

    try {
      const headers = { 'Content-Type': 'application/json' };
      if (state.token) headers['Authorization'] = `Bearer ${state.token}`;

      const res = await fetch('/api/rooms', {
        method: 'POST',
        headers,
        body: JSON.stringify({ name, isPrivate, password, maxPlayers, biome }),
      });
      const data = await res.json();
      if (!res.ok) throw data;

      elements.modalCreateRoom.classList.remove('open');
      joinRoom(data.room.id, isPrivate ? password : null);
    } catch (err) {
      displayFormError(elements.createRoomError, err, 'Error al crear la sala');
    }
  });

  // Lista y Entrada a Salas
  elements.btnRefreshRooms.addEventListener('click', fetchRooms);
  elements.btnQuickJoin.addEventListener('click', () => joinRoom('room-1'));

  // Sala de Espera
  elements.btnLeaveRoom.addEventListener('click', leaveCurrentRoom);
  elements.btnRoomFullscreen?.addEventListener('click', enterFullscreen);

  elements.btnToggleReady.addEventListener('click', () => {
    if (!state.socket || state.socket.readyState !== WebSocket.OPEN) return;
    const nextState = !state.isReady;
    if (nextState) {
      enterFullscreen();
    }
    state.socket.send(JSON.stringify({ type: 'set_ready', ready: nextState }));
  });

  elements.btnExitMatch.addEventListener('click', leaveCurrentRoom);
  elements.btnToggleFullscreen?.addEventListener('click', toggleFullscreen);

  // Botón y tap de rotación / Pantalla Completa
  elements.btnRotateFullscreen?.addEventListener('click', (e) => {
    e.stopPropagation();
    enterFullscreen();
  });
  elements.rotateOverlay?.addEventListener('click', () => {
    enterFullscreen();
  });

  // Tap en canvas para activar/restaurar pantalla completa en móvil
  elements.canvasWrapper?.addEventListener(
    'pointerdown',
    () => {
      if (state.isTouch && !document.fullscreenElement && !document.webkitFullscreenElement) {
        enterFullscreen();
      }
    },
    { passive: true }
  );

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

  // Alternancia de Sonido SFX
  elements.btnToggleSound?.addEventListener('click', toggleSound);
  elements.btnHeaderSound?.addEventListener('click', toggleSound);

  // Tabla de Posiciones (Leaderboard) Overlay
  elements.btnToggleLeaderboard?.addEventListener('click', () => toggleLeaderboard());
  elements.btnCloseLeaderboard?.addEventListener('click', () => toggleLeaderboard(false));
}

function leaveCurrentRoom() {
  if (state.socket && state.socket.readyState === WebSocket.OPEN && state.currentRoomId) {
    state.socket.send(JSON.stringify({ type: 'leave_room' }));
  }
  exitFullscreen();
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
  state.particles = [];
  state.floatingTexts = [];
  state.screenTrauma = 0;
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
  if (elements.roomsCountHint) {
    elements.roomsCountHint.textContent = `${rooms.length} ${rooms.length === 1 ? 'sala activa' : 'salas activas'}`;
  }

  if (rooms.length === 0) {
    elements.roomsContainer.innerHTML = `
      <div class="empty-rooms-banner">
        <div class="empty-icon">📡</div>
        <div class="empty-title">No hay salas abiertas activas</div>
        <div class="empty-subtitle">Sé el primer operador en desplegar una sala con el botón "Crear Sala".</div>
      </div>
    `;
    return;
  }

  const biomeIcons = {
    cavern: { label: 'Caverna', icon: '💎' },
    lab: { label: 'Laboratorio', icon: '⚡' },
    ruins: { label: 'Ruinas', icon: '🌋' },
  };

  elements.roomsContainer.innerHTML = rooms
    .map((r) => {
      const biomeInfo = biomeIcons[r.biome] || biomeIcons.cavern;
      const isFull = r.playerCount >= r.maxPlayers;
      return `
    <div class="room-item ${isFull ? 'room-full' : ''}" data-room-id="${r.id}">
      <div class="room-meta-group">
        <div class="room-meta-name">
          ${r.name} ${r.isPrivate ? '<span class="room-badge-private">🔒 PRIVADA</span>' : ''}
          <span class="room-badge-biome">${biomeInfo.icon} ${biomeInfo.label}</span>
        </div>
        <div class="room-meta-sub">
          <span>👑 Host: <strong>${r.creator}</strong></span>
          <span>👥 Operadores: <strong>${r.playerCount}/${r.maxPlayers}</strong></span>
          <span class="room-status-pill status-${r.status}">${r.status === 'in_progress' ? '⚔️ En combate' : '⏳ Esperando'}</span>
        </div>
      </div>
      <button class="cyber-btn ${isFull ? 'cyber-btn-secondary' : 'cyber-btn-primary'} btn-join-room" data-room-id="${r.id}" data-private="${r.isPrivate}" ${isFull ? 'disabled' : ''}>
        ${isFull ? 'LLENA' : 'DESPLEGARSE'}
      </button>
    </div>
  `;
    })
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
      characterId: state.selectedCharacter || 'vanguard',
    })
  );
}

function renderLobbyRoster(lobby) {
  elements.currentRoomName.textContent = lobby.roomName;
  if (lobby.biome) {
    state.currentBiome = lobby.biome;
    updateBiomeBadge(lobby.biome);
  }

  elements.playersRoster.innerHTML = lobby.players
    .map((p) => {
      const char = CHARACTERS[p.characterId] || CHARACTERS.vanguard;
      const colorKey = COLOR_MAP[p.color?.toLowerCase()] || char.spriteColor || 'cyan';
      const avatarSrc = `/img/soldier_${colorKey}_front.png`;
      const charRole = char.role || 'Asalto Frontal';
      const charName = char.name || 'Vanguardia Neón';

      return `
    <div class="roster-card">
      <div style="display: flex; align-items: center; gap: 12px;">
        <img src="${avatarSrc}" style="width: 32px; height: 42px; object-fit: contain; filter: drop-shadow(0 0 6px ${p.color || char.color});" alt="${charName}">
        <div>
          <strong>${p.username}</strong>
          <div style="font-size: 12px; color: var(--text-muted); display: flex; gap: 6px; align-items: center; flex-wrap: wrap;">
            <span style="color: ${char.color}; font-weight: 600;">${charName}</span>
            <span>•</span>
            <span style="color: var(--text-muted);">${charRole}</span>
            <span>•</span>
            <span>Ping: ${p.ping || 20}ms</span>
          </div>
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

// --- Sistema de Audio SFX Procedural (Web Audio API - Cero Dependencias) ---
function getAudioContext() {
  if (!state.soundEnabled) return null;
  if (!state.audioCtx) {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (AudioContextClass) {
      state.audioCtx = new AudioContextClass();
    }
  }
  if (state.audioCtx && state.audioCtx.state === 'suspended') {
    state.audioCtx.resume().catch(() => {});
  }
  return state.audioCtx;
}

function setupAudioListeners() {
  const unlockAudio = () => {
    if (state.soundEnabled) {
      getAudioContext();
    }
  };
  window.addEventListener('pointerdown', unlockAudio, { passive: true });
  window.addEventListener('keydown', unlockAudio, { passive: true });
}

function toggleSound() {
  state.soundEnabled = !state.soundEnabled;
  localStorage.setItem('cyber_sound', String(state.soundEnabled));
  updateSoundUI();
  if (state.soundEnabled) {
    getAudioContext();
    playSfx('pickup_shard');
  }
}

function updateSoundUI() {
  const icon = state.soundEnabled ? '🔊' : '🔇';
  if (elements.soundIcon) elements.soundIcon.textContent = icon;
  if (elements.headerSoundIcon) elements.headerSoundIcon.textContent = icon;
  if (elements.btnTitleSound) {
    elements.btnTitleSound.textContent = `${icon} AUDIO`;
  }
}

function playSfx(type, options = {}) {
  if (!state.soundEnabled) return;
  const aCtx = getAudioContext();
  if (!aCtx || aCtx.state !== 'running') return;

  const now = aCtx.currentTime;

  try {
    switch (type) {
      case 'start_game': {
        const notes = [261.63, 329.63, 392.0, 523.25, 659.25, 783.99];
        notes.forEach((freq, idx) => {
          const osc = aCtx.createOscillator();
          const gain = aCtx.createGain();
          osc.type = 'triangle';
          const t = now + idx * 0.055;
          osc.frequency.setValueAtTime(freq, t);
          gain.gain.setValueAtTime(0.2, t);
          gain.gain.exponentialRampToValueAtTime(0.001, t + 0.28);
          osc.connect(gain);
          gain.connect(aCtx.destination);
          osc.start(t);
          osc.stop(t + 0.3);
        });
        break;
      }

      case 'menu_click': {
        const osc = aCtx.createOscillator();
        const gain = aCtx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(800, now);
        osc.frequency.exponentialRampToValueAtTime(400, now + 0.04);
        gain.gain.setValueAtTime(0.12, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.04);
        osc.connect(gain);
        gain.connect(aCtx.destination);
        osc.start(now);
        osc.stop(now + 0.045);
        break;
      }

      case 'shoot': {
        const osc = aCtx.createOscillator();
        const gain = aCtx.createGain();
        const filter = aCtx.createBiquadFilter();

        osc.type = options.crit ? 'sawtooth' : 'triangle';
        const startFreq = options.crit ? 960 : 640;
        const endFreq = options.crit ? 180 : 120;

        osc.frequency.setValueAtTime(startFreq, now);
        osc.frequency.exponentialRampToValueAtTime(endFreq, now + 0.12);

        filter.type = 'lowpass';
        filter.frequency.setValueAtTime(options.crit ? 3500 : 2200, now);

        gain.gain.setValueAtTime(0.18, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.12);

        osc.connect(filter);
        filter.connect(gain);
        gain.connect(aCtx.destination);

        osc.start(now);
        osc.stop(now + 0.13);
        break;
      }

      case 'hit': {
        const osc = aCtx.createOscillator();
        const gain = aCtx.createGain();
        osc.type = 'square';
        osc.frequency.setValueAtTime(240, now);
        osc.frequency.exponentialRampToValueAtTime(50, now + 0.08);

        gain.gain.setValueAtTime(0.18, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.08);

        osc.connect(gain);
        gain.connect(aCtx.destination);
        osc.start(now);
        osc.stop(now + 0.09);
        break;
      }

      case 'crit': {
        [0, 0.045].forEach((offset, idx) => {
          const osc = aCtx.createOscillator();
          const gain = aCtx.createGain();
          osc.type = 'sine';
          osc.frequency.setValueAtTime(idx === 0 ? 880 : 1320, now + offset);
          gain.gain.setValueAtTime(0.22, now + offset);
          gain.gain.exponentialRampToValueAtTime(0.001, now + offset + 0.12);

          osc.connect(gain);
          gain.connect(aCtx.destination);
          osc.start(now + offset);
          osc.stop(now + offset + 0.13);
        });
        break;
      }

      case 'pickup_shard': {
        [1318.5, 1760].forEach((freq, idx) => {
          const osc = aCtx.createOscillator();
          const gain = aCtx.createGain();
          osc.type = 'sine';
          const t = now + idx * 0.05;
          osc.frequency.setValueAtTime(freq, t);
          gain.gain.setValueAtTime(0.16, t);
          gain.gain.exponentialRampToValueAtTime(0.001, t + 0.2);

          osc.connect(gain);
          gain.connect(aCtx.destination);
          osc.start(t);
          osc.stop(t + 0.22);
        });
        break;
      }

      case 'pickup_medkit': {
        [349.23, 440.0, 523.25].forEach((freq, idx) => {
          const osc = aCtx.createOscillator();
          const gain = aCtx.createGain();
          osc.type = 'triangle';
          const t = now + idx * 0.04;
          osc.frequency.setValueAtTime(freq, t);
          gain.gain.setValueAtTime(0.15, t);
          gain.gain.exponentialRampToValueAtTime(0.001, t + 0.35);

          osc.connect(gain);
          gain.connect(aCtx.destination);
          osc.start(t);
          osc.stop(t + 0.38);
        });
        break;
      }

      case 'levelup': {
        [523.25, 659.25, 783.99, 1046.5].forEach((freq, idx) => {
          const osc = aCtx.createOscillator();
          const gain = aCtx.createGain();
          osc.type = 'sine';
          const t = now + idx * 0.07;
          osc.frequency.setValueAtTime(freq, t);
          gain.gain.setValueAtTime(0.2, t);
          gain.gain.exponentialRampToValueAtTime(0.001, t + 0.25);

          osc.connect(gain);
          gain.connect(aCtx.destination);
          osc.start(t);
          osc.stop(t + 0.28);
        });
        break;
      }

      case 'kill': {
        const osc = aCtx.createOscillator();
        const gain = aCtx.createGain();
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(140, now);
        osc.frequency.exponentialRampToValueAtTime(30, now + 0.28);

        gain.gain.setValueAtTime(0.28, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.3);

        osc.connect(gain);
        gain.connect(aCtx.destination);
        osc.start(now);
        osc.stop(now + 0.32);
        break;
      }

      case 'wall_hit': {
        const osc = aCtx.createOscillator();
        const gain = aCtx.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(360, now);
        osc.frequency.exponentialRampToValueAtTime(80, now + 0.04);
        gain.gain.setValueAtTime(0.06, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.04);

        osc.connect(gain);
        gain.connect(aCtx.destination);
        osc.start(now);
        osc.stop(now + 0.05);
        break;
      }
    }
  } catch {
    // Si el navegador suspende el contexto de audio, la simulación continúa sin interrupción
  }
}

// --- Selección de Especialistas (Personajes) y Biomas ---
function setupCharacterSelection() {
  document.querySelectorAll('.character-card').forEach((card) => {
    card.addEventListener('click', () => {
      const charId = card.getAttribute('data-character');
      if (charId) {
        selectCharacter(charId);
      }
    });
  });
}

function selectCharacter(charId) {
  state.selectedCharacter = charId;
  localStorage.setItem('cyber_char', charId);

  updateUserDisplay();

  document.querySelectorAll('.character-card').forEach((c) => {
    c.classList.toggle('active', c.getAttribute('data-character') === charId);
  });

  const matchingClass = CHARACTER_TO_CLASS[charId] || 'assault';
  state.selectedClass = matchingClass;
  document.querySelectorAll('.class-card').forEach((c) => {
    c.classList.toggle('active', c.getAttribute('data-class') === matchingClass);
  });

  if (state.socket && state.socket.readyState === WebSocket.OPEN && state.currentRoomId) {
    state.socket.send(JSON.stringify({ type: 'select_character', characterId: charId }));
  }
}

// --- Selección de Clases de Operadores ---
function setupClassSelection() {
  document.querySelectorAll('.class-card').forEach((card) => {
    card.addEventListener('click', () => {
      const classId = card.getAttribute('data-class');
      if (classId) {
        selectClass(classId);
      }
    });
  });
}

function selectClass(classId) {
  state.selectedClass = classId;
  document.querySelectorAll('.class-card').forEach((c) => {
    c.classList.toggle('active', c.getAttribute('data-class') === classId);
  });

  const matchingChar = CLASS_TO_CHARACTER[classId] || 'vanguard';
  state.selectedCharacter = matchingChar;
  localStorage.setItem('cyber_char', matchingChar);
  document.querySelectorAll('.character-card').forEach((c) => {
    c.classList.toggle('active', c.getAttribute('data-character') === matchingChar);
  });

  if (state.socket && state.socket.readyState === WebSocket.OPEN && state.currentRoomId) {
    state.socket.send(JSON.stringify({ type: 'select_class', classId }));
  }
}

// --- Selección de Biomas de Mapas ---
function setupBiomeSelection() {
  document.querySelectorAll('.biome-card').forEach((card) => {
    card.addEventListener('click', () => {
      const biome = card.getAttribute('data-biome');
      if (biome && elements.inputRoomBiome) {
        elements.inputRoomBiome.value = biome;
        document.querySelectorAll('.biome-card').forEach((c) => {
          c.classList.toggle('active', c.getAttribute('data-biome') === biome);
        });
      }
    });
  });
}

function updateBiomeBadge(biomeId) {
  const biomeInfo = BIOMES[biomeId] || BIOMES.cavern;
  const label = `${biomeInfo.icon} ${biomeInfo.name}`;
  if (elements.currentRoomBiome) {
    elements.currentRoomBiome.textContent = label;
  }
  if (elements.radarBiomeBadge) {
    elements.radarBiomeBadge.textContent = label;
  }
}

// --- Tabla de Posiciones en Vivo (Leaderboard) ---
function toggleLeaderboard(force) {
  state.isLeaderboardOpen = typeof force === 'boolean' ? force : !state.isLeaderboardOpen;
  if (elements.hudLeaderboard) {
    elements.hudLeaderboard.classList.toggle('open', state.isLeaderboardOpen);
    elements.hudLeaderboard.style.display = state.isLeaderboardOpen ? 'flex' : 'none';
  }
  if (state.isLeaderboardOpen && state.currentSnapshot?.players) {
    renderLeaderboard(state.currentSnapshot.players);
  }
}

function renderLeaderboard(players) {
  if (!elements.leaderboardBody || !Array.isArray(players)) return;

  const sorted = [...players].sort((a, b) => {
    const scoreA = (a.kills || 0) * 100 + (a.shards || 0) * 10 + (a.level || 1) * 50 - (a.dead ? 500 : 0);
    const scoreB = (b.kills || 0) * 100 + (b.shards || 0) * 10 + (b.level || 1) * 50 - (b.dead ? 500 : 0);
    return scoreB - scoreA;
  });

  elements.leaderboardBody.innerHTML = sorted
    .map((p, idx) => {
      const isMe = p.id === state.myPlayerId;
      const char = CHARACTERS[p.characterId] || CHARACTERS.vanguard;
      const colorKey = COLOR_MAP[p.color?.toLowerCase()] || char.spriteColor || 'cyan';
      const avatarSrc = `/img/soldier_${colorKey}_front.png`;
      const hpPct = Math.max(0, Math.min(100, Math.round(((p.hp || 0) / (p.maxHp || 100)) * 100)));

      return `
    <tr class="${isMe ? 'is-self' : ''}">
      <td style="font-weight: 700; color: ${idx === 0 ? '#ffe234' : idx === 1 ? '#00f0ff' : '#aaa'};">#${idx + 1}</td>
      <td>
        <div style="display: flex; align-items: center; gap: 8px;">
          <img src="${avatarSrc}" style="width: 20px; height: 26px; object-fit: contain; filter: drop-shadow(0 0 4px ${p.color || char.color});" alt="${char.name}">
          <span style="color: ${char.color}; font-weight: 600;">${char.name}</span>
        </div>
      </td>
      <td style="font-weight: ${isMe ? '700' : '400'}; color: ${isMe ? 'var(--accent-cyan)' : '#fff'};">
        ${p.username} ${isMe ? '(Tú)' : ''}
      </td>
      <td><span class="badge-level">Nv. ${p.level || 1}</span></td>
      <td style="color: #ff5a5a; font-weight: 700;">${p.kills || 0}</td>
      <td style="color: #00f0ff; font-weight: 700;">${p.shards || 0}</td>
      <td>
        <div style="display: flex; align-items: center; gap: 6px;">
          <div style="width: 50px; height: 6px; background: rgba(255,255,255,0.1); border-radius: 3px; overflow: hidden;">
            <div style="width: ${hpPct}%; height: 100%; background: ${p.dead ? '#555' : hpPct > 35 ? '#b6ff3b' : '#ff4343'};"></div>
          </div>
          <span style="font-size: 11px;">${p.dead ? 'MUERTO' : `${p.hp}/${p.maxHp}`}</span>
        </div>
      </td>
      <td style="color: var(--text-muted); font-size: 11px;">${p.ping || 20}ms</td>
    </tr>
  `;
    })
    .join('');
}

// --- Sistema de Partículas, Daño Flotante y Screen Shake ---
function spawnParticles(x, y, color, count = 8, speed = 120, maxLife = 0.45, size = 3) {
  for (let i = 0; i < count; i++) {
    const angle = Math.random() * Math.PI * 2;
    const spd = (0.3 + Math.random() * 0.7) * speed;
    state.particles.push({
      x,
      y,
      vx: Math.cos(angle) * spd,
      vy: Math.sin(angle) * spd,
      life: maxLife * (0.6 + Math.random() * 0.4),
      maxLife,
      color,
      size: (0.7 + Math.random() * 0.6) * size,
    });
  }
}

function updateAndDrawParticles(dt) {
  for (let i = state.particles.length - 1; i >= 0; i--) {
    const p = state.particles[i];
    p.life -= dt;
    if (p.life <= 0) {
      state.particles.splice(i, 1);
      continue;
    }
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.vx *= 0.94;
    p.vy *= 0.94;

    const alpha = Math.max(0, p.life / p.maxLife);
    const radius = p.size * (0.5 + 0.5 * alpha);

    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = p.color;
    ctx.shadowColor = p.color;
    ctx.shadowBlur = 6;
    ctx.beginPath();
    ctx.arc(p.x, p.y, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}

function addFloatingText(text, x, y, color = '#ffffff', size = 14, isBold = false) {
  state.floatingTexts.push({
    text,
    x,
    y,
    color,
    size,
    isBold,
    life: 0.9,
    maxLife: 0.9,
    vy: -40,
  });
}

function updateAndDrawFloatingTexts(dt) {
  for (let i = state.floatingTexts.length - 1; i >= 0; i--) {
    const ft = state.floatingTexts[i];
    ft.life -= dt;
    if (ft.life <= 0) {
      state.floatingTexts.splice(i, 1);
      continue;
    }
    ft.y += ft.vy * dt;
    ft.vy *= 0.96;

    const alpha = Math.max(0, ft.life / ft.maxLife);
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.font = `${ft.isBold ? 'bold ' : ''}${ft.size}px Orbitron, sans-serif`;
    ctx.fillStyle = ft.color;
    ctx.textAlign = 'center';
    ctx.shadowColor = ft.color;
    ctx.shadowBlur = 8;
    ctx.fillText(ft.text, ft.x, ft.y);
    ctx.restore();
  }
}

function addTrauma(amount) {
  state.screenTrauma = Math.min(1.0, state.screenTrauma + amount);
}

function addKillFeedMessage(killerName, victimName) {
  if (!elements.killFeed) return;
  const item = document.createElement('div');
  item.className = 'kill-feed-item';
  item.innerHTML = `<span class="killer">${killerName}</span> <span class="action">eliminó a</span> <span class="victim">${victimName}</span>`;
  elements.killFeed.appendChild(item);
  setTimeout(() => {
    item.style.opacity = '0';
    item.style.transform = 'translateX(20px)';
    setTimeout(() => item.remove(), 400);
  }, 3500);
}

function processSnapshotEvent(ev) {
  switch (ev.type) {
    case 'shoot': {
      const isMine = ev.playerId === state.myPlayerId;
      playSfx('shoot', { crit: ev.crit });
      if (isMine) {
        addTrauma(0.06);
      }
      break;
    }

    case 'hit': {
      const isMyHit = ev.targetId === state.myPlayerId;
      if (ev.crit) {
        playSfx('crit');
        spawnParticles(ev.x, ev.y, '#ff2bd6', 14, 180, 0.5, 4);
        addFloatingText(`-${ev.damage} CRIT!`, ev.x, ev.y - 14, '#ff2bd6', 15, true);
        if (isMyHit) addTrauma(0.4);
      } else {
        playSfx('hit');
        spawnParticles(ev.x, ev.y, isMyHit ? '#ff4343' : '#00f0ff', 9, 120, 0.35, 3);
        addFloatingText(`-${ev.damage}`, ev.x, ev.y - 12, isMyHit ? '#ff5a5a' : '#00f0ff', 13, false);
        if (isMyHit) addTrauma(0.2);
      }
      break;
    }

    case 'kill': {
      playSfx('kill');
      spawnParticles(ev.x, ev.y, '#ff2bd6', 22, 220, 0.65, 5);
      spawnParticles(ev.x, ev.y, '#00f0ff', 16, 170, 0.5, 4);
      addTrauma(ev.victimId === state.myPlayerId ? 0.7 : 0.3);
      addKillFeedMessage(ev.killerName, ev.victimName);
      break;
    }

    case 'pickup': {
      if (ev.kind === 'shard') {
        playSfx('pickup_shard');
        spawnParticles(ev.x, ev.y, '#00f0ff', 12, 100, 0.45, 3);
      } else if (ev.kind === 'medkit') {
        playSfx('pickup_medkit');
        spawnParticles(ev.x, ev.y, '#b6ff3b', 14, 110, 0.5, 3.5);
        addFloatingText('+35 HP', ev.x, ev.y - 14, '#b6ff3b', 14, true);
      }
      break;
    }

    case 'levelup': {
      playSfx('levelup');
      spawnParticles(ev.x, ev.y, '#b6ff3b', 20, 160, 0.65, 4);
      spawnParticles(ev.x, ev.y, '#ffe234', 16, 140, 0.6, 3.5);
      addFloatingText(`NIVEL ${ev.level}!`, ev.x, ev.y - 20, '#ffe234', 16, true);
      if (ev.playerId === state.myPlayerId) {
        addTrauma(0.25);
      }
      break;
    }

    case 'wall_hit': {
      playSfx('wall_hit');
      spawnParticles(ev.x, ev.y, '#ffb020', 4, 70, 0.25, 2);
      break;
    }
  }
}

// Iniciar al cargar el DOM
window.addEventListener('DOMContentLoaded', init);
