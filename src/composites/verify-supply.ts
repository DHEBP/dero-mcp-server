/**
 * `verify_supply` — offline CalcSupply cross-check composite.
 *
 * Recomputes DERO total supply from the emission schedule
 * (PREMINE + one-time launch credit + Σ CalcBlockReward epochs) — the same
 * math as DEROFDN/derohe `community-dev` `blockchain/supply.go` CalcSupply
 * and dero-docs `SupplyMonitor/schedule.ts`. Optionally compares against
 * `DERO.GetInfo.total_supply` when a daemon is reachable.
 *
 * Scope: schedule CalcSupply only. This is NOT a UTXO census. A match
 * confirms the node reports the same schedule number; a mismatch against
 * older builds often means GetInfo still uses the post-halving linear
 * undercount (a display quirk), not inflation. Cite
 * `integrity/verify-the-supply`.
 *
 * Failure model:
 *   - No `height` and GetInfo unreachable → `INVALID_INPUT` (need a height
 *     to compute offline) or `RPC_UNREACHABLE` if the only path was tip.
 *   - Height provided + daemon down → still returns offline CalcSupply;
 *     `getinfo_total_supply` / `match` are null.
 */

import { z } from 'zod'
import {
  attachCitations,
  runChain,
  stepLatencies,
  stepValue,
  type ChainStep,
  type DeroDaemonRpc,
} from './_shared.js'

/** Atomic units per DERO (5 decimals). */
export const DEC = 100_000
export const BASE_REWARD = 123_000
export const REWARD_REDUCTION_INTERVAL = 7_000_000
export const PREMINE = 1_228_125_400_000
/** One-time launch credit: 0.002 DERO × accounts registered before block 144000. */
export const LAUNCH_CREDIT = 271_739_600

export const verifySupplyInputSchema = {
  height: z
    .number()
    .int()
    .nonnegative()
    .optional()
    .describe(
      'Topoheight / height to evaluate. Default: tip topoheight from DERO.GetInfo. Required when the daemon is unreachable.',
    ),
} as const

type VerifySupplyInput = { height?: number }

type DaemonInfo = {
  topoheight?: number
  total_supply?: number | string
  version?: string
  testnet?: boolean
  network?: string
}

/** CalcBlockReward(h) = BASE >> ((h + RRI) / RRI), integer math. */
export function calcBlockReward(height: number): number {
  const h = Math.floor(height)
  if (h < 0) return 0
  const shift = Math.floor((h + REWARD_REDUCTION_INTERVAL) / REWARD_REDUCTION_INTERVAL)
  return Math.floor(BASE_REWARD / 2 ** shift)
}

/**
 * CalcSupply(height) in atomic units — premine + launch credit + sum of
 * CalcBlockReward over [0, height). Matches derohe community-dev and
 * dero-docs schedule.ts for integer heights.
 */
export function calcSupplyAtoms(height: number): number {
  const hI = Math.floor(height)
  if (hI < 0) {
    throw new Error('INVALID_INPUT: height must be a non-negative integer')
  }
  let supply = PREMINE + LAUNCH_CREDIT
  let rem = hI
  let epochStart = 0
  while (rem > 0) {
    const n = Math.min(rem, REWARD_REDUCTION_INTERVAL)
    supply += calcBlockReward(epochStart) * n
    rem -= n
    epochStart += REWARD_REDUCTION_INTERVAL
  }
  return supply
}

export function calcSupplyDero(height: number): number {
  return Math.floor(calcSupplyAtoms(height) / DEC)
}

function parseTotalSupply(raw: number | string | undefined): number | null {
  if (typeof raw === 'number' && Number.isFinite(raw)) return Math.trunc(raw)
  if (typeof raw === 'string' && raw.trim() !== '') {
    const n = Number(raw)
    if (Number.isFinite(n)) return Math.trunc(n)
  }
  return null
}

