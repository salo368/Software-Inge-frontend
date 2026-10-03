import {
    test,
    expect,
} from '@playwright/test';

import {
    completeProcessForm,
    createProcessAtFormStage,
    uploadSyntheticDeclaration,
} from '../../support/uc3/process-flow';

test.setTimeout(120_000);

test(
    'EUV-UC3-004 · avanzar de documentación completa a firma',
    async ({ page }, testInfo) => {
        /*
         * ============================================================
         * PREPARACIÓN
         * ============================================================
         *
         * Para este EUV debemos llegar hasta:
         *
         * proceso
         *   ↓
         * formulario completado
         *   ↓
         * documentos
         *   ↓
         * declaración registrada
         *
         * La transición Documentos -> Firma todavía NO se ejecuta.
         */
        const preparation = await test.step(
            'PREPARACIÓN · existe un proceso con documentación registrada',
            async () => {
                const process =
                    await createProcessAtFormStage(
                        page
                    );

                await completeProcessForm(
                    page
                );

                const declaration =
                    await uploadSyntheticDeclaration(
                        page
                    );

                return {
                    process,
                    declaration,
                };
            }
        );

        const {
            process: processContext,
            declaration,
        } = preparation;

        const {
            amount,
            termDays,
            selectedBankId,
            processId,
        } = processContext;

        /*
         * ============================================================
         * EUV
         * ============================================================
         */

        await test.step(
            'DADO un proceso con la documentación requerida registrada',
            async () => {
                await expect(
                    page.locator(
                        '#process-stage-documents'
                    )
                ).toBeVisible();

                await expect(
                    page.locator(
                        '#process-documents-file'
                    )
                ).toBeVisible();

                await expect(
                    page.locator(
                        '#process-documents-file'
                    )
                ).toContainText(
                    declaration.name
                );

                /*
                 * Existe el estímulo específico para abandonar
                 * Documentos.
                 */
                await expect(
                    page.locator(
                        '#process-advance-documents'
                    )
                ).toBeVisible();

                await expect(
                    page.locator(
                        '#process-advance-documents'
                    )
                ).toBeEnabled();

                await expect(
                    page.locator('#process-error')
                ).toHaveCount(0);
            }
        );

        await test.step(
            'CUANDO el inversionista solicita continuar a firma',
            async () => {
                await page
                    .locator(
                        '#process-advance-documents'
                    )
                    .click();
            }
        );

        await test.step(
            'ENTONCES el proceso abandona documentos y avanza a la etapa de firma',
            async () => {
                /*
                 * Oráculo principal.
                 */
                await expect(
                    page.locator(
                        '#process-stage-signature'
                    )
                ).toBeVisible({
                    timeout: 15_000,
                });

                /*
                 * Documents debe desaparecer.
                 */
                await expect(
                    page.locator(
                        '#process-stage-documents'
                    )
                ).toHaveCount(0);

                await expect(
                    page.locator(
                        '#process-advance-documents'
                    )
                ).toHaveCount(0);

                /*
                 * No existe error general.
                 */
                await expect(
                    page.locator('#process-error')
                ).toHaveCount(0);

                /*
                 * La transición ocurre dentro del mismo proceso.
                 */
                await expect(page).toHaveURL(
                    new RegExp(
                        `/portal/process/${processId}(?:[/?#]|$)`
                    )
                );

                /*
                 * La sesión debe permanecer activa.
                 */
                await expect(
                    page.locator(
                        '#global-nav-account'
                    )
                ).toBeVisible();

                await expect(
                    page.locator(
                        '#global-nav-logout'
                    )
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
                                'EUV-UC3-004',

                            description:
                                'Avanzar de documentación completa a firma',

                            processId,

                            selectedBankId,

                            amount:
                                Number(amount),

                            termDays,

                            uploadedDocument:
                                declaration.name,

                            resultingStage:
                                'signature',

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
            'evidencia-etapa-firma',
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
