import fs from 'node:fs';
import path from 'node:path';

import {
    test,
    expect,
} from '@playwright/test';

import {
    prepareSigningCeremony,
    readFixtureBase64,
} from '../../support/signing/signing-e2e';

test.setTimeout(180_000);

test(
    'EUV-UC3-006 · validar la identidad del inversionista durante la firma',
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
                'Se necesita una fixture facial local para validar Rekognition.'
            );
        }

        let signId = '';

        const preparation =
            await test.step(
                'PREPARACIÓN · existe una ceremonia de firma en revisión con el hook E2E habilitado',
                async () => {
                    return await prepareSigningCeremony(
                        page
                    );
                }
            );

        const {
            context,
            driver,
        } = preparation;

        signId =
            context.signId;

        const idFront =
            readFixtureBase64(
                'tests/fixtures/signing/id-front.png'
            );

        const idBack =
            readFixtureBase64(
                'tests/fixtures/signing/id-back.png'
            );

        const face =
            fs
                .readFileSync(
                    path.resolve(facePath!)
                )
                .toString('base64');

        await test.step(
            'DADO una ceremonia lista para validar la identidad',
            async () => {
                const state =
                    await driver.state();

                expect(
                    state.signId
                ).toBe(signId);

                expect(
                    state.screen
                ).toBe('review');

                expect(
                    state.error
                ).toBe('');

                expect(
                    state.uploads
                ).not.toBeNull();
            }
        );

        await test.step(
            'CUANDO el inversionista continúa a la validación de identidad',
            async () => {
                await driver.goToIdentity();

                const state =
                    await driver.state();

                expect(
                    state.screen
                ).toBe('identity');
            }
        );

        await test.step(
            'Y presenta el frente de su documento',
            async () => {
                await driver.submitEvidence(
                    'id_front',
                    idFront,
                    'image/png'
                );

                const state =
                    await driver.state();

                expect(
                    state.uploads
                        ?.id_front.uploaded
                ).toBe(true);

                expect(
                    state.uploads
                        ?.id_front.validated
                ).toBe(true);

                expect(
                    state.error
                ).toBe('');
            }
        );

        await test.step(
            'Y presenta el reverso de su documento',
            async () => {
                await driver.submitEvidence(
                    'id_back',
                    idBack,
                    'image/png'
                );

                const state =
                    await driver.state();

                expect(
                    state.uploads
                        ?.id_back.uploaded
                ).toBe(true);

                expect(
                    state.uploads
                        ?.id_back.validated
                ).toBe(true);

                expect(
                    state.error
                ).toBe('');
            }
        );

        await test.step(
            'Y presenta la evidencia facial requerida',
            async () => {
                await driver.submitEvidence(
                    'face',
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

                expect(
                    state.uploads
                        ?.id_front.uploaded
                ).toBe(true);

                expect(
                    state.uploads
                        ?.id_front.validated
                ).toBe(true);

                expect(
                    state.uploads
                        ?.id_back.uploaded
                ).toBe(true);

                expect(
                    state.uploads
                        ?.id_back.validated
                ).toBe(true);

                expect(
                    state.uploads
                        ?.face.uploaded
                ).toBe(true);

                expect(
                    state.uploads
                        ?.face.validated
                ).toBe(true);

                expect(
                    state.screen
                ).toBe('signature');

                expect(
                    state.error
                ).toBe('');

                expect(
                    state.signId
                ).toBe(signId);
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

                            signId,

                            resultingScreen:
                                finalState.screen,

                            resultingStage:
                                finalState.stage,

                            uploads:
                                finalState.uploads,

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