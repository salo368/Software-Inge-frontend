import {
    expect,
    type Page,
} from '@playwright/test';

import {
    createProcessAtFormStage,
    type ProcessContext,
} from './process-flow';

/**
 * Sesión vacía: sirve para que un spec NO herede el `storageState` del
 * usuario compartido de PAREX y pueda registrar el suyo.
 *
 *   test.use({ storageState: { cookies: [], origins: [] } });
 */
export const NO_SESSION: {
    cookies: never[];
    origins: never[];
} = {
    cookies: [],
    origins: [],
};

/**
 * Registra un inversionista nuevo por la pantalla de registro (el mismo
 * recorrido que EUV-UC2-001) y deja la sesión iniciada en `page`.
 *
 * Por qué existe: el formulario de datos personales es UNO POR USUARIO y
 * persiste. El usuario compartido de PAREX ya lo tiene lleno desde la
 * primera corrida (EUV-UC3-002 lo guarda) y varios specs lo reescriben a la
 * vez, así que un test que necesite el formulario vacío, o que lea de
 * vuelta lo que guardó, es frágil con ese usuario. Con uno propio el estado
 * es conocido y nadie más lo toca.
 */
export async function registerFreshUser(
    page: Page
): Promise<{ email: string; password: string }> {
    const unique =
        `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    const credentials = {
        email: `parex-form-${unique}@example.com`,
        password: 'Parex-form-123',
    };

    await page.goto('/portal/register');

    await page.locator('#register-name').fill('Usuario PAREX Formulario');
    await page.locator('#register-email').fill(credentials.email);
    await page.locator('#register-password').fill(credentials.password);
    await page.locator('#portal-register-submit').click();

    await expect(
        page.locator('#global-nav-account')
    ).toBeVisible({
        timeout: 30_000,
    });

    return credentials;
}

/**
 * Usuario nuevo + proceso nuevo en etapa Formulario, con el formulario del
 * usuario vacío (sin precarga) y sus valores por defecto.
 *
 * Requiere que el spec declare `test.use({ storageState: NO_SESSION })`.
 */
export async function startFreshFormProcess(
    page: Page
): Promise<ProcessContext> {
    await registerFreshUser(page);

    const context = await createProcessAtFormStage(page);

    // Usuario nuevo: nada que precargar.
    await expect(
        page.locator('#process-form')
    ).toBeVisible();

    await expect(
        page.getByText('Precargamos tus datos')
    ).toHaveCount(0);

    return context;
}
