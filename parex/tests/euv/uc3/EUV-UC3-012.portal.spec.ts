import {
    test,
    expect,
} from '@playwright/test';

import {
    payFullAmount,
    prepareProcessAtPaymentStage,
} from '../../support/uc3/completion-flow';

import {
    requireSigningE2EInputsWithOtp,
} from '../../support/signing/signing-test-env';

test.setTimeout(300_000);

/*
 * Bloqueado (test.fixme) mientras no exista una fuente automatizable del
 * OTP: ver OTP_BLOCKED_REASON en support/signing/signing-test-env.ts.
 *
 * Cambio de contrato: el pago ya no es simulado con un botón. El
 * inversionista registra cada transferencia con su comprobante
 * (`payments`), y `processes.get-pending-pay` pasa el proceso a REVIEW
 * cuando lo pagado cubre el monto.
 */
test(
    'EUV-UC3-012 · registrar el pago del CDT y enviarlo a revisión',
    async ({ page }, testInfo) => {
        const inputs =
            requireSigningE2EInputsWithOtp(
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
                        inputs
                    );
                }
            );

        await test.step(
            'CUANDO el inversionista registra una transferencia por el total con su comprobante',
            async () => {
                await payFullAmount(
                    page,
                    context.amount
                );
            }
        );

        await test.step(
            'ENTONCES el pago queda registrado y el proceso pasa a revisión',
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
                ).toHaveAttribute(
                    'data-stage',
                    'REVIEW'
                );

                await expect(
                    page.locator(
                        '#process-stage-done'
                    )
                ).toContainText(
                    'Recibimos tu pago'
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
