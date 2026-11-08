import fs from 'node:fs';
import path from 'node:path';

import {
    test,
    type TestInfo,
} from '@playwright/test';

/**
 * Obtiene el OTP de 6 dígitos de una firma.
 *
 * El backend solo lo envía por correo (`POST /signatures/set-otp`): ya no
 * existe el atajo `X-Debug-OTP-Signature` / `_debug_otp`. Para automatizar
 * los EUV que confirman el OTP hace falta una fuente real del código (un
 * buzón de prueba leído por IMAP/API, o un endpoint de prueba en el back).
 */
export type OtpProvider = (signatureId: string) => Promise<string>;

export const OTP_BLOCKED_REASON =
    'El backend ya no expone un OTP de prueba (set-otp solo lo envía por correo). ' +
    'Reactivar cuando exista una fuente automatizable del código (buzón de prueba o ' +
    'endpoint de prueba en dev/staging) y conectarla en resolveOtpProvider().';

/**
 * Punto ÚNICO donde se conecta la fuente del OTP. Devuelve `null` mientras
 * no exista ninguna; los EUV que la necesitan quedan como `test.fixme`.
 */
export function resolveOtpProvider(): OtpProvider | null {
    return null;
}

export interface SigningE2EInputs {
    /** Selfie real (Rekognition debe detectar exactamente un rostro). */
    facePath: string;
    /** Correo del firmante: adonde llegaría el OTP. */
    signerEmail: string;
}

/**
 * Entradas comunes a los EUV que preparan una ceremonia. Hace `skip` del
 * test (con anotación `blocked`) si falta la fixture facial.
 */
export function requireSigningE2EInputs(
    testInfo: TestInfo
): SigningE2EInputs {
    const facePath =
        process.env.SIGNATURES_TEST_FACE_PATH;

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
            'Se necesita una fixture facial privada para preparar la ceremonia.'
        );
    }

    return {
        facePath:
            path.resolve(facePath!),

        signerEmail:
            signerEmail(),
    };
}

/**
 * Como `requireSigningE2EInputs`, y además exige una fuente de OTP. Sin
 * ella el test queda `fixme` con la razón explícita.
 */
export function requireSigningE2EInputsWithOtp(
    testInfo: TestInfo
): SigningE2EInputs & { otpProvider: OtpProvider } {
    const otpProvider =
        resolveOtpProvider();

    if (!otpProvider) {
        testInfo.annotations.push({
            type: 'blocked',
            description:
                OTP_BLOCKED_REASON,
        });

        test.fixme(
            true,
            OTP_BLOCKED_REASON
        );
    }

    return {
        ...requireSigningE2EInputs(testInfo),
        otpProvider: otpProvider!,
    };
}

export function signerEmail(): string {
    return (
        process.env.SIGNATURES_TEST_EMAIL ??
        process.env.TEST_USER_EMAIL ??
        'parex@example.com'
    );
}
