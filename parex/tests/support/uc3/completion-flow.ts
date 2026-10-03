import {
    expect,
    type Page,
} from '@playwright/test';

import {
    prepareSigningAtOtpScreen,
} from '../signing/signing-e2e';

export async function prepareSignedCeremony(
    page: Page,
    faceFixturePath: string,
    debugOtpKeyHex: string
) {
    const preparation =
        await prepareSigningAtOtpScreen(
            page,
            faceFixturePath,
            debugOtpKeyHex
        );

    const {
        context,
        driver,
        otp,
    } = preparation;

    await driver.confirmOtp(
        otp
    );

    /*
     * El firmado es asíncrono.
     * No aceptamos únicamente "signing":
     * esperamos el estado terminal real del backend.
     */
    await driver.waitForStage(
        'signed',
        120_000
    );

    await driver.waitForScreen(
        'done',
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
        state.stage
    ).toBe(
        'signed'
    );

    expect(
        state.screen
    ).toBe(
        'done'
    );

    expect(
        state.error
    ).toBe('');

    return {
        context,
        driver,
    };
}

export async function prepareProcessAtPaymentStage(
    page: Page,
    faceFixturePath: string,
    debugOtpKeyHex: string
) {
    const preparation =
        await prepareSignedCeremony(
            page,
            faceFixturePath,
            debugOtpKeyHex
        );

    const {
        context,
    } = preparation;

    const returnButton =
        page.locator(
            '#signing-return-to-process'
        );

    await expect(
        returnButton
    ).toBeVisible();

    await Promise.all([
        page.waitForURL(
            (url) =>
                url.pathname.endsWith(
                    `/portal/process/${context.processId}`
                ),
            {
                timeout: 30_000,
            }
        ),

        returnButton.click(),
    ]);

    /*
     * Al volver, ProcessComponent detecta la ceremonia signed
     * y autoavanza signature -> payment.
     */
    await expect(
        page.locator(
            '#process-stage-payment'
        )
    ).toBeVisible({
        timeout: 30_000,
    });

    await expect(
        page.locator(
            '#process-error'
        )
    ).toHaveCount(0);

    return preparation;
}

export async function prepareProcessAtDoneStage(
    page: Page,
    faceFixturePath: string,
    debugOtpKeyHex: string
) {
    const preparation =
        await prepareProcessAtPaymentStage(
            page,
            faceFixturePath,
            debugOtpKeyHex
        );

    await page
        .locator(
            '#process-advance-payment'
        )
        .click();

    await expect(
        page.locator(
            '#process-stage-done'
        )
    ).toBeVisible({
        timeout: 30_000,
    });

    await expect(
        page.locator(
            '#process-error'
        )
    ).toHaveCount(0);

    return preparation;
}
