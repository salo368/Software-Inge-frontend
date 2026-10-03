import {
    test,
    expect,
} from '@playwright/test';

import {
    prepareSigningAtOtpScreen,
} from '../../support/signing/signing-e2e';

import {
    requireSigningE2EInputs,
} from '../../support/signing/signing-test-env';

test.setTimeout(300_000);

test(
    'EUV-UC3-010 · completar el firmado digital de la orden',
    async ({ page }, testInfo) => {
        const {
            facePath,
            debugOtpKeyHex,
        } =
            requireSigningE2EInputs(
                testInfo
            );

        const preparation =
            await test.step(
                'PREPARACIÓN · existe una ceremonia en OTP con código autorizado',
                async () => {
                    return await prepareSigningAtOtpScreen(
                        page,
                        facePath,
                        debugOtpKeyHex
                    );
                }
            );

        const {
            context,
            driver,
            otp,
        } = preparation;

        await test.step(
            'CUANDO el inversionista confirma el OTP y el firmado asíncrono finaliza',
            async () => {
                await driver.confirmOtp(
                    otp
                );

                await driver.waitForStage(
                    'signed',
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

                expect(
                    state.signId
                ).toBe(
                    context.signId
                );

                expect(
                    state.stage
                ).toBe(
                    'signed'
                );

                expect(
                    state.screen
                ).toBe(
                    'done'
                );

                expect(
                    state.error
                ).toBe('');

                await expect(
                    page.locator(
                        '#signing-screen-done'
                    )
                ).toBeVisible();

                const hash =
                    page.locator(
                        '#signing-signed-hash code'
                    );

                await expect(
                    hash
                ).toHaveText(
                    /^[0-9a-f]{64}$/i
                );

                const pdfLink =
                    page.locator(
                        '#signing-signed-pdf'
                    );

                await expect(
                    pdfLink
                ).toBeVisible();

                const href =
                    await pdfLink
                        .getAttribute(
                            'href'
                        );

                expect(
                    href,
                    'la ceremonia signed debe exponer signed_pdf_url'
                ).toBeTruthy();

                const response =
                    await page
                        .context()
                        .request
                        .get(
                            href!
                        );

                expect(
                    response.ok(),
                    `signed.pdf debe ser descargable; status=${response.status()}`
                ).toBeTruthy();

                expect(
                    response.headers()[
                        'content-type'
                    ] ?? ''
                ).toContain(
                    'application/pdf'
                );

                const pdf =
                    await response.body();

                expect(
                    pdf.length
                ).toBeGreaterThan(
                    100
                );

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
                            signId:
                                context.signId,
                            stage:
                                'signed',
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
