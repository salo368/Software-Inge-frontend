import { expect, type Page } from '@playwright/test';

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

export interface SyntheticDeclaration {
    name: string;
    mimeType: 'image/png';
    buffer: Buffer;
}

export interface ProcessFormData {
    fullName: string;
    birthDate: string;
    documentNumber: string;
    phone: string;
    city: string;
    address: string;
    occupation: string;
    economicActivity: string;
    monthlyIncome: string;
    monthlyExpenses: string;
    totalAssets: string;
    totalLiabilities: string;
    sourceOfFunds: string;
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

    await page
        .locator('#simulator-submit')
        .click();

    await expect(
        page.locator('#simulator-results')
    ).toBeVisible();

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
                timeout: 15_000,
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
    ).toBeVisible();

    return {
        ...simulatorContext,
        processId,
    };
}

/**
 * Genera datos sintéticos para el formulario.
 *
 * No utiliza información personal real.
 */
export function buildSyntheticProcessFormData(): ProcessFormData {
    return {
        fullName:
            'Usuario PAREX E2E',

        birthDate:
            '1999-11-02',

        documentNumber:
            String(Date.now()).slice(-10),

        phone:
            '3001234567',

        city:
            'Bogota',

        address:
            'Calle de prueba PAREX 123',

        occupation:
            'Ingeniero',

        economicActivity:
            'Empleado',

        monthlyIncome:
            '12000000',

        monthlyExpenses:
            '5000000',

        totalAssets:
            '20000000',

        totalLiabilities:
            '1000000',

        sourceOfFunds:
            'Salario',
    };
}

/**
 * Diligencia los campos del formulario, pero NO lo envía.
 *
 * Esta separación es intencional:
 * EUV-UC3-002 necesita ejecutar explícitamente el submit
 * porque ese estímulo forma parte del comportamiento evaluado.
 */
export async function fillProcessFormFields(
    page: Page,
    data: ProcessFormData =
        buildSyntheticProcessFormData()
): Promise<ProcessFormData> {
    await expect(
        page.locator('#process-form')
    ).toBeVisible();

    await page
        .locator('#process-form-full-name')
        .fill(data.fullName);

    await page
        .locator('#process-form-birth-date')
        .fill(data.birthDate);

    await page
        .locator('#process-form-document-number')
        .fill(data.documentNumber);

    await page
        .locator('#process-form-phone')
        .fill(data.phone);

    await page
        .locator('#process-form-city')
        .fill(data.city);

    await page
        .locator('#process-form-address')
        .fill(data.address);

    await page
        .locator('#process-form-occupation')
        .fill(data.occupation);

    await page
        .locator('#process-form-economic-activity')
        .fill(data.economicActivity);

    await page
        .locator('#process-form-monthly-income')
        .fill(data.monthlyIncome);

    await page
        .locator('#process-form-monthly-expenses')
        .fill(data.monthlyExpenses);

    await page
        .locator('#process-form-total-assets')
        .fill(data.totalAssets);

    await page
        .locator('#process-form-total-liabilities')
        .fill(data.totalLiabilities);

    await page
        .locator('#process-form-source-of-funds')
        .fill(data.sourceOfFunds);

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
     * debemos haber abandonado Formulario.
     */
    await expect(
        page.locator('#process-stage-documents')
    ).toBeVisible({
        timeout: 15_000,
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
 * Construye una declaración completamente sintética.
 *
 * Es un PNG válido de 1x1 pixel.
 *
 * No usa:
 * - declaraciones reales
 * - cédulas
 * - datos personales
 * - biometría
 */
export function buildSyntheticDeclaration(): SyntheticDeclaration {
    return {
        name:
            `declaracion-renta-parex-${Date.now()}.png`,

        mimeType:
            'image/png',

        buffer: Buffer.from(
            'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
            'base64'
        ),
    };
}

/**
 * Registra una declaración sintética y espera hasta que
 * el backend la exponga nuevamente como FileRow.
 *
 * Esta función se usa como PREPARACIÓN para EUV posteriores
 * a UC3-003.
 *
 * EUV-UC3-003 NO debe usar esta función, porque el upload
 * es precisamente el comportamiento que dicho EUV valida.
 */
export async function uploadSyntheticDeclaration(
    page: Page,
    declaration:
        SyntheticDeclaration =
        buildSyntheticDeclaration()
): Promise<SyntheticDeclaration> {
    await expect(
        page.locator('#process-stage-documents')
    ).toBeVisible();

    await expect(
        page.locator('#process-documents-input')
    ).toHaveCount(1);

    await page
        .locator('#process-documents-input')
        .setInputFiles(declaration);

    /*
     * No consideramos PASS simplemente porque el input
     * recibió el archivo.
     *
     * Esperamos hasta que el sistema lo haya registrado
     * y el componente lo vuelva a presentar.
     */
    await expect(
        page.locator('#process-documents-file')
    ).toBeVisible({
        timeout: 40_000,
    });

    await expect(
        page.locator('#process-documents-file')
    ).toContainText(
        declaration.name
    );

    await expect(
        page.locator('#process-documents-view')
    ).toBeVisible();

    await expect(
        page.locator('#process-documents-error')
    ).toHaveCount(0);

    return declaration;
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
     * Registrar declaración sintética.
     */
    await uploadSyntheticDeclaration(page);

    /*
     * Documentos -> Signature.
     *
     * Esta transición ya fue demostrada por EUV-UC3-004,
     * por eso aquí funciona únicamente como preparación.
     */
    await expect(
        page.locator('#process-advance-documents')
    ).toBeVisible();

    await expect(
        page.locator('#process-advance-documents')
    ).toBeEnabled();

    await page
        .locator('#process-advance-documents')
        .click();

    await expect(
        page.locator('#process-stage-signature')
    ).toBeVisible({
        timeout: 15_000,
    });

    await expect(
        page.locator('#process-stage-documents')
    ).toHaveCount(0);

    await expect(
        page.locator('#process-error')
    ).toHaveCount(0);

    /*
     * WORKAROUND TEMPORAL - defecto conocido del flujo de firma.
     *
     * Después de Documents -> Signature, el portal actualiza el
     * process en memoria pero la información de la ceremonia
     * (detail.signature) puede no quedar hidratada inmediatamente.
     *
     * Una recarga vuelve a consultar el detalle completo del proceso.
     *
     * Este reload NO forma parte del comportamiento evaluado por
     * EUV-UC3-005. Es una precondición temporal para poder continuar
     * validando el Signing SPA mientras se corrige el producto.
     */
    await page.reload({
        waitUntil: 'domcontentloaded',
    });

    await expect(
        page.locator('#process-stage-signature')
    ).toBeVisible({
        timeout: 15_000,
    });

    await expect(
        page.locator('#process-signature-start')
    ).toBeVisible();

    await expect(
        page.locator('#process-signature-start')
    ).toBeEnabled();

    return processContext;
}