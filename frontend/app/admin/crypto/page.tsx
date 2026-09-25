'use client'

import { useEffect, useMemo, useState } from 'react'
import { useTranslations } from 'next-intl'
import toast from 'react-hot-toast'
import {
  AlertTriangle,
  Bitcoin,
  CheckCircle2,
  CircleDashed,
  ExternalLink,
  Link2,
  Power,
  RefreshCw,
  XCircle,
} from 'lucide-react'
import api from '@/lib/api'
import { useApiQuery } from '@/hooks/useApiQuery'
import { getErrorMessage } from '@/lib/api-error'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { Modal } from '@/components/ui/Modal'
import { Tabs } from '@/components/ui/Tabs'
import { Badge, type BadgeVariant } from '@/components/ui/Badge'
import { EmptyState } from '@/components/ui/EmptyState'
import { ErrorState } from '@/components/ui/ErrorState'
import { PageHeader } from '@/components/ui/PageHeader'
import { TableSkeleton } from '@/components/ui/Skeleton'
import { Table, Thead, Tbody, Th, Td } from '@/components/ui/Table'

type SecretKey = 'etherscanApiKey' | 'trongridApiKey' | 'toncenterApiKey' | 'webhookSecret'

interface ChainSettings {
  chain: 'TRON' | 'TON' | 'ETH' | 'SOL'
  name: string
  network: string
  tokens: string[]
  confirmations: number
  wallet: string | null
  walletValid: boolean | null
  watchable: boolean
  payable: boolean
  poll: { lastPolledAt: string | null; lastError: string | null; transfersSeen: number; watching: boolean } | null
}

interface Settings {
  provider: { id: string | null; isActive: boolean; exists: boolean }
  expiryMinutes: number
  lateGraceHours: number
  solanaRpcUrl: string | null
  secrets: Record<SecretKey, string | null>
  chains: ChainSettings[]
  liveInvoices: number
  unmatchedTransfers: number
  fx: {
    markupPercent: number
    fixedRates: Record<string, string>
    rates: Array<{
      currency: string
      perUsd: string | null
      source: string | null
      publishedAt: string | null
      fetchedAt: string | null
      pinned: string | null
      available: boolean
    }>
  }
}

interface InvoiceRow {
  id: string
  invoiceId: string
  chain: string
  token: string
  amount: string
  baseAmount: string
  status: string
  expiresAt: string
  txHash: string | null
  txUrl: string | null
  confirmations: number
  requiredConfirmations: number
  createdAt: string
  order: { id: string; status: string; userId: string; product: string | null } | null
}

interface TransferRow {
  id: string
  chain: string
  token: string
  txHash: string
  txUrl: string
  from: string | null
  amount: string
  isFinal: boolean
  confirmations: number
  status: string
  note: string | null
  resolvedBy: string | null
  createdAt: string
  suggestion: { id: string; invoiceId: string; amount: string; status: string; createdAt: string } | null
}

const INVOICE_VARIANT: Record<string, BadgeVariant> = {
  awaiting: 'info',
  confirming: 'warning',
  paid: 'success',
  expired: 'default',
  cancelled: 'default',
}

const TRANSFER_VARIANT: Record<string, BadgeVariant> = {
  unmatched: 'warning',
  matched: 'success',
  ignored: 'default',
}

const shortHash = (hash: string) => (hash.length > 16 ? `${hash.slice(0, 8)}…${hash.slice(-6)}` : hash)

/**
 * The crypto rail, run from one place.
 *
 * Settings come first because they are where the money can go wrong: a wallet
 * saved with a typo is money nobody can spend, so each one is checked as an
 * address on its own network and the page says, per network, whether payments
 * there will actually be seen. Unmatched transfers get their own tab because
 * they are money already received that no order has been credited for — the
 * one queue here that someone has to work through.
 */
