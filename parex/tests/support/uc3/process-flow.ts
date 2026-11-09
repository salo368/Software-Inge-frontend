import { expect, type Page } from '@playwright/test';

import {
    pickFixedOption,
    pickSearchOption,
} from './form-controls';

export const DEFAULT_UC3_AMOUNT = '89000000';
export const DEFAULT_UC3_TERM_DAYS = 540;

export interface SimulatorOfferContext {
    amount: string;
    termDays: number;
    selectedBankId: string;
}

export interface ProcessContext extends SimulatorOfferContext {
    processId: string;
}

export interface SyntheticDocument {
    name: string;
    mimeType: 'image/png';
    buffer: Buffer;
}

/** Documento requerido tal como lo pinta el portal (`process-documents-row-<slug>`). */
export interface RequiredDocument {
    fileType: string;
    slug: string;
}

export interface UploadedDocument extends RequiredDocument {
    name: string;
}

/**
 * Formulario KYC del servicio `forms` (backend docs/forms-api.md §3.1).
 *
 * Los países, departamentos y ciudades son CLAVES del catálogo
 * (`GET /forms/get-locations`), no etiquetas.
 */
export interface ProcessFormData {
    name: string;
    secondName: string;
    lastName: string;
    secondLastName: string;
    gender: 'M' | 'F' | 'O';
    birthDate: string;
    nationality: string;
    civilStatus: string;
    educationLevel: string;
    birthCountry: string;
    birthDepartment: string;
    birthCity: string;
    documentType: 'CC' | 'CE' | 'TI' | 'PA';
    documentNumber: string;
    documentIssuanceDate: string;
    documentIssuanceCountry: string;
    documentIssuanceDepartment: string;
    documentIssuanceCity: string;
    email: string;
    /** País del indicativo (ISO 3166-1 alfa-2), p. ej. `CO`. El campo es un selector con banderas. */
    phoneCountry: string;
    /** Indicativo de ese país, sin `+`: es lo que se escribe para buscarlo y lo que el back recibe. */
    phoneDial: string;
    phoneNumber: string;
    monthlyIncome: string;
    monthlyExpenses: string;
    totalAssets: string;
    totalLiabilities: string;
    isTaxDeclarant: boolean;
    isPep: boolean;
}

/**
 * Lleva al usuario autenticado hasta tener una alternativa
 * disponible en el simulador.
 *
 * IMPORTANTE:
 * Esta función NO abre el CDT.
 *
 * Esto permite que EUV-UC3-001 pueda utilizarla como preparación
 * sin ejecutar anticipadamente el comportamiento que pretende validar.
 */
