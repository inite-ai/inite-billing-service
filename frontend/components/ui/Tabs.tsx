'use client'

interface TabsProps {
  tabs: { key: string; label: string }[]
  activeTab: string
  onChange: (key: string) => void
}

export function Tabs({ tabs, activeTab, onChange }: TabsProps) {
  return (
    <div className="flex gap-1 bg-slate-100 dark:bg-slate-800/60 rounded-xl p-1 w-fit">
      {tabs.map((tab) => (
        <button
          key={tab.key}
          onClick={() => onChange(tab.key)}
          className={`
            px-4 py-2 rounded-lg text-sm font-medium transition-all duration-200
            ${activeTab === tab.key
              ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-sm'
              : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-white/50 dark:hover:bg-slate-700/50'}
          `}
        >
          {tab.label}
        </button>
      ))}
    </div>
  )
}
