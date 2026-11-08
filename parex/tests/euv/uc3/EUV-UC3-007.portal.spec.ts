import {
    test,
    expect,
} from '@playwright/test';

import {
    prepareSigningAtSignatureScreen,
    readFixtureBase64,
} from '../../support/signing/signing-e2e';

import {
    requireSigningE2EInputs,
} from '../../support/signing/signing-test-env';

test.setTimeout(300_000);

test(
    'EUV-UC3-007 · registrar la firma manuscrita del inversionista',
    async ({ page }, testInfo) => {
        const {
            facePath,
            signerEmail,
        } =
            requireSigningE2EInputs(
                testInfo
            );

        const preparation =
            await test.step(
                'PREPARACIÓN · existe una ceremonia con identidad validada en etapa de firma manuscrita',
                async () => {
                    return await prepareSigningAtSignatureScreen(
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

        const signature =
            readFixtureBase64(
                'parex/tests/fixtures/signing/signature.png'
            );

        await test.step(
            'DADO una ceremonia con la identidad del inversionista validada',
            async () => {
                const state =
                    await driver.state();

                expect(state.signatureId).toBe(context.signatureId);
                expect(state.screen).toBe('signature');
                expect(state.stage).toBe('SIGNATURE');
                expect(state.biometrics).toEqual({
                    ID_FRONT: true,
                    ID_BACK: true,
                    FACE: true,
                });
                expect(state.drawSubmitted).toBe(false);
                expect(state.error).toBe('');
            }
        );

        await test.step(
            'CUANDO el inversionista registra su firma manuscrita',
            async () => {
                await driver.submitSignature(
                    signature,
                    'image/png'
                );
            }
        );

        await test.step(
            'ENTONCES la firma queda registrada y la ceremonia avanza a confirmación por código',
            async () => {
                await driver.waitForScreen(
                    'otp',
                    30_000
                );

                const state =
                    await driver.state();

                expect(state.signatureId).toBe(context.signatureId);
                expect(state.drawSubmitted).toBe(true);
                expect(state.screen).toBe('otp');
                expect(state.stage).toBe('OTP');
                expect(state.error).toBe('');

                await expect(
                    page.locator('#signing-screen-otp')
                ).toBeVisible();
            }
        );

        const finalState =
            await driver.state();

        await testInfo.attach(
            'estado-firma-manuscrita',
            {
                body: Buffer.from(
                    JSON.stringify(
                        {
                            environment:
                                process.env.TEST_ENV ??
                                'dev',

                            euv:
                                'EUV-UC3-007',

                            processId:
                                context.processId,

                            signatureId:
                                context.signatureId,

                            resultingScreen:
                                finalState.screen,

                            resultingStage:
                                finalState.stage,

                            drawSubmitted:
                                finalState.drawSubmitted,

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
            'evidencia-firma-registrada',
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
