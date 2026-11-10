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

/** Pantallas del wizard (`SignComponent.screen()`). */
export type SigningScreen =
    | 'review'
    | 'form'
    | 'identity'
    | 'signature'
    | 'otp'
    | 'signing'
    | 'done'
    | 'failed'
    | 'expired';

/** Stages del backend (`SignatureStage`). */
export type SignatureStage =
    | 'FORM'
    | 'BIOMETRICS'
    | 'SIGNATURE'
    | 'OTP'
    | 'SIGNING'
    | 'SIGNED'
    | 'FAILED';

export type BiometricType =
    | 'ID_FRONT'
    | 'ID_BACK'
    | 'FACE';

/** Espejo de `E2EState` en projects/signing/src/app/core/e2e-hooks.ts. */
export interface SigningE2EState {
    signatureId: string;
    screen: SigningScreen | null;
    stage: SignatureStage | null;
    biometrics: Record<BiometricType, boolean> | null;
    drawSubmitted: boolean;
    otpSent: boolean;
    attemptsLeft: number;
    lastRejection: string;
    error: string;
    busy: boolean;
}

export interface SigningContext extends ProcessContext {
    signatureId: string;
    portalReturnUrl: string;
    signingUrl: string;
}

type HookWindow = {
    __signingE2E?: Record<string, (...args: never[]) => unknown>;
};

/**
 * Maneja `window.__signingE2E`. Cada acción resuelve cuando la llamada
 * del SPA termina; el resultado se lee con `state()`.
 */
export class SigningE2EDriver {
    constructor(
        private readonly page: Page
    ) { }

    async waitReady(
        timeoutMs = 15_000
    ): Promise<void> {
        await this.page.waitForFunction(
            () => Boolean((window as unknown as HookWindow).__signingE2E),
            undefined,
            { timeout: timeoutMs }
        );
    }

    async waitForSignatureLoaded(
        timeoutMs = 20_000
    ): Promise<void> {
        await this.page.waitForFunction(
            () => {
                const api = (window as unknown as {
                    __signingE2E?: { getState: () => { stage: string | null } };
                }).__signingE2E;
                return !!api && api.getState().stage !== null;
            },
            undefined,
            { timeout: timeoutMs }
        );
    }

    async state(): Promise<SigningE2EState> {
        return await this.page.evaluate(
            () =>
                (window as unknown as {
                    __signingE2E: { getState: () => SigningE2EState };
                }).__signingE2E.getState()
        );
    }

    private async call(
        method: string,
        ...args: unknown[]
    ): Promise<void> {
        await this.page.evaluate(
            async ({ method, args }) => {
                const api = (window as unknown as {
                    __signingE2E: Record<string, (...a: unknown[]) => unknown>;
                }).__signingE2E;
                await api[method](...args);
            },
            { method, args }
        );
    }

    async waitForScreen(
        screen: SigningScreen,
        timeoutMs = 30_000
    ): Promise<void> {
        await this.call('waitForScreen', screen, timeoutMs);
    }

    async waitForStage(
        stage: SignatureStage,
        timeoutMs = 60_000
    ): Promise<void> {
        await this.call('waitForStage', stage, timeoutMs);
    }

    /** Equivale a "Todo en orden, continuar" en la revisión del documento. */
    async acknowledgeReview(): Promise<void> {
        await this.call('acknowledgeReview');
        await this.waitForScreen('form');
    }

    /** Acepta los términos y registra el correo del firmante (FORM -> BIOMETRICS). */
    async submitForm(
        email: string
    ): Promise<void> {
        await this.call('submitForm', email);
        await this.throwOnError('submitForm');
    }

    /**
     * Sube y valida una evidencia. Falla con el motivo de Rekognition si
     * la evidencia es rechazada.
     */
    async submitEvidence(
        type: BiometricType,
        base64: string,
        mime: string
    ): Promise<void> {
        await this.call('submitEvidence', type, base64, mime);

        const state =
            await this.state();

        if (state.lastRejection) {
            throw new Error(
                `${type}: evidencia rechazada (${state.lastRejection})`
            );
        }

        await this.throwOnError(type);

        expect(
            state.biometrics?.[type],
            `${type} debe quedar validada`
        ).toBe(true);
    }

    /** Registra el dibujo (SIGNATURE -> OTP); el SPA pide el primer OTP solo. */
    async submitSignature(
        base64: string,
        mime = 'image/png'
    ): Promise<void> {
        await this.call('submitSignature', base64, mime);
        await this.throwOnError('submitSignature');
    }

    async requestOtp(): Promise<void> {
        await this.call('requestOtp');
        await this.throwOnError('requestOtp');
    }

    async confirmOtp(
        code: string
    ): Promise<void> {
        await this.call('confirmOtp', code);
    }

    /** Espera la pantalla OTP con un código ya solicitado. */
    async waitForOtpRequested(
        timeoutMs = 30_000
    ): Promise<void> {
        const startedAt =
            Date.now();

        while (Date.now() - startedAt < timeoutMs) {
            const state =
                await this.state();

            if (state.error) {
                throw new Error(`otp: ${state.error}`);
            }

            if (
                state.screen === 'otp' &&
                state.stage === 'OTP' &&
                state.otpSent
            ) {
                return;
            }

            await this.page.waitForTimeout(200);
        }

        const finalState =
            await this.state();

        throw new Error(
            `timeout esperando OTP. Estado: ${JSON.stringify({
                screen: finalState.screen,
                stage: finalState.stage,
                otpSent: finalState.otpSent,
                error: finalState.error,
            })}`
        );
    }

