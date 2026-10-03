import fs from 'node:fs';
import path from 'node:path';

import {
    test,
    expect,
} from '@playwright/test';

import {
    prepareSigningAtSignatureScreen,
    readFixtureBase64,
} from '../../support/signing/signing-e2e';

test.setTimeout(180_000);

test(
    'EUV-UC3-007 · registrar la firma manuscrita del inversionista',
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
                'PREPARACIÓN · existe una ceremonia con identidad validada en etapa de firma manuscrita',
                async () => {
                    return await prepareSigningAtSignatureScreen(
                        page,
                        facePath!
                    );
                }
            );

        const {
            context,
            driver,
        } = preparation;

        const signature =
            readFixtureBase64(
                'tests/fixtures/signing/signature.png'
            );

        await test.step(
            'DADO una ceremonia con la identidad del inversionista validada',
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
                    'signature'
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
                    state.error
                ).toBe('');
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
            'ENTONCES la firma queda registrada y la ceremonia avanza a consentimiento',
            async () => {
                await driver.waitForScreen(
                    'consent',
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
                    state.uploads?.signature.uploaded
                ).toBe(true);

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
                    state.error
                ).toBe('');
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

                            signId:
                                context.signId,

                            resultingScreen:
                                finalState.screen,

                            resultingStage:
                                finalState.stage,

                            signature:
                                finalState.uploads
                                    ?.signature,

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