'use client'

interface TabsProps {
  tabs: { key: string; label: string }[]
  activeTab: string
  onChange: (key: string) => void
}

export function Tabs({ tabs, activeTab, onChange }: TabsProps) {
  return (
    <div className="flex gap-1 bg-gray-100 dark:bg-gray-800 rounded-xl p-1">
      {tabs.map((tab) => (
        <button
          key={tab.key}
          onClick={() => onChange(tab.key)}
          className={`
            px-4 py-2 rounded-lg text-sm font-medium transition-all
            ${activeTab === tab.key
              ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm'
              : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'}
          `}
        >
          {tab.label}
        </button>
      ))}
    </div>
  )
}
