import { test as setup, expect } from '@playwright/test';
import fs from 'node:fs';

const target = process.env.TEST_ENV ?? 'dev';

const AUTH_FILE = `.auth/${target}-user.json`;

setup(
    `PRE-${target.toUpperCase()}-AUTH-001 · usuario de pruebas válido y autenticable`,
    async ({ page }) => {

        const email = process.env.TEST_USER_EMAIL;
        const password = process.env.TEST_USER_PASSWORD;

        if (!email || !password) {
            throw new Error(
                `No existen credenciales configuradas para el ambiente ${target.toUpperCase()}. ` +
                `Revisa .env.${target}.local`
            );
        }

        fs.mkdirSync('.auth', { recursive: true });

        await setup.step(
            'DADO un usuario de pruebas con credenciales configuradas para el ambiente',
            async () => {

                await page.goto('/portal/login');

                await expect(
                    page.locator('#login-email')
                ).toHaveCount(1);

                await expect(
                    page.locator('#login-password')
                ).toHaveCount(1);

                await expect(
                    page.locator('#portal-login-submit')
                ).toHaveCount(1);

                await expect(
                    page.locator('#login-email')
                ).toBeVisible();

                await expect(
                    page.locator('#login-password')
                ).toBeVisible();

                await expect(
                    page.locator('#portal-login-submit')
                ).toBeVisible();
            }
        );

        await setup.step(
            'CUANDO el usuario intenta autenticarse',
            async () => {

                await page
                    .locator('#login-email')
                    .fill(email);

                await page
                    .locator('#login-password')
                    .fill(password);

                await page
                    .locator('#portal-login-submit')
                    .click();
            }
        );

        await setup.step(
            'ENTONCES el ambiente acepta las credenciales y establece una sesión autenticada',
            async () => {

                const authenticated =
                    page.locator('#global-nav-account');

                const loginError =
                    page.locator('#portal-login-error');

                const result = await Promise.race([
                    authenticated
                        .waitFor({
                            state: 'visible',
                            timeout: 15_000,
                        })
                        .then(() => 'authenticated' as const),

                    loginError
                        .waitFor({
                            state: 'visible',
                            timeout: 15_000,
                        })
                        .then(() => 'rejected' as const),
                ]);

                if (result === 'rejected') {
                    const message =
                        (await loginError.textContent())?.trim();

                    throw new Error(
                        `PRE-${target.toUpperCase()}-AUTH-001 no satisfecha: ` +
                        `${target.toUpperCase()} rechazó las credenciales del usuario de pruebas.` +
                        (message
                            ? ` Respuesta visible: "${message}".`
                            : '')
                    );
                }

                await expect(
                    page.locator('#global-nav-account')
                ).toHaveCount(1);

                await expect(
                    page.locator('#global-nav-logout')
                ).toHaveCount(1);

                await expect(
                    page.locator('#global-nav-login')
                ).toHaveCount(0);
            }
        );

        await page.context().storageState({
            path: AUTH_FILE,
        });
    }
);