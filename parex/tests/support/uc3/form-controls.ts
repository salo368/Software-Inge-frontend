import {
    expect,
    type Page,
} from '@playwright/test';

/**
 * Ayudas para los controles propios del formulario del portal.
 *
 * Reemplazan al `<select>` nativo, que ya no existe en el formulario:
 *
 *   - Selector CORTO (género, estado civil, nivel educativo, tipo de
 *     documento): un clic abre la lista y se elige una opción.
 *   - Selector con BÚSQUEDA (nacionalidad, países, departamentos,
 *     ciudades, indicativo): se escribe para filtrar y se elige una
 *     opción de las que quedan.
 *
 * Las opciones se eligen por su CLAVE (`data-key`: `QUINDIO`, `SINGLE`,
 * `CO`...), nunca por la etiqueta visible ni por la posición: así los
 * tests no dependen de tildes, de traducciones ni del orden de la
 * búsqueda. Los ids de los campos son los de siempre
 * (`process-form-*`); la lista de cada uno es `#<id>-list`.
 */

const list = (page: Page, inputId: string) =>
    page.locator(`#${inputId}-list`);

const option = (page: Page, inputId: string, key: string) =>
    page.locator(`#${inputId}-list .combo-option[data-key="${key}"]`);

/**
 * Selector corto: abre la lista y elige la opción con esa clave.
 */
export async function pickFixedOption(
    page: Page,
    inputId: string,
    key: string
): Promise<void> {
    await page.locator(`#${inputId}`).click();

    await expect(
        list(page, inputId)
    ).toBeVisible();

    await option(page, inputId, key).click();

    await expect(
        list(page, inputId)
    ).toHaveCount(0);
}

/**
 * Texto con el que se filtra una opción a partir de su clave de catálogo:
 * las primeras letras, sin guiones bajos (`BOGOTA_DC` -> `bogo`). Es
 * suficiente para que quede en la lista; la elección real es por clave.
 */
export function searchTextFor(key: string): string {
    return key
        .replace(/_/g, ' ')
        .toLowerCase()
        .slice(0, 4);
}

/**
 * Selector con búsqueda: escribe para filtrar, espera a que aparezca la
 * opción con esa clave y la elige.
 *
 * @param search texto a escribir; por defecto las primeras letras de la
 *               clave. Pásalo explícito cuando la clave no se parece al
 *               nombre (por ejemplo el indicativo: clave `CO`, texto `+57`).
 */
export async function pickSearchOption(
    page: Page,
    inputId: string,
    key: string,
    search: string = searchTextFor(key)
): Promise<void> {
    const input = page.locator(`#${inputId}`);

    await input.click();
    await input.fill(search);

    await expect(
        option(page, inputId, key),
        `la búsqueda "${search}" debe dejar disponible la opción ${key}`
    ).toBeVisible();

    await option(page, inputId, key).click();

    await expect(
        list(page, inputId)
    ).toHaveCount(0);
}

/**
 * Etiquetas visibles de las opciones de una lista abierta, en el orden en
 * que se muestran (para verificar el ranking de la búsqueda).
 */
export async function visibleOptionLabels(
    page: Page,
    inputId: string
): Promise<string[]> {
    await expect(
        list(page, inputId)
    ).toBeVisible();

    return (
        await page
            .locator(`#${inputId}-list .combo-option .combo-label`)
            .allTextContents()
    ).map((label) => label.trim());
}

/**
 * Claves de las opciones de una lista abierta, en el orden mostrado.
 */
export async function visibleOptionKeys(
    page: Page,
    inputId: string
): Promise<string[]> {
    await expect(
        list(page, inputId)
    ).toBeVisible();

    return await page
        .locator(`#${inputId}-list .combo-option`)
        .evaluateAll((rows) =>
            rows.map((row) => row.getAttribute('data-key') ?? '')
        );
}
