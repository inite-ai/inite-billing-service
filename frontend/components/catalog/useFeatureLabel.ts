'use client'

import { useTranslations } from 'next-intl'
import { humanizeKey, isFeatureKey } from '@/lib/catalog'

/**
 * A plan feature as a customer reads it: a machine key (`custom-domain`)
 * through the catalog dictionary, or spelled out; a sentence as written;
 * `*` as "everything included". Shared by the catalog and the cabinet.
 */
export function useFeatureLabel() {
  const t = useTranslations('catalog')
  return (feature: string) => {
    if (feature === '*') return t('allFeatures')
    if (!isFeatureKey(feature)) return feature
    return t.has(`feature.${feature}`) ? t(`feature.${feature}`) : humanizeKey(feature)
  }
}
