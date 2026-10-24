import { test, expect } from '@playwright/test';

test.describe('Flujo E2E 1: Autenticación, Credenciales y Protección de Salas', () => {
  test('valida rechazo de credenciales inválidas y acceso exitoso con credenciales correctas', async ({
    page,
  }) => {
    await page.goto('/');

    // 1. Abrir modal de autenticación
    await page.click('#btn-show-auth');
    await expect(page.locator('#modal-auth')).toHaveClass(/open/);

    // 2. Intento de acceso con credenciales inválidas (usuario demasiado corto)
    await page.fill('#input-username', 'ab');
    await page.fill('#input-password', '12');
    await page.click('#btn-submit-auth');

    // Debe mostrar mensaje de error en pantalla
    const errorMsg = page.locator('#auth-error-msg');
    await expect(errorMsg).toBeVisible();

    // 3. Acceso exitoso con credenciales válidas
    await page.fill('#input-username', 'CyberTester99');
    await page.fill('#input-password', 'claveSegura2026');
    await page.click('#btn-submit-auth');

    // El modal debe cerrarse y el tag de usuario debe reflejar el operador
    await expect(page.locator('#modal-auth')).not.toHaveClass(/open/);
    await expect(page.locator('#user-tag')).toHaveText('CyberTester99');
  });

  test('comprueba la protección de salas privadas mediante contraseña', async ({ page, request }) => {
    // 1. Crear una sala privada vía API
    const roomRes = await request.post('/api/rooms', {
      data: {
        name: 'Sector Blindado',
        isPrivate: true,
        password: 'cyberPassword777',
        maxPlayers: 4,
      },
    });
    expect(roomRes.ok()).toBeTruthy();
    const { room } = await roomRes.json();

    // 2. Navegar a la página y refrescar la lista de salas
    await page.goto('/');
    await page.click('#btn-refresh-rooms');

    // Localizar el elemento de la sala privada creada
    const roomCard = page.locator(`.room-item[data-room-id="${room.id}"]`);
    await expect(roomCard).toBeVisible();

    // 3. Al hacer clic en unirse a sala privada, debe saltar el modal de contraseña
    await roomCard.locator('.btn-join-room').click();
    await expect(page.locator('#modal-join-password')).toHaveClass(/open/);

    // 4. Ingresar contraseña correcta y acceder a la sala
    await page.fill('#input-join-password', 'cyberPassword777');
    await page.locator('#form-join-password button[type="submit"]').click();

    // Debe acceder a la vista de sala activa
    await expect(page.locator('#view-room-waiting')).toHaveClass(/active/);
    await expect(page.locator('#current-room-name')).toHaveText('Sector Blindado');
  });
});
