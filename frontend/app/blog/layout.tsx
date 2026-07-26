import Link from 'next/link'

export default function BlogLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="docs min-h-screen">
      <nav className="sticky top-0 z-20 border-b border-[var(--d-border)] bg-[var(--d-bg)]/90 backdrop-blur">
        <div className="max-w-6xl mx-auto px-4 h-14 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2.5 font-semibold">
            <span
              className="w-7 h-7 rounded-lg grid place-items-center text-[13px] font-bold"
              style={{ background: 'var(--d-accent)', color: 'var(--d-bg)', transform: 'rotate(-4deg)' }}
            >
              IN
            </span>
            INITE <span className="text-[var(--d-faint)] font-medium">Billing</span>
            <span className="ml-1 text-[var(--d-faint)] font-mono text-xs uppercase tracking-widest">Blog</span>
          </Link>
          <div className="flex items-center gap-4 text-sm text-[var(--d-muted)]">
            <Link href="/docs" className="hover:text-[var(--d-text)]">
              Docs
            </Link>
            <Link href="/" className="hover:text-[var(--d-text)]">
              Home
            </Link>
          </div>
        </div>
      </nav>
      <div className="max-w-3xl mx-auto px-4">{children}</div>
    </div>
  )
}
