import { test, expect } from '@playwright/test';

test.describe('Flujo E2E 5: Selección de Especialistas, Biomas de Mapas, Radar y Marcador', () => {
  test('crea sala con bioma personalizado (Laboratorio), selecciona Especialista Nova y verifica radar y marcador en partida', async ({
    page,
  }) => {
    await page.goto('/');

    // 1. Abrir modal de creación de sala
    await page.click('#btn-create-room-modal');
    await expect(page.locator('#modal-create-room')).toHaveClass(/open/);

    // 2. Seleccionar el bioma "Laboratorio CyberGrid"
    const labBiomeCard = page.locator('.biome-card[data-biome="lab"]');
    await expect(labBiomeCard).toBeVisible();
    await labBiomeCard.click();
    await expect(labBiomeCard).toHaveClass(/active/);
    await expect(page.locator('#input-room-biome')).toHaveValue('lab');

    const testRoomName = `Sector BioLab ${Date.now() % 10000}`;
    await page.fill('#input-room-name', testRoomName);
    await page.click('#btn-submit-create-room');

    // 3. Confirmar acceso a la sala de espera con el bioma correcto
    await expect(page.locator('#modal-create-room')).not.toHaveClass(/open/);
    await expect(page.locator('#view-room-waiting')).toHaveClass(/active/, { timeout: 8_000 });
    await expect(page.locator('#current-room-name')).toHaveText(testRoomName);
    await expect(page.locator('#current-room-biome')).toContainText('Laboratorio CyberGrid');

    // 4. Seleccionar Especialista "Operadora Nova" (Bio-Tech)
    const novaCard = page.locator('.character-card[data-character="nova"]');
    await expect(novaCard).toBeVisible();
    await novaCard.click();
    await expect(novaCard).toHaveClass(/active/);

    // Comprobar sincronización con la clase táctica
    const tacticalClass = page.locator('.class-card[data-class="tactical"]');
    await expect(tacticalClass).toHaveClass(/active/);

    // 5. Iniciar partida marcando "Listo"
    const readyBtn = page.locator('#btn-toggle-ready');
    await readyBtn.click();
    await expect(page.locator('#view-game')).toHaveClass(/active/, { timeout: 8_000 });

    // 6. Verificar presencia del Radar Táctico y la insignia de bioma en el HUD
    const radarCanvas = page.locator('#radar-canvas');
    await expect(radarCanvas).toBeVisible();
    const radarBiomeBadge = page.locator('#radar-biome-badge');
    await expect(radarBiomeBadge).toBeVisible();
    await expect(radarBiomeBadge).toContainText('Laboratorio CyberGrid');

    // 7. Abrir la Tabla de Posiciones (Leaderboard) mediante el botón táctil del HUD
    const btnLeaderboard = page.locator('#btn-toggle-leaderboard');
    await expect(btnLeaderboard).toBeVisible();
    await btnLeaderboard.click();

    const leaderboardModal = page.locator('#hud-leaderboard');
    await expect(leaderboardModal).toHaveClass(/open/);

    // Comprobar que en la tabla aparece la fila del jugador con el especialista seleccionado
    const leaderboardRows = page.locator('#leaderboard-body tr');
    await expect(leaderboardRows).toHaveCount(1);
    await expect(leaderboardRows.first()).toContainText('Nova');

    // Cerrar el modal del marcador con el botón '✕'
    await page.click('#btn-close-leaderboard');
    await expect(leaderboardModal).not.toHaveClass(/open/);

    // 8. Salir de la partida limpiamente
    await page.click('#btn-exit-match');
    await expect(page.locator('#view-lobby')).toHaveClass(/active/);
  });
});