export async function prepareSimulatorOffer(
    page: Page,
    options: {
        amount?: string;
        termDays?: number;
    } = {}
): Promise<SimulatorOfferContext> {
    const amount =
        options.amount ?? DEFAULT_UC3_AMOUNT;

    const termDays =
        options.termDays ?? DEFAULT_UC3_TERM_DAYS;

    await page.goto('/');

    /*
     * Precondición:
     * la sesión autenticada fue preparada por auth.setup.ts.
     */
    await expect(
        page.locator('#global-nav-account')
    ).toBeVisible();

    await expect(
        page.locator('#global-nav-logout')
    ).toBeVisible();

    /*
     * Simulador.
     */
    await expect(
        page.locator('#simulator-investment-amount')
    ).toBeVisible();

    await page
        .locator('#simulator-investment-amount')
        .fill(amount);

    await page
        .locator(`#simulator-term-${termDays}`)
        .click();

    /*
     * En CI la simulación puede tardar más que el timeout visual
     * por cold start / latencia del servicio.
     *
     * Esperamos el contrato HTTP real en lugar de dormir un tiempo
     * arbitrario. La promesa se registra ANTES del click para no
     * perder respuestas rápidas.
     */
    const pageErrors: string[] = [];

    const pageErrorListener =
        (error: Error) => {
            pageErrors.push(error.message);
        };

    page.on(
        'pageerror',
        pageErrorListener
    );

    const simulationResponsePromise =
        page.waitForResponse(
            (response) =>
                response.request().method() === 'GET' &&
                response.url().includes('/banks/simulate'),
            {
                timeout: 60_000,
            }
        );

    await page
        .locator('#simulator-submit')
        .click();

    const simulationResponse =
        await simulationResponsePromise;

    const simulationBody =
        await simulationResponse.text();

    console.log(
        [
            '[PAREX] GET /banks/simulate',
            `status=${simulationResponse.status()}`,
            `body=${simulationBody.slice(0, 1000)}`,
        ].join(' · ')
    );

    expect(
        simulationResponse.ok(),
        [
            'la simulación debe responder correctamente',
            `status=${simulationResponse.status()}`,
            `body=${simulationBody.slice(0, 500)}`,
        ].join(' · ')
    ).toBeTruthy();

    let simulationPayload: unknown;

    try {
        simulationPayload =
            JSON.parse(simulationBody);
    } catch {
        throw new Error(
            [
                'GET /banks/simulate respondió 2xx',
                'pero el body no es JSON válido',
                `body=${simulationBody.slice(0, 500)}`,
            ].join(' · ')
        );
    }

    /*
     * Contrato: `banks` es un OBJETO indexado por el id del banco,
     * no un array (backend docs/banks-api.md §3.3).
     */
    const banks =
        (simulationPayload as { banks?: unknown } | null)?.banks;

    expect(
        banks !== null &&
        typeof banks === 'object' &&
        !Array.isArray(banks),
        [
            'GET /banks/simulate respondió 2xx',
            'pero no cumple el contrato esperado { banks: { <id>: {...} } }',
            `body=${simulationBody.slice(0, 500)}`,
        ].join(' · ')
    ).toBeTruthy();

    const simulatorResults =
        page.locator('#simulator-results');

    const simulatorError =
        page.locator('#simulator-error');

    try {
        await expect
            .poll(
                async () => {
                    if (pageErrors.length > 0) {
                        return 'page-error';
                    }

                    if (
                        await simulatorError
                            .isVisible()
                            .catch(() => false)
                    ) {
                        return 'simulator-error';
                    }

                    if (
                        await simulatorResults
                            .isVisible()
                            .catch(() => false)
                    ) {
                        return 'results';
                    }

                    return 'loading';
                },
                {
                    timeout: 15_000,
                    message:
                        'el simulador debe terminar mostrando resultados o un error observable',
                }
            )
            .not.toBe('loading');

        if (pageErrors.length > 0) {
            throw new Error(
                [
                    'El navegador lanzó un error JavaScript después de la simulación',
                    ...pageErrors,
                ].join(' · ')
            );
        }

        if (
            await simulatorError
                .isVisible()
                .catch(() => false)
        ) {
            throw new Error(
                `El simulador mostró error: ${
                    await simulatorError
                        .textContent()
                }`
            );
        }

        await expect(
            simulatorResults
        ).toBeVisible();
    } finally {
        page.off(
            'pageerror',
            pageErrorListener
        );
    }

    /*
     * Descubrimos las identidades de dominio disponibles.
     *
     * No usamos:
     * - nth()
     * - posición visual
     * - clases CSS
     * - texto visible como identidad
     */
    const offerIds = await page
        .locator('[id^="simulator-offer-open-"]')
        .evaluateAll((elements) =>
            elements.map((element) => element.id)
        );

    const bankIds = offerIds
        .map((id) =>
            Number(
                id.replace(
                    'simulator-offer-open-',
                    ''
                )
            )
        )
        .filter(Number.isFinite)
        .sort((a, b) => a - b);

    expect(
        bankIds.length,
        'debe existir al menos una alternativa disponible'
    ).toBeGreaterThan(0);

    /*
     * Selección determinista:
     * usamos el bank.id numéricamente menor disponible.
     */
    const selectedBankId =
        String(bankIds[0]);

    await expect(
        page.locator(
            `#simulator-offer-${selectedBankId}`
        )
    ).toHaveCount(1);

    await expect(
        page.locator(
            `#simulator-offer-open-${selectedBankId}`
        )
    ).toHaveCount(1);

    return {
        amount,
        termDays,
        selectedBankId,
    };
}

