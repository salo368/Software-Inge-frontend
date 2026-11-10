import {
    test,
    expect,
} from '@playwright/test';

import {
    NO_SESSION,
    startFreshFormProcess,
} from '../../support/uc3/fresh-user';

import {
    buildSyntheticProcessFormData,
    completeProcessForm,
} from '../../support/uc3/process-flow';

// Cada test registra su propio usuario: el formulario es uno por usuario y persiste.
test.use({ storageState: NO_SESSION });

test.setTimeout(180_000);

test(
    'VAL-FORM-006 · el formulario envía al backend valores limpios (claves de catálogo, fechas ISO, números e indicativo sin "+") y los vuelve a mostrar legibles',
    async ({ page }, testInfo) => {
        const bodies: Record<string, unknown>[] = [];

        page.on('request', (request) => {
            if (
                request.method() === 'PUT' &&
                request.url().endsWith('/forms/upsert-form')
            ) {
                bodies.push(JSON.parse(request.postData() ?? '{}'));
            }
        });

        await test.step(
            'PREPARACIÓN · un usuario nuevo tiene un proceso en etapa Formulario, con el formulario vacío',
            async () => {
                await startFreshFormProcess(page);
            }
        );

        await test.step(
            'CUANDO el inversionista completa el formulario con el indicativo de España y lo envía',
            async () => {
                await completeProcessForm(
                    page,
                    {
                        ...buildSyntheticProcessFormData(),
                        phoneCountry: 'ES',
                        phoneDial: '34',
                    }
                );
            }
        );

        await test.step(
            'ENTONCES el backend recibe claves de catálogo, fechas ISO e indicativo como número',
            async () => {
                expect(bodies.length).toBeGreaterThan(0);

                const body = bodies.at(-1)!;

                expect(body).toMatchObject({
                    nationality: 'COLOMBIA',
                    birth_country: 'COLOMBIA',
                    birth_department: 'QUINDIO',
                    birth_city: 'ARMENIA',
                    document_issuance_country: 'COLOMBIA',
                    document_issuance_department: 'CUNDINAMARCA',
                    document_issuance_city: 'USAQUEN',
                    gender: 'O',
                    civil_status: 'SINGLE',
                    education_level: 'PROFESSIONAL',
                    document_type: 'CC',
                    birth_date: '1999-11-02',
                    document_issuance_date: '2017-11-10',
                    phone_ext: '34',
                });

                // El país del indicativo es solo de la interfaz: no viaja.
                expect(body['phone_country']).toBeUndefined();
            }
        );

        await test.step(
            'Y los montos viajan como números, sin puntos',
            async () => {
                const body = bodies.at(-1)!;

                expect(body['monthly_income']).toBe(12000000);
                expect(body['monthly_expenses']).toBe(5000000);
                expect(body['total_assets']).toBe(20000000);
                expect(body['total_liabilities']).toBe(1000000);

                for (const key of [
                    'monthly_income',
                    'monthly_expenses',
                    'total_assets',
                    'total_liabilities',
                ]) {
                    expect(typeof body[key]).toBe('number');
                }
            }
        );

        await test.step(
            'Y al volver a editar, lo guardado se muestra como etiquetas legibles',
            async () => {
                await page.locator('#process-documents-edit-form').click();

                await expect(
                    page.locator('#process-form-birth-department')
                ).toHaveValue('Quindío');

                await expect(
                    page.locator('#process-form-birth-city')
                ).toHaveValue('Armenia');

                await expect(
                    page.locator('#process-form-document-issuance-city')
                ).toHaveValue('Bogotá D.C. - Usaquén');

                await expect(
                    page.locator('#process-form-birth-date')
                ).toHaveValue('02/11/1999');

                await expect(
                    page.locator('#process-form-document-issuance-date')
                ).toHaveValue('10/11/2017');

                await expect(
                    page.locator('#process-form-monthly-income')
                ).toHaveValue('12.000.000');

                await expect(
                    page.locator('#process-form-phone-ext')
                ).toHaveValue('+34');

                await expect(
                    page.locator('#process-form-section-contact .combo-flag')
                ).toHaveClass(/fi-es/);
            }
        );

        await testInfo.attach(
            'evidencia-formulario-guardado',
            {
                body: await page.screenshot({ fullPage: true }),
                contentType: 'image/png',
            }
        );
    }
);
