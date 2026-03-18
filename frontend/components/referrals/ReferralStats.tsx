'use client'

import { AffiliateStats } from '@/lib/types'
import { Card } from '@/components/ui/Card'
import { Users, DollarSign, Clock, Wallet } from 'lucide-react'

interface ReferralStatsProps {
  stats: AffiliateStats | null
}

export function ReferralStats({ stats }: ReferralStatsProps) {
  if (!stats) return null

  const items = [
    { label: 'Total Referrals', value: stats.totalReferrals, icon: Users, color: 'text-violet-500' },
    { label: 'Total Commissions', value: `$${stats.totalCommissions}`, icon: DollarSign, color: 'text-green-500' },
    { label: 'Pending', value: `$${stats.pendingCommissions}`, icon: Clock, color: 'text-yellow-500' },
    { label: 'Paid', value: `$${stats.paidCommissions}`, icon: Wallet, color: 'text-blue-500' },
  ]

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
      {items.map((item) => {
        const Icon = item.icon
        return (
          <Card key={item.label}>
            <div className="flex items-center gap-3">
              <Icon className={`w-6 h-6 ${item.color}`} />
              <div>
                <p className="text-xl font-bold text-gray-900 dark:text-white">{item.value}</p>
                <p className="text-xs text-gray-500 dark:text-gray-400">{item.label}</p>
              </div>
            </div>
          </Card>
        )
      })}
    </div>
  )
}
