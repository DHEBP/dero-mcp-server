/**
 * Decoder for DERO `deroproof…` / `dero…` / `deroi…` / `deto…` / `detoi…` bech32 strings.
 *
 * Implements the same wire format as `rpc/address.go` + `rpc/rpc.go` in DEROHE:
 *
 *   bech32 → convertbits(5→8, no pad) → version byte (=1) → 33-byte compressed point
 *   → optional CBOR map of arguments (only present for HRPs `deroi`, `detoi`, `deroproof`).
 *
 * The CBOR map keys are `Name + DataType` ASCII strings (e.g. `"VU"` for
 * `RPC_VALUE_TRANSFER` + `DataUint64`). Values are typed CBOR primitives.
 *
 * No new npm dependencies — bech32 + the minimum-needed CBOR subset are hand-rolled
 * (~zero kB install delta for the MCP server, which is published for `npx` use).
 *
 * Verified against the publicly-cited 2022 inflation-claim proof string:
 *   embedded `uint64` = 18446743853709551435 = signed -2,200,000.00181 DERO.
 */

const BECH32_CHARSET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l'
const BECH32_CHARSET_INDEX: Record<string, number> = Object.fromEntries(
  Array.from(BECH32_CHARSET).map((c, i) => [c, i]),
)

/** Polymod step from BIP-0173. */
function bech32Polymod(values: readonly number[]): number {
  const generators = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3]
  let chk = 1
  for (const v of values) {
    const top = chk >>> 25
    chk = ((chk & 0x1ffffff) << 5) ^ v
    for (let i = 0; i < 5; i++) {
      if ((top >>> i) & 1) chk ^= generators[i]
    }
  }
  return chk
}

function bech32HrpExpand(hrp: string): number[] {
  const out: number[] = []
  for (let i = 0; i < hrp.length; i++) out.push(hrp.charCodeAt(i) >>> 5)
  out.push(0)
  for (let i = 0; i < hrp.length; i++) out.push(hrp.charCodeAt(i) & 31)
  return out
}

function bech32VerifyChecksum(hrp: string, data: readonly number[]): boolean {
  return bech32Polymod([...bech32HrpExpand(hrp), ...data]) === 1
}

/**
 * Decode a bech32 string. Throws on invalid input.
 * Returns `{ hrp, data }` where data is the 5-bit values WITHOUT the 6-byte checksum.
 */
export function bech32Decode(input: string): { hrp: string; data: number[] } {
  if (input.length < 8 || input.length > 1023) {
    throw new Error(`bech32: invalid length ${input.length}`)
  }
  const hasLower = /[a-z]/.test(input)
  const hasUpper = /[A-Z]/.test(input)
  if (hasLower && hasUpper) throw new Error('bech32: mixed case not allowed')
  const lower = input.toLowerCase()
  const sep = lower.lastIndexOf('1')
  if (sep < 1 || sep + 7 > lower.length) {
    throw new Error('bech32: separator not found or too close to ends')
  }
  const hrp = lower.slice(0, sep)
  const dataPart = lower.slice(sep + 1)
  const data: number[] = []
  for (const ch of dataPart) {
    const v = BECH32_CHARSET_INDEX[ch]
    if (v === undefined) throw new Error(`bech32: invalid char "${ch}"`)
    data.push(v)
  }
  if (!bech32VerifyChecksum(hrp, data)) {
    throw new Error('bech32: invalid checksum')
  }
  return { hrp, data: data.slice(0, -6) }
}

/**
 * Repack a bit-stream from `fromBits` to `toBits`. Mirrors DEROHE's `convertbits`
 * (in turn from BIP-0173 reference impl).
 */
export function convertBits(
  data: readonly number[],
  fromBits: number,
  toBits: number,
  pad: boolean,
): number[] {
  let acc = 0
  let bits = 0
  const out: number[] = []
  const maxv = (1 << toBits) - 1
  for (const value of data) {
    if (value < 0 || value >>> fromBits !== 0) {
      throw new Error(`convertBits: value out of range: ${value}`)
    }
    acc = (acc << fromBits) | value
    bits += fromBits
    while (bits >= toBits) {
      bits -= toBits
      out.push((acc >>> bits) & maxv)
    }
  }
  if (pad) {
    if (bits > 0) out.push((acc << (toBits - bits)) & maxv)
  } else if (bits >= fromBits || ((acc << (toBits - bits)) & maxv) !== 0) {
    throw new Error('convertBits: non-zero padding bits')
  }
  return out
}

