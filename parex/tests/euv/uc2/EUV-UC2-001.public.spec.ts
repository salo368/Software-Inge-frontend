import { test, expect } from '@playwright/test';

test(
    'EUV-UC2-001 · registrar una cuenta de inversionista',
    async ({ page }, testInfo) => {

        const runId = Date.now();

        const testData = {
            fullName: 'Usuario PAREX E2E',
            email: `parex.e2e.${runId}@example.com`,
            password: 'ParexTest2026!',
        };

        await test.step(
            'DADO una persona sin sesión autenticada y con un correo no registrado',
            async () => {
                await page.goto('/portal/register');

                await expect(page.locator('#register-name')).toHaveCount(1);
                await expect(page.locator('#register-email')).toHaveCount(1);
                await expect(page.locator('#register-password')).toHaveCount(1);
                await expect(page.locator('#portal-register-submit')).toHaveCount(1);
            }
        );

        await test.step(
            'CUANDO diligencia sus datos y solicita crear la cuenta',
            async () => {
                await page.locator('#register-name')
                    .fill(testData.fullName);

                await page.locator('#register-email')
                    .fill(testData.email);

                await page.locator('#register-password')
                    .fill(testData.password);

                await page.locator('#portal-register-submit')
                    .click();
            }
        );

        await test.step(
            'ENTONCES el sistema crea la cuenta y establece una sesión autenticada',
            async () => {
                await expect(
                    page.locator('#global-nav-account')
                ).toBeVisible({ timeout: 15_000 });

                await expect(
                    page.locator('#global-nav-logout')
                ).toBeVisible();

                await expect(
                    page.locator('#global-nav-login')
                ).toHaveCount(0);

                await expect(
                    page.locator('#global-user-name')
                ).toContainText(testData.fullName);
            }
        );

        await testInfo.attach(
            'evidencia-registro-cuenta',
            {
                body: await page.screenshot(),
                contentType: 'image/png',
            }
        );
    }
);