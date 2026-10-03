import fs from 'node:fs';
import path from 'node:path';

import {
    test,
    expect,
} from '@playwright/test';

import {
    prepareSigningAtConsentScreen,
} from '../../support/signing/signing-e2e';

test.setTimeout(180_000);

test(
    'EUV-UC3-008 · aceptar términos y solicitar código OTP',
    async ({ page }, testInfo) => {
        testInfo.annotations.push({
            type: 'known_issue',
            description:
                'DEF-UC3-SIGN-001',
        });

        testInfo.annotations.push({
            type: 'workaround',
            description:
                'Reload en etapa Signature antes de iniciar la ceremonia.',
        });

        const facePath =
            process.env
                .SIGNATURES_TEST_FACE_PATH;

        if (
            !facePath ||
            !fs.existsSync(
                path.resolve(facePath)
            )
        ) {
            testInfo.annotations.push({
                type: 'blocked',
                description:
                    'SIGNATURES_TEST_FACE_PATH no está configurado o no existe.',
            });

            test.skip(
                true,
                'Se necesita una fixture facial local para preparar la ceremonia.'
            );
        }

        const preparation =
            await test.step(
                'PREPARACIÓN · existe una ceremonia en etapa de consentimiento',
                async () => {
                    return await prepareSigningAtConsentScreen(
                        page,
                        facePath!
                    );
                }
            );

        const {
            context,
            driver,
        } = preparation;

        await test.step(
            'DADO una ceremonia con identidad validada y firma manuscrita registrada',
            async () => {
                const state =
                    await driver.state();

                expect(
                    state.signId
                ).toBe(
                    context.signId
                );

                expect(
                    state.screen
                ).toBe(
                    'consent'
                );

                expect(
                    state.stage
                ).toBe(
                    'consent'
                );

                expect(
                    state.uploads?.id_front.validated
                ).toBe(true);

                expect(
                    state.uploads?.id_back.validated
                ).toBe(true);

                expect(
                    state.uploads?.face.validated
                ).toBe(true);

                expect(
                    state.uploads?.signature.uploaded
                ).toBe(true);

                expect(
                    state.otpSent
                ).toBe(false);

                expect(
                    state.error
                ).toBe('');
            }
        );

        await test.step(
            'CUANDO el inversionista acepta los términos de la ceremonia',
            async () => {
                await driver.acceptConsent();
            }
        );

        await test.step(
            'ENTONCES el sistema solicita el código OTP y presenta la etapa de confirmación',
            async () => {
                await driver.waitForOtpRequested(
                    30_000
                );

                const state =
                    await driver.state();

                expect(
                    state.signId
                ).toBe(
                    context.signId
                );

                expect(
                    state.screen
                ).toBe(
                    'otp'
                );

                expect(
                    state.stage
                ).toBe(
                    'otp'
                );

                expect(
                    state.otpSent
                ).toBe(true);

                expect(
                    state.error
                ).toBe('');
            }
        );

        const finalState =
            await driver.state();

        await testInfo.attach(
            'estado-consentimiento-otp',
            {
                body: Buffer.from(
                    JSON.stringify(
                        {
                            environment:
                                process.env.TEST_ENV ??
                                'dev',

                            euv:
                                'EUV-UC3-008',

                            processId:
                                context.processId,

                            signId:
                                context.signId,

                            resultingScreen:
                                finalState.screen,

                            resultingStage:
                                finalState.stage,

                            otpSent:
                                finalState.otpSent,

                            debugOtpAvailable:
                                Boolean(
                                    finalState.debugOtp
                                ),

                            knownIssue:
                                'DEF-UC3-SIGN-001',

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
            'evidencia-etapa-otp',
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