// ─────────────────────────────────────────────────────────────────────────────
// Minimal CBOR decoder
//
// Implements only the subset DEROHE actually serializes for `Arguments`:
//   - major type 0 (unsigned int)            → uint64 (bigint when ≥ 2^53)
//   - major type 1 (negative int)            → int64 (bigint when needed)
//   - major type 2 (byte string)             → Uint8Array
//   - major type 3 (text string)             → string
//   - major type 4 (array)                   → unknown[] (rare here, supported)
//   - major type 5 (map)                     → Record<string, unknown>
//   - major type 7: float16/32/64, true/false/null/undefined
//
// Indefinite-length and tagged values are not supported (DEROHE config forbids
// indefinite-length and only uses one tag for time, which Arguments doesn't carry
// through deroproof payloads).
// ─────────────────────────────────────────────────────────────────────────────

class CborReader {
  private offset = 0
  constructor(private readonly bytes: Uint8Array) {}

  private readByte(): number {
    if (this.offset >= this.bytes.length) throw new Error('cbor: unexpected EOF')
    return this.bytes[this.offset++]
  }

  private readUint(extra: number): number | bigint {
    if (extra < 24) return extra
    if (extra === 24) return this.readByte()
    if (extra === 25) return (this.readByte() << 8) | this.readByte()
    if (extra === 26) {
      const a = this.readByte(),
        b = this.readByte(),
        c = this.readByte(),
        d = this.readByte()
      return a * 0x1000000 + ((b << 16) | (c << 8) | d)
    }
    if (extra === 27) {
      let v = 0n
      for (let i = 0; i < 8; i++) v = (v << 8n) | BigInt(this.readByte())
      return v <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(v) : v
    }
    throw new Error(`cbor: unsupported additional info ${extra}`)
  }

  private readBytes(len: number): Uint8Array {
    if (this.offset + len > this.bytes.length) throw new Error('cbor: truncated byte string')
    const out = this.bytes.slice(this.offset, this.offset + len)
    this.offset += len
    return out
  }

  read(): unknown {
    const initial = this.readByte()
    const major = initial >>> 5
    const extra = initial & 0x1f

    switch (major) {
      case 0:
        return this.readUint(extra)
      case 1: {
        const u = this.readUint(extra)
        if (typeof u === 'bigint') return -1n - u
        return -1 - u
      }
      case 2: {
        const len = this.readUint(extra)
        if (typeof len === 'bigint') throw new Error('cbor: byte string too large')
        return this.readBytes(len)
      }
      case 3: {
        const len = this.readUint(extra)
        if (typeof len === 'bigint') throw new Error('cbor: text string too large')
        return new TextDecoder('utf-8').decode(this.readBytes(len))
      }
      case 4: {
        const len = this.readUint(extra)
        if (typeof len === 'bigint') throw new Error('cbor: array too large')
        const arr: unknown[] = []
        for (let i = 0; i < len; i++) arr.push(this.read())
        return arr
      }
      case 5: {
        const len = this.readUint(extra)
        if (typeof len === 'bigint') throw new Error('cbor: map too large')
        const map: Record<string, unknown> = {}
        for (let i = 0; i < len; i++) {
          const k = this.read()
          if (typeof k !== 'string') {
            throw new Error(`cbor: map key must be string for DERO Arguments, got ${typeof k}`)
          }
          map[k] = this.read()
        }
        return map
      }
      case 7: {
        if (extra === 20) return false
        if (extra === 21) return true
        if (extra === 22) return null
        if (extra === 23) return undefined
        // floats are not used in deroproof arguments — bail explicitly.
        throw new Error(`cbor: unsupported simple/float type (extra=${extra})`)
      }
      default:
        throw new Error(`cbor: unsupported major type ${major}`)
    }
  }

  done(): boolean {
    return this.offset >= this.bytes.length
  }
}

export function cborDecode(bytes: Uint8Array): unknown {
  const r = new CborReader(bytes)
  const v = r.read()
  // Trailing bytes are not expected in a DERO arguments payload.
  return v
}

// ─────────────────────────────────────────────────────────────────────────────
// Proof / address decoder
// ─────────────────────────────────────────────────────────────────────────────

