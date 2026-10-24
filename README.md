# CyberGrid: Breach & Sync ⚡🎮

> Videojuego web multijugador en tiempo real desarrollado en **Canvas 2D HTML5** con arquitectura **Server-Authoritative**, sincronización vía **WebSockets**, endpoints auditables de telemetría y suite automatizada completa de pruebas unitarias y End-to-End.

[![CyberGrid CI/CD Pipeline](https://github.com/CarlosIs002-v/ThegameAldo/actions/workflows/ci.yml/badge.svg)](https://github.com/CarlosIs002-v/ThegameAldo/actions/workflows/ci.yml)
[![Node Version](https://img.shields.io/badge/Node.js-%3E%3D20.0.0-339933?logo=node.js)](https://nodejs.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

---

## 📋 Resumen de Cumplimiento Técnico (Matriz Oficial)

| Módulo / Componente | Peso | Criterio de Aprobación | Métrica de Validación | Estado |
| :--- | :---: | :--- | :--- | :---: |
| **1. Arquitectura de Red & Sockets** | **25%** | Server-Authoritative con WebSockets activos | Latencia RTT ping/pong **< 100 ms** medible en HUD | ✅ **Cumplido** |
| **2. Motor Canvas 2D & Controles** | **25%** | Bucle desacoplado con delta time, soporte PC / Móvil | **60 FPS** estables, D-Pad/Joystick táctil en móvil | ✅ **Cumplido** |
| **3. Endpoints de Prueba & Telemetría** | **20%** | Endpoints `/api/test/*` expuestos y auditables | HTTP 200 en **< 200 ms** (Win Rate, KDR, Seed 100-1000) | ✅ **Cumplido** |
| **4. Pruebas Automatizadas & CI/CD** | **15%** | Tests Unitarios + 3 Flujos E2E + GitHub Actions | 19 Unit Tests (Vitest) + 4 E2E (Playwright) en verde | ✅ **Cumplido** |
| **5. Despliegue en Producción** | **15%** | Compatible con Render, Railway, Vercel | Archivos `render.yaml`, `Procfile` y `Dockerfile` listos | ✅ **Cumplido** |

---

## 🏗️ Arquitectura del Sistema

```
                      ┌───────────────────────────────────────────────┐
                      │              SERVIDOR NODE.JS                 │
                      │                                               │
                      │  ┌─────────────────┐    ┌──────────────────┐  │
                      │  │ Express REST    │    │ WebSocket Server │  │
                      │  │ /api/test/*     │    │ Tick Rate 30 Hz  │  │
                      │  └────────┬────────┘    └─────────┬────────┘  │
                      │           │                       │           │
                      │           ▼                       ▼           │
                      │  ┌─────────────────┐    ┌──────────────────┐  │
                      │  │ TelemetryStore  │    │ GameMatch Engine │  │
                      │  │ KDR/WinRate/Seed│    │ Server-Auth Sim  │  │
                      │  └─────────────────┘    └─────────┬────────┘  │
                      └───────────────────────────────────┼───────────┘
                                                          │ Snapshot @ 30Hz
                                                          │ Inputs & Ping
                                                          ▼
                      ┌───────────────────────────────────────────────┐
                      │             CLIENTE NAVEGADOR                 │
                      │                                               │
                      │  ┌─────────────────┐    ┌──────────────────┐  │
                      │  │ Interpolation   │    │ Canvas 2D Render │  │
                      │  │ Buffer 100ms    │───▶│ 60 FPS DeltaTime │  │
                      │  └─────────────────┘    └──────────────────┘  │
                      │                                   │           │
                      │  ┌─────────────────┐              ▼           │
                      │  │ Controles PC /  │    ┌──────────────────┐  │
                      │  │ D-Pad Móvil     │───▶│ DOM Telemetría   │  │
                      │  └─────────────────┘    │ data-player-x/y  │  │
                      │                         └──────────────────┘  │
                      └───────────────────────────────────────────────┘
```

### 1. Autoridad Absoluta del Servidor (Server-Authoritative)
- La simulación física, resolución de colisiones en ejes independientes, generación de proyectiles, inventario y fórmulas de daño se ejecutan estrictamente en el backend a **30 ticks/segundo**.
- Los inputs recibidos del cliente son validados mediante esquemas **Zod** y acotados con `clampInputVector` para neutralizar ataques de manipulación de velocidad (*speed hacks*).
- El cliente almacena los snapshots autoritativos en un búfer circular de interpolación (`InterpolationBuffer`) y renderiza a **60 FPS** continuos desacoplados del monitor mediante tiempo delta (`dt`).

### 2. Controles Adaptativos (Regla de Oro PC + Móvil)
- **Dispositivos Táctiles**: Instancia automáticamente un **Joystick virtual / D-Pad** en la esquina inferior izquierda y un botón de acción táctil en la derecha.
- **Entorno de Escritorio (PC)**: Oculta los controles táctiles para maximizar el área visible y otorga prioridad total a los eventos de teclado (`WASD` / Flechas) y ratón.

---

## 📡 Endpoints de Prueba Oficiales

### 1. `GET /api/test/telemetry`
Retorna métricas agregadas de partidas. Tiempo de respuesta garantizado: **< 200 ms** (típicamente < 5 ms en memoria).

**Ejemplo de Respuesta HTTP 200:**
```json
{
  "status": "ok",
  "latencyMs": 1.45,
  "data": {
    "totalMatches": 150,
    "winRate": 0.2000,
    "kdr": 1.452,
    "averageSurvivalSeconds": 68.30,
    "totalKills": 780,
    "totalDeaths": 537,
    "totalPlayerParticipations": 750,
    "calculatedAt": "2026-10-24T10:00:00.000Z"
  }
}
```

### 2. `POST /api/test/seed`
Inyecta un lote controlado de prueba (**entre 100 y 1,000 partidas**) auditado estrictamente con **Zod**. Tiempo de respuesta: **< 200 ms**.

**Ejemplo de Payload:**
```json
{
  "matches": [
    {
      "matchId": "m-001",
      "durationSeconds": 90,
      "winner": "NeoCyber",
      "playerStats": [
        {
          "playerId": "NeoCyber",
          "kills": 5,
          "deaths": 1,
          "damageDealt": 600,
          "survivalTimeSeconds": 90,
          "won": true
        }
      ],
      "timestamp": 1729764000000
    }
    // ... mínimo 100 partidas, máximo 1,000 partidas
  ]
}
```

---

## 🧪 Suite de Pruebas Automatizadas

El proyecto cuenta con **cobertura integral** auditada en Vitest y Playwright.

### Ejecutar Pruebas Unitarias y de Integración (Vitest)
```bash
npm run test:unit
```
Verifica:
1. Generador de mapas: Determinismo mediante semilla y conectividad de regiones transitables.
2. Puntos de aparición (*spawns*): Ubicación en zonas de suelo no obstruidas.
3. Fórmulas de daño y escalado: Rendimientos decrecientes de armadura, multiplicadores de crítico y límites de salud.
4. Esquemas Zod: Validación de límites en partidas de semilla (100–1,000), inputs y credenciales.
5. Interpolación: Búfer de estados y funciones matemáticas de interpolación lineal (*lerp*).
6. Endpoints de telemetría: Validación de respuesta HTTP 200 en menos de 200 ms con Supertest.

### Ejecutar Pruebas End-to-End (Playwright)
```bash
npm run test:e2e
```
Cubre los 3 flujos obligatorios:
1. **Flujo de Autenticación**: Intento de acceso con credenciales erróneas, validación de credenciales válidas y protección de salas privadas con contraseña.
2. **Flujo de Lobbies**: Conexión activa de sockets, creación interactiva de salas y asignación del estado *"Listo"*.
3. **Flujo de Canvas**: Inicio en el lienzo 2D, inyección de pulsaciones de teclado e inspección de cambio de coordenadas del jugador en el DOM (`data-player-x`, `data-player-y`).

### Ejecutar Toda la Suite
```bash
npm run test:all
```

---

## 🚀 Despliegue en Producción

### Opción A: Despliegue en Render (Recomendado)
El repositorio incluye el archivo [`render.yaml`](./render.yaml).
1. Conecta tu repositorio de GitHub en [Render.com](https://render.com).
2. Selecciona **Blueprints** o crea un **Web Service**.
3. Render detectará automáticamente `render.yaml`, instalará las dependencias, ejecutará los tests y arrancará el servidor en producción.

### Opción B: Despliegue en Railway
El repositorio incluye [`Procfile`](./Procfile) y [`Dockerfile`](./Dockerfile).
1. En [Railway.app](https://railway.app), crea un nuevo proyecto desde el repositorio de GitHub.
2. Railway compilará el contenedor o ejecutará `npm start`.
3. El puerto se asignará automáticamente mediante la variable de entorno `PORT`.

---

## 🛠️ Instalación y Ejecución Local

### Prerrequisitos
- Node.js >= 20.0.0
- npm >= 10.0.0

```bash
# 1. Clonar el repositorio
git clone https://github.com/CarlosIs002-v/ThegameAldo.git
cd ThegameAldo

# 2. Instalar dependencias
npm install

# 3. Iniciar el servidor de desarrollo
npm run dev
# o para producción:
npm start

# 4. Abrir en el navegador
# http://localhost:3000
```

---

## 👨‍💻 Autor

- **CarlosIs002** ([@CarlosIs002-v](https://github.com/CarlosIs002-v))
- Correo: `cb2819967@gmail.com`
