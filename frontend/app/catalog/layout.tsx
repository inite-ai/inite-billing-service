import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Pricing',
  description: 'Plans and prices of every INITE product — content, analytics, rent, health and more — in your currency.',
  alternates: { canonical: '/catalog' },
}

export default function CatalogLayout({ children }: { children: React.ReactNode }) {
  return children
}