    private async throwOnError(
        label: string
    ): Promise<void> {
        const state =
            await this.state();

        if (state.error) {
            throw new Error(`${label}: ${state.error}`);
        }
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

/**
 * Prepara un proceso en Signature, inicia la firma desde el portal y abre
 * el Signing SPA con `?e2e=1`. Deja la ceremonia en la revisión del
 * documento.
 */
export async function prepareSigningCeremony(
    page: Page
): Promise<{
    context: SigningContext;
    driver: SigningE2EDriver;
}> {
    const processContext =
        await prepareProcessAtSignatureStage(page);

    const portalReturnUrl =
        page.url();

    await Promise.all([
        page.waitForURL(
            (url) => /^\/sign\/[^/]+$/.test(url.pathname),
            { timeout: 20_000 }
        ),

        page
            .locator('#process-signature-start')
            .click(),
    ]);

    const normalSigningUrl =
        new URL(page.url());

    const match =
        normalSigningUrl.pathname.match(/^\/sign\/([^/?#]+)$/);

    expect(
        match,
        'la ceremonia debe contener un signature_id'
    ).not.toBeNull();

    const signatureId =
        match![1];

    normalSigningUrl.searchParams.set('e2e', '1');

    await page.goto(
        normalSigningUrl.toString(),
        { waitUntil: 'domcontentloaded' }
    );

    await page.context().grantPermissions(
        ['camera'],
        { origin: new URL(page.url()).origin }
    );

    const driver =
        new SigningE2EDriver(page);

    await driver.waitReady();

    await driver.waitForSignatureLoaded();

    await expect(
        page.locator('#signing-ceremony')
    ).toBeVisible({
        timeout: 20_000,
    });

    const state =
        await driver.state();

    expect(state.signatureId).toBe(signatureId);
    expect(state.stage).toBe('FORM');

    await driver.waitForScreen('review');

    return {
        context: {
            ...processContext,
            signatureId,
            portalReturnUrl,
            signingUrl: page.url(),
        },
        driver,
    };
}

/**
 * Revisión -> correo + términos -> identidad (stage BIOMETRICS).
 */
export async function prepareSigningAtIdentityScreen(
    page: Page,
    email: string
): Promise<{
    context: SigningContext;
    driver: SigningE2EDriver;
}> {
    const preparation =
        await prepareSigningCeremony(page);

    const { driver } = preparation;

    await driver.acknowledgeReview();

    await driver.submitForm(email);

    await driver.waitForScreen('identity', 30_000);

    // get-required-biometrics se pide al entrar a BIOMETRICS: esperar su respuesta.
    await page.waitForFunction(
        () =>
            (window as unknown as {
                __signingE2E: { getState: () => { biometrics: unknown } };
            }).__signingE2E.getState().biometrics !== null,
        undefined,
        { timeout: 20_000 }
    );

    const state =
        await driver.state();

    expect(state.stage).toBe('BIOMETRICS');
    expect(state.error).toBe('');

    return preparation;
}

/**
 * Identidad validada (frente, reverso y rostro) -> firma manuscrita
 * (stage SIGNATURE).
 */
export async function prepareSigningAtSignatureScreen(
    page: Page,
    faceFixturePath: string,
    email: string
): Promise<{
    context: SigningContext;
    driver: SigningE2EDriver;
}> {
    const preparation =
        await prepareSigningAtIdentityScreen(page, email);

    const { driver } = preparation;

    await driver.submitEvidence(
        'ID_FRONT',
        readFixtureBase64('parex/tests/fixtures/signing/id-front.png'),
        'image/png'
    );

    await driver.submitEvidence(
        'ID_BACK',
        readFixtureBase64('parex/tests/fixtures/signing/id-back.png'),
        'image/png'
    );

    await driver.submitEvidence(
        'FACE',
        readFixtureBase64(faceFixturePath),
        'image/jpeg'
    );

    await driver.waitForScreen('signature', 30_000);

    const state =
        await driver.state();

    expect(state.biometrics).toEqual({
        ID_FRONT: true,
        ID_BACK: true,
        FACE: true,
    });
    expect(state.stage).toBe('SIGNATURE');
    expect(state.error).toBe('');

    return preparation;
}

/**
 * Firma manuscrita registrada -> OTP solicitado (stage OTP).
 */
export async function prepareSigningAtOtpScreen(
    page: Page,
    faceFixturePath: string,
    email: string
): Promise<{
    context: SigningContext;
    driver: SigningE2EDriver;
}> {
    const preparation =
        await prepareSigningAtSignatureScreen(page, faceFixturePath, email);

    const { driver } = preparation;

    await driver.submitSignature(
        readFixtureBase64('parex/tests/fixtures/signing/signature.png'),
        'image/png'
    );

    await driver.waitForOtpRequested(30_000);

    const state =
        await driver.state();

    expect(state.drawSubmitted).toBe(true);
    expect(state.stage).toBe('OTP');
    expect(state.error).toBe('');

    return preparation;
}
