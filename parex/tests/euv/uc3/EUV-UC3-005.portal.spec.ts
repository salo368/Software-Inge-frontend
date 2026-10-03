import {
    test,
    expect,
} from '@playwright/test';

import {
    prepareProcessAtSignatureStage,
} from '../../support/uc3/process-flow';

test.setTimeout(120_000);

test(
    'EUV-UC3-005 · iniciar la ceremonia de firma',
    async ({ page }, testInfo) => {

        testInfo.annotations.push({
            type: 'known_issue',
            description: 'DEF-UC3-SIGN-001',
        });

        testInfo.annotations.push({
            type: 'workaround',
            description:
                'Reload en etapa Signature antes de iniciar la ceremonia.',
        });

        let signId = '';
        let portalReturnUrl = '';

        /*
         * ============================================================
         * PREPARACIÓN
         * ============================================================
         *
         * Dejamos un proceso nuevo en la etapa Signature.
         *
         * Todavía NO presionamos "Firmar ahora".
         * Por tanto la navegación al Signing SPA sigue siendo
         * parte del comportamiento evaluado por este EUV.
         */
        const processContext =
            await test.step(
                'PREPARACIÓN · existe un proceso listo para iniciar firma',
                async () => {
                    return await prepareProcessAtSignatureStage(
                        page
                    );
                }
            );

        const {
            amount,
            termDays,
            selectedBankId,
            processId,
        } = processContext;

        /*
         * ============================================================
         * EUV
         * ============================================================
         */

        await test.step(
            'DADO un proceso listo para iniciar la ceremonia de firma',
            async () => {
                await expect(
                    page.locator(
                        '#process-stage-signature'
                    )
                ).toBeVisible();

                /*
                 * Estímulo observable del usuario.
                 */
                await expect(
                    page.locator(
                        '#process-signature-start'
                    )
                ).toBeVisible();

                await expect(
                    page.locator(
                        '#process-signature-start'
                    )
                ).toBeEnabled();

                await expect(
                    page.locator('#process-error')
                ).toHaveCount(0);

                /*
                 * Guardamos la URL exacta del portal.
                 *
                 * El producto debe incluirla luego como return_url
                 * en el Signing SPA.
                 */
                portalReturnUrl =
                    page.url();

                await expect(page).toHaveURL(
                    new RegExp(
                        `/portal/process/${processId}(?:[/?#]|$)`
                    )
                );
            }
        );

        await test.step(
            'CUANDO el inversionista solicita iniciar la firma',
            async () => {
                /*
                 * startSignature() puede:
                 *
                 * 1. crear una ceremonia mediante /advance y recibir sign_url;
                 * 2. reutilizar un sign_id pendiente.
                 *
                 * Para el EUV ambas rutas son válidas:
                 * el comportamiento observable debe terminar en Signing.
                 */
                await Promise.all([
                    page.waitForURL(
                        (url) =>
                            /^\/sign\/[^/]+$/.test(
                                url.pathname
                            ),
                        {
                            timeout: 20_000,
                        }
                    ),

                    page
                        .locator(
                            '#process-signature-start'
                        )
                        .click(),
                ]);
            }
        );

        await test.step(
            'ENTONCES el sistema presenta una ceremonia de firma identificable',
            async () => {
                /*
                 * ----------------------------------------------------------
                 * 1. Validar URL de Signing
                 * ----------------------------------------------------------
                 */
                const signingUrl =
                    new URL(page.url());

                const signMatch =
                    signingUrl.pathname.match(
                        /^\/sign\/([^/?#]+)$/
                    );

                expect(
                    signMatch,
                    'la URL debe contener un sign_id identificable'
                ).not.toBeNull();

                signId =
                    signMatch![1];

                expect(
                    signId.length,
                    'el sign_id no puede estar vacío'
                ).toBeGreaterThan(0);

                /*
                 * ----------------------------------------------------------
                 * 2. Validar retorno al proceso original
                 * ----------------------------------------------------------
                 *
                 * URLSearchParams ya entrega el valor decodificado.
                 */
                const returnUrl =
                    signingUrl.searchParams.get(
                        'return_url'
                    );

                expect(
                    returnUrl,
                    'Signing debe conservar la URL de retorno al proceso'
                ).not.toBeNull();

                expect(
                    returnUrl,
                    'return_url debe apuntar al mismo proceso que inició la firma'
                ).toBe(
                    portalReturnUrl
                );

                /*
                 * ----------------------------------------------------------
                 * 3. Validar que el SPA realmente cargó la ceremonia
                 * ----------------------------------------------------------
                 *
                 * No basta con comprobar la URL.
                 *
                 * signing-ceremony solo existe después de que el Signing SPA
                 * recupera exitosamente la ceremonia desde el backend.
                 */
                await expect(
                    page.locator(
                        '#signing-ceremony'
                    )
                ).toBeVisible({
                    timeout: 20_000,
                });

                /*
                 * Si ceremony() fue cargada correctamente,
                 * el estado loading debe desaparecer.
                 */
                await expect(
                    page.locator(
                        '#signing-loading'
                    )
                ).toHaveCount(0);

                /*
                 * El sign_id debe ser válido.
                 */
                await expect(
                    page.locator(
                        '#signing-not-found'
                    )
                ).toHaveCount(0);

                /*
                 * Sin errores recuperables al entrar.
                 */
                await expect(
                    page.locator(
                        '#signing-error'
                    )
                ).toHaveCount(0);

                /*
                 * Para una ceremonia nueva esperamos aterrizar
                 * en la revisión del documento.
                 */
                await expect(
                    page.locator(
                        '#signing-screen-review'
                    )
                ).toBeVisible();

                await expect(
                    page.locator(
                        '#signing-review-continue'
                    )
                ).toBeVisible();
            }
        );

        /*
         * ============================================================
         * EVIDENCIA
         * ============================================================
         */
        await testInfo.attach(
            'contexto-ejecucion',
            {
                body: Buffer.from(
                    JSON.stringify(
                        {
                            environment:
                                process.env.TEST_ENV ??
                                'dev',

                            euv:
                                'EUV-UC3-005',

                            description:
                                'Iniciar la ceremonia de firma',

                            processId,

                            signId,

                            selectedBankId,

                            amount:
                                Number(amount),

                            termDays,

                            portalReturnUrl,

                            signingUrl:
                                page.url(),

                            resultingSystem:
                                'signing',

                            resultingScreen:
                                'review',
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
            'evidencia-ceremonia-firma',
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