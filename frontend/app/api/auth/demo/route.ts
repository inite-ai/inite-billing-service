import type { NextRequest } from 'next/server'
import { demoDoor } from '@/lib/demo-door'

// The demo button's door (lib/demo-door.ts). Never cached: every call is a grant.
export const dynamic = 'force-dynamic'

export function GET(request: NextRequest) {
  return demoDoor(request)
}

export function POST(request: NextRequest) {
  return demoDoor(request)
}

export function HEAD(request: NextRequest) {
  return demoDoor(request)
}
