import createNextIntlPlugin from 'next-intl/plugin'
import createMDX from '@next/mdx'

const withNextIntl = createNextIntlPlugin('./i18n/request.ts')
// remark-gfm enables GFM tables / strikethrough / autolinks in docs .mdx pages.
// Passed as a STRING (not an imported function) so Turbopack can serialize it.
const withMDX = createMDX({ options: { remarkPlugins: [['remark-gfm', {}]] } })

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Treat .mdx as page sources so app/docs/<slug>/page.mdx works as a route.
  pageExtensions: ['ts', 'tsx', 'mdx'],
  env: {
    NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000',
    NEXT_PUBLIC_AUTH_SERVICE_URL: process.env.NEXT_PUBLIC_AUTH_SERVICE_URL || 'https://auth.inite.ai',
    NEXT_PUBLIC_OAUTH_CLIENT_ID: process.env.NEXT_PUBLIC_OAUTH_CLIENT_ID || 'inite-billing',
  },
}

export default withNextIntl(withMDX(nextConfig))
