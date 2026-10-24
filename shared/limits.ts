/** Tope por archivo adjunto. El servidor lo exige y Nginx corta a ese mismo tamaño (`client_max_body_size`). */
export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024

/** Adjuntos que entran en un export (ADR 0008): el archivo los lleva en base64 y se arma en memoria. */
export const MAX_EXPORT_ATTACHMENT_BYTES = 32 * 1024 * 1024

/** Cuerpo máximo de un import: el export con 32 MB de adjuntos pesa un tercio más por el base64. */
export const MAX_IMPORT_BYTES = 48 * 1024 * 1024
