'use client'

import { useAuth } from '@/contexts/AuthContext'
import ChatPanel from './ChatPanel'

export default function ChatWrapper() {
  const { user } = useAuth()
  if (!user) return null
  return <ChatPanel />
}
