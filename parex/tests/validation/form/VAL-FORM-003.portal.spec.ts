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

const BIRTH = 'process-form-birth-date';
const ISSUANCE = 'process-form-document-issuance-date';
const ERROR = '#process-form-section-personal .date-field-error';

test(
    'VAL-FORM-003 · las fechas se escriben con máscara dd/mm/aaaa o se eligen en un calendario con mes y año',
    async ({ page }, testInfo) => {
        await test.step(
            'PREPARACIÓN · un usuario nuevo tiene un proceso en etapa Formulario, con el formulario vacío',
            async () => {
                await startFreshFormProcess(page);
            }
        );

        await test.step(
            'DADO una fecha vacía con su formato a la vista',
            async () => {
                await expect(
                    page.locator(`#${BIRTH}`)
                ).toHaveAttribute('placeholder', 'dd/mm/aaaa');
            }
        );

        await test.step(
            'CUANDO se teclean solo los números ENTONCES las barras aparecen solas',
            async () => {
                await page.locator(`#${BIRTH}`).pressSequentially('02111999');

                await expect(
                    page.locator(`#${BIRTH}`)
                ).toHaveValue('02/11/1999');

                await expect(
                    page.locator(ERROR)
                ).toHaveCount(0);
            }
        );

        await test.step(
            'Y una fecha en formato ISO (1990-05-17) también se acepta y se muestra como dd/mm/aaaa',
            async () => {
                await page.locator(`#${BIRTH}`).fill('1990-05-17');

                await expect(
                    page.locator(`#${BIRTH}`)
                ).toHaveValue('17/05/1990');
            }
        );

        await test.step(
            'Y una fecha que no existe se explica y se marca en rojo',
            async () => {
                await page.locator(`#${BIRTH}`).fill('');
                await page.locator(`#${BIRTH}`).pressSequentially('31022000');

                await expect(
                    page.locator(ERROR)
                ).toHaveText('Esa fecha no existe.');

                await expect(
                    page.locator(`#${BIRTH}`)
                ).toHaveClass(/is-invalid/);
            }
        );

        await test.step(
            'Y una fecha futura no se acepta',
            async () => {
                await page.locator(`#${BIRTH}`).fill('');
                await page.locator(`#${BIRTH}`).pressSequentially('01012999');

                await expect(
                    page.locator(ERROR)
                ).toContainText('futura');
            }
        );

        await test.step(
            'Y salir con la fecha a medias avisa que hay que completarla',
            async () => {
                await page.locator(`#${BIRTH}`).fill('');
                await page.locator(`#${BIRTH}`).pressSequentially('0211');
                await page.locator('#process-form-name').click();

                await expect(
                    page.locator(ERROR)
                ).toContainText('completa');
            }
        );

        await test.step(
            'ENTONCES el calendario abre cerca de una edad adulta y se llega a un año lejano con los selectores',
            async () => {
                await page.locator(`#${BIRTH}`).fill('');
                await page.locator(`#${BIRTH}-toggle`).click();

                const calendar = page.locator(`#${BIRTH}-calendar`);

                await expect(calendar).toBeVisible();

                await expect(
                    calendar.locator('.date-select-year')
                ).toHaveValue(String(new Date().getFullYear() - 30));

                await calendar.locator('.date-select-year').selectOption('1990');
                await calendar.locator('.date-select-month').selectOption('4'); // mayo
                await calendar.locator('button[data-iso="1990-05-17"]').click();

                await expect(calendar).toHaveCount(0);

                await expect(
                    page.locator(`#${BIRTH}`)
                ).toHaveValue('17/05/1990');

                await expect(
                    page.locator(`#${BIRTH}`)
                ).toBeFocused();
            }
        );

        await test.step(
            'Y al reabrirlo el día elegido queda marcado, y Escape lo cierra devolviendo el foco al campo',
            async () => {
                await page.locator(`#${BIRTH}-toggle`).click();

                await expect(
                    page.locator(`#${BIRTH}-calendar button.selected`)
                ).toHaveAttribute('data-iso', '1990-05-17');

                await page.keyboard.press('Escape');

                await expect(
                    page.locator(`#${BIRTH}-calendar`)
                ).toHaveCount(0);

                await expect(
                    page.locator(`#${BIRTH}`)
                ).toBeFocused();
            }
        );

        await test.step(
            'Y en el calendario hoy se puede elegir y mañana no',
            async () => {
                // Sin fecha, el calendario abre en el mes de hoy; la cuadrícula
                // siempre incluye también mañana (del mismo mes o del relleno
                // del siguiente), así que esta comprobación es determinista.
                await page.locator(`#${ISSUANCE}-toggle`).click();

                const iso = (d: Date) =>
                    [
                        d.getFullYear(),
                        String(d.getMonth() + 1).padStart(2, '0'),
                        String(d.getDate()).padStart(2, '0'),
                    ].join('-');

                const today = new Date();
                const tomorrow = new Date();
                tomorrow.setDate(today.getDate() + 1);

                const calendar = page.locator(`#${ISSUANCE}-calendar`);

                await expect(
                    calendar.locator(`button[data-iso="${iso(today)}"]`)
                ).toBeEnabled();

                await expect(
                    calendar.locator(`button[data-iso="${iso(tomorrow)}"]`)
                ).toBeDisabled();

                await page.keyboard.press('Escape');
            }
        );

        await testInfo.attach(
            'evidencia-fechas',
            {
                body: await page.screenshot({ fullPage: true }),
                contentType: 'image/png',
            }
        );
    }
);
