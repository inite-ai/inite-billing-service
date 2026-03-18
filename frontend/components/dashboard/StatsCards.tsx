'use client'

import { Card } from '@/components/ui/Card'
import { CreditCard, Receipt, Users, DollarSign } from 'lucide-react'

interface StatsCardsProps {
  activeSubscriptions: number
  totalOrders: number
  totalReferrals: number
  pendingCommissions: string
}

export function StatsCards({ activeSubscriptions, totalOrders, totalReferrals, pendingCommissions }: StatsCardsProps) {
  const stats = [
    { label: 'Active Subscriptions', value: activeSubscriptions, icon: CreditCard, color: 'text-green-500' },
    { label: 'Total Orders', value: totalOrders, icon: Receipt, color: 'text-blue-500' },
    { label: 'Total Referrals', value: totalReferrals, icon: Users, color: 'text-violet-500' },
    { label: 'Pending Commissions', value: `$${pendingCommissions}`, icon: DollarSign, color: 'text-yellow-500' },
  ]

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
      {stats.map((stat) => {
        const Icon = stat.icon
        return (
          <Card key={stat.label}>
            <div className="flex items-center gap-3">
              <Icon className={`w-8 h-8 ${stat.color}`} />
              <div>
                <p className="text-2xl font-bold text-gray-900 dark:text-white">{stat.value}</p>
                <p className="text-sm text-gray-500 dark:text-gray-400">{stat.label}</p>
              </div>
            </div>
          </Card>
        )
      })}
    </div>
  )
}
