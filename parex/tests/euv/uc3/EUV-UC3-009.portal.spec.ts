import fs from 'node:fs';
import path from 'node:path';

import {
    test,
    expect,
} from '@playwright/test';

import {
    prepareSigningAtOtpScreen,
} from '../../support/signing/signing-e2e';

test.setTimeout(240_000);

test(
    'EUV-UC3-009 · confirmar OTP e iniciar el firmado del documento',
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

        const debugOtpKeyHex =
            process.env
                .DEBUG_OTP_KEY_HEX;

        if (
            !debugOtpKeyHex
        ) {
            testInfo.annotations.push({
                type: 'blocked',
                description:
                    'DEBUG_OTP_KEY_HEX no está configurado en el entorno DEV.',
            });

            test.skip(
                true,
                'Se necesita la clave HMAC de automatización DEV para confirmar el OTP.'
            );
        }

        if (
            !/^[0-9a-fA-F]+$/.test(
                debugOtpKeyHex!
            ) ||
            debugOtpKeyHex!.length % 2 !== 0
        ) {
            throw new Error(
                'DEBUG_OTP_KEY_HEX debe ser hexadecimal y tener longitud par.'
            );
        }

        const preparation =
            await test.step(
                'PREPARACIÓN · existe una ceremonia en OTP con código de automatización autorizado',
                async () => {
                    return await prepareSigningAtOtpScreen(
                        page,
                        facePath!,
                        debugOtpKeyHex!
                    );
                }
            );

        const {
            context,
            driver,
            otp,
        } = preparation;

        await test.step(
            'DADO una ceremonia con OTP vigente y disponible para la prueba DEV',
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
                    otp
                ).toMatch(
                    /^\d{6}$/
                );

                expect(
                    state.error
                ).toBe('');
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
                const state =
                    await driver.state();

                expect(
                    state.signId
                ).toBe(
                    context.signId
                );

                expect(
                    state.screen
                ).not.toBe(
                    'otp'
                );

                expect(
                    state.stage
                ).not.toBe(
                    'otp'
                );

                expect(
                    [
                        'signing',
                        'signed',
                    ]
                ).toContain(
                    state.stage
                );

                expect(
                    [
                        'signing',
                        'done',
                    ]
                ).toContain(
                    state.screen
                );

                expect(
                    state.error
                ).toBe('');
            }
        );

        const finalState =
            await driver.state();

        await testInfo.attach(
            'estado-confirmacion-otp',
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

                            signId:
                                context.signId,

                            resultingScreen:
                                finalState.screen,

                            resultingStage:
                                finalState.stage,

                            otpConfirmed:
                                true,

                            debugOtpGate:
                                'DEV_ONLY',

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
            'evidencia-otp-confirmado',
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