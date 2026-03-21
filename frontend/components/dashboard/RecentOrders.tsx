'use client'

import { Order } from '@/lib/types'
import { Card } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { Table, Thead, Tbody, Th, Td } from '@/components/ui/Table'
import { useTranslations } from 'next-intl'

interface RecentOrdersProps {
  orders: Order[]
}

export function RecentOrders({ orders }: RecentOrdersProps) {
  const t = useTranslations('dashboard')
  const tc = useTranslations('common')

  return (
    <Card>
      <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">{t('recentOrders')}</h3>
      {orders.length === 0 ? (
        <p className="text-gray-500 dark:text-gray-400 text-sm">{t('noOrdersYet')}</p>
      ) : (
        <Table>
          <Thead>
            <tr>
              <Th>{t('tableDate')}</Th>
              <Th>{t('tableAmount')}</Th>
              <Th>{t('tableMode')}</Th>
              <Th>{t('tableStatus')}</Th>
            </tr>
          </Thead>
          <Tbody>
            {orders.map((order) => (
              <tr key={order.id}>
                <Td>{new Date(order.createdAt).toLocaleDateString()}</Td>
                <Td>{order.amount} {order.currency}</Td>
                <Td>{order.mode}</Td>
                <Td><Badge>{order.status}</Badge></Td>
              </tr>
            ))}
          </Tbody>
        </Table>
      )}
    </Card>
  )
}