/** DERO argument data-type single-char suffix. */
export type DeroDataType = 'I' | 'U' | 'S' | 'H' | 'A' | 'F' | 'T'

const DATA_TYPE_LABEL: Record<DeroDataType, string> = {
  I: 'int64',
  U: 'uint64',
  S: 'string',
  H: 'hash (32 bytes)',
  A: 'address (33-byte compressed point)',
  F: 'float64',
  T: 'time',
}

/** Known DERO argument name conventions (subset; not exhaustive). */
const KNOWN_ARGUMENT_NAMES: Record<string, string> = {
  V: 'RPC_VALUE_TRANSFER',
  S: 'RPC_SOURCE_PORT',
  D: 'RPC_DESTINATION_PORT',
  C: 'RPC_COMMENT',
  N: 'RPC_NEEDED_REPLY_BACK',
  E: 'RPC_EXPIRY',
  R: 'RPC_REPLYBACK_ADDRESS',
  T: 'RPC_TRANSACTION_REASON',
}

export type ParsedArgument = {
  name: string
  type: DeroDataType
  type_label: string
  /** Human-readable name when the convention is known. */
  semantic_name?: string
  /** Decoded value (uint64/int64/hash → bigint or hex; address → bech32; string → string; bool → boolean). */
  value: unknown
}

export type DecodedAddress = {
  hrp: 'dero' | 'deto' | 'deroi' | 'detoi' | 'deroproof'
  mainnet: boolean
  /** True when HRP === 'deroproof' — payload key is a derived blinder point, NOT a wallet pubkey. */
  is_proof: boolean
  /** Compressed-point bytes, lowercase hex. */
  public_key_hex: string
  /** All decoded arguments (empty for plain `dero`/`deto`). */
  arguments: ParsedArgument[]
  /** Convenience: the RPC_VALUE_TRANSFER uint64 if present, else undefined. */
  value_transfer_uint64?: bigint
}

const UINT64_MAX = (1n << 64n) - 1n
const UINT64_SIGN_BIT = 1n << 63n

export type ValueInterpretation = {
  uint64: string
  signed_int64: string
  /** True when interpreted as signed int64, the value is negative. */
  is_negative_wraparound: boolean
  /** Atomic units (signed). 1 DERO = 100,000 atomic. */
  signed_atoms: string
  /** DERO float (signed_atoms / 100_000) as a string with 5 fractional digits. */
  dero: string
}

/**
 * Interpret a uint64 transfer value as both unsigned and signed-wraparound.
 *
 * DERO transfer amounts are stored as `uint64` atomic units (1 DERO = 100,000 atoms).
 * A "negative" transfer is the wraparound of a huge unsigned value; this helper
 * surfaces both views without taking a position on which is "correct" — that's
 * what the cited rebuttal docs are for.
 */
export function interpretValueTransfer(value: bigint): ValueInterpretation {
  if (value < 0n || value > UINT64_MAX) {
    throw new Error(`uint64 out of range: ${value}`)
  }
  const isNegative = (value & UINT64_SIGN_BIT) !== 0n
  const signedAtoms = isNegative ? value - (1n << 64n) : value
  // Format signed DERO with 5 fractional digits.
  const ATOMIC = 100_000n
  const abs = signedAtoms < 0n ? -signedAtoms : signedAtoms
  const whole = abs / ATOMIC
  const frac = abs % ATOMIC
  const sign = signedAtoms < 0n ? '-' : ''
  const dero = `${sign}${whole.toString()}.${frac.toString().padStart(5, '0')}`
  return {
    uint64: value.toString(),
    signed_int64: signedAtoms.toString(),
    is_negative_wraparound: isNegative,
    signed_atoms: signedAtoms.toString(),
    dero,
  }
}