function buildNarrative(args: {
  height: number
  heightSource: 'provided' | 'getinfo_tip'
  calcDero: number
  getinfo: number | null
  match: boolean | null
  daemonVersion: string | null
}): string {
  const parts: string[] = []
  parts.push(
    `At height ${args.height} (${args.heightSource === 'provided' ? 'caller-provided' : 'GetInfo tip'}), offline CalcSupply = ${args.calcDero.toLocaleString('en-US')} DERO (premine + 2,717 DERO launch credit + epoch rewards).`,
  )
  if (args.getinfo === null) {
    parts.push(
      'No GetInfo.total_supply cross-check (daemon unreachable or field missing). This number is schedule-only — not a UTXO census.',
    )
  } else if (args.match) {
    parts.push(
      `GetInfo.total_supply = ${args.getinfo.toLocaleString('en-US')} DERO — matches CalcSupply.${args.daemonVersion ? ` Daemon ${args.daemonVersion}.` : ''}`,
    )
  } else {
    parts.push(
      `GetInfo.total_supply = ${args.getinfo.toLocaleString('en-US')} DERO — does NOT match CalcSupply (gap ${Math.abs(args.calcDero - args.getinfo).toLocaleString('en-US')} DERO). On older builds GetInfo often uses a post-halving linear undercount; that is a display quirk, not evidence of inflation. See integrity/verify-the-supply.`,
    )
  }
  return parts.join(' ')
}

/**
 * Pure offline path used by unit tests and by the composite when height is known.
 */
export function verifySupplyOffline(height: number): {
  height: number
  calc_supply_atoms: number
  calc_supply_dero: number
  block_reward_atoms: number
  block_reward_dero: number
} {
  const atoms = calcSupplyAtoms(height)
  const rewardAtoms = calcBlockReward(height)
  return {
    height: Math.floor(height),
    calc_supply_atoms: atoms,
    calc_supply_dero: Math.floor(atoms / DEC),
    block_reward_atoms: rewardAtoms,
    block_reward_dero: rewardAtoms / DEC,
  }
}

export async function verifySupply(rpc: DeroDaemonRpc, input: VerifySupplyInput = {}) {
  const providedHeight =
    typeof input.height === 'number' && Number.isInteger(input.height) ? input.height : undefined

  const steps: ChainStep[] = [
    {
      name: 'info',
      required: providedHeight === undefined,
      fn: () => rpc<DaemonInfo>('DERO.GetInfo'),
    },
  ]

  const chain = await runChain(steps)

  if (chain.haltedAt === 'info') {
    const detail = chain.results.find((r) => r.name === 'info')?.error?.message ?? 'unknown'
    throw new Error(`fetch failed: ${detail}`)
  }

  const info = stepValue<DaemonInfo>(chain, 'info')
  let height: number
  let heightSource: 'provided' | 'getinfo_tip'

  if (providedHeight !== undefined) {
    height = providedHeight
    heightSource = 'provided'
  } else if (info && typeof info.topoheight === 'number') {
    height = info.topoheight
    heightSource = 'getinfo_tip'
  } else {
    throw new Error(
      'INVALID_INPUT: pass height when GetInfo is unavailable or did not return topoheight',
    )
  }

  const offline = verifySupplyOffline(height)
  const getinfoSupply = info ? parseTotalSupply(info.total_supply) : null
  const match =
    getinfoSupply === null ? null : getinfoSupply === offline.calc_supply_dero

  const formula_note =
    'CalcSupply = PREMINE (12,281,254 DERO) + launch credit (271,739,600 atomic ≈ 2,717 DERO) + Σ CalcBlockReward over reward epochs. Source: DEROFDN/derohe community-dev blockchain/supply.go. Not a UTXO census — matching GetInfo only confirms schedule parity.'

  const narrative = buildNarrative({
    height: offline.height,
    heightSource,
    calcDero: offline.calc_supply_dero,
    getinfo: getinfoSupply,
    match,
    daemonVersion: typeof info?.version === 'string' ? info.version : null,
  })

  return attachCitations(
    {
      height: offline.height,
      height_source: heightSource,
      calc_supply_atoms: offline.calc_supply_atoms,
      calc_supply_dero: offline.calc_supply_dero,
      block_reward_atoms: offline.block_reward_atoms,
      block_reward_dero: offline.block_reward_dero,
      getinfo_total_supply: getinfoSupply,
      match,
      formula_note,
      narrative,
      _diagnostics: {
        step_latency_ms: stepLatencies(chain),
        total_ms: chain.totalMs,
        halted_at: chain.haltedAt,
        daemon_reachable: info !== null,
      },
    },
    'verify_supply',
  )
}
