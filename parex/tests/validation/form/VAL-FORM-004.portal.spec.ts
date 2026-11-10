import {
    test,
    expect,
} from '@playwright/test';

import {
    NO_SESSION,
    startFreshFormProcess,
} from '../../support/uc3/fresh-user';


// Cada test registra su propio usuario: el formulario es uno por usuario y persiste.
test.use({ storageState: NO_SESSION });

test.setTimeout(150_000);

const FIELDS = [
    'monthly-income',
    'monthly-expenses',
    'total-assets',
    'total-liabilities',
] as const;

const field = (name: string) =>
    `#process-form-${name}`;

test(
    'VAL-FORM-004 · los montos del perfil financiero se escriben limpios: puntos de miles, sin ceros a la izquierda y el cero es válido',
    async ({ page }, testInfo) => {
        await test.step(
            'PREPARACIÓN · un usuario nuevo tiene un proceso en etapa Formulario, con el formulario vacío',
            async () => {
                await startFreshFormProcess(page);
            }
        );

        await test.step(
            'DADO los cuatro montos, que parten en 0',
            async () => {
                for (const name of FIELDS) {
                    await expect(
                        page.locator(field(name))
                    ).toHaveValue('0');
                }
            }
        );

        await test.step(
            'CUANDO se entra a un monto ENTONCES el 0 inicial queda seleccionado y escribir lo reemplaza',
            async () => {
                await page.locator(field('monthly-income')).click();
                await page.keyboard.type('5');

                await expect(
                    page.locator(field('monthly-income'))
                ).toHaveValue('5');
            }
        );

        await test.step(
            'Y se agrupan los miles mientras se escribe',
            async () => {
                await page.locator(field('monthly-income')).fill('');
                await page
                    .locator(field('monthly-income'))
                    .pressSequentially('12000000');

                await expect(
                    page.locator(field('monthly-income'))
                ).toHaveValue('12.000.000');
            }
        );

        await test.step(
            'Y los ceros a la izquierda se quitan y los símbolos y letras se descartan',
            async () => {
                await page.locator(field('monthly-expenses')).fill('005000000');

                await expect(
                    page.locator(field('monthly-expenses'))
                ).toHaveValue('5.000.000');

                await page
                    .locator(field('total-assets'))
                    .fill('$ 20.000.000 COP');

                await expect(
                    page.locator(field('total-assets'))
                ).toHaveValue('20.000.000');

                await page.locator(field('total-liabilities')).fill('');
                await page
                    .locator(field('total-liabilities'))
                    .pressSequentially('1a0-0');

                await expect(
                    page.locator(field('total-liabilities'))
                ).toHaveValue('100');
            }
        );

        await test.step(
            'Y cero es un monto válido, pero dejarlo vacío no',
            async () => {
                await page.locator(field('total-liabilities')).fill('000');

                await expect(
                    page.locator(field('total-liabilities'))
                ).toHaveValue('0');

                await expect(
                    page.locator(field('total-liabilities'))
                ).not.toHaveClass(/ng-invalid/);

                await page.locator(field('total-liabilities')).fill('');

                await expect(
                    page.locator(field('total-liabilities'))
                ).toHaveClass(/ng-invalid/);
            }
        );

        await test.step(
            'ENTONCES borrar justo después de un punto elimina el dígito anterior y no se queda atascado',
            async () => {
                await page.locator(field('total-assets')).fill('1234567'); // 1.234.567

                await page
                    .locator(field('total-assets'))
                    .evaluate((el: HTMLInputElement) =>
                        el.setSelectionRange(2, 2) // 1.|234.567
                    );

                await page.keyboard.press('Backspace');

                await expect(
                    page.locator(field('total-assets'))
                ).toHaveValue('234.567');
            }
        );

        await testInfo.attach(
            'evidencia-montos',
            {
                body: await page.screenshot({ fullPage: true }),
                contentType: 'image/png',
            }
        );
    }
);
