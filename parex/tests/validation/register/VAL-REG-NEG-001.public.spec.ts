import { test, expect } from '@playwright/test';

test(
    'VAL-REG-NEG-001 · no permite registrar dos cuentas con el mismo correo',
    async ({ page }, testInfo) => {
        const runId = Date.now();

        const user = {
            fullName: 'Usuario PAREX Duplicado',
            email: `parex.duplicate.${runId}@example.com`,
            password: 'ParexTest2026!',
        };

        await test.step(
            'PREPARACIÓN · existe una cuenta registrada con el correo de prueba',
            async () => {
                await page.goto('/portal/register');

                await page.locator('#register-name').fill(user.fullName);
                await page.locator('#register-email').fill(user.email);
                await page.locator('#register-password').fill(user.password);
                await page.locator('#portal-register-submit').click();

                await expect(
                    page.locator('#global-nav-account')
                ).toBeVisible({ timeout: 15_000 });

                await expect(
                    page.locator('#global-nav-logout')
                ).toBeVisible();

                await page.locator('#global-nav-logout').click();

                await expect(
                    page.locator('#global-nav-login')
                ).toBeVisible({ timeout: 10_000 });
            }
        );

        await test.step(
            'DADO que el correo ya pertenece a una cuenta',
            async () => {
                await page.goto('/portal/register');

                await expect(
                    page.locator('#portal-register-submit')
                ).toHaveCount(1);
            }
        );

        await test.step(
            'CUANDO intenta registrar nuevamente el mismo correo',
            async () => {
                await page.locator('#register-name').fill(user.fullName);
                await page.locator('#register-email').fill(user.email);
                await page.locator('#register-password').fill(user.password);
                await page.locator('#portal-register-submit').click();
            }
        );

        await test.step(
            'ENTONCES el sistema rechaza el nuevo registro',
            async () => {
                const error = page.locator('#portal-register-error');

                await expect(error).toHaveCount(1);
                await expect(error).toBeVisible();

                await expect(error).toContainText('email_taken');

                await expect(page).toHaveURL(/\/portal\/register/);

                await expect(
                    page.locator('#global-nav-account')
                ).toHaveCount(0);

                await expect(
                    page.locator('#global-nav-logout')
                ).toHaveCount(0);
            }
        );

        await testInfo.attach(
            'evidencia-correo-duplicado',
            {
                body: await page.screenshot(),
                contentType: 'image/png',
            }
        );
    }
);