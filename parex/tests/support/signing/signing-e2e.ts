import fs from 'node:fs';
import path from 'node:path';

import {
    expect,
    type Page,
} from '@playwright/test';

import {
    prepareProcessAtSignatureStage,
    type ProcessContext,
} from '../uc3/process-flow';

export type SigningScreen =
    | 'review'
    | 'identity'
    | 'signature'
    | 'consent'
    | 'otp'
    | 'signing'
    | 'done'
    | 'failed'
    | 'expired';

export interface SigningUploadState {
    uploaded: boolean;
    validated: boolean | null;
}

export interface SigningE2EState {
    signId: string;

    screen: SigningScreen | null;

    stage: string | null;

    uploads: {
        id_front: SigningUploadState;
        id_back: SigningUploadState;
        face: SigningUploadState;
        signature: SigningUploadState;
    } | null;

    otpSent: boolean;

    debugOtp: string;

    error: string;

    busy: boolean;
}

export interface SigningContext extends ProcessContext {
    signId: string;
    portalReturnUrl: string;
    signingUrl: string;
}

export class SigningE2EDriver {
    constructor(
        private readonly page: Page
    ) { }

    async waitReady(
        timeoutMs = 15_000
    ): Promise<void> {
        await this.page.waitForFunction(
            () =>
                Boolean(
                    (
                        window as unknown as {
                            __signingE2E?: unknown;
                        }
                    ).__signingE2E
                ),
            undefined,
            {
                timeout: timeoutMs,
            }
        );
    }

    async waitForCeremonyLoaded(
        timeoutMs = 20_000
    ): Promise<void> {
        await this.page.waitForFunction(
            () => {
                const api = (
                    window as unknown as {
                        __signingE2E?: {
                            getState: () => {
                                stage: string | null;
                                uploads: unknown | null;
                            };
                        };
                    }
                ).__signingE2E;

                if (!api) {
                    return false;
                }

                const state =
                    api.getState();

                return (
                    state.stage !== null &&
                    state.uploads !== null
                );
            },
            undefined,
            {
                timeout: timeoutMs,
            }
        );
    }

    async state(): Promise<SigningE2EState> {
        return await this.page.evaluate(
            () =>
                (
                    window as unknown as {
                        __signingE2E: {
                            getState:
                            () => SigningE2EState;
                        };
                    }
                ).__signingE2E.getState()
        );
    }

    async waitForScreen(
        screen: SigningScreen,
        timeoutMs = 30_000
    ): Promise<void> {
        await this.page.evaluate(
            async ({
                screen,
                timeoutMs,
            }) => {
                await (
                    window as unknown as {
                        __signingE2E: {
                            waitForScreen: (
                                screen: string,
                                timeoutMs: number
                            ) => Promise<void>;
                        };
                    }
                ).__signingE2E.waitForScreen(
                    screen,
                    timeoutMs
                );
            },
            {
                screen,
                timeoutMs,
            }
        );
    }

    async waitForStage(
        stage: string,
        timeoutMs = 60_000
    ): Promise<void> {
        await this.page.evaluate(
            async ({
                stage,
                timeoutMs,
            }) => {
                await (
                    window as unknown as {
                        __signingE2E: {
                            waitForStage: (
                                stage: string,
                                timeoutMs: number
                            ) => Promise<void>;
                        };
                    }
                ).__signingE2E.waitForStage(
                    stage,
                    timeoutMs
                );
            },
            {
                stage,
                timeoutMs,
            }
        );
    }

    async waitForEvidenceValidated(
        type:
            | 'id_front'
            | 'id_back'
            | 'face',
        timeoutMs = 30_000
    ): Promise<void> {
        const startedAt =
            Date.now();

        while (
            Date.now() - startedAt <
            timeoutMs
        ) {
            const state =
                await this.state();

            if (state.error) {
                throw new Error(
                    `${type}: ${state.error}`
                );
            }

            const evidence =
                state.uploads?.[type];

            if (
                evidence?.uploaded === true &&
                evidence.validated === true
            ) {
                return;
            }

            if (
                evidence?.uploaded === true &&
                evidence.validated === false
            ) {
                throw new Error(
                    `${type}: la evidencia fue cargada pero no validada`
                );
            }

            await this.page.waitForTimeout(
                200
            );
        }

        const finalState =
            await this.state();

        throw new Error(
            `${type}: timeout esperando validación. Estado: ${JSON.stringify(
                finalState.uploads?.[type] ??
                null
            )}`
        );
    }

