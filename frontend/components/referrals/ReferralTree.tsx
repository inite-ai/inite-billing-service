'use client'

import { AffiliateTreeNode } from '@/lib/types'
import { Users, ChevronRight } from 'lucide-react'

interface ReferralTreeProps {
  tree: AffiliateTreeNode | null
}

function TreeNode({ node, depth = 0 }: { node: AffiliateTreeNode; depth?: number }) {
  return (
    <div className={`${depth > 0 ? 'ml-6 border-l-2 border-gray-200 dark:border-gray-700 pl-4' : ''}`}>
      <div className="flex items-center gap-3 py-2">
        <div className="w-8 h-8 rounded-full bg-violet-100 dark:bg-violet-900/30 flex items-center justify-center">
          <Users className="w-4 h-4 text-violet-600 dark:text-violet-400" />
        </div>
        <div className="flex-1">
          <p className="text-sm font-medium text-gray-900 dark:text-white">
            {node.referralCode}
          </p>
          <p className="text-xs text-gray-500 dark:text-gray-400">
            {node.totalReferrals} referrals | Earned: ${node.totalEarned}
          </p>
        </div>
        {node.children.length > 0 && (
          <ChevronRight className="w-4 h-4 text-gray-400" />
        )}
      </div>
      {node.children.map((child) => (
        <TreeNode key={child.id} node={child} depth={depth + 1} />
      ))}
    </div>
  )
}

export function ReferralTree({ tree }: ReferralTreeProps) {
  if (!tree) {
    return <p className="text-gray-500 dark:text-gray-400 text-sm">No referral tree data</p>
  }

  return <TreeNode node={tree} />
}
