import {
    test,
    expect,
    type Page,
} from '@playwright/test';

test.setTimeout(120_000);

const AMOUNT = '#simulator-investment-amount';

/** Espera la simulación que dispara el usuario y devuelve sus parámetros. */
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
    'VAL-SIM-001 · el monto se escribe limpio: sin ceros a la izquierda, con puntos de miles y solo números',
    async ({ page }, testInfo) => {
        await test.step(
            'DADO el simulador con su monto inicial',
            async () => {
                await page.goto('/');

                await expect(
                    page.locator(AMOUNT)
                ).toBeVisible();

                await expect(
                    page.locator(AMOUNT)
                ).toHaveValue(/^\d{1,3}(\.\d{3})+$/);
            }
        );

        await test.step(
            'CUANDO se escribe con ceros a la izquierda ENTONCES se limpian y se agrupan los miles',
            async () => {
                await page.locator(AMOUNT).fill('005000000');

                await expect(
                    page.locator(AMOUNT)
                ).toHaveValue('5.000.000');
            }
        );

        await test.step(
            'Y se pega con símbolos y letras ENTONCES solo quedan los números',
            async () => {
                await page.locator(AMOUNT).fill('$ 12.500.000 COP');

                await expect(
                    page.locator(AMOUNT)
                ).toHaveValue('12.500.000');
            }
        );

        await test.step(
            'Y no admite más dígitos de los que el sistema puede guardar',
            async () => {
                await page.locator(AMOUNT).fill('9'.repeat(20));

                await expect(
                    page.locator(AMOUNT)
                ).toHaveValue('9.999.999.999.999');
            }
        );

        await test.step(
            'Y un cero solo no es un monto: queda vacío y no se puede simular',
            async () => {
                await page.locator(AMOUNT).fill('0');

                await expect(
                    page.locator(AMOUNT)
                ).toHaveValue('');

                await expect(
                    page.locator('#simulator-submit')
                ).toBeDisabled();
            }
        );

        await test.step(
            'ENTONCES la simulación recibe el número limpio, sin puntos ni ceros',
            async () => {
                await page.locator(AMOUNT).fill('089000000');

                await expect(
                    page.locator(AMOUNT)
                ).toHaveValue('89.000.000');

                await page.locator('#simulator-term-540').click();

                const params = await simulate(
                    page,
                    () => page.locator('#simulator-submit').click()
                );

                expect(params.get('amount')).toBe('89000000');
                expect(params.get('term')).toBe('540');
            }
        );

        await testInfo.attach(
            'evidencia-monto',
            {
                body: await page.screenshot({ fullPage: true }),
                contentType: 'image/png',
            }
        );
    }
);
