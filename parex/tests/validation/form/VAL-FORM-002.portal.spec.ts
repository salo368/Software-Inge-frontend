import {
    test,
    expect,
} from '@playwright/test';

import {
    NO_SESSION,
    startFreshFormProcess,
} from '../../support/uc3/fresh-user';


import {
    pickFixedOption,
    visibleOptionKeys,
} from '../../support/uc3/form-controls';

// Cada test registra su propio usuario: el formulario es uno por usuario y persiste.
test.use({ storageState: NO_SESSION });

test.setTimeout(150_000);

const CIVIL = 'process-form-civil-status';
const GENDER = 'process-form-gender';
const DOCUMENT_TYPE = 'process-form-document-type';

test(
    'VAL-FORM-002 · los selectores cortos abren su lista con un clic, se manejan con el teclado y son obligatorios',
    async ({ page }, testInfo) => {
        await test.step(
            'PREPARACIÓN · un usuario nuevo tiene un proceso en etapa Formulario, con el formulario vacío',
            async () => {
                await startFreshFormProcess(page);
            }
        );

        await test.step(
            'DADO un selector corto: se ve como un select, no como una caja de texto',
            async () => {
                await expect(
                    page.locator(`#${CIVIL}`)
                ).toHaveAttribute('placeholder', 'Selecciona');

                await expect(
                    page.locator(`#${CIVIL}`)
                ).toHaveAttribute('readonly', '');
            }
        );

        await test.step(
            'CUANDO se pulsa ENTONCES lista todas sus opciones, sin filtrar',
            async () => {
                await page.locator(`#${CIVIL}`).click();

                expect(
                    await visibleOptionKeys(page, CIVIL)
                ).toEqual(['SINGLE', 'MARRIED', 'DIVORCED', 'WIDOWED']);

                await page.keyboard.press('Escape');
            }
        );

        await test.step(
            'Y el tipo de documento trae Cédula de ciudadanía por defecto',
            async () => {
                await expect(
                    page.locator(`#${DOCUMENT_TYPE}`)
                ).toHaveValue('Cedula de ciudadania');

                await page.locator(`#${DOCUMENT_TYPE}`).click();

                expect(
                    await visibleOptionKeys(page, DOCUMENT_TYPE)
                ).toEqual(['CC', 'CE', 'TI', 'PA']);

                await page.keyboard.press('Escape');
            }
        );

        await test.step(
            'Y elegir con el clic guarda la opción y marca la actual al reabrir',
            async () => {
                await pickFixedOption(page, CIVIL, 'MARRIED');

                await expect(
                    page.locator(`#${CIVIL}`)
                ).toHaveValue('Casado(a)');

                await page.locator(`#${CIVIL}`).click();

                await expect(
                    page.locator(`#${CIVIL}-list .combo-option.selected`)
                ).toHaveAttribute('data-key', 'MARRIED');

                // Escribir no convierte el selector en una caja de texto.
                await page.keyboard.type('zzz');

                await expect(
                    page.locator(`#${CIVIL}`)
                ).toHaveValue('Casado(a)');

                await page.keyboard.press('Escape');

                await expect(
                    page.locator(`#${CIVIL}-list`)
                ).toHaveCount(0);
            }
        );

        await test.step(
            'Y con el teclado: una letra salta a la opción, las flechas se mueven y Enter elige sin enviar el formulario',
            async () => {
                await page.locator(`#${CIVIL}`).focus();
                await page.keyboard.press('v');

                await expect(
                    page.locator(`#${CIVIL}-list .combo-option.active`)
                ).toHaveAttribute('data-key', 'WIDOWED');

                await page.keyboard.press('ArrowUp');
                await page.keyboard.press('Enter');

                await expect(
                    page.locator(`#${CIVIL}`)
                ).toHaveValue('Divorciado(a)');

                await expect(
                    page.locator('#process-form')
                ).toBeVisible();
            }
        );

        await test.step(
            'ENTONCES un selector obligatorio sin elegir marca el error al enviar y no deja avanzar',
            async () => {
                await expect(
                    page.locator(`#${GENDER}`)
                ).toHaveValue('');

                await page.locator('#process-form-submit').click();

                await expect(
                    page.locator(`#${GENDER}`)
                ).toHaveClass(/is-invalid/);

                await expect(
                    page.locator('#process-form-error')
                ).toBeVisible();

                await expect(
                    page.locator('#process-stage-form')
                ).toBeVisible();
            }
        );

        await testInfo.attach(
            'evidencia-selectores-cortos',
            {
                body: await page.screenshot({ fullPage: true }),
                contentType: 'image/png',
            }
        );
    }
);
