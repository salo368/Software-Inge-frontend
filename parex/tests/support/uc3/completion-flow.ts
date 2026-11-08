import {
    expect,
    type Page,
} from '@playwright/test';

import {
    prepareSigningAtOtpScreen,
} from '../signing/signing-e2e';

import type {
    OtpProvider,
} from '../signing/signing-test-env';

import {
    buildSyntheticDocument,
} from './process-flow';

export interface CompletionInputs {
    facePath: string;
    signerEmail: string;
    otpProvider: OtpProvider;
}

/**
 * Ceremonia en OTP -> confirma el código -> SIGNED (pantalla `done`).
 * Necesita una fuente real del OTP (ver signing-test-env.ts).
 */
export async function prepareSignedCeremony(
    page: Page,
    inputs: CompletionInputs
) {
    const preparation =
        await prepareSigningAtOtpScreen(
            page,
            inputs.facePath,
            inputs.signerEmail
        );

    const {
        context,
        driver,
    } = preparation;

    const otp =
        await inputs.otpProvider(context.signatureId);

    expect(otp).toMatch(/^\d{6}$/);

    await driver.confirmOtp(otp);

    /*
     * El firmado es asíncrono.
     * No aceptamos únicamente SIGNING:
     * esperamos el estado terminal real del backend.
     */
    await driver.waitForStage('SIGNED', 120_000);

    await driver.waitForScreen('done', 30_000);

    const state =
        await driver.state();

    expect(state.signatureId).toBe(context.signatureId);
    expect(state.stage).toBe('SIGNED');
    expect(state.screen).toBe('done');
    expect(state.error).toBe('');

    return {
        ...preparation,
        otp,
    };
}

/**
 * Firmada -> vuelve al portal -> el webhook `signed` deja el proceso en
 * PAYMENT.
 */
export async function prepareProcessAtPaymentStage(
    page: Page,
    inputs: CompletionInputs
) {
    const preparation =
        await prepareSignedCeremony(page, inputs);

    const {
        context,
    } = preparation;

    const returnButton =
        page.locator('#signing-return-to-process');

    await expect(returnButton).toBeVisible();

    await Promise.all([
        page.waitForURL(
            (url) =>
                url.pathname.endsWith(
                    `/portal/process/${context.processId}`
                ),
            { timeout: 30_000 }
        ),

        returnButton.click(),
    ]);

    /*
     * Al volver, el portal ve la firma SIGNED y espera a que el webhook
     * mueva el proceso a PAYMENT.
     */
    await expect(
        page.locator('#process-stage-payment')
    ).toBeVisible({
        timeout: 90_000,
    });

    await expect(
        page.locator('#process-error')
    ).toHaveCount(0);

    return preparation;
}

/**
 * Registra un pago por el total con un comprobante sintético; el
 * proceso pasa a REVIEW (`get-pending-pay`).
 */
export async function payFullAmount(
    page: Page,
    amount: string
): Promise<void> {
    await expect(
        page.locator('#process-payment-summary')
    ).toBeVisible({
        timeout: 20_000,
    });

    await page
        .locator('#process-payment-amount')
        .fill(amount);

    await page
        .locator('#process-payment-receipt-input')
        .setInputFiles(buildSyntheticDocument('comprobante'));

    await page
        .locator('#process-payment-submit')
        .click();
}

/**
 * Pagada -> REVIEW (pantalla `#process-stage-done`).
 */
export async function prepareProcessAtDoneStage(
    page: Page,
    inputs: CompletionInputs
) {
    const preparation =
        await prepareProcessAtPaymentStage(page, inputs);

    await payFullAmount(
        page,
        preparation.context.amount
    );

    await expect(
        page.locator('#process-stage-done')
    ).toBeVisible({
        timeout: 30_000,
    });

    await expect(
        page.locator('#process-error')
    ).toHaveCount(0);

    return preparation;
}
