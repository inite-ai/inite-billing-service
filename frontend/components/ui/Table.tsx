'use client'

export function Table({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`overflow-x-auto -mx-5 px-5 ${className}`}>
      <table className="min-w-full">
        {children}
      </table>
    </div>
  )
}

export function Thead({ children }: { children: React.ReactNode }) {
  return (
    <thead>
      {children}
    </thead>
  )
}

export function Tbody({ children }: { children: React.ReactNode }) {
  return (
    <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
      {children}
    </tbody>
  )
}

export function Th({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <th className={`px-4 py-3 text-left text-[11px] font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-wider border-b border-slate-200 dark:border-slate-800 ${className}`}>
      {children}
    </th>
  )
}

export function Td({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <td className={`px-4 py-3.5 text-sm text-slate-700 dark:text-slate-300 ${className}`}>
      {children}
    </td>
  )
}
