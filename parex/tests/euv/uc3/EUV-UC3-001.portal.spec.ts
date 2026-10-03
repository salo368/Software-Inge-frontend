import {
    test,
    expect,
} from '@playwright/test';

import {
    prepareSimulatorOffer,
} from '../../support/uc3/process-flow';

test.setTimeout(120_000);

test(
    'EUV-UC3-001 · iniciar una adquisición de CDT',
    async ({ page }, testInfo) => {
        let processId = '';

        /*
         * ============================================================
         * PREPARACIÓN
         * ============================================================
         *
         * Dejamos disponible una alternativa.
         *
         * NO abrimos todavía el CDT porque esa acción pertenece
         * al comportamiento evaluado por este EUV.
         */
        const context = await test.step(
            'PREPARACIÓN · inversionista autenticado y alternativa disponible',
            async () => {
                return await prepareSimulatorOffer(
                    page
                );
            }
        );

        const {
            amount,
            termDays,
            selectedBankId,
        } = context;

        /*
         * ============================================================
         * EUV
         * ============================================================
         */

        await test.step(
            'DADO una alternativa disponible para continuar la adquisición',
            async () => {
                await expect(
                    page.locator(
                        `#simulator-offer-${selectedBankId}`
                    )
                ).toBeVisible();

                await expect(
                    page.locator(
                        `#simulator-offer-open-${selectedBankId}`
                    )
                ).toBeVisible();
            }
        );

        await test.step(
            'CUANDO solicita abrir el CDT seleccionado',
            async () => {
                await Promise.all([
                    page.waitForURL(
                        /\/portal\/process\/[^/?#]+/,
                        {
                            timeout: 15_000,
                        }
                    ),

                    page
                        .locator(
                            `#simulator-offer-open-${selectedBankId}`
                        )
                        .click(),
                ]);
            }
        );

        await test.step(
            'ENTONCES el sistema crea un proceso identificable para continuar la adquisición',
            async () => {
                const pathname =
                    new URL(page.url()).pathname;

                const match = pathname.match(
                    /^\/portal\/process\/([^/?#]+)$/
                );

                expect(
                    match,
                    'la navegación debe contener un identificador de proceso'
                ).not.toBeNull();

                processId = match![1];

                expect(
                    processId.length,
                    'el processId no puede estar vacío'
                ).toBeGreaterThan(0);

                /*
                 * Primer estado observable del proceso.
                 */
                await expect(
                    page.locator('#process-stage-form')
                ).toBeVisible();

                await expect(
                    page.locator('#process-form')
                ).toBeVisible();

                /*
                 * La sesión continúa activa.
                 */
                await expect(
                    page.locator('#global-nav-account')
                ).toBeVisible();

                await expect(
                    page.locator('#global-nav-logout')
                ).toBeVisible();
            }
        );

        /*
         * ============================================================
         * EVIDENCIA
         * ============================================================
         */
        await testInfo.attach(
            'contexto-ejecucion',
            {
                body: Buffer.from(
                    JSON.stringify(
                        {
                            environment:
                                process.env.TEST_ENV ??
                                'dev',

                            euv:
                                'EUV-UC3-001',

                            description:
                                'Iniciar una adquisición de CDT',

                            amount:
                                Number(amount),

                            termDays,

                            selectedBankId,

                            processId,

                            resultingStage:
                                'form',

                            finalUrl:
                                page.url(),
                        },
                        null,
                        2
                    )
                ),

                contentType:
                    'application/json',
            }
        );

        await testInfo.attach(
            'evidencia-proceso-creado',
            {
                body:
                    await page.screenshot({
                        fullPage: true,
                    }),

                contentType:
                    'image/png',
            }
        );
    }
);