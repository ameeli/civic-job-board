/** The message of a caught value, which need not be an Error. */
export const errorMessage = (cause: unknown) => cause instanceof Error ? cause.message : String(cause);
