/**
 * Por qué puerta entró la request (ADR 0001). Sale del listener (socket), nunca de un header: cada listener crea su
 * propia app con un ingress fijo.
 */
export type Ingress = 'public' | 'tailnet'

export const INGRESSES: readonly Ingress[] = ['public', 'tailnet']
