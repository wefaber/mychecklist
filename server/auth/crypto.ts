const IV_BYTES = 12

function b64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64')
}

function importKey(key: Uint8Array): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', key as BufferSource, 'AES-GCM', false, [
    'encrypt',
    'decrypt',
  ])
}

/** AES-256-GCM. Formato guardado: base64(iv 12 bytes ‖ texto cifrado ‖ tag). */
export async function seal(
  key: Uint8Array,
  plaintext: string,
): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES))
  const data = new TextEncoder().encode(plaintext)
  const cipher = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      await importKey(key),
      data,
    ),
  )
  const out = new Uint8Array(IV_BYTES + cipher.length)
  out.set(iv)
  out.set(cipher, IV_BYTES)
  return b64(out)
}

/** Lanza si la clave no es la correcta o el valor se alteró. */
export async function open(key: Uint8Array, sealed: string): Promise<string> {
  const raw = Uint8Array.from(Buffer.from(sealed, 'base64'))
  const plain = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: raw.slice(0, IV_BYTES) },
    await importKey(key),
    raw.slice(IV_BYTES),
  )
  return new TextDecoder().decode(plain)
}

export function sha256Hex(value: string): string {
  return new Bun.CryptoHasher('sha256').update(value).digest('hex')
}

/** Token opaco de 256 bits para cookies y estados de OAuth. */
export function randomToken(bytes = 32): string {
  return Buffer.from(crypto.getRandomValues(new Uint8Array(bytes))).toString(
    'base64url',
  )
}
