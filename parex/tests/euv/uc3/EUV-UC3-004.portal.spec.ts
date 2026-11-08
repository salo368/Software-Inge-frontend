import {
    test,
    expect,
} from '@playwright/test';

import {
    completeProcessForm,
    createProcessAtFormStage,
    uploadRequiredDocuments,
} from '../../support/uc3/process-flow';

test.setTimeout(240_000);

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
         * documentos requeridos registrados
         *
         * La transición Documentos -> Firma todavía NO se ejecuta.
         * (El backend puede abrir la firma en segundo plano apenas los
         * documentos están completos; el portal solo cambia de etapa
         * cuando el inversionista pide continuar.)
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

                const documents =
                    await uploadRequiredDocuments(
                        page
                    );

                return {
                    process,
                    documents,
                };
            }
        );

        const {
            process: processContext,
            documents,
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

                for (const doc of documents) {
                    await expect(
                        page.locator(
                            `#process-documents-file-${doc.slug}`
                        )
                    ).toContainText(
                        doc.name
                    );
                }

                await expect(
                    page.locator(
                        '#process-documents-complete'
                    )
                ).toBeVisible();

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
                 *
                 * generate_sign llena la orden de inversión y abre la
                 * firma en segundo plano: puede tardar varios segundos
                 * (más con cold start).
                 */
                await expect(
                    page.locator(
                        '#process-stage-signature'
                    )
                ).toBeVisible({
                    timeout: 120_000,
                });

                await expect(
                    page.locator('#process-header')
                ).toHaveAttribute(
                    'data-stage',
                    'SIGNATURE'
                );

                /*
                 * La firma ya existe y se puede iniciar.
                 */
                await expect(
                    page.locator(
                        '#process-signature-start'
                    )
                ).toBeEnabled({
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

                            uploadedDocuments:
                                documents.map((d) => ({
                                    fileType: d.fileType,
                                    name: d.name,
                                })),

                            resultingStage:
                                'SIGNATURE',

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
