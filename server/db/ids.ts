const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ' // Crockford base32

let lastTime = -1
let lastRandom = new Uint8Array(10)

function encode(value: number, length: number): string {
  let out = ''
  for (let i = 0; i < length; i++) {
    out = ALPHABET[value % 32]! + out
    value = Math.floor(value / 32)
  }
  return out
}

/** ULID: 48-bit ms timestamp + 80 random bits, monotonic within the same millisecond. */
export function ulid(now: number = Date.now()): string {
  if (now === lastTime) {
    // Increment the 80-bit random part as a big-endian counter.
    for (let i = lastRandom.length - 1; i >= 0; i--) {
      if (lastRandom[i] === 255) lastRandom[i] = 0
      else {
        lastRandom[i]!++
        break
      }
    }
  } else {
    lastTime = now
    lastRandom = crypto.getRandomValues(new Uint8Array(10))
  }
  let random = ''
  // 10 bytes = 80 bits = 16 base32 chars, 5 bits at a time.
  let bits = 0
  let acc = 0
  for (const byte of lastRandom) {
    acc = (acc << 8) | byte
    bits += 8
    while (bits >= 5) {
      bits -= 5
      random += ALPHABET[(acc >> bits) & 31]
    }
    acc &= (1 << bits) - 1
  }
  return encode(now, 10) + random
}
