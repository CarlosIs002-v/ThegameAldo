import { test, expect } from '@playwright/test';

test.describe('Flujo E2E 3: Lienzo Canvas, Inyección de Controles y Aserción de Coordenadas en DOM', () => {
  test('inicia partida en Canvas 2D, inyecta controles de movimiento y verifica cambio de coordenadas en el DOM', async ({
    page,
  }) => {
    await page.goto('/');

    // 1. Acceder mediante Entrada Rápida a la sala por defecto
    await page.click('#btn-quick-join');
    await expect(page.locator('#view-room-waiting')).toHaveClass(/active/, { timeout: 10_000 });

    // 2. Marcar "Listo" para transicionar al Canvas de juego
    await page.click('#btn-toggle-ready');

    // 3. Confirmar que el lienzo Canvas está activo y visible
    const viewGame = page.locator('#view-game');
    await expect(viewGame).toHaveClass(/active/, { timeout: 10_000 });

    const canvas = page.locator('#game-canvas');
    await expect(canvas).toBeVisible();

    // 4. Esperar a que el servidor envíe el primer snapshot y se pueble el DOM de telemetría
    const coordsBox = page.locator('#player-coordinates');
    await expect(coordsBox).not.toHaveAttribute('data-player-x', '0', { timeout: 10_000 });

    const initialX = parseFloat(await coordsBox.getAttribute('data-player-x'));
    const initialY = parseFloat(await coordsBox.getAttribute('data-player-y'));

    expect(Number.isFinite(initialX)).toBeTruthy();
    expect(Number.isFinite(initialY)).toBeTruthy();

    // 5. Inyección de controles: Desplazamiento mediante teclado (tecla D hacia la derecha o S hacia abajo)
    await page.keyboard.down('KeyD');
    await page.keyboard.down('KeyS');
    await page.waitForTimeout(600); // Mantener presionado 600ms para permitir movimiento autoritativo
    await page.keyboard.up('KeyD');
    await page.keyboard.up('KeyS');

    // Esperar a que el siguiente snapshot del servidor actualice el DOM
    await page.waitForTimeout(200);

    const updatedX = parseFloat(await coordsBox.getAttribute('data-player-x'));
    const updatedY = parseFloat(await coordsBox.getAttribute('data-player-y'));

    // 6. Aserción formal requerida: Cambio medible de coordenadas del jugador en el DOM
    const moved = updatedX !== initialX || updatedY !== initialY;
    expect(moved).toBeTruthy();
  });
});
