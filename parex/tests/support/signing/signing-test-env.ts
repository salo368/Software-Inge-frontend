import fs from 'node:fs';
import path from 'node:path';

import {
    test,
    type TestInfo,
} from '@playwright/test';

export function requireSigningE2EInputs(
    testInfo: TestInfo
): {
    facePath: string;
    debugOtpKeyHex: string;
} {
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

    const debugOtpKeyHex =
        process.env.DEBUG_OTP_KEY_HEX;

    if (!debugOtpKeyHex) {
        testInfo.annotations.push({
            type: 'blocked',
            description:
                'DEBUG_OTP_KEY_HEX no está configurado en el entorno de ejecución.',
        });

        test.skip(
            true,
            'Se necesita la clave HMAC de automatización del ambiente.'
        );
    }

    if (
        !/^[0-9a-fA-F]+$/.test(
            debugOtpKeyHex!
        ) ||
        debugOtpKeyHex!.length % 2 !== 0
    ) {
        throw new Error(
            'DEBUG_OTP_KEY_HEX debe ser hexadecimal y tener longitud par.'
        );
    }

    return {
        facePath:
            path.resolve(facePath!),

        debugOtpKeyHex:
            debugOtpKeyHex!,
    };
}
