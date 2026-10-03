import {
    test,
    expect,
} from '@playwright/test';

import {
    buildSyntheticDeclaration,
    completeProcessForm,
    createProcessAtFormStage,
} from '../../support/uc3/process-flow';

test.setTimeout(120_000);

test(
    'EUV-UC3-003 · registrar la documentación requerida de una adquisición',
    async ({ page }, testInfo) => {
        /*
         * ============================================================
         * PREPARACIÓN
         * ============================================================
         *
         * Dejamos el proceso exactamente en Documentos.
         *
         * NO cargamos todavía ninguna declaración porque ese upload
         * pertenece al comportamiento que pretende demostrar UC3-003.
         */
        const context = await test.step(
            'PREPARACIÓN · existe un proceso en etapa Documentos',
            async () => {
                const process =
                    await createProcessAtFormStage(
                        page
                    );

                await completeProcessForm(
                    page
                );

                return process;
            }
        );

        const {
            amount,
            termDays,
            selectedBankId,
            processId,
        } = context;

        const declaration =
            buildSyntheticDeclaration();

        /*
         * ============================================================
         * EUV
         * ============================================================
         */

        await test.step(
            'DADO un proceso que requiere la declaración de renta',
            async () => {
                await expect(
                    page.locator(
                        '#process-stage-documents'
                    )
                ).toBeVisible();

                await expect(
                    page.locator(
                        '#process-documents-input'
                    )
                ).toHaveCount(1);

                await expect(
                    page.locator(
                        '#process-documents-empty'
                    )
                ).toBeVisible();

                await expect(
                    page.locator(
                        '#process-documents-error'
                    )
                ).toHaveCount(0);
            }
        );

        await test.step(
            'CUANDO el inversionista adjunta la documentación requerida',
            async () => {
                await page
                    .locator(
                        '#process-documents-input'
                    )
                    .setInputFiles(
                        declaration
                    );
            }
        );

        await test.step(
            'ENTONCES el documento queda registrado y disponible en el proceso',
            async () => {
                /*
                 * Oráculo principal.
                 *
                 * El archivo debe reaparecer como documento
                 * registrado por el sistema.
                 */
                await expect(
                    page.locator(
                        '#process-documents-file'
                    )
                ).toBeVisible({
                    timeout: 40_000,
                });

                await expect(
                    page.locator(
                        '#process-documents-file'
                    )
                ).toContainText(
                    declaration.name
                );

                /*
                 * Existe acción de consulta del documento registrado.
                 */
                await expect(
                    page.locator(
                        '#process-documents-view'
                    )
                ).toBeVisible();

                await expect(
                    page.locator(
                        '#process-documents-error'
                    )
                ).toHaveCount(0);

                /*
                 * La etapa sigue siendo Documentos:
                 * UC3-003 valida registro documental,
                 * no transición a Firma.
                 */
                await expect(
                    page.locator(
                        '#process-stage-documents'
                    )
                ).toBeVisible();

                /*
                 * Seguimos en el mismo proceso.
                 */
                await expect(page).toHaveURL(
                    new RegExp(
                        `/portal/process/${processId}(?:[/?#]|$)`
                    )
                );
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
                                'EUV-UC3-003',

                            description:
                                'Registrar la documentación requerida de una adquisición',

                            processId,

                            selectedBankId,

                            amount:
                                Number(amount),

                            termDays,

                            uploadedDocument:
                                declaration.name,

                            resultingStage:
                                'documents',

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
            'evidencia-documento-registrado',
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