export default function AdminCryptoPage() {
  const t = useTranslations('admin.crypto')
  const [tab, setTab] = useState<'settings' | 'invoices' | 'transfers'>('settings')
  const { data: settings, loading, error, refetch } = useApiQuery<Settings>('/v1/admin/crypto/settings')
  const [polling, setPolling] = useState(false)
  const [toggling, setToggling] = useState(false)

  const pollNow = async () => {
    setPolling(true)
    try {
      await api.post('/v1/admin/crypto/poll')
      toast.success(t('polled'))
      refetch()
    } catch (e) {
      toast.error(getErrorMessage(e, t('pollFailed')))
    } finally {
      setPolling(false)
    }
  }

  const toggle = async () => {
    if (!settings) return
    setToggling(true)
    try {
      await api.put('/v1/admin/crypto/settings', { isActive: !settings.provider.isActive })
      toast.success(settings.provider.isActive ? t('turnedOff') : t('turnedOn'))
      refetch()
    } catch (e) {
      toast.error(getErrorMessage(e, t('saveFailed')))
    } finally {
      setToggling(false)
    }
  }

  return (
    <div>
      <PageHeader
        title={t('title')}
        subtitle={t('subtitle')}
        actions={
          settings && (
            <>
              <Button
                size="sm"
                variant="outline"
                icon={<RefreshCw className={`h-4 w-4 ${polling ? 'animate-spin' : ''}`} />}
                onClick={pollNow}
                disabled={polling || !settings.provider.isActive}
              >
                {t('pollNow')}
              </Button>
              <Button
                size="sm"
                variant={settings.provider.isActive ? 'secondary' : 'primary'}
                icon={<Power className="h-4 w-4" />}
                onClick={toggle}
                loading={toggling}
              >
                {settings.provider.isActive ? t('turnOff') : t('turnOn')}
              </Button>
            </>
          )
        }
      />

      {loading && !settings ? (
        <Card>
          <TableSkeleton />
        </Card>
      ) : error || !settings ? (
        <Card>
          <ErrorState message={error ?? t('loadFailed')} onRetry={refetch} />
        </Card>
      ) : (
        <>
          <dl className="mb-6 grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-slate-200 bg-slate-200 sm:grid-cols-4 dark:border-slate-800 dark:bg-slate-800">
            <Figure label={t('stats.status')} value={settings.provider.isActive ? t('on') : t('off')} tone={settings.provider.isActive ? 'good' : undefined} />
            <Figure label={t('stats.networks')} value={`${settings.chains.filter((c) => c.payable).length} / ${settings.chains.length}`} />
            <Figure label={t('stats.openInvoices')} value={settings.liveInvoices} />
            <Figure
              label={t('stats.unmatched')}
              value={settings.unmatchedTransfers}
              tone={settings.unmatchedTransfers ? 'warn' : undefined}
            />
          </dl>

          <div className="mb-4">
            <Tabs
              tabs={[
                { key: 'settings', label: t('tabs.settings') },
                { key: 'invoices', label: t('tabs.invoices') },
                {
                  key: 'transfers',
                  label: settings.unmatchedTransfers
                    ? `${t('tabs.transfers')} · ${settings.unmatchedTransfers}`
                    : t('tabs.transfers'),
                },
              ]}
              activeTab={tab}
              onChange={(key) => setTab(key as typeof tab)}
            />
          </div>

          {tab === 'settings' && <SettingsForm settings={settings} onSaved={refetch} />}
          {tab === 'invoices' && <InvoicesTab />}
          {tab === 'transfers' && <TransfersTab onResolved={refetch} />}
        </>
      )}
    </div>
  )
}

function Figure({ label, value, tone }: { label: string; value: string | number; tone?: 'good' | 'warn' }) {
  const color =
    tone === 'good'
      ? 'text-emerald-600 dark:text-emerald-400'
      : tone === 'warn'
        ? 'text-amber-600 dark:text-amber-400'
        : 'text-slate-900 dark:text-white'
  return (
    <div className="bg-white px-4 py-3 dark:bg-slate-900">
      <dt className="truncate text-xs text-slate-500 dark:text-slate-400">{label}</dt>
      <dd className={`mt-0.5 text-xl font-semibold tabular-nums ${color}`}>{value}</dd>
    </div>
  )
}

// ─── Settings ────────────────────────────────────────────────

