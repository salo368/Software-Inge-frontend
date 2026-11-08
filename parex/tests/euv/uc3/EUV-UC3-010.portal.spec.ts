import {
    test,
    expect,
} from '@playwright/test';

import {
    prepareSigningAtOtpScreen,
} from '../../support/signing/signing-e2e';

import {
    requireSigningE2EInputsWithOtp,
} from '../../support/signing/signing-test-env';

test.setTimeout(300_000);

/*
 * Bloqueado (test.fixme) mientras no exista una fuente automatizable del
 * OTP: ver OTP_BLOCKED_REASON en support/signing/signing-test-env.ts.
 */
test(
    'EUV-UC3-010 · completar el firmado digital de la orden',
    async ({ page }, testInfo) => {
        const {
            facePath,
            signerEmail,
            otpProvider,
        } =
            requireSigningE2EInputsWithOtp(
                testInfo
            );

        const preparation =
            await test.step(
                'PREPARACIÓN · existe una ceremonia en OTP con un código vigente',
                async () => {
                    return await prepareSigningAtOtpScreen(
                        page,
                        facePath,
                        signerEmail
                    );
                }
            );

        const {
            context,
            driver,
        } = preparation;

        await test.step(
            'CUANDO el inversionista confirma el OTP y el firmado asíncrono finaliza',
            async () => {
                await driver.confirmOtp(
                    await otpProvider(
                        context.signatureId
                    )
                );

                await driver.waitForStage(
                    'SIGNED',
                    120_000
                );

                await driver.waitForScreen(
                    'done',
                    30_000
                );
            }
        );

        await test.step(
            'ENTONCES la ceremonia queda firmada y existe un PDF firmado verificable',
            async () => {
                const state =
                    await driver.state();

                expect(state.signatureId).toBe(context.signatureId);
                expect(state.stage).toBe('SIGNED');
                expect(state.screen).toBe('done');
                expect(state.error).toBe('');

                await expect(
                    page.locator('#signing-screen-done')
                ).toBeVisible();

                await expect(
                    page.locator('#signing-signed-hash code')
                ).toHaveText(
                    /^[0-9a-f]{64}$/i
                );

                const pdfLink =
                    page.locator('#signing-signed-pdf');

                await expect(pdfLink).toBeVisible();

                const href =
                    await pdfLink.getAttribute('href');

                expect(
                    href,
                    'la firma SIGNED debe exponer signed_url'
                ).toBeTruthy();

                const response =
                    await page
                        .context()
                        .request
                        .get(href!);

                expect(
                    response.ok(),
                    `signed.pdf debe ser descargable; status=${response.status()}`
                ).toBeTruthy();

                const pdf =
                    await response.body();

                expect(pdf.length).toBeGreaterThan(100);

                expect(
                    pdf
                        .subarray(0, 5)
                        .toString()
                ).toBe(
                    '%PDF-'
                );
            }
        );

        await testInfo.attach(
            'estado-firma-completada',
            {
                body: Buffer.from(
                    JSON.stringify(
                        {
                            environment:
                                process.env.TEST_ENV ??
                                'dev',
                            euv:
                                'EUV-UC3-010',
                            processId:
                                context.processId,
                            signatureId:
                                context.signatureId,
                            stage:
                                'SIGNED',
                            signedPdfVerified:
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
