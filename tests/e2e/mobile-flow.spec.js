import { test, expect } from '@playwright/test';

test.describe('Flujo E2E 4: Adaptación Móvil, Joysticks Táctiles y Apuntado', () => {
  test('ocupa la pantalla, muestra controles táctiles y mueve/apunta al jugador', async ({ page }) => {
    await page.goto('/');

    await page.click('#btn-quick-join');
    await expect(page.locator('#view-room-waiting')).toHaveClass(/active/, { timeout: 10_000 });

    await page.click('#btn-toggle-ready');
    await expect(page.locator('#view-game')).toHaveClass(/active/, { timeout: 10_000 });

    // La cabecera desaparece en partida móvil y los controles táctiles están activos.
    await expect(page.locator('.cyber-header')).toBeHidden();
    await expect(page.locator('#touch-controls')).toBeVisible();
    await expect(page.locator('#touch-joystick')).toBeVisible();
    await expect(page.locator('#touch-aim')).toBeVisible();

    const coordsBox = page.locator('#player-coordinates');
    await expect(coordsBox).not.toHaveAttribute('data-player-x', '0', { timeout: 10_000 });

    const initialX = parseFloat(await coordsBox.getAttribute('data-player-x'));
    const initialY = parseFloat(await coordsBox.getAttribute('data-player-y'));
    expect(Number.isFinite(initialX)).toBeTruthy();
    expect(Number.isFinite(initialY)).toBeTruthy();

    // Joystick izquierdo: mantener pulsado hacia abajo-derecha.
    await page.evaluate(() => {
      const zone = document.getElementById('touch-joystick');
      const base = zone.querySelector('.joystick-base');
      const rect = base.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      const baseEvent = {
        bubbles: true,
        cancelable: true,
        pointerId: 41,
        pointerType: 'touch',
        isPrimary: true,
        buttons: 1,
      };
      zone.dispatchEvent(new PointerEvent('pointerdown', { ...baseEvent, clientX: cx, clientY: cy }));
      zone.dispatchEvent(
        new PointerEvent('pointermove', { ...baseEvent, clientX: cx + 34, clientY: cy + 18 })
      );
    });

    await page.waitForTimeout(700);

    await page.evaluate(() => {
      const zone = document.getElementById('touch-joystick');
      zone.dispatchEvent(
        new PointerEvent('pointerup', {
          bubbles: true,
          cancelable: true,
          pointerId: 41,
          pointerType: 'touch',
          isPrimary: true,
        })
      );
    });

    await page.waitForTimeout(250);

    const updatedX = parseFloat(await coordsBox.getAttribute('data-player-x'));
    const updatedY = parseFloat(await coordsBox.getAttribute('data-player-y'));
    expect(updatedX !== initialX || updatedY !== initialY).toBeTruthy();

    // Joystick derecho: apuntar a la derecha.
    await page.evaluate(() => {
      const zone = document.getElementById('touch-aim');
      const base = zone.querySelector('.joystick-base');
      const rect = base.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      const baseEvent = {
        bubbles: true,
        cancelable: true,
        pointerId: 42,
        pointerType: 'touch',
        isPrimary: true,
        buttons: 1,
      };
      zone.dispatchEvent(new PointerEvent('pointerdown', { ...baseEvent, clientX: cx, clientY: cy }));
      zone.dispatchEvent(
        new PointerEvent('pointermove', { ...baseEvent, clientX: cx + 36, clientY: cy })
      );
    });

    await page.waitForTimeout(300);

    const aimAngle = parseFloat(await coordsBox.getAttribute('data-aim-angle'));
    expect(Number.isFinite(aimAngle)).toBeTruthy();
    expect(Math.abs(aimAngle)).toBeLessThan(0.35);

    await page.evaluate(() => {
      const zone = document.getElementById('touch-aim');
      zone.dispatchEvent(
        new PointerEvent('pointerup', {
          bubbles: true,
          cancelable: true,
          pointerId: 42,
          pointerType: 'touch',
          isPrimary: true,
        })
      );
    });

    // El canvas y los controles deben caber dentro del viewport sin scroll lateral.
    const layout = await page.evaluate(() => {
      const canvas = document.getElementById('game-canvas').getBoundingClientRect();
      const controls = Array.from(
        document.querySelectorAll('#touch-joystick, #touch-aim, #btn-touch-fire')
      ).map((el) => {
        const r = el.getBoundingClientRect();
        return { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
      });

      return {
        width: window.innerWidth,
        height: window.innerHeight,
        overflowX: document.documentElement.scrollWidth - window.innerWidth,
        canvas: { left: canvas.left, top: canvas.top, right: canvas.right, bottom: canvas.bottom },
        controls,
      };
    });

    expect(layout.overflowX).toBeLessThanOrEqual(1);
    expect(layout.canvas.left).toBeGreaterThanOrEqual(-1);
    expect(layout.canvas.top).toBeGreaterThanOrEqual(-1);
    expect(layout.canvas.right).toBeLessThanOrEqual(layout.width + 1);
    expect(layout.canvas.bottom).toBeLessThanOrEqual(layout.height + 1);

    for (const control of layout.controls) {
      expect(control.left).toBeGreaterThanOrEqual(-1);
      expect(control.top).toBeGreaterThanOrEqual(-1);
      expect(control.right).toBeLessThanOrEqual(layout.width + 1);
      expect(control.bottom).toBeLessThanOrEqual(layout.height + 1);
    }
  });
});
