import {
    test,
    expect,
} from '@playwright/test';

import {
    prepareSignedCeremony,
} from '../../support/uc3/completion-flow';

import {
    requireSigningE2EInputsWithOtp,
} from '../../support/signing/signing-test-env';

test.setTimeout(300_000);

/*
 * Bloqueado (test.fixme) mientras no exista una fuente automatizable del
 * OTP: ver OTP_BLOCKED_REASON en support/signing/signing-test-env.ts.
 */
test(
    'EUV-UC3-011 · regresar al proceso después de completar la firma',
    async ({ page }, testInfo) => {
        const inputs =
            requireSigningE2EInputsWithOtp(
                testInfo
            );

        const {
            context,
        } =
            await test.step(
                'PREPARACIÓN · la ceremonia está firmada',
                async () => {
                    return await prepareSignedCeremony(
                        page,
                        inputs
                    );
                }
            );

        await test.step(
            'CUANDO el inversionista regresa al proceso',
            async () => {
                const button =
                    page.locator(
                        '#signing-return-to-process'
                    );

                await expect(
                    button
                ).toBeVisible();

                await Promise.all([
                    page.waitForURL(
                        (url) =>
                            url.pathname.endsWith(
                                `/portal/process/${context.processId}`
                            ),
                        {
                            timeout:
                                30_000,
                        }
                    ),

                    button.click(),
                ]);
            }
        );

        await test.step(
            'ENTONCES el mismo proceso abandona firma y queda pendiente de pago',
            async () => {
                /*
                 * El webhook `signed` mueve el proceso a PAYMENT de forma
                 * asíncrona; el portal espera esa transición.
                 */
                await expect(
                    page.locator(
                        '#process-stage-payment'
                    )
                ).toBeVisible({
                    timeout:
                        90_000,
                });

                await expect(
                    page.locator('#process-header')
                ).toHaveAttribute(
                    'data-stage',
                    'PAYMENT'
                );

                await expect(
                    page.locator(
                        '#process-payment-submit'
                    )
                ).toBeVisible();

                await expect(
                    page.locator(
                        '#process-payment-pending'
                    )
                ).toHaveAttribute(
                    'data-pending',
                    String(Number(context.amount))
                );

                await expect(
                    page.locator(
                        '#process-error'
                    )
                ).toHaveCount(0);

                expect(
                    page.url()
                ).toContain(
                    context.processId
                );
            }
        );
    }
);
