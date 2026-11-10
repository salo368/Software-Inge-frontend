import fs from 'node:fs';

import {
    test,
    expect,
} from '@playwright/test';

import {
    prepareSigningAtIdentityScreen,
    readFixtureBase64,
} from '../../support/signing/signing-e2e';

import {
    requireSigningE2EInputs,
} from '../../support/signing/signing-test-env';

test.setTimeout(300_000);

test(
    'EUV-UC3-006 · validar la identidad del inversionista durante la firma',
    async ({ page }, testInfo) => {
        const {
            facePath,
            signerEmail,
        } =
            requireSigningE2EInputs(
                testInfo
            );

        /*
         * PREPARACIÓN: revisión del documento -> correo del firmante y
         * aceptación de términos (FORM -> BIOMETRICS). El backend ya no
         * tiene una etapa de consentimiento aparte: los términos se
         * aceptan junto con el correo, antes de la identidad.
         */
        const preparation =
            await test.step(
                'PREPARACIÓN · existe una ceremonia de firma en validación de identidad con el hook E2E habilitado',
                async () => {
                    return await prepareSigningAtIdentityScreen(
                        page,
                        signerEmail
                    );
                }
            );

        const {
            context,
            driver,
        } = preparation;

        const signatureId =
            context.signatureId;

        const idFront =
            readFixtureBase64(
                'parex/tests/fixtures/signing/id-front.png'
            );

        const idBack =
            readFixtureBase64(
                'parex/tests/fixtures/signing/id-back.png'
            );

        const face =
            fs
                .readFileSync(facePath)
                .toString('base64');

        await test.step(
            'DADO una ceremonia lista para validar la identidad',
            async () => {
                const state =
                    await driver.state();

                expect(state.signatureId).toBe(signatureId);
                expect(state.screen).toBe('identity');
                expect(state.stage).toBe('BIOMETRICS');
                expect(state.error).toBe('');
                expect(state.biometrics).toEqual({
                    ID_FRONT: false,
                    ID_BACK: false,
                    FACE: false,
                });
            }
        );

        await test.step(
            'CUANDO presenta el frente de su documento',
            async () => {
                await driver.submitEvidence(
                    'ID_FRONT',
                    idFront,
                    'image/png'
                );

                const state =
                    await driver.state();

                expect(state.biometrics?.ID_FRONT).toBe(true);
                expect(state.error).toBe('');
            }
        );

        await test.step(
            'Y presenta el reverso de su documento',
            async () => {
                await driver.submitEvidence(
                    'ID_BACK',
                    idBack,
                    'image/png'
                );

                const state =
                    await driver.state();

                expect(state.biometrics?.ID_BACK).toBe(true);
                expect(state.error).toBe('');
            }
        );

        await test.step(
            'Y presenta la evidencia facial requerida',
            async () => {
                await driver.submitEvidence(
                    'FACE',
                    face,
                    'image/jpeg'
                );
            }
        );

        await test.step(
            'ENTONCES las tres evidencias quedan validadas y la ceremonia avanza a firma manuscrita',
            async () => {
                await driver.waitForScreen(
                    'signature',
                    30_000
                );

                const state =
                    await driver.state();

                expect(state.biometrics).toEqual({
                    ID_FRONT: true,
                    ID_BACK: true,
                    FACE: true,
                });
                expect(state.screen).toBe('signature');
                expect(state.stage).toBe('SIGNATURE');
                expect(state.error).toBe('');
                expect(state.signatureId).toBe(signatureId);

                await expect(
                    page.locator('#signing-screen-signature')
                ).toBeVisible();
            }
        );

        const finalState =
            await driver.state();

        await testInfo.attach(
            'estado-identidad',
            {
                body: Buffer.from(
                    JSON.stringify(
                        {
                            environment:
                                process.env.TEST_ENV ??
                                'dev',

                            euv:
                                'EUV-UC3-006',

                            processId:
                                context.processId,

                            signatureId,

                            resultingScreen:
                                finalState.screen,

                            resultingStage:
                                finalState.stage,

                            biometrics:
                                finalState.biometrics,

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
            'evidencia-identidad-validada',
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
