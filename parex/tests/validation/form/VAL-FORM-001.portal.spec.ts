import {
    test,
    expect,
} from '@playwright/test';

import {
    NO_SESSION,
    startFreshFormProcess,
} from '../../support/uc3/fresh-user';


import {
    pickSearchOption,
    visibleOptionKeys,
} from '../../support/uc3/form-controls';

// Cada test registra su propio usuario: el formulario es uno por usuario y persiste.
test.use({ storageState: NO_SESSION });

test.setTimeout(150_000);

const NATIONALITY = 'process-form-nationality';
const BIRTH_COUNTRY = 'process-form-birth-country';
const BIRTH_DEPARTMENT = 'process-form-birth-department';
const BIRTH_CITY = 'process-form-birth-city';

test(
    'VAL-FORM-001 · los selectores de listas largas son buscadores: ordenan por relevancia, ignoran tildes y se acotan',
    async ({ page }, testInfo) => {
        await test.step(
            'PREPARACIÓN · un usuario nuevo tiene un proceso en etapa Formulario, con el formulario vacío',
            async () => {
                await startFreshFormProcess(page);
            }
        );

        await test.step(
            'DADO la nacionalidad, que por defecto es Colombia',
            async () => {
                await expect(
                    page.locator(`#${NATIONALITY}`)
                ).toHaveValue('Colombia');
            }
        );

        await test.step(
            'CUANDO se abre la lista sin escribir ENTONCES Colombia va primero y la lista es acotada',
            async () => {
                await page.locator(`#${NATIONALITY}`).click();

                const keys = await visibleOptionKeys(page, NATIONALITY);

                expect(keys[0]).toBe('COLOMBIA');
                expect(keys.length).toBeLessThanOrEqual(50);

                await expect(
                    page.locator(`#${NATIONALITY}-list .combo-more`)
                ).toContainText(/Mostrando 50 de \d+/);

                const height = await page
                    .locator(`#${NATIONALITY}-list`)
                    .evaluate((el) => Math.round(el.getBoundingClientRect().height));

                expect(
                    height,
                    'el panel tiene un alto máximo aunque haya cientos de países'
                ).toBeLessThanOrEqual(260);
            }
        );

        await test.step(
            'Y al escribir "ale" la mejor coincidencia va primero y se resalta lo escrito',
            async () => {
                await page.locator(`#${NATIONALITY}`).fill('ale');

                const keys = await visibleOptionKeys(page, NATIONALITY);

                expect(keys[0]).toBe('ALEMANIA');

                await expect(
                    page.locator(`#${NATIONALITY}-list .combo-option mark`).first()
                ).toHaveText('Ale');

                await page.keyboard.press('Enter');

                await expect(
                    page.locator(`#${NATIONALITY}`)
                ).toHaveValue('Alemania');

                // Enter elige y NO envía el formulario.
                await expect(
                    page.locator('#process-form')
                ).toBeVisible();
            }
        );

        await test.step(
            'Y la ciudad espera al departamento',
            async () => {
                await expect(
                    page.locator(`#${BIRTH_CITY}`)
                ).toHaveAttribute('placeholder', 'Elige primero el departamento');

                await page.locator(`#${BIRTH_CITY}`).click();

                await expect(
                    page.locator(`#${BIRTH_CITY}-list .combo-empty`)
                ).toContainText('Elige primero el departamento');

                await page.keyboard.press('Escape');
            }
        );

        await test.step(
            'Y se busca sin tildes ("quindio" encuentra Quindío) y la ciudad se elige dentro de ese departamento',
            async () => {
                await pickSearchOption(page, BIRTH_DEPARTMENT, 'QUINDIO', 'quindio');

                await expect(
                    page.locator(`#${BIRTH_DEPARTMENT}`)
                ).toHaveValue('Quindío');

                await pickSearchOption(page, BIRTH_CITY, 'ARMENIA');

                await expect(
                    page.locator(`#${BIRTH_CITY}`)
                ).toHaveValue('Armenia');
            }
        );

        await test.step(
            'Y cambiar el departamento borra la ciudad que ya no corresponde',
            async () => {
                await pickSearchOption(page, BIRTH_DEPARTMENT, 'NARINO', 'narino');

                await expect(
                    page.locator(`#${BIRTH_DEPARTMENT}`)
                ).toHaveValue('Nariño');

                await expect(
                    page.locator(`#${BIRTH_CITY}`)
                ).toHaveValue('');
            }
        );

        await test.step(
            'Y un texto que no es ninguna opción avisa y, al salir, vuelve a la última elección',
            async () => {
                await page.locator(`#${BIRTH_COUNTRY}`).click();
                await page.locator(`#${BIRTH_COUNTRY}`).fill('zzzzz');

                await expect(
                    page.locator(`#${BIRTH_COUNTRY}-list .combo-empty`)
                ).toContainText('Sin resultados');

                await page.locator('#process-form-name').click();

                await expect(
                    page.locator(`#${BIRTH_COUNTRY}`)
                ).toHaveValue('Colombia');
            }
        );

        await test.step(
            'Y fuera de Colombia, departamento y ciudad pasan a texto libre',
            async () => {
                await pickSearchOption(page, BIRTH_COUNTRY, 'PERU');

                await expect(
                    page.locator(`#${BIRTH_DEPARTMENT}`)
                ).toBeVisible();

                await expect(
                    page.locator(`#${BIRTH_DEPARTMENT}[role="combobox"]`)
                ).toHaveCount(0);
            }
        );

        await testInfo.attach(
            'evidencia-buscadores',
            {
                body: await page.screenshot({ fullPage: true }),
                contentType: 'image/png',
            }
        );
    }
);
