import {
    test,
    expect,
    type Page,
} from '@playwright/test';

test.setTimeout(150_000);

const CUSTOM = '#simulator-term-custom';
const HERO = '.glass-card';

async function simulate(
    page: Page,
    trigger: () => Promise<void>
): Promise<URLSearchParams> {
    const response = page.waitForResponse(
        (r) =>
            r.request().method() === 'GET' &&
            r.url().includes('/banks/simulate'),
        { timeout: 60_000 }
    );

    await trigger();

    return new URL((await response).url()).searchParams;
}

test(
    'VAL-SIM-002 · además de los plazos fijos, se puede simular con un plazo propio en días',
    async ({ page }, testInfo) => {
        await test.step(
            'DADO el simulador con sus plazos fijos y un campo para otro plazo',
            async () => {
                await page.goto('/');

                for (const days of [90, 180, 360, 540, 720]) {
                    await expect(
                        page.locator(`#simulator-term-${days}`)
                    ).toBeVisible();
                }

                await expect(
                    page.locator(CUSTOM)
                ).toBeVisible();
            }
        );

        await test.step(
            'CUANDO se escribe un plazo en días y se pulsa Enter ENTONCES se simula con ese plazo',
            async () => {
                await page.locator(CUSTOM).fill('200');

                const params = await simulate(
                    page,
                    () => page.locator(CUSTOM).press('Enter')
                );

                expect(params.get('term')).toBe('200');

                await expect(
                    page.locator('#simulator-results')
                ).toBeVisible({ timeout: 30_000 });

                await expect(
                    page.locator('[id^="simulator-offer-open-"]').first()
                ).toBeVisible();
            }
        );

        await test.step(
            'Y el resumen del mercado habla del plazo simulado, con tasas reales',
            async () => {
                await expect(
                    page.locator(HERO)
                ).toContainText('200 dias');

                await expect(
                    page.locator(HERO)
                ).toContainText(/\d+\.\d{2}%/);

                await expect(
                    page.locator(HERO)
                ).not.toContainText('0.00%');
            }
        );

        await test.step(
            'Y si se cambia el plazo sin simular de nuevo, el resumen no cambia de plazo',
            async () => {
                await page.locator(CUSTOM).fill('250');

                await expect(
                    page.locator(HERO)
                ).toContainText('200 dias');

                await expect(
                    page.locator(HERO)
                ).not.toContainText('250 dias');
            }
        );

        await test.step(
            'Y un plazo fijo vuelve a simular y deja vacío el plazo propio',
            async () => {
                const params = await simulate(
                    page,
                    () => page.locator('#simulator-term-540').click()
                );

                expect(params.get('term')).toBe('540');

                await expect(
                    page.locator(CUSTOM)
                ).toHaveValue('');

                await expect(
                    page.locator('#simulator-term-540')
                ).toHaveClass(/active/);
            }
        );

        await test.step(
            'Y un plazo inválido (vacío, cero) impide simular',
            async () => {
                // '0' primero: escribir '' en un campo que ya está vacío no dispara
                // ningún evento y la aplicación no se entera.
                for (const invalid of ['0', '']) {
                    await page.locator(CUSTOM).fill(invalid);

                    await expect(
                        page.locator('#simulator-submit')
                    ).toBeDisabled();
                }
            }
        );

        await test.step(
            'Y teclear justo un plazo fijo no borra el campo mientras se escribe',
            async () => {
                await page.locator(CUSTOM).fill('');
                await page.locator(CUSTOM).pressSequentially('90');

                await expect(
                    page.locator(CUSTOM)
                ).toHaveValue('90');
            }
        );

        await testInfo.attach(
            'evidencia-plazo-propio',
            {
                body: await page.screenshot({ fullPage: true }),
                contentType: 'image/png',
            }
        );
    }
);