function Readiness({ chain }: { chain: ChainSettings }) {
  const t = useTranslations('admin.crypto')
  if (chain.payable) {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-600 dark:text-emerald-400">
        <CheckCircle2 className="h-3.5 w-3.5" /> {t('ready.accepting')}
      </span>
    )
  }
  if (chain.wallet && chain.walletValid === false) {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-red-600 dark:text-red-400">
        <XCircle className="h-3.5 w-3.5" /> {t('ready.badWallet')}
      </span>
    )
  }
  if (chain.wallet && !chain.watchable) {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-amber-600 dark:text-amber-400">
        <AlertTriangle className="h-3.5 w-3.5" /> {t('ready.needsKey')}
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
      <CircleDashed className="h-3.5 w-3.5" /> {t('ready.noWallet')}
    </span>
  )
}

function SettingsForm({ settings, onSaved }: { settings: Settings; onSaved: () => void }) {
  const t = useTranslations('admin.crypto')
  const initialWallets = useMemo(
    () => Object.fromEntries(settings.chains.map((c) => [c.chain, c.wallet ?? ''])) as Record<string, string>,
    [settings],
  )
  const [wallets, setWallets] = useState(initialWallets)
  const [secrets, setSecrets] = useState<Record<SecretKey, string>>({
    etherscanApiKey: '',
    trongridApiKey: '',
    toncenterApiKey: '',
    webhookSecret: '',
  })
  const [cleared, setCleared] = useState<SecretKey[]>([])
  const [solanaRpcUrl, setSolanaRpcUrl] = useState(settings.solanaRpcUrl ?? '')
  const [expiryMinutes, setExpiryMinutes] = useState(String(settings.expiryMinutes))
  const [lateGraceHours, setLateGraceHours] = useState(String(settings.lateGraceHours))
  const [markupPercent, setMarkupPercent] = useState(String(settings.fx.markupPercent))
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  useEffect(() => {
    setWallets(initialWallets)
  }, [initialWallets])

  const save = async () => {
    setSaving(true)
    setFormError(null)
    try {
      const walletPatch: Record<string, string | null> = {}
      for (const chain of settings.chains) {
        const next = (wallets[chain.chain] ?? '').trim()
        if (next !== (chain.wallet ?? '')) walletPatch[chain.chain] = next || null
      }
      const secretPatch: Record<string, string | null> = {}
      for (const key of Object.keys(secrets) as SecretKey[]) {
        if (secrets[key].trim()) secretPatch[key] = secrets[key].trim()
        else if (cleared.includes(key)) secretPatch[key] = null
      }
      await api.put('/v1/admin/crypto/settings', {
        wallets: walletPatch,
        ...secretPatch,
        solanaRpcUrl: solanaRpcUrl.trim() || null,
        expiryMinutes: Number(expiryMinutes),
        lateGraceHours: Number(lateGraceHours),
        fxMarkupPercent: Number(markupPercent.replace(',', '.')),
      })
      toast.success(t('saved'))
      setSecrets({ etherscanApiKey: '', trongridApiKey: '', toncenterApiKey: '', webhookSecret: '' })
      setCleared([])
      onSaved()
    } catch (e) {
      setFormError(getErrorMessage(e, t('saveFailed')))
    } finally {
      setSaving(false)
    }
  }

  const secretField = (key: SecretKey, hint: string) => {
    const stored = settings.secrets[key]
    const isCleared = cleared.includes(key)
    return (
      <div>
        <Input
          label={t(`keys.${key}`)}
          type="password"
          autoComplete="off"
          value={secrets[key]}
          onChange={(e) => setSecrets((s) => ({ ...s, [key]: e.target.value }))}
          placeholder={stored && !isCleared ? `${t('keys.stored')} ${stored}` : t('keys.notSet')}
          className="font-mono"
        />
        <div className="mt-1.5 flex items-start justify-between gap-3">
          <p className="text-xs text-slate-500 dark:text-slate-400">{hint}</p>
          {stored && !isCleared && (
            <button
              type="button"
              onClick={() => setCleared((c) => [...c, key])}
              className="shrink-0 text-xs text-red-600 hover:underline dark:text-red-400"
            >
              {t('keys.remove')}
            </button>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <Card>
        <h2 className="text-base font-semibold text-slate-900 dark:text-white">{t('wallets.title')}</h2>
        <p className="mt-1 max-w-prose text-sm text-slate-500 dark:text-slate-400">{t('wallets.hint')}</p>
        <div className="mt-5 divide-y divide-slate-100 dark:divide-slate-800">
          {settings.chains.map((chain) => (
            <div key={chain.chain} className="grid gap-3 py-4 first:pt-0 last:pb-0 lg:grid-cols-[12rem_1fr_14rem] lg:items-start">
              <div>
                <p className="font-medium text-slate-900 dark:text-white">
                  {chain.name} <span className="text-slate-400">· {chain.network}</span>
                </p>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  {chain.tokens.join(', ')} · {t('wallets.confirmations', { count: chain.confirmations })}
                </p>
              </div>
              <Input
                aria-label={t('wallets.addressFor', { network: chain.name })}
                value={wallets[chain.chain] ?? ''}
                onChange={(e) => setWallets((w) => ({ ...w, [chain.chain]: e.target.value }))}
                placeholder={t('wallets.placeholder')}
                className="font-mono text-xs"
                spellCheck={false}
              />
              <div className="space-y-1 lg:pt-2.5">
                <Readiness chain={chain} />
                {chain.poll?.lastError ? (
                  <p className="text-xs text-red-600 dark:text-red-400" title={chain.poll.lastError}>
                    {t('wallets.pollError')}: {chain.poll.lastError}
                  </p>
                ) : chain.poll?.lastPolledAt ? (
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    {t('wallets.lastPoll', { time: new Date(chain.poll.lastPolledAt).toLocaleTimeString() })}
                  </p>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      </Card>

      <Card>
        <h2 className="text-base font-semibold text-slate-900 dark:text-white">{t('keys.title')}</h2>
        <p className="mt-1 max-w-prose text-sm text-slate-500 dark:text-slate-400">{t('keys.hint')}</p>
        <div className="mt-5 grid gap-5 md:grid-cols-2">
          {secretField('etherscanApiKey', t('keys.etherscanHint'))}
          {secretField('trongridApiKey', t('keys.trongridHint'))}
          {secretField('toncenterApiKey', t('keys.toncenterHint'))}
          <div>
            <Input
              label={t('keys.solanaRpcUrl')}
              value={solanaRpcUrl}
              onChange={(e) => setSolanaRpcUrl(e.target.value)}
              placeholder="https://api.mainnet-beta.solana.com"
              className="font-mono"
            />
            <p className="mt-1.5 text-xs text-slate-500 dark:text-slate-400">{t('keys.solanaHint')}</p>
          </div>
          {secretField('webhookSecret', t('keys.webhookHint'))}
        </div>
      </Card>

      <FxCard settings={settings} markupPercent={markupPercent} onMarkupChange={setMarkupPercent} onChanged={onSaved} />

      <Card>
        <h2 className="text-base font-semibold text-slate-900 dark:text-white">{t('timing.title')}</h2>
        <div className="mt-5 grid gap-5 md:grid-cols-2">
          <div>
            <Input
              label={t('timing.expiryMinutes')}
              type="number"
              min={10}
              max={1440}
              value={expiryMinutes}
              onChange={(e) => setExpiryMinutes(e.target.value)}
            />
            <p className="mt-1.5 text-xs text-slate-500 dark:text-slate-400">{t('timing.expiryHint')}</p>
          </div>
          <div>
            <Input
              label={t('timing.graceHours')}
              type="number"
              min={1}
              max={168}
              value={lateGraceHours}
              onChange={(e) => setLateGraceHours(e.target.value)}
            />
            <p className="mt-1.5 text-xs text-slate-500 dark:text-slate-400">{t('timing.graceHint')}</p>
          </div>
        </div>
      </Card>

      {formError && (
        <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-900/30 dark:text-red-400">
          {formError}
        </p>
      )}
      <div className="flex justify-end">
        <Button onClick={save} loading={saving}>
          {t('save')}
        </Button>
      </div>
    </div>
  )
}

// ─── Exchange rates ──────────────────────────────────────────

function FxCard({
  settings,
  markupPercent,
  onMarkupChange,
  onChanged,
}: {
  settings: Settings
  markupPercent: string
  onMarkupChange: (value: string) => void
  onChanged: () => void
}) {
  const t = useTranslations('admin.crypto.fx')
  const [refreshing, setRefreshing] = useState(false)
  const sourceLabel = (source: string) =>
    source === 'fixed'
      ? t('sources.fixed')
      : source === 'cbr.ru'
        ? t('sources.cbr')
        : source === 'open.er-api.com'
          ? t('sources.openErApi')
          : source
  const [pinCurrency, setPinCurrency] = useState('')
  const [pinRate, setPinRate] = useState('')
  const [pinning, setPinning] = useState(false)

  const refresh = async () => {
    setRefreshing(true)
    try {
      const res = await api.post('/v1/admin/crypto/fx/refresh')
      toast.success(t('refreshed', { source: res.data.source }))
      onChanged()
    } catch (e) {
      toast.error(getErrorMessage(e, t('refreshFailed')))
    } finally {
      setRefreshing(false)
    }
  }

  const setPin = async (currency: string, rate: string | null) => {
    setPinning(true)
    try {
      await api.put('/v1/admin/crypto/settings', { fixedRates: { [currency]: rate } })
      setPinCurrency('')
      setPinRate('')
      onChanged()
    } catch (e) {
      toast.error(getErrorMessage(e, t('refreshFailed')))
    } finally {
      setPinning(false)
    }
  }

  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-slate-900 dark:text-white">{t('title')}</h2>
          <p className="mt-1 max-w-prose text-sm text-slate-500 dark:text-slate-400">{t('hint')}</p>
        </div>
        <Button
          size="sm"
          variant="outline"
          icon={<RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />}
          onClick={refresh}
          disabled={refreshing}
        >
          {t('refresh')}
        </Button>
      </div>

      <div className="mt-5 max-w-xs">
        <Input
          label={t('markup')}
          type="number"
          min={0}
          max={20}
          step={0.1}
          value={markupPercent}
          onChange={(e) => onMarkupChange(e.target.value)}
        />
      </div>
      <p className="mt-1.5 max-w-prose text-xs text-slate-500 dark:text-slate-400">{t('markupHint')}</p>

      <div className="mt-6">
        {settings.fx.rates.length === 0 ? (
          <p className="text-sm text-slate-500 dark:text-slate-400">{t('noCurrencies')}</p>
        ) : (
          <Table>
            <Thead>
              <tr>
                <Th>{t('currency')}</Th>
                <Th className="text-right">{t('rate')}</Th>
                <Th>{t('source')}</Th>
                <Th>{t('updated')}</Th>
                <Th>
                  <span className="sr-only">{t('unpin')}</span>
                </Th>
              </tr>
            </Thead>
            <Tbody>
              {settings.fx.rates.map((rate) => (
                <tr key={rate.currency}>
                  <Td className="font-mono font-semibold">{rate.currency}</Td>
                  <Td className="text-right font-mono tabular-nums">
                    {rate.perUsd ? Number(rate.perUsd).toLocaleString(undefined, { maximumFractionDigits: 4 }) : '—'}
                  </Td>
                  <Td className="text-sm">
                    {rate.available && rate.source ? (
                      sourceLabel(rate.source)
                    ) : (
                      <span className="inline-flex items-center gap-1.5 text-xs text-red-600 dark:text-red-400">
                        <XCircle className="h-3.5 w-3.5" /> {t('unavailable')}
                      </span>
                    )}
                  </Td>
                  <Td className="whitespace-nowrap text-xs tabular-nums text-slate-500 dark:text-slate-400">
                    {rate.pinned
                      ? t('pinned')
                      : rate.publishedAt
                        ? new Date(rate.publishedAt).toLocaleString()
                        : '—'}
                  </Td>
                  <Td>
                    {rate.pinned && (
                      <button
                        type="button"
                        onClick={() => setPin(rate.currency, null)}
                        disabled={pinning}
                        className="text-xs text-red-600 hover:underline dark:text-red-400"
                      >
                        {t('unpin')}
                      </button>
                    )}
                  </Td>
                </tr>
              ))}
            </Tbody>
          </Table>
        )}
      </div>

      <form
        className="mt-5 grid gap-3 sm:grid-cols-[10rem_12rem_auto] sm:items-end"
        onSubmit={(e) => {
          e.preventDefault()
          if (pinCurrency.trim() && pinRate.trim()) setPin(pinCurrency.trim().toUpperCase(), pinRate.trim())
        }}
      >
        <Input
          label={t('pin')}
          placeholder={t('pinCurrency')}
          value={pinCurrency}
          onChange={(e) => setPinCurrency(e.target.value.toUpperCase().slice(0, 3))}
          className="font-mono"
        />
        <Input
          aria-label={t('pinRate')}
          placeholder={t('pinRate')}
          inputMode="decimal"
          value={pinRate}
          onChange={(e) => setPinRate(e.target.value)}
          className="font-mono"
        />
        <Button type="submit" variant="secondary" loading={pinning} disabled={pinCurrency.length !== 3 || !pinRate.trim()}>
          {t('addPin')}
        </Button>
      </form>
      <p className="mt-1.5 max-w-prose text-xs text-slate-500 dark:text-slate-400">{t('pinHint')}</p>
    </Card>
  )
}

// ─── Invoices ────────────────────────────────────────────────

function InvoicesTab() {
  const t = useTranslations('admin.crypto')
  const [status, setStatus] = useState('')
  const { data, loading, error, refetch } = useApiQuery<InvoiceRow[]>(
    `/v1/admin/crypto/invoices?limit=100${status ? `&status=${status}` : ''}`,
  )

  return (
    <Card>
      <div className="mb-4 flex justify-end">
        <div className="w-48">
          <Select
            aria-label={t('filterStatus')}
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            options={[
              { value: '', label: t('invoiceStatus.all') },
              ...['awaiting', 'confirming', 'paid', 'expired', 'cancelled'].map((s) => ({
                value: s,
                label: t(`invoiceStatus.${s}`),
              })),
            ]}
          />
        </div>
      </div>
      {loading && !data ? (
        <TableSkeleton />
      ) : error ? (
        <ErrorState message={error} onRetry={refetch} />
      ) : !data?.length ? (
        <EmptyState icon={Bitcoin} title={t('noInvoices')} subtitle={t('noInvoicesHint')} />
      ) : (
        <Table>
          <Thead>
            <tr>
              <Th>{t('columns.created')}</Th>
              <Th>{t('columns.order')}</Th>
              <Th>{t('columns.network')}</Th>
              <Th className="text-right">{t('columns.amount')}</Th>
              <Th>{t('columns.status')}</Th>
              <Th>{t('columns.transaction')}</Th>
            </tr>
          </Thead>
          <Tbody>
            {data.map((invoice) => (
              <tr key={invoice.id}>
                <Td className="whitespace-nowrap text-xs tabular-nums text-slate-500 dark:text-slate-400">
                  {new Date(invoice.createdAt).toLocaleString()}
                </Td>
                <Td>
                  <div className="text-sm text-slate-900 dark:text-white">{invoice.order?.product ?? '—'}</div>
                  <div className="font-mono text-xs text-slate-500 dark:text-slate-400">{invoice.order?.userId ?? invoice.invoiceId}</div>
                </Td>
                <Td className="text-sm">
                  {invoice.token} · {invoice.chain}
                </Td>
                <Td className="text-right font-mono text-sm tabular-nums">{invoice.amount}</Td>
                <Td>
                  <Badge variant={INVOICE_VARIANT[invoice.status] ?? 'default'}>{t(`invoiceStatus.${invoice.status}`)}</Badge>
                  {invoice.status === 'confirming' && (
                    <div className="mt-1 text-xs tabular-nums text-slate-500 dark:text-slate-400">
                      {invoice.confirmations}/{invoice.requiredConfirmations}
                    </div>
                  )}
                </Td>
                <Td>
                  {invoice.txUrl ? (
                    <a
                      href={invoice.txUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 font-mono text-xs text-violet-600 hover:underline dark:text-violet-400"
                    >
                      {shortHash(invoice.txHash!)} <ExternalLink className="h-3 w-3" />
                    </a>
                  ) : (
                    <span className="text-xs text-slate-400">—</span>
                  )}
                </Td>
              </tr>
            ))}
          </Tbody>
        </Table>
      )}
    </Card>
  )
}

// ─── Transfers ───────────────────────────────────────────────

function TransfersTab({ onResolved }: { onResolved: () => void }) {
  const t = useTranslations('admin.crypto')
  const [status, setStatus] = useState('unmatched')
  const { data, loading, error, refetch } = useApiQuery<TransferRow[]>(`/v1/admin/crypto/transfers?status=${status}`)
  const [assigning, setAssigning] = useState<TransferRow | null>(null)
  const [ignoring, setIgnoring] = useState<TransferRow | null>(null)

  const done = () => {
    setAssigning(null)
    setIgnoring(null)
    refetch()
    onResolved()
  }

  return (
    <Card>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <p className="max-w-prose text-sm text-slate-500 dark:text-slate-400">{t('transfersHint')}</p>
        <div className="w-48">
          <Select
            aria-label={t('filterStatus')}
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            options={['unmatched', 'matched', 'ignored'].map((s) => ({ value: s, label: t(`transferStatus.${s}`) }))}
          />
        </div>
      </div>
      {loading && !data ? (
        <TableSkeleton />
      ) : error ? (
        <ErrorState message={error} onRetry={refetch} />
      ) : !data?.length ? (
        <EmptyState icon={CheckCircle2} title={t(status === 'unmatched' ? 'noUnmatched' : 'noTransfers')} />
      ) : (
        <Table>
          <Thead>
            <tr>
              <Th>{t('columns.received')}</Th>
              <Th>{t('columns.network')}</Th>
              <Th className="text-right">{t('columns.amount')}</Th>
              <Th>{t('columns.transaction')}</Th>
              <Th>{t('columns.note')}</Th>
              {status === 'unmatched' && <Th>{t('columns.actions')}</Th>}
            </tr>
          </Thead>
          <Tbody>
            {data.map((transfer) => (
              <tr key={transfer.id}>
                <Td className="whitespace-nowrap text-xs tabular-nums text-slate-500 dark:text-slate-400">
                  {new Date(transfer.createdAt).toLocaleString()}
                </Td>
                <Td className="text-sm">
                  {transfer.token} · {transfer.chain}
                  {!transfer.isFinal && (
                    <div className="text-xs text-amber-600 dark:text-amber-400">{t('notFinal')}</div>
                  )}
                </Td>
                <Td className="text-right font-mono text-sm tabular-nums">{transfer.amount}</Td>
                <Td>
                  <a
                    href={transfer.txUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 font-mono text-xs text-violet-600 hover:underline dark:text-violet-400"
                  >
                    {shortHash(transfer.txHash)} <ExternalLink className="h-3 w-3" />
                  </a>
                  {transfer.from && (
                    <div className="mt-0.5 font-mono text-xs text-slate-500 dark:text-slate-400">
                      {t('from')} {shortHash(transfer.from)}
                    </div>
                  )}
                </Td>
                <Td className="max-w-xs text-xs text-slate-600 dark:text-slate-300">
                  {transfer.status !== 'unmatched' && (
                    <Badge variant={TRANSFER_VARIANT[transfer.status] ?? 'default'}>{t(`transferStatus.${transfer.status}`)}</Badge>
                  )}
                  {transfer.note && <p className="mt-1">{transfer.note}</p>}
                  {transfer.suggestion && transfer.status === 'unmatched' && (
                    <p className="mt-1 text-slate-500 dark:text-slate-400">
                      {t('likely', { amount: transfer.suggestion.amount, status: t(`invoiceStatus.${transfer.suggestion.status}`) })}
                    </p>
                  )}
                </Td>
                {status === 'unmatched' && (
                  <Td>
                    <div className="flex gap-2">
                      <Button size="sm" icon={<Link2 className="h-3.5 w-3.5" />} onClick={() => setAssigning(transfer)}>
                        {t('assign')}
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setIgnoring(transfer)}>
                        {t('ignore')}
                      </Button>
                    </div>
                  </Td>
                )}
              </tr>
            ))}
          </Tbody>
        </Table>
      )}

      <Modal isOpen={!!assigning} onClose={() => setAssigning(null)} title={t('assignTitle')}>
        {assigning && <AssignForm transfer={assigning} onDone={done} onCancel={() => setAssigning(null)} />}
      </Modal>
      <Modal isOpen={!!ignoring} onClose={() => setIgnoring(null)} title={t('ignoreTitle')}>
        {ignoring && <IgnoreForm transfer={ignoring} onDone={done} onCancel={() => setIgnoring(null)} />}
      </Modal>
    </Card>
  )
}

function AssignForm({ transfer, onDone, onCancel }: { transfer: TransferRow; onDone: () => void; onCancel: () => void }) {
  const t = useTranslations('admin.crypto')
  const tc = useTranslations('common')
  const { data: invoices, loading } = useApiQuery<InvoiceRow[]>('/v1/admin/crypto/invoices?limit=200')
  const candidates = useMemo(
    () =>
      (invoices ?? []).filter(
        (i) => i.chain === transfer.chain && i.token === transfer.token && !i.txHash && i.status !== 'paid',
      ),
    [invoices, transfer],
  )
  const [invoiceId, setInvoiceId] = useState(transfer.suggestion?.id ?? '')
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  useEffect(() => {
    if (!invoiceId && candidates[0]) setInvoiceId(candidates[0].id)
  }, [candidates, invoiceId])

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    setFormError(null)
    try {
      const res = await api.post(`/v1/admin/crypto/transfers/${transfer.id}/assign`, {
        invoiceId,
        note: note.trim() || undefined,
      })
      toast.success(res.data.paymentStatus === 'paid' ? t('assignedPaid') : t('assigned'))
      onDone()
    } catch (err) {
      setFormError(getErrorMessage(err, t('assignFailed')))
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="rounded-xl bg-slate-50 p-3 text-sm dark:bg-slate-800/60">
        <span className="font-mono font-semibold">{transfer.amount} {transfer.token}</span>
        <span className="text-slate-500 dark:text-slate-400"> · {transfer.chain} · </span>
        <a href={transfer.txUrl} target="_blank" rel="noopener noreferrer" className="font-mono text-violet-600 hover:underline dark:text-violet-400">
          {shortHash(transfer.txHash)}
        </a>
      </div>
      {loading ? (
        <TableSkeleton />
      ) : candidates.length === 0 ? (
        <p className="text-sm text-slate-500 dark:text-slate-400">{t('noCandidates')}</p>
      ) : (
        <Select
          label={t('invoice')}
          value={invoiceId}
          onChange={(e) => setInvoiceId(e.target.value)}
          options={candidates.map((i) => ({
            value: i.id,
            label: `${i.amount} ${i.token} · ${i.order?.product ?? i.invoiceId} · ${t(`invoiceStatus.${i.status}`)} · ${new Date(i.createdAt).toLocaleString()}${i.id === transfer.suggestion?.id ? ` — ${t('suggested')}` : ''}`,
          }))}
        />
      )}
      <Input label={t('noteOptional')} value={note} onChange={(e) => setNote(e.target.value)} />
      <p className="text-xs text-slate-500 dark:text-slate-400">{t('assignHint')}</p>
      {formError && (
        <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-900/30 dark:text-red-400">
          {formError}
        </p>
      )}
      <div className="flex justify-end gap-3">
        <Button type="button" variant="ghost" onClick={onCancel}>
          {tc('cancel')}
        </Button>
        <Button type="submit" loading={saving} disabled={!invoiceId}>
          {t('assign')}
        </Button>
      </div>
    </form>
  )
}

function IgnoreForm({ transfer, onDone, onCancel }: { transfer: TransferRow; onDone: () => void; onCancel: () => void }) {
  const t = useTranslations('admin.crypto')
  const tc = useTranslations('common')
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    setFormError(null)
    try {
      await api.post(`/v1/admin/crypto/transfers/${transfer.id}/ignore`, { note: note.trim() })
      toast.success(t('ignored'))
      onDone()
    } catch (err) {
      setFormError(getErrorMessage(err, t('ignoreFailed')))
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <p className="text-sm text-slate-600 dark:text-slate-300">
        {t('ignoreHint', { amount: `${transfer.amount} ${transfer.token}` })}
      </p>
      <Input label={t('reason')} value={note} onChange={(e) => setNote(e.target.value)} required />
      {formError && (
        <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-900/30 dark:text-red-400">
          {formError}
        </p>
      )}
      <div className="flex justify-end gap-3">
        <Button type="button" variant="ghost" onClick={onCancel}>
          {tc('cancel')}
        </Button>
        <Button type="submit" variant="danger" loading={saving} disabled={!note.trim()}>
          {t('ignore')}
        </Button>
      </div>
    </form>
  )
}
