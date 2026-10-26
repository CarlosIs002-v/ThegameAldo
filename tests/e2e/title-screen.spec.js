import { test, expect } from '@playwright/test';

test.describe('Flujo E2E 6: Pantalla de Inicio Arcade, Botón Start y Menú Principal Renovado', () => {
  test('muestra la pantalla arcade con logo, formación de soldados y transiciona al menú al pulsar start', async ({ page }) => {
    // 1. Abrir el juego forzando la intro arcade
    await page.goto('/?show_intro=1');

    // 2. Verificar que la pantalla de inicio está activa
    const titleView = page.locator('#view-title');
    await expect(titleView).toBeVisible();
    await expect(titleView).toHaveClass(/active/);

    // 3. Verificar elementos visuales retro arcade inspirados en el diseño
    const logoCyber = page.locator('.title-word-cyber');
    await expect(logoCyber).toContainText('CYBERGRID');

    const specialistsLineup = page.locator('.title-specialists-lineup .title-fighter-spot');
    await expect(specialistsLineup).toHaveCount(4);

    const startBtn = page.locator('#btn-start-game');
    await expect(startBtn).toBeVisible();
    await expect(startBtn).toContainText('PULSA START');

    // 4. Probar apertura y cierre del modal de Controles desde el título
    const btnControls = page.locator('#btn-title-controls');
    await expect(btnControls).toBeVisible();
    await btnControls.click();

    const modalControls = page.locator('#modal-controls');
    await expect(modalControls).toHaveClass(/open/);
    await expect(modalControls).toContainText('GUÍA DE CONTROLES');

    await page.locator('#btn-close-controls').click();
    await expect(modalControls).not.toHaveClass(/open/);

    // 5. Probar apertura y cierre del modal de Créditos desde el título
    const btnCredits = page.locator('#btn-title-credits');
    await expect(btnCredits).toBeVisible();
    await btnCredits.click();

    const modalCredits = page.locator('#modal-credits');
    await expect(modalCredits).toHaveClass(/open/);
    await expect(modalCredits).toContainText('CRÉDITOS DEL JUEGO');

    await page.locator('#btn-close-credits').click();
    await expect(modalCredits).not.toHaveClass(/open/);

    // 6. Hacer clic en "PULSA START"
    await startBtn.click();

    // 7. Verificar que salimos de la pantalla de inicio y entramos al lobby interactivo
    const lobbyView = page.locator('#view-lobby');
    await expect(lobbyView).toBeVisible();
    await expect(lobbyView).toHaveClass(/active/);
    await expect(titleView).not.toHaveClass(/active/);

    // 8. Verificar componentes del nuevo menú simplificado
    const operatorName = page.locator('#lobby-user-name');
    await expect(operatorName).toBeVisible();

    const quickJoinBtn = page.locator('#btn-quick-join');
    await expect(quickJoinBtn).toBeVisible();
    await expect(quickJoinBtn).toContainText('Entrar al Combate');

    const createRoomBtn = page.locator('#btn-create-room-modal');
    await expect(createRoomBtn).toBeVisible();
    await expect(createRoomBtn).toContainText('Nueva Sala');

    const howToPlayBtn = page.locator('#btn-open-how-to-play');
    await expect(howToPlayBtn).toBeVisible();
    await expect(howToPlayBtn).toContainText('Ver Controles');

    // 9. Probar que el botón "¿Cómo Jugar?" en el menú también abre la guía
    await howToPlayBtn.click();
    await expect(modalControls).toHaveClass(/open/);
    await page.locator('#btn-close-controls').click();
    await expect(modalControls).not.toHaveClass(/open/);

    // 10. Probar regresar al título con el botón de retroceso
    const backToTitleBtn = page.locator('#btn-back-to-title');
    await expect(backToTitleBtn).toBeVisible();
    await backToTitleBtn.click();

    await expect(titleView).toHaveClass(/active/);
    await expect(lobbyView).not.toHaveClass(/active/);
  });
});
