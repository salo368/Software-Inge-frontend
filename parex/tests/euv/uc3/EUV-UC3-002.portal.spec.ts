import {
    test,
    expect,
} from '@playwright/test';

import {
    createProcessAtFormStage,
    fillProcessFormFields,
} from '../../support/uc3/process-flow';

test.setTimeout(120_000);

test(
    'EUV-UC3-002 · completar información del inversionista y avanzar a documentos',
    async ({ page }, testInfo) => {
        /*
         * ============================================================
         * PREPARACIÓN
         * ============================================================
         *
         * Creamos un proceso y lo dejamos en Formulario.
         *
         * NO completamos ni enviamos el formulario todavía.
         */
        const context = await test.step(
            'PREPARACIÓN · existe un proceso en etapa de formulario',
            async () => {
                return await createProcessAtFormStage(
                    page
                );
            }
        );

        const {
            amount,
            termDays,
            selectedBankId,
            processId,
        } = context;

        let documentNumber = '';

        /*
         * ============================================================
         * EUV
         * ============================================================
         */

        await test.step(
            'DADO un proceso en etapa de información personal y financiera',
            async () => {
                await expect(
                    page.locator('#process-stage-form')
                ).toBeVisible();

                await expect(
                    page.locator('#process-form')
                ).toBeVisible();

                await expect(
                    page.locator('#process-form-submit')
                ).toBeVisible();
            }
        );

        await test.step(
            'CUANDO el inversionista completa la información requerida',
            async () => {
                const formData =
                    await fillProcessFormFields(
                        page
                    );

                documentNumber =
                    formData.documentNumber;
            }
        );

        await test.step(
            'Y solicita guardar y continuar',
            async () => {
                await expect(
                    page.locator('#process-form-submit')
                ).toBeEnabled();

                await page
                    .locator('#process-form-submit')
                    .click();
            }
        );

        await test.step(
            'ENTONCES el proceso abandona el formulario y avanza a documentos',
            async () => {
                /*
                 * Oráculo principal.
                 */
                await expect(
                    page.locator(
                        '#process-stage-documents'
                    )
                ).toBeVisible({
                    timeout: 15_000,
                });

                /*
                 * Formulario ya no debe estar disponible.
                 */
                await expect(
                    page.locator('#process-stage-form')
                ).toHaveCount(0);

                await expect(
                    page.locator('#process-form')
                ).toHaveCount(0);

                /*
                 * Sigue siendo el mismo proceso.
                 */
                await expect(page).toHaveURL(
                    new RegExp(
                        `/portal/process/${processId}(?:[/?#]|$)`
                    )
                );

                await expect(
                    page.locator('#process-error')
                ).toHaveCount(0);
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
                                'EUV-UC3-002',

                            description:
                                'Completar información del inversionista y avanzar a documentos',

                            processId,

                            selectedBankId,

                            amount:
                                Number(amount),

                            termDays,

                            syntheticDocumentNumber:
                                documentNumber,

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
            'evidencia-etapa-documentos',
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