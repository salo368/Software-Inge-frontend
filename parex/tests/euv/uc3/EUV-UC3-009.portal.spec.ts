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
    'EUV-UC3-009 · confirmar OTP e iniciar el firmado del documento',
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

        let otp = '';

        await test.step(
            'DADO una ceremonia con OTP vigente',
            async () => {
                otp =
                    await otpProvider(
                        context.signatureId
                    );

                const state =
                    await driver.state();

                expect(state.signatureId).toBe(context.signatureId);
                expect(state.screen).toBe('otp');
                expect(state.stage).toBe('OTP');
                expect(state.otpSent).toBe(true);
                expect(otp).toMatch(/^\d{6}$/);
                expect(state.error).toBe('');
            }
        );

        await test.step(
            'CUANDO el inversionista confirma el código OTP',
            async () => {
                await driver.confirmOtp(
                    otp
                );
            }
        );

        await test.step(
            'ENTONCES la ceremonia abandona OTP e inicia el procesamiento de firma',
            async () => {
                await expect
                    .poll(
                        async () => (await driver.state()).stage,
                        { timeout: 30_000 }
                    )
                    .not.toBe('OTP');

                const state =
                    await driver.state();

                expect(state.signatureId).toBe(context.signatureId);
                expect(['SIGNING', 'SIGNED']).toContain(state.stage);
                expect(['signing', 'done']).toContain(state.screen);
                expect(state.error).toBe('');
            }
        );

        const finalState =
            await driver.state();

        await testInfo.attach(
            'estado-otp-confirmado',
            {
                body: Buffer.from(
                    JSON.stringify(
                        {
                            environment:
                                process.env.TEST_ENV ??
                                'dev',

                            euv:
                                'EUV-UC3-009',

                            processId:
                                context.processId,

                            signatureId:
                                context.signatureId,

                            resultingScreen:
                                finalState.screen,

                            resultingStage:
                                finalState.stage,

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
    }
);
