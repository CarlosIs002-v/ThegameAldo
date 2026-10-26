import { test, expect } from '@playwright/test';

test.describe('Flujo E2E 2: Creación de Sala, Asignación de Estado "Listo" y Sockets', () => {
  test('comprueba la conexión de WebSockets, creación interactiva de sala y toggle de estado "Listo"', async ({
    page,
  }) => {
    await page.goto('/');

    // 1. Verificación de conexión WebSocket activa (ping/RTT reportado en el HUD)
    const pingDisplay = page.locator('#ping-display');
    await expect(pingDisplay).not.toHaveText('-- ms', { timeout: 10_000 });

    // 2. Creación interactiva de una nueva sala mediante el modal
    await page.click('#btn-create-room-modal');
    await expect(page.locator('#modal-create-room')).toHaveClass(/open/);

    const testRoomName = `Sector Gamma ${Date.now() % 10000}`;
    await page.fill('#input-room-name', testRoomName);
    await page.click('#btn-submit-create-room');

    // 3. Confirmar que el cliente transiciona a la sala de espera creada
    await expect(page.locator('#modal-create-room')).not.toHaveClass(/open/);
    await expect(page.locator('#view-room-waiting')).toHaveClass(/active/, { timeout: 8_000 });
    await expect(page.locator('#current-room-name')).toHaveText(testRoomName);

    // 4. Comprobar lista de jugadores y asignación de estado "Listo"
    const readyBtn = page.locator('#btn-toggle-ready');
    await expect(readyBtn).toHaveText('Marcar "Listo"');

    // Estado inicial en el roster: ESPERANDO
    const readyBadge = page.locator('.roster-ready-badge').first();
    await expect(readyBadge).toHaveText('ESPERANDO');

    // Hacer clic para marcar "Listo"
    await readyBtn.click();

    // El estado del botón debe actualizarse y el badge debe cambiar a LISTO
    await expect(readyBtn).toHaveText('Cancelar "Listo"');
    await expect(readyBadge).toHaveClass(/is-ready/);
    await expect(readyBadge).toHaveText('LISTO');
  });

  test('abandonar la partida libera al jugador y la sala en el servidor', async ({
    page,
    request,
  }) => {
    await page.goto('/');

    await page.click('#btn-create-room-modal');
    const testRoomName = `Sector Salida ${Date.now() % 10000}`;
    await page.fill('#input-room-name', testRoomName);
    await page.click('#btn-submit-create-room');

    await expect(page.locator('#view-room-waiting')).toHaveClass(/active/, { timeout: 8_000 });
    const roomId = (await page.locator('#current-room-id').textContent())
      .replace('ID:', '')
      .trim();

    await page.click('#btn-toggle-ready');
    await expect(page.locator('#view-game')).toHaveClass(/active/, { timeout: 8_000 });

    await page.click('#btn-exit-match');
    await expect(page.locator('#view-lobby')).toHaveClass(/active/);

    await expect
      .poll(
        async () => {
          const res = await request.get('/api/rooms');
          const body = await res.json();
          const room = (body.rooms || []).find((r) => r.id === roomId);
          return room ? room.playerCount : -1;
        },
        { timeout: 8_000 }
      )
      .toBe(0);
  });
});
