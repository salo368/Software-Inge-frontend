import { test, expect } from '@playwright/test';

test(
    'VAL-AUTH-POS-001 · credenciales válidas establecen una sesión autenticada',
    async ({ page }, testInfo) => {
        const email = process.env.TEST_USER_EMAIL;
        const password = process.env.TEST_USER_PASSWORD;

        if (!email || !password) {
            throw new Error('Credenciales de prueba no configuradas');
        }

        await test.step(
            'DADO un usuario de pruebas con credenciales válidas',
            async () => {
                await page.goto('/portal/login');

                await expect(page.locator('#login-email')).toHaveCount(1);
                await expect(page.locator('#login-password')).toHaveCount(1);
                await expect(page.locator('#portal-login-submit')).toHaveCount(1);
            },
        );

        await test.step(
            'CUANDO el usuario inicia sesión',
            async () => {
                await page.locator('#login-email').fill(email);
                await page.locator('#login-password').fill(password);
                await page.locator('#portal-login-submit').click();
            },
        );

        await test.step(
            'ENTONCES el sistema presenta el estado autenticado',
            async () => {
                await expect(
                    page.locator('#global-nav-account'),
                ).toBeVisible({ timeout: 15_000 });

                await expect(
                    page.locator('#global-nav-logout'),
                ).toBeVisible();

                await expect(
                    page.locator('#global-nav-login'),
                ).toHaveCount(0);
            },
        );

        await testInfo.attach('evidencia-estado-autenticado', {
            body: await page.screenshot(),
            contentType: 'image/png',
        });
    },
);