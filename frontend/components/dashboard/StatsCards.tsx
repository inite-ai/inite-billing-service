'use client'

import { motion } from 'framer-motion'
import { CreditCard, Receipt, Users, DollarSign } from 'lucide-react'
import { useTranslations } from 'next-intl'

interface StatsCardsProps {
  activeSubscriptions: number
  totalOrders: number
  totalReferrals: number
  pendingCommissions: string
}

const gradients = ['stat-gradient-green', 'stat-gradient-blue', 'stat-gradient-violet', 'stat-gradient-amber']

export function StatsCards({ activeSubscriptions, totalOrders, totalReferrals, pendingCommissions }: StatsCardsProps) {
  const t = useTranslations('dashboard')

  const stats = [
    { label: t('activeSubscriptions'), value: activeSubscriptions, icon: CreditCard, color: 'text-emerald-500', gradient: gradients[0] },
    { label: t('totalOrders'), value: totalOrders, icon: Receipt, color: 'text-blue-500', gradient: gradients[1] },
    { label: t('totalReferrals'), value: totalReferrals, icon: Users, color: 'text-violet-500', gradient: gradients[2] },
    { label: t('pendingCommissions'), value: `$${pendingCommissions}`, icon: DollarSign, color: 'text-amber-500', gradient: gradients[3] },
  ]

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
      {stats.map((stat, index) => {
        const Icon = stat.icon
        return (
          <motion.div
            key={index}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: index * 0.08, duration: 0.4 }}
            className={`rounded-2xl border p-5 ${stat.gradient}`}
          >
            <div className="flex items-start justify-between mb-3">
              <div className={`p-2 rounded-xl ${stat.color} bg-white/80 dark:bg-slate-900/50`}>
                <Icon className="w-5 h-5" />
              </div>
            </div>
            <p className="text-2xl font-bold text-slate-900 dark:text-white tracking-tight">{stat.value}</p>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">{stat.label}</p>
          </motion.div>
        )
      })}
    </div>
  )
}