    async waitForOtpRequested(
        timeoutMs = 30_000
    ): Promise<void> {
        const startedAt =
            Date.now();

        while (
            Date.now() - startedAt <
            timeoutMs
        ) {
            const state =
                await this.state();

            if (state.error) {
                throw new Error(
                    `otp: ${state.error}`
                );
            }

            if (
                state.screen === 'otp' &&
                state.stage === 'otp' &&
                state.otpSent === true
            ) {
                return;
            }

            await this.page.waitForTimeout(
                200
            );
        }

        const finalState =
            await this.state();

        throw new Error(
            `timeout esperando OTP. Estado: ${JSON.stringify(
                {
                    screen:
                        finalState.screen,
                    stage:
                        finalState.stage,
                    otpSent:
                        finalState.otpSent,
                    error:
                        finalState.error,
                }
            )}`
        );
    }

    async goToIdentity(): Promise<void> {
        await this.page.evaluate(
            () => {
                (
                    window as unknown as {
                        __signingE2E: {
                            goToIdentity:
                            () => void;
                        };
                    }
                ).__signingE2E.goToIdentity();
            }
        );

        await this.waitForScreen(
            'identity'
        );
    }

    async submitEvidence(
        type:
            | 'id_front'
            | 'id_back'
            | 'face',
        base64: string,
        mime: string
    ): Promise<void> {
        await this.page.evaluate(
            async ({
                type,
                base64,
                mime,
            }) => {
                await (
                    window as unknown as {
                        __signingE2E: {
                            submitEvidence: (
                                type: string,
                                base64: string,
                                mime: string
                            ) => Promise<void>;
                        };
                    }
                ).__signingE2E.submitEvidence(
                    type,
                    base64,
                    mime
                );
            },
            {
                type,
                base64,
                mime,
            }
        );

        await this.waitForEvidenceValidated(
            type
        );
    }

    async submitSignature(
        base64: string,
        mime = 'image/png'
    ): Promise<void> {
        await this.page.evaluate(
            async ({
                base64,
                mime,
            }) => {
                await (
                    window as unknown as {
                        __signingE2E: {
                            submitSignature: (
                                base64: string,
                                mime?: string
                            ) => Promise<void>;
                        };
                    }
                ).__signingE2E.submitSignature(
                    base64,
                    mime
                );
            },
            {
                base64,
                mime,
            }
        );
    }

    async setDebugOtpKey(
        hexKey: string
    ): Promise<void> {
        await this.page.evaluate(
            (key) => {
                (
                    window as unknown as {
                        __signingE2E: {
                            setDebugOtpKey:
                            (key: string) => void;
                        };
                    }
                ).__signingE2E.setDebugOtpKey(
                    key
                );
            },
            hexKey
        );
    }

    async acceptConsent(): Promise<void> {
        await this.page.evaluate(
            async () => {
                await (
                    window as unknown as {
                        __signingE2E: {
                            acceptConsent:
                            () => Promise<void>;
                        };
                    }
                ).__signingE2E.acceptConsent();
            }
        );
    }

    async debugOtp(): Promise<string> {
        const state =
            await this.state();

        return state.debugOtp;
    }

    async confirmOtp(
        code: string
    ): Promise<void> {
        await this.page.evaluate(
            async (otp) => {
                await (
                    window as unknown as {
                        __signingE2E: {
                            confirmOtp:
                            (
                                otp: string
                            ) => Promise<void>;
                        };
                    }
                ).__signingE2E.confirmOtp(
                    otp
                );
            },
            code
        );
    }
}

export function readFixtureBase64(
    relativePath: string
): string {
    const fixturePath =
        path.resolve(relativePath);

    if (!fs.existsSync(fixturePath)) {
        throw new Error(
            `No existe fixture: ${fixturePath}`
        );
    }

    return fs
        .readFileSync(fixturePath)
        .toString('base64');
}

