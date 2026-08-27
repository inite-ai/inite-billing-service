'use client'

import { useTranslations } from 'next-intl'
import { Badge, type BadgeVariant } from './Badge'

/**
 * Status colour is a property of the status, not of the words on screen.
 *
 * `Badge` used to infer its variant from `String(children)`, which worked in
 * English only because the labels happened to equal the map keys. Pages that
 * passed a translated label (`t('status.active')` → "активен") fell through to
 * the neutral variant, so the entire status colour system disappeared in
 * Russian; pages that passed the raw API value kept their colour but showed
 * `past_due` to a Russian-speaking operator. Same concept, two wrong answers.
 *
 * `StatusBadge` takes the canonical status and owns both halves: it resolves
 * the variant from the value and renders the translated label itself.
 */

/** Canonical status → semantic variant. Keys are API values, never labels. */
const VARIANT_BY_STATUS: Record<string, BadgeVariant> = {
  active: 'success',
  paid: 'success',
  earned: 'success',
  converted: 'success',
  delivered: 'success',
  trialing: 'info',
  open: 'info',
  sent: 'info',
  pending: 'warning',
  processing: 'warning',
  past_due: 'warning',
  canceling: 'warning',
  refunded: 'warning',
  created: 'default',
  inactive: 'default',
  none: 'default',
  canceled: 'error',
  cancelled: 'error',
  ended: 'error',
  failed: 'error',
  expired: 'error',
  voided: 'error',
  revoked: 'error',
  suspended: 'error',
  terminated: 'error',
  bounced: 'error',
  fraud: 'error',
}

/**
 * API values are snake_case; message keys are camelCase. Everything else maps
 * one to one, so only the exceptions are listed.
 */
const MESSAGE_KEY_BY_STATUS: Record<string, string> = {
  past_due: 'pastDue',
  cancelled: 'canceled',
}

export function statusVariant(status: string): BadgeVariant {
  return VARIANT_BY_STATUS[status?.toLowerCase()] ?? 'default'
}

export function StatusBadge({ status, className = '' }: { status: string; className?: string }) {
  const t = useTranslations('common.status')
  const raw = String(status ?? '')
  const key = MESSAGE_KEY_BY_STATUS[raw.toLowerCase()] ?? raw

  // An unmapped status still has to render something an operator can read, so
  // fall back to the value the API sent rather than a missing-message marker.
  const label = t.has(key as never) ? t(key as never) : raw.replace(/_/g, ' ')

  return (
    <Badge variant={statusVariant(raw)} className={className}>
      {label}
    </Badge>
  )
}

/** Boolean active/inactive columns, so callers stop hand-writing the ternary. */
export function ActiveBadge({ active }: { active: boolean }) {
  return <StatusBadge status={active ? 'active' : 'inactive'} />
}
