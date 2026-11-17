'use client'

import { useAuth } from '@/contexts/AuthContext'
import ChatPanel from './ChatPanel'

export default function ChatWrapper() {
  const { user } = useAuth()
  // The assistant answers with a model; the demo makes no model calls.
  if (!user || user.demo) return null
  return <ChatPanel />
}
