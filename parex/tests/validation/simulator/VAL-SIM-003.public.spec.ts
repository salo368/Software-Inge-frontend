import {
    test,
    expect,
} from '@playwright/test';

test.setTimeout(120_000);

const HERO = '.glass-card';

test(
    'VAL-SIM-003 · sin datos del mercado el resumen no inventa tasas de 0 %, y avisa cuando ninguna entidad cubre lo pedido',
    async ({ page }, testInfo) => {
        await test.step(
            'DADO el simulador recién abierto, sin haber simulado',
            async () => {
                await page.goto('/');

                await expect(
                    page.locator('#simulator-submit')
                ).toBeVisible();
            }
        );

        await test.step(
            'ENTONCES el resumen muestra guiones y pide simular, en vez de 0.00 %',
            async () => {
                await expect(
                    page.locator('#simulator-market-dash')
                ).toHaveCount(2);

                await expect(
                    page.locator(HERO)
                ).not.toContainText('0.00');

                await expect(
                    page.locator('#simulator-market-hint')
                ).toHaveText('Simula para ver las tasas del mercado.');
            }
        );

        await test.step(
            'CUANDO se simula un plazo que ninguna entidad ofrece (1 día)',
            async () => {
                await page.locator('#simulator-term-custom').fill('1');

                const response = page.waitForResponse(
                    (r) =>
                        r.request().method() === 'GET' &&
                        r.url().includes('/banks/simulate'),
                    { timeout: 60_000 }
                );

                await page.locator('#simulator-submit').click();

                expect((await response).ok()).toBeTruthy();
            }
        );

        await test.step(
            'ENTONCES se explica que ninguna entidad cubre ese monto y plazo, sin tarjetas ni 0.00 %',
            async () => {
                await expect(
                    page.locator('#simulator-no-results')
                ).toBeVisible({ timeout: 30_000 });

                await expect(
                    page.locator('#simulator-no-results')
                ).toContainText('Ninguna entidad cubre ese monto y plazo');

                await expect(
                    page.locator('[id^="simulator-offer-open-"]')
                ).toHaveCount(0);

                await expect(
                    page.locator('#simulator-market-dash')
                ).toHaveCount(2);

                await expect(
                    page.locator(HERO)
                ).not.toContainText('0.00');

                await expect(
                    page.locator('#simulator-market-hint')
                ).toHaveText('Ninguna entidad cubre ese monto y plazo.');
            }
        );

        await test.step(
            'Y la tarjeta de resumen no cambia de alto entre un estado y otro',
            async () => {
                const sinCobertura = Math.round(
                    (await page.locator(HERO).boundingBox())!.height
                );

                await page.locator('#simulator-term-360').click();

                await expect(
                    page.locator('#simulator-results')
                ).toBeVisible({ timeout: 30_000 });

                const conTasas = Math.round(
                    (await page.locator(HERO).boundingBox())!.height
                );

                expect(conTasas).toBe(sinCobertura);
            }
        );

        await testInfo.attach(
            'evidencia-resumen-mercado',
            {
                body: await page.screenshot({ fullPage: true }),
                contentType: 'image/png',
            }
        );
    }
);
