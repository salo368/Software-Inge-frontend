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

/*
 * Cambio de contrato respecto a la versión anterior de este EUV:
 *
 * El backend ya no tiene una etapa de consentimiento (`consent`). Los
 * términos se aceptan junto con el correo del firmante, al inicio de la
 * ceremonia (ver la preparación de UC3-006), y el primer OTP se pide
 * apenas se registra la firma manuscrita (UC3-007).
 *
 * Por eso UC3-008 valida aquí la solicitud explícita del código por parte
 * del inversionista (botón "Reenviar código"), que es el estímulo de OTP
 * que sigue existiendo. No necesita conocer el código: solo que el
 * sistema lo emita y deje la ceremonia lista para confirmarlo.
 */
test(
    'EUV-UC3-008 · aceptar términos y solicitar código OTP',
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
                'PREPARACIÓN · existe una ceremonia con términos aceptados, identidad validada y firma manuscrita registrada',
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
            'DADO una ceremonia en confirmación por código',
            async () => {
                const state =
                    await driver.state();

                expect(state.signatureId).toBe(context.signatureId);
                expect(state.screen).toBe('otp');
                expect(state.stage).toBe('OTP');
                expect(state.drawSubmitted).toBe(true);
                expect(state.error).toBe('');

                await expect(
                    page.locator('#signing-otp-resend')
                ).toBeEnabled();
            }
        );

        await test.step(
            'CUANDO el inversionista solicita el código OTP',
            async () => {
                const otpResponse =
                    page.waitForResponse(
                        (response) =>
                            response.request().method() === 'POST' &&
                            response.url().includes('/signatures/set-otp'),
                        {
                            timeout: 30_000,
                        }
                    );

                await page
                    .locator('#signing-otp-resend')
                    .click();

                const response =
                    await otpResponse;

                expect(
                    response.ok(),
                    `set-otp debe responder 200; status=${response.status()}`
                ).toBeTruthy();

                const body =
                    await response.json();

                expect(
                    body.email_sent,
                    'el servidor de correo debe aceptar el envío del OTP'
                ).toBe(true);

                expect(body.stage).toBe('OTP');
            }
        );

        await test.step(
            'ENTONCES el sistema emite el código y presenta la etapa de confirmación',
            async () => {
                await driver.waitForOtpRequested(
                    30_000
                );

                const state =
                    await driver.state();

                expect(state.signatureId).toBe(context.signatureId);
                expect(state.screen).toBe('otp');
                expect(state.stage).toBe('OTP');
                expect(state.otpSent).toBe(true);
                expect(state.attemptsLeft).toBe(3);
                expect(state.error).toBe('');

                await expect(
                    page.locator('#signing-otp-input')
                ).toBeVisible();

                await expect(
                    page.locator('#signing-otp-attempts')
                ).toContainText('3');
            }
        );

        const finalState =
            await driver.state();

        await testInfo.attach(
            'estado-otp',
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

                            signatureId:
                                context.signatureId,

                            resultingScreen:
                                finalState.screen,

                            resultingStage:
                                finalState.stage,

                            otpSent:
                                finalState.otpSent,

                            attemptsLeft:
                                finalState.attemptsLeft,

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
