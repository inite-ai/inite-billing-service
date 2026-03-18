'use client'

import { Order } from '@/lib/types'
import { Card } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { Table, Thead, Tbody, Th, Td } from '@/components/ui/Table'

interface RecentOrdersProps {
  orders: Order[]
}

export function RecentOrders({ orders }: RecentOrdersProps) {
  return (
    <Card>
      <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">Recent Orders</h3>
      {orders.length === 0 ? (
        <p className="text-gray-500 dark:text-gray-400 text-sm">No orders yet</p>
      ) : (
        <Table>
          <Thead>
            <tr>
              <Th>Date</Th>
              <Th>Amount</Th>
              <Th>Mode</Th>
              <Th>Status</Th>
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
