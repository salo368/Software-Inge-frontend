/**
 * The only place in this block that knows which app it is signing for. Keeping
 * it to one file is what makes the block reusable: point these at another host
 * and the ceremony works unchanged.
 */

/** Where to send the user when the ceremony ends or they back out. */
export function hostReturnUrl(contextId: string | null): string {
  return contextId ? `/portal/process/${contextId}` : '/portal/me';
}

export const HOST_RETURN_LABEL = 'Volver al proceso';