/**
 * Prepara un proceso nuevo y lo deja en la etapa Formulario.
 *
 * NO debe utilizarse como preparación de EUV-UC3-001,
 * porque allí la creación del proceso es precisamente
 * el comportamiento que se pretende demostrar.
 */
export async function createProcessAtFormStage(
    page: Page,
    options: {
        amount?: string;
        termDays?: number;
    } = {}
): Promise<ProcessContext> {
    const simulatorContext =
        await prepareSimulatorOffer(
            page,
            options
        );

    const {
        selectedBankId,
    } = simulatorContext;

    /*
     * Abrir CDT y esperar navegación al proceso.
     */
    await Promise.all([
        page.waitForURL(
            /\/portal\/process\/[^/?#]+/,
            {
                timeout: 30_000,
            }
        ),

        page
            .locator(
                `#simulator-offer-open-${selectedBankId}`
            )
            .click(),
    ]);

    const pathname =
        new URL(page.url()).pathname;

    const match = pathname.match(
        /^\/portal\/process\/([^/?#]+)$/
    );

    expect(
        match,
        'la navegación debe contener un identificador de proceso'
    ).not.toBeNull();

    const processId = match![1];

    expect(
        processId.length,
        'el identificador del proceso no puede estar vacío'
    ).toBeGreaterThan(0);

    /*
     * Confirmar que el proceso inicia en Formulario.
     */
    await expect(
        page.locator('#process-stage-form')
    ).toBeVisible();

    await expect(
        page.locator('#process-form')
    ).toBeVisible({
        timeout: 20_000,
    });

    return {
        ...simulatorContext,
        processId,
    };
}

/**
 * Genera datos sintéticos para el formulario.
 *
 * No utiliza información personal real. Las ubicaciones son claves
 * reales del catálogo (`QUINDIO/ARMENIA`, `CUNDINAMARCA/USAQUEN`, esta
 * última una localidad de Bogotá, válida como ciudad de expedición).
 *
 * `isTaxDeclarant: true` hace que el proceso exija, además de la
 * certificación bancaria, la declaración de renta: así UC3-003 cubre un
 * requisito condicional.
 */
export function buildSyntheticProcessFormData(): ProcessFormData {
    return {
        name: 'Usuario',
        secondName: 'Parex',
        lastName: 'Prueba',
        secondLastName: 'Automatizada',
        gender: 'O',
        birthDate: '1999-11-02',
        nationality: 'COLOMBIA',
        civilStatus: 'SINGLE',
        educationLevel: 'PROFESSIONAL',
        birthCountry: 'COLOMBIA',
        birthDepartment: 'QUINDIO',
        birthCity: 'ARMENIA',
        documentType: 'CC',
        documentNumber: String(Date.now()).slice(-10),
        documentIssuanceDate: '2017-11-10',
        documentIssuanceCountry: 'COLOMBIA',
        documentIssuanceDepartment: 'CUNDINAMARCA',
        documentIssuanceCity: 'USAQUEN',
        email:
            process.env.SIGNATURES_TEST_EMAIL ??
            process.env.TEST_USER_EMAIL ??
            'parex@example.com',
        phoneCountry: 'CO',
        phoneDial: '57',
        phoneNumber: '3001234567',
        monthlyIncome: '12000000',
        monthlyExpenses: '5000000',
        totalAssets: '20000000',
        totalLiabilities: '1000000',
        isTaxDeclarant: true,
        isPep: false,
    };
}

/**
 * Diligencia los campos del formulario, pero NO lo envía.
 *
 * Esta separación es intencional:
 * EUV-UC3-002 necesita ejecutar explícitamente el submit
 * porque ese estímulo forma parte del comportamiento evaluado.
 *
 * El usuario PAREX puede traer un formulario de una corrida anterior
 * (el formulario es uno por usuario), así que se sobrescribe todo.
 * Los selectores en cascada se llenan en orden país -> departamento ->
 * ciudad: cambiar el padre limpia a los hijos.
 *
 * Los selectores son controles propios (no `<select>` nativos): ver
 * `form-controls.ts`. Las fechas aceptan el formato ISO (`1999-11-02`),
 * que el campo convierte a `dd/mm/aaaa`; los montos aceptan solo dígitos
 * y el campo les pone los puntos de miles.
 */
export async function fillProcessFormFields(
    page: Page,
    data: ProcessFormData =
        buildSyntheticProcessFormData()
): Promise<ProcessFormData> {
    await expect(
        page.locator('#process-form')
    ).toBeVisible();

    const fill = (id: string, value: string) =>
        page.locator(`#${id}`).fill(value);

    const fixed = (id: string, key: string) =>
        pickFixedOption(page, id, key);

    const search = (id: string, key: string) =>
        pickSearchOption(page, id, key);

    // Información personal
    await fill('process-form-name', data.name);
    await fill('process-form-second-name', data.secondName);
    await fill('process-form-last-name', data.lastName);
    await fill('process-form-second-last-name', data.secondLastName);
    await fixed('process-form-gender', data.gender);
    await fill('process-form-birth-date', data.birthDate);
    await search('process-form-nationality', data.nationality);
    await fixed('process-form-civil-status', data.civilStatus);
    await fixed('process-form-education-level', data.educationLevel);

    // Lugar de nacimiento
    await search('process-form-birth-country', data.birthCountry);
    await search('process-form-birth-department', data.birthDepartment);
    await search('process-form-birth-city', data.birthCity);

    // Documento
    await fixed('process-form-document-type', data.documentType);
    await fill('process-form-document-number', data.documentNumber);
    await fill('process-form-document-issuance-date', data.documentIssuanceDate);
    await search('process-form-document-issuance-country', data.documentIssuanceCountry);
    await search('process-form-document-issuance-department', data.documentIssuanceDepartment);
    await search('process-form-document-issuance-city', data.documentIssuanceCity);

    // Contacto
    await fill('process-form-email', data.email);
    await pickSearchOption(
        page,
        'process-form-phone-ext',
        data.phoneCountry,
        `+${data.phoneDial}`
    );
    await fill('process-form-phone', data.phoneNumber);

    // Perfil financiero
    await fill('process-form-monthly-income', data.monthlyIncome);
    await fill('process-form-monthly-expenses', data.monthlyExpenses);
    await fill('process-form-total-assets', data.totalAssets);
    await fill('process-form-total-liabilities', data.totalLiabilities);
    await page.locator('#process-form-is-tax-declarant').setChecked(data.isTaxDeclarant);
    await page.locator('#process-form-is-pep').setChecked(data.isPep);

    return data;
}

/**
 * Completa el formulario y lleva el proceso hasta Documentos.
 *
 * Se usa como PREPARACIÓN para EUV posteriores a UC3-002.
 */
export async function completeProcessForm(
    page: Page,
    data: ProcessFormData =
        buildSyntheticProcessFormData()
): Promise<ProcessFormData> {
    await fillProcessFormFields(
        page,
        data
    );

    await page
        .locator('#process-form-submit')
        .click();

    /*
     * Oráculo de preparación:
     * debemos haber abandonado Formulario
     * (upsert-form + set-process-form).
     */
    await expect(
        page.locator('#process-stage-documents')
    ).toBeVisible({
        timeout: 30_000,
    });

    await expect(
        page.locator('#process-stage-form')
    ).toHaveCount(0);

    await expect(
        page.locator('#process-form')
    ).toHaveCount(0);

    return data;
}

/**
 * Documentos que el proceso exige, según los pinta el portal a partir
 * de `GET /processes/get-required-files`.
 */
export async function readRequiredDocuments(
    page: Page
): Promise<RequiredDocument[]> {
    await expect(
        page.locator('#process-documents-list')
    ).toBeVisible({
        timeout: 20_000,
    });

    return await page
        .locator('[id^="process-documents-row-"]')
        .evaluateAll((rows) =>
            rows.map((row) => ({
                fileType: row.getAttribute('data-file-type') ?? '',
                slug: row.id.replace('process-documents-row-', ''),
            }))
        );
}

/**
 * Construye un documento completamente sintético.
 *
 * Es un PNG válido de 1x1 pixel.
 *
 * No usa:
 * - documentos reales
 * - datos personales
 * - biometría
 */
export function buildSyntheticDocument(
    slug = 'documento'
): SyntheticDocument {
    return {
        name:
            `${slug}-parex-${Date.now()}.png`,

        mimeType:
            'image/png',

        buffer: Buffer.from(
            'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
            'base64'
        ),
    };
}

/**
 * Adjunta un documento sintético a la caja `slug` y espera hasta que
 * el backend lo registre (on_upload) y el portal lo presente como cargado.
 */
export async function uploadSyntheticDocument(
    page: Page,
    slug: string,
    document: SyntheticDocument =
        buildSyntheticDocument(slug)
): Promise<SyntheticDocument> {
    await page
        .locator(`#process-documents-input-${slug}`)
        .setInputFiles(document);

    /*
     * No consideramos PASS simplemente porque el input
     * recibió el archivo.
     *
     * Esperamos hasta que el sistema lo haya registrado
     * y el componente lo vuelva a presentar.
     */
    await expect(
        page.locator(`#process-documents-file-${slug}`)
    ).toBeVisible({
        timeout: 45_000,
    });

    await expect(
        page.locator(`#process-documents-file-${slug}`)
    ).toContainText(
        document.name
    );

    await expect(
        page.locator(`#process-documents-error-${slug}`)
    ).toHaveCount(0);

    return document;
}

/**
 * Registra todos los documentos requeridos y espera a que el
 * portal los marque como completos.
 *
 * Se usa como PREPARACIÓN para EUV posteriores a UC3-003.
 *
 * EUV-UC3-003 NO debe usar esta función, porque el upload
 * es precisamente el comportamiento que dicho EUV valida.
 */
export async function uploadRequiredDocuments(
    page: Page
): Promise<UploadedDocument[]> {
    await expect(
        page.locator('#process-stage-documents')
    ).toBeVisible();

    const required =
        await readRequiredDocuments(page);

    expect(
        required.length,
        'el proceso debe exigir al menos un documento'
    ).toBeGreaterThan(0);

    const uploaded: UploadedDocument[] = [];

    for (const doc of required) {
        const file =
            await uploadSyntheticDocument(
                page,
                doc.slug
            );

        uploaded.push({
            ...doc,
            name: file.name,
        });
    }

    await expect(
        page.locator('#process-documents-complete')
    ).toBeVisible({
        timeout: 20_000,
    });

    return uploaded;
}

/**
 * Lleva un proceso nuevo hasta la etapa Signature.
 *
 * Se utiliza como PREPARACIÓN para los EUV que evalúan
 * la ceremonia de firma.
 *
 * IMPORTANTE:
 * esta función NO presiona "Firmar ahora".
 *
 * Por tanto, iniciar la ceremonia continúa siendo
 * responsabilidad de EUV-UC3-005.
 */
export async function prepareProcessAtSignatureStage(
    page: Page
): Promise<ProcessContext> {
    /*
     * Crear proceso nuevo en etapa Formulario.
     */
    const processContext =
        await createProcessAtFormStage(page);

    /*
     * Formulario -> Documentos.
     */
    await completeProcessForm(page);

    /*
     * Registrar los documentos requeridos.
     */
    await uploadRequiredDocuments(page);

    /*
     * Documentos -> Signature.
     *
     * Esta transición ya fue demostrada por EUV-UC3-004,
     * por eso aquí funciona únicamente como preparación.
     * generate_sign llena la orden de inversión y abre la firma
     * en segundo plano: puede tardar varios segundos.
     */
    await expect(
        page.locator('#process-advance-documents')
    ).toBeEnabled();

    await page
        .locator('#process-advance-documents')
        .click();

    await expect(
        page.locator('#process-stage-signature')
    ).toBeVisible({
        timeout: 120_000,
    });

    await expect(
        page.locator('#process-stage-documents')
    ).toHaveCount(0);

    await expect(
        page.locator('#process-error')
    ).toHaveCount(0);

    await expect(
        page.locator('#process-signature-start')
    ).toBeVisible({
        timeout: 15_000,
    });

    await expect(
        page.locator('#process-signature-start')
    ).toBeEnabled();

    return processContext;
}