export async function prepareSigningCeremony(
    page: Page
): Promise<{
    context: SigningContext;
    driver: SigningE2EDriver;
}> {
    const processContext =
        await prepareProcessAtSignatureStage(
            page
        );

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

    const portalReturnUrl =
        page.url();

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

    const normalSigningUrl =
        new URL(page.url());

    const match =
        normalSigningUrl.pathname.match(
            /^\/sign\/([^/?#]+)$/
        );

    expect(
        match,
        'la ceremonia debe contener un sign_id'
    ).not.toBeNull();

    const signId =
        match![1];

    normalSigningUrl.searchParams.set(
        'e2e',
        '1'
    );

    await page.goto(
        normalSigningUrl.toString(),
        {
            waitUntil:
                'domcontentloaded',
        }
    );

    await page.context().grantPermissions(
        ['camera'],
        {
            origin:
                new URL(
                    page.url()
                ).origin,
        }
    );

    const driver =
        new SigningE2EDriver(page);

    await driver.waitReady();

    await driver.waitForCeremonyLoaded();

    await expect(
        page.locator(
            '#signing-ceremony'
        )
    ).toBeVisible({
        timeout: 20_000,
    });

    const state =
        await driver.state();

    expect(
        state.signId
    ).toBe(signId);

    expect(
        state.stage
    ).not.toBeNull();

    expect(
        state.uploads
    ).not.toBeNull();

    await driver.waitForScreen(
        'review'
    );

    return {
        context: {
            ...processContext,
            signId,
            portalReturnUrl,
            signingUrl:
                page.url(),
        },

        driver,
    };
}

export async function prepareSigningAtSignatureScreen(
    page: Page,
    faceFixturePath: string
): Promise<{
    context: SigningContext;
    driver: SigningE2EDriver;
}> {
    const preparation =
        await prepareSigningCeremony(
            page
        );

    const {
        context,
        driver,
    } = preparation;

    const idFront =
        readFixtureBase64(
            'tests/fixtures/signing/id-front.png'
        );

    const idBack =
        readFixtureBase64(
            'tests/fixtures/signing/id-back.png'
        );

    const face =
        readFixtureBase64(
            faceFixturePath
        );

    await driver.goToIdentity();

    await driver.submitEvidence(
        'id_front',
        idFront,
        'image/png'
    );

    await driver.submitEvidence(
        'id_back',
        idBack,
        'image/png'
    );

    await driver.submitEvidence(
        'face',
        face,
        'image/jpeg'
    );

    await driver.waitForScreen(
        'signature',
        30_000
    );

    const state =
        await driver.state();

    expect(
        state.uploads?.id_front.uploaded
    ).toBe(true);

    expect(
        state.uploads?.id_front.validated
    ).toBe(true);

    expect(
        state.uploads?.id_back.uploaded
    ).toBe(true);

    expect(
        state.uploads?.id_back.validated
    ).toBe(true);

    expect(
        state.uploads?.face.uploaded
    ).toBe(true);

    expect(
        state.uploads?.face.validated
    ).toBe(true);

    expect(
        state.screen
    ).toBe('signature');

    expect(
        state.error
    ).toBe('');

    return {
        context,
        driver,
    };
}

export async function prepareSigningAtConsentScreen(
    page: Page,
    faceFixturePath: string
): Promise<{
    context: SigningContext;
    driver: SigningE2EDriver;
}> {
    const preparation =
        await prepareSigningAtSignatureScreen(
            page,
            faceFixturePath
        );

    const {
        context,
        driver,
    } = preparation;

    const signature =
        readFixtureBase64(
            'tests/fixtures/signing/signature.png'
        );

    await driver.submitSignature(
        signature,
        'image/png'
    );

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
        state.screen
    ).toBe('consent');

    expect(
        state.stage
    ).toBe('consent');

    expect(
        state.uploads?.signature.uploaded
    ).toBe(true);

    expect(
        state.error
    ).toBe('');

    return {
        context,
        driver,
    };
}

export async function prepareSigningAtOtpScreen(
    page: Page,
    faceFixturePath: string,
    debugOtpKeyHex: string
): Promise<{
    context: SigningContext;
    driver: SigningE2EDriver;
    otp: string;
}> {
    const preparation =
        await prepareSigningAtConsentScreen(
            page,
            faceFixturePath
        );

    const {
        context,
        driver,
    } = preparation;

    await driver.setDebugOtpKey(
        debugOtpKeyHex
    );

    await driver.acceptConsent();

    await driver.waitForOtpRequested(
        30_000
    );

    const state =
        await driver.state();

    expect(
        state.screen
    ).toBe('otp');

    expect(
        state.stage
    ).toBe('otp');

    expect(
        state.otpSent
    ).toBe(true);

    expect(
        state.error
    ).toBe('');

    const otp =
        await driver.debugOtp();

    expect(
        otp,
        'el backend DEV debe exponer un OTP de seis dígitos cuando la compuerta debug está autorizada'
    ).toMatch(
        /^\d{6}$/
    );

    return {
        context,
        driver,
        otp,
    };
}