import {
    test,
    expect,
} from '@playwright/test';

import {
    prepareProcessAtDoneStage,
} from '../../support/uc3/completion-flow';

import {
    requireSigningE2EInputsWithOtp,
} from '../../support/signing/signing-test-env';

test.setTimeout(300_000);

/*
 * Bloqueado (test.fixme) mientras no exista una fuente automatizable del
 * OTP: ver OTP_BLOCKED_REASON en support/signing/signing-test-env.ts.
 *
 * El último estado alcanzable hoy es REVIEW (pago en revisión):
 * SENT_TO_BANK y COMPLETED existen en el backend pero sin transición.
 */
test(
    'EUV-UC3-013 · consultar el CDT pagado desde Mi cuenta',
    async ({ page }, testInfo) => {
        const inputs =
            requireSigningE2EInputsWithOtp(
                testInfo
            );

        const {
            context,
        } =
            await test.step(
                'PREPARACIÓN · existe un CDT firmado y pagado (en revisión)',
                async () => {
                    return await prepareProcessAtDoneStage(
                        page,
                        inputs
                    );
                }
            );

        await test.step(
            'CUANDO el inversionista abre Mi cuenta',
            async () => {
                await Promise.all([
                    page.waitForURL(
                        /\/portal\/me(?:[/?#]|$)/,
                        {
                            timeout:
                                30_000,
                        }
                    ),

                    page
                        .locator(
                            '#process-done-to-account'
                        )
                        .click(),
                ]);
            }
        );

        await test.step(
            'ENTONCES Mi cuenta conserva exactamente la misma adquisición con el pago en revisión',
            async () => {
                await expect(
                    page.locator(
                        '#portal-process-list'
                    )
                ).toBeVisible();

                const card =
                    page.locator(
                        `#portal-process-${context.processId}`
                    );

                await expect(
                    card
                ).toBeVisible();

                await expect(
                    card
                ).toHaveAttribute(
                    'data-process-id',
                    context.processId
                );

                await expect(
                    card
                ).toHaveAttribute(
                    'data-bank-id',
                    context.selectedBankId
                );

                await expect(
                    card
                ).toHaveAttribute(
                    'data-stage',
                    'REVIEW'
                );

                await expect(
                    card
                ).toHaveAttribute(
                    'data-amount',
                    String(Number(context.amount))
                );

                await expect(
                    card
                ).toHaveAttribute(
                    'data-term-days',
                    String(
                        context.termDays
                    )
                );

                await expect(
                    card
                ).toContainText(
                    'Pago en revision'
                );
            }
        );

        await test.step(
            'Y el inversionista puede reabrir el mismo proceso completado',
            async () => {
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

                    page
                        .locator(
                            `#portal-process-${context.processId}`
                        )
                        .click(),
                ]);

                await expect(
                    page.locator(
                        '#process-stage-done'
                    )
                ).toBeVisible();

                expect(
                    page.url()
                ).toContain(
                    context.processId
                );
            }
        );

        await testInfo.attach(
            'persistencia-cdt-mi-cuenta',
            {
                body: Buffer.from(
                    JSON.stringify(
                        {
                            environment:
                                process.env.TEST_ENV ??
                                'dev',
                            euv:
                                'EUV-UC3-013',
                            processId:
                                context.processId,
                            bankId:
                                context.selectedBankId,
                            amount:
                                context.amount,
                            termDays:
                                context.termDays,
                            stage:
                                'REVIEW',
                            visibleInAccount:
                                true,
                        },
                        null,
                        2
                    )
                ),
                contentType:
                    'application/json',
            }
        );
    }
);
