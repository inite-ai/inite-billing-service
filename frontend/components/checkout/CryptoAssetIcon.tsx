'use client'

import type { ComponentType } from 'react'
import TokenUSDT from '@web3icons/react/icons/tokens/TokenUSDT'
import TokenUSDC from '@web3icons/react/icons/tokens/TokenUSDC'
import NetworkTron from '@web3icons/react/icons/networks/NetworkTron'
import NetworkTon from '@web3icons/react/icons/networks/NetworkTon'
import NetworkSolana from '@web3icons/react/icons/networks/NetworkSolana'
import NetworkEthereum from '@web3icons/react/icons/networks/NetworkEthereum'
import NetworkBinanceSmartChain from '@web3icons/react/icons/networks/NetworkBinanceSmartChain'
import NetworkPolygon from '@web3icons/react/icons/networks/NetworkPolygon'
import NetworkArbitrumOne from '@web3icons/react/icons/networks/NetworkArbitrumOne'
import NetworkOptimism from '@web3icons/react/icons/networks/NetworkOptimism'
import NetworkBase from '@web3icons/react/icons/networks/NetworkBase'
import NetworkAvalanche from '@web3icons/react/icons/networks/NetworkAvalanche'

type Icon = ComponentType<{ size?: number; variant?: 'branded' | 'mono' | 'background'; className?: string }>

const TOKENS: Record<string, Icon> = { USDT: TokenUSDT, USDC: TokenUSDC }

export const NETWORK_ICONS: Record<string, Icon> = {
  TRON: NetworkTron,
  TON: NetworkTon,
  SOL: NetworkSolana,
  ETH: NetworkEthereum,
  BSC: NetworkBinanceSmartChain,
  POLYGON: NetworkPolygon,
  ARBITRUM: NetworkArbitrumOne,
  OPTIMISM: NetworkOptimism,
  BASE: NetworkBase,
  AVAX: NetworkAvalanche,
}

/**
 * A token with the network it travels on, badged in the corner — the way
 * wallets draw it. USDT on TRON and USDT on BNB Chain are different money to
 * send, and the badge is what makes that visible before anyone reads a label.
 */
export function CryptoAssetIcon({ token, chain, size = 36 }: { token?: string; chain?: string; size?: number }) {
  const TokenIcon = token ? TOKENS[token] : undefined
  const NetworkIcon = chain ? NETWORK_ICONS[chain] : undefined
  const badge = Math.round(size * 0.46)
  return (
    <span className="relative inline-flex shrink-0" style={{ width: size, height: size }} aria-hidden>
      {TokenIcon ? (
        <TokenIcon variant="background" size={size} className="rounded-full" />
      ) : NetworkIcon ? (
        <NetworkIcon variant="background" size={size} className="rounded-full" />
      ) : (
        <span className="h-full w-full rounded-full bg-slate-600" />
      )}
      {TokenIcon && NetworkIcon && (
        <span
          className="absolute -bottom-1 -right-1.5 inline-flex overflow-hidden rounded-full ring-2 ring-slate-800"
          style={{ width: badge, height: badge }}
        >
          <NetworkIcon variant="background" size={badge} />
        </span>
      )}
    </span>
  )
}
