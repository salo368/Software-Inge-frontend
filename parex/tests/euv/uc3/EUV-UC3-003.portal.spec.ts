import {
    test,
    expect,
} from '@playwright/test';

import {
    buildSyntheticDocument,
    completeProcessForm,
    createProcessAtFormStage,
    readRequiredDocuments,
    type RequiredDocument,
    type SyntheticDocument,
} from '../../support/uc3/process-flow';

test.setTimeout(180_000);

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
         * NO cargamos todavía ningún documento porque ese upload
         * pertenece al comportamiento que pretende demostrar UC3-003.
         *
         * El formulario sintético declara renta, así que el proceso
         * debe exigir la certificación bancaria (siempre) y la
         * declaración de renta (condicional).
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

        let required: RequiredDocument[] = [];
        const uploaded: Record<string, SyntheticDocument> = {};

        /*
         * ============================================================
         * EUV
         * ============================================================
         */

        await test.step(
            'DADO un proceso que requiere certificación bancaria y declaración de renta',
            async () => {
                await expect(
                    page.locator(
                        '#process-stage-documents'
                    )
                ).toBeVisible();

                required =
                    await readRequiredDocuments(
                        page
                    );

                expect(
                    required.map((d) => d.fileType).sort()
                ).toEqual(
                    ['BANK_CERT', 'TAX_DECLARATION']
                );

                for (const doc of required) {
                    await expect(
                        page.locator(
                            `#process-documents-input-${doc.slug}`
                        )
                    ).toHaveCount(1);

                    await expect(
                        page.locator(
                            `#process-documents-empty-${doc.slug}`
                        )
                    ).toBeVisible();

                    await expect(
                        page.locator(
                            `#process-documents-error-${doc.slug}`
                        )
                    ).toHaveCount(0);
                }

                /*
                 * Sin documentos no se puede continuar a firma.
                 */
                await expect(
                    page.locator(
                        '#process-advance-documents'
                    )
                ).toBeDisabled();
            }
        );

        await test.step(
            'CUANDO el inversionista adjunta la documentación requerida',
            async () => {
                for (const doc of required) {
                    const file =
                        buildSyntheticDocument(
                            doc.slug
                        );

                    uploaded[doc.slug] =
                        file;

                    await page
                        .locator(
                            `#process-documents-input-${doc.slug}`
                        )
                        .setInputFiles(
                            file
                        );
                }
            }
        );

        await test.step(
            'ENTONCES cada documento queda registrado y el proceso puede continuar',
            async () => {
                /*
                 * Oráculo principal.
                 *
                 * Cada archivo debe reaparecer como documento
                 * registrado por el sistema (on_upload -> get-required-files).
                 */
                for (const doc of required) {
                    await expect(
                        page.locator(
                            `#process-documents-file-${doc.slug}`
                        )
                    ).toBeVisible({
                        timeout: 45_000,
                    });

                    await expect(
                        page.locator(
                            `#process-documents-file-${doc.slug}`
                        )
                    ).toContainText(
                        uploaded[doc.slug].name
                    );

                    await expect(
                        page.locator(
                            `#process-documents-row-${doc.slug}`
                        )
                    ).toHaveAttribute(
                        'data-uploaded',
                        'true'
                    );

                    await expect(
                        page.locator(
                            `#process-documents-error-${doc.slug}`
                        )
                    ).toHaveCount(0);
                }

                await expect(
                    page.locator(
                        '#process-documents-complete'
                    )
                ).toBeVisible();

                await expect(
                    page.locator(
                        '#process-advance-documents'
                    )
                ).toBeEnabled();

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

                            requiredDocuments:
                                required.map((d) => d.fileType),

                            uploadedDocuments:
                                Object.fromEntries(
                                    Object.entries(uploaded).map(
                                        ([slug, f]) => [slug, f.name]
                                    )
                                ),

                            resultingStage:
                                'DOCUMENTS',

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
            'evidencia-documentos-registrados',
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
