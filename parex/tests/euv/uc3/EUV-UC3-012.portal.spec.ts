import {
    test,
    expect,
} from '@playwright/test';

import {
    prepareProcessAtPaymentStage,
} from '../../support/uc3/completion-flow';

import {
    requireSigningE2EInputs,
} from '../../support/signing/signing-test-env';

test.setTimeout(300_000);

test(
    'EUV-UC3-012 · completar el pago simulado y activar el CDT',
    async ({ page }, testInfo) => {
        const {
            facePath,
            debugOtpKeyHex,
        } =
            requireSigningE2EInputs(
                testInfo
            );

        const {
            context,
        } =
            await test.step(
                'PREPARACIÓN · existe un proceso firmado en etapa de pago',
                async () => {
                    return await prepareProcessAtPaymentStage(
                        page,
                        facePath,
                        debugOtpKeyHex
                    );
                }
            );

        await test.step(
            'CUANDO el inversionista completa el pago simulado',
            async () => {
                await page
                    .locator(
                        '#process-advance-payment'
                    )
                    .click();
            }
        );

        await test.step(
            'ENTONCES el proceso queda completado y el CDT aparece activo',
            async () => {
                await expect(
                    page.locator(
                        '#process-stage-done'
                    )
                ).toBeVisible({
                    timeout:
                        30_000,
                });

                await expect(
                    page.locator(
                        '#process-stage-done'
                    )
                ).toContainText(
                    'Tu CDT esta activo'
                );

                await expect(
                    page.locator(
                        '#process-done-to-account'
                    )
                ).toBeVisible();

                expect(
                    page.url()
                ).toContain(
                    context.processId
                );
            }
        );
    }
);