function parseArgumentEntry(rawKey: string, rawValue: unknown): ParsedArgument {
  if (rawKey.length < 2) {
    throw new Error(`invalid argument key "${rawKey}" (must be ≥2 chars: name + type)`)
  }
  const type = rawKey[rawKey.length - 1] as DeroDataType
  const name = rawKey.slice(0, -1)
  const typeLabel = DATA_TYPE_LABEL[type] ?? `unknown(${type})`
  const semanticName = KNOWN_ARGUMENT_NAMES[name]

  let value: unknown
  switch (type) {
    case 'U': {
      // CBOR yields number or bigint; normalize to bigint so callers don't lose precision.
      if (typeof rawValue === 'bigint') value = rawValue
      else if (typeof rawValue === 'number') value = BigInt(rawValue)
      else throw new Error(`argument "${rawKey}" expected uint64, got ${typeof rawValue}`)
      break
    }
    case 'I': {
      if (typeof rawValue === 'bigint') value = rawValue
      else if (typeof rawValue === 'number') value = BigInt(rawValue)
      else throw new Error(`argument "${rawKey}" expected int64, got ${typeof rawValue}`)
      break
    }
    case 'S': {
      if (typeof rawValue !== 'string') {
        throw new Error(`argument "${rawKey}" expected string, got ${typeof rawValue}`)
      }
      value = rawValue
      break
    }
    case 'H': {
      if (!(rawValue instanceof Uint8Array)) {
        throw new Error(`argument "${rawKey}" expected byte string for hash, got ${typeof rawValue}`)
      }
      value = bytesToHex(rawValue)
      break
    }
    case 'A': {
      if (!(rawValue instanceof Uint8Array)) {
        throw new Error(`argument "${rawKey}" expected byte string for address, got ${typeof rawValue}`)
      }
      // 33-byte compressed point; surface as hex (re-encoding to bech32 needs network context).
      value = bytesToHex(rawValue)
      break
    }
    case 'F':
    case 'T':
    default:
      value = rawValue
  }

  return {
    name,
    type,
    type_label: typeLabel,
    ...(semanticName ? { semantic_name: semanticName } : {}),
    value: typeof value === 'bigint' ? value.toString() : value,
  }
}

function bytesToHex(bytes: Uint8Array): string {
  let hex = ''
  for (const b of bytes) hex += b.toString(16).padStart(2, '0')
  return hex
}

/**
 * Decode a full `deroproof…` / `dero…` / `deroi…` / `deto…` / `detoi…` bech32 string.
 *
 * Mirrors `rpc.NewAddress` from DEROHE: validates HRP, runs 5→8 bit repack,
 * checks version byte, splits compressed point + (optional) CBOR arguments.
 */
export function decodeDeroBech32(input: string): DecodedAddress {
  const { hrp, data } = bech32Decode(input.trim())

  const validHrps = ['dero', 'deto', 'deroi', 'detoi', 'deroproof'] as const
  if (!(validHrps as readonly string[]).includes(hrp)) {
    throw new Error(`invalid HRP "${hrp}" (expected one of ${validHrps.join(', ')})`)
  }

  // 5-bit → 8-bit (no pad), per DEROHE.
  const repacked = convertBits(data, 5, 8, false)
  if (repacked.length < 1) throw new Error('decoded payload too short for version byte')
  if (repacked[0] !== 1) throw new Error(`invalid address version: ${repacked[0]} (expected 1)`)
  const body = repacked.slice(1)
  if (body.length < 33) {
    throw new Error(`decoded payload too short for compressed point: ${body.length} < 33 bytes`)
  }

  const pointBytes = new Uint8Array(body.slice(0, 33))
  const argBytes = new Uint8Array(body.slice(33))
  const publicKeyHex = bytesToHex(pointBytes)

  const mainnet = hrp === 'dero' || hrp === 'deroi' || hrp === 'deroproof'
  const isProof = hrp === 'deroproof'

  // Plain `dero` / `deto` have no arguments. `deroi` / `detoi` / `deroproof` always do.
  const hasArguments = hrp === 'deroi' || hrp === 'detoi' || hrp === 'deroproof'

  const args: ParsedArgument[] = []
  if (hasArguments) {
    if (argBytes.length === 0) {
      // Some integrated addresses can carry zero-length arguments; treat as empty map.
    } else {
      const decoded = cborDecode(argBytes)
      if (typeof decoded !== 'object' || decoded === null || Array.isArray(decoded)) {
        throw new Error(`CBOR root must be a map, got ${typeof decoded}`)
      }
      for (const [k, v] of Object.entries(decoded as Record<string, unknown>)) {
        args.push(parseArgumentEntry(k, v))
      }
    }
  }

  const valueTransfer = args.find((a) => a.name === 'V' && a.type === 'U')

  return {
    hrp: hrp as DecodedAddress['hrp'],
    mainnet,
    is_proof: isProof,
    public_key_hex: publicKeyHex,
    arguments: args,
    ...(valueTransfer ? { value_transfer_uint64: BigInt(valueTransfer.value as string) } : {}),
  }
}
