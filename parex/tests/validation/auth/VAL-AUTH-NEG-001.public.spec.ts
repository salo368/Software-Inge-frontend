import { test, expect } from '@playwright/test';

test(
    'VAL-AUTH-NEG-001 · credenciales inválidas producen un rechazo observable',
    async ({ page }, testInfo) => {
        await test.step(
            'DADO un usuario no autenticado',
            async () => {
                await page.goto('/portal/login');

                await expect(page.locator('#login-email')).toHaveCount(1);
                await expect(page.locator('#login-password')).toHaveCount(1);
                await expect(page.locator('#portal-login-submit')).toHaveCount(1);
            },
        );

        await test.step(
            'CUANDO ingresa credenciales inválidas',
            async () => {
                await page
                    .locator('#login-email')
                    .fill('usuario.inexistente@parex.test');

                await page
                    .locator('#login-password')
                    .fill('CredencialIncorrecta123');

                await page
                    .locator('#portal-login-submit')
                    .click();
            },
        );

        await test.step(
            'ENTONCES el sistema rechaza el acceso de forma observable',
            async () => {
                const error = page.locator('#portal-login-error');

                await expect(error).toHaveCount(1);
                await expect(error).toBeVisible();
                await expect(error).toContainText('invalid_credentials');

                await expect(page).toHaveURL(/\/portal\/login/);

                await expect(
                    page.locator('#global-nav-account'),
                ).toHaveCount(0);

                await expect(
                    page.locator('#global-nav-logout'),
                ).toHaveCount(0);
            },
        );

        await testInfo.attach('evidencia-rechazo-autenticacion', {
            body: await page.screenshot(),
            contentType: 'image/png',
        });
    },
);