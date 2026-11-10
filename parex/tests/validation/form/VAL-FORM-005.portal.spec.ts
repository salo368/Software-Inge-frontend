import {
    test,
    expect,
} from '@playwright/test';

import {
    NO_SESSION,
    startFreshFormProcess,
} from '../../support/uc3/fresh-user';


import {
    visibleOptionKeys,
} from '../../support/uc3/form-controls';

// Cada test registra su propio usuario: el formulario es uno por usuario y persiste.
test.use({ storageState: NO_SESSION });

test.setTimeout(150_000);

const DIAL = 'process-form-phone-ext';
const FLAG = '#process-form-section-contact .combo-flag';

test(
    'VAL-FORM-005 · el indicativo se elige con banderas y se busca por país o por número',
    async ({ page }, testInfo) => {
        await test.step(
            'PREPARACIÓN · un usuario nuevo tiene un proceso en etapa Formulario, con el formulario vacío',
            async () => {
                await startFreshFormProcess(page);
            }
        );

        await test.step(
            'DADO el indicativo, que por defecto es Colombia: bandera y solo el número',
            async () => {
                await expect(
                    page.locator(`#${DIAL}`)
                ).toHaveValue('+57');

                await expect(
                    page.locator(FLAG)
                ).toHaveClass(/fi-co/);
            }
        );

        await test.step(
            'Y la bandera es una imagen real servida con la propia aplicación',
            async () => {
                const flag = await page.locator(FLAG).evaluate(async (el) => {
                    const url = getComputedStyle(el)
                        .backgroundImage
                        .match(/url\("?(.*?)"?\)/)![1];

                    const response = await fetch(url);

                    return {
                        status: response.status,
                        type: response.headers.get('content-type') ?? '',
                        sameOrigin: new URL(url, location.href).origin === location.origin,
                    };
                });

                expect(flag.status).toBe(200);
                expect(flag.type).toContain('svg');
                expect(flag.sameOrigin).toBe(true);
            }
        );

        await test.step(
            'CUANDO se abre la lista ENTONCES muestra país e indicativo, con Colombia primero, en un panel más ancho que el campo',
            async () => {
                await page.locator(`#${DIAL}`).click();

                const keys = await visibleOptionKeys(page, DIAL);

                expect(keys[0]).toBe('CO');

                await expect(
                    page.locator(`#${DIAL}-list .combo-option[data-key="CO"] .combo-hint`)
                ).toHaveText('+57');

                await expect(
                    page.locator(`#${DIAL}-list .combo-option[data-key="CO"] .combo-icon`)
                ).toHaveClass(/fi-co/);

                const widths = await page.evaluate((id) => ({
                    panel: document.querySelector(`#${id}-list`)!.getBoundingClientRect().width,
                    field: document.querySelector(`#${id}`)!.getBoundingClientRect().width,
                }), DIAL);

                expect(widths.panel).toBeGreaterThan(widths.field);
            }
        );

        await test.step(
            'Y se busca por número, con o sin "+": 34 es solo España y 57 no trae a Burundi ni a Chipre',
            async () => {
                await page.locator(`#${DIAL}`).fill('34');

                expect(
                    await visibleOptionKeys(page, DIAL)
                ).toEqual(['ES']);

                await page.locator(`#${DIAL}`).fill('+57');

                expect(
                    await visibleOptionKeys(page, DIAL)
                ).toEqual(['CO']);
            }
        );

        await test.step(
            'Y con un código compartido (+1) salen todos los países, con Estados Unidos primero',
            async () => {
                await page.locator(`#${DIAL}`).fill('+1');

                const keys = await visibleOptionKeys(page, DIAL);

                expect(keys[0]).toBe('US');
                expect(keys).toContain('CA');
            }
        );

        await test.step(
            'Y elegir por nombre cambia el número y la bandera',
            async () => {
                await page.locator(`#${DIAL}`).fill('venez');
                await page.keyboard.press('Enter');

                await expect(
                    page.locator(`#${DIAL}`)
                ).toHaveValue('+58');

                await expect(
                    page.locator(FLAG)
                ).toHaveClass(/fi-ve/);
            }
        );

        await test.step(
            'ENTONCES dos países con el mismo código se distinguen: Canadá y Estados Unidos son ambos +1',
            async () => {
                await page.locator(`#${DIAL}`).fill('+1');
                await page.locator(`#${DIAL}-list .combo-option[data-key="CA"]`).click();

                await expect(
                    page.locator(`#${DIAL}`)
                ).toHaveValue('+1');

                await expect(
                    page.locator(FLAG)
                ).toHaveClass(/fi-ca/);
            }
        );

        await testInfo.attach(
            'evidencia-indicativo',
            {
                body: await page.screenshot({ fullPage: true }),
                contentType: 'image/png',
            }
        );
    }
);
