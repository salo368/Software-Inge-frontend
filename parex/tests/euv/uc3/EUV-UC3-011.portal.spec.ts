import {
    test,
    expect,
} from '@playwright/test';

import {
    prepareSignedCeremony,
} from '../../support/uc3/completion-flow';

import {
    requireSigningE2EInputs,
} from '../../support/signing/signing-test-env';

test.setTimeout(300_000);

test(
    'EUV-UC3-011 · regresar al proceso después de completar la firma',
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
                'PREPARACIÓN · la ceremonia está firmada',
                async () => {
                    return await prepareSignedCeremony(
                        page,
                        facePath,
                        debugOtpKeyHex
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
                await expect(
                    page.locator(
                        '#process-stage-payment'
                    )
                ).toBeVisible({
                    timeout:
                        30_000,
                });

                await expect(
                    page.locator(
                        '#process-advance-payment'
                    )
                ).toBeVisible();

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
