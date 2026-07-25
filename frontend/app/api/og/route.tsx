import { ImageResponse } from 'next/og'
import type { NextRequest } from 'next/server'

// Node runtime (not edge): the site self-hosts via `next start`, where the
// edge shim + next/og is unreliable. Node runs ImageResponse fine (see icon.tsx).
export const runtime = 'nodejs'

const INK = '#0A0A0B'
const PANEL = '#101012'
const LIME = '#CCFF00'
const TEXT = '#ECECEA'
const DIM = '#83837C'
const LINE = 'rgba(255,255,255,0.09)'

/** Fetch a Google font subset covering exactly `text` (loads Cyrillic when present). */
async function loadFont(family: string, weight: number, text: string): Promise<ArrayBuffer> {
  const url = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(
    family,
  )}:wght@${weight}&text=${encodeURIComponent(text)}`
  const css = await (
    await fetch(url, {
      headers: {
        // An old UA makes Google Fonts serve woff/truetype — next/og (Satori)
        // cannot decode woff2, so a modern UA would break the image.
        'User-Agent': 'Mozilla/5.0 (compatible; MSIE 9.0; Windows NT 6.1; Trident/5.0)',
      },
    })
  ).text()
  const src = css.match(/src:\s*url\(([^)]+)\)/)
  if (!src) throw new Error(`font load failed for ${family}`)
  return await (await fetch(src[1]).then((r) => r)).arrayBuffer()
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const locale = searchParams.get('locale') === 'ru' ? 'ru' : 'en'
  const title = (searchParams.get('title') || 'One backend for your money.').slice(0, 90)
  const subtitle = (searchParams.get('subtitle') || '').slice(0, 200)
  const kicker =
    searchParams.get('kicker') ||
    (locale === 'ru' ? 'ПЛАТЁЖНЫЙ БЭКЕНД ДЛЯ ПРОДУКТОВ' : 'BILLING BACKEND FOR PRODUCTS')

  // Union of glyphs we render, so each subset covers Cyrillic + Latin as needed.
  const glyphs = `${title}${subtitle}${kicker} INITEBillng billing.inite.ai AI-first◆·`
  // Never hard-fail the OG endpoint on a font hiccup — fall back to defaults.
  let fonts: Array<{ name: string; data: ArrayBuffer; weight: 500 | 700; style: 'normal' }> = []
  try {
    const [display, sans, mono] = await Promise.all([
      loadFont('Playfair Display', 700, glyphs),
      loadFont('Manrope', 500, glyphs),
      loadFont('JetBrains Mono', 500, glyphs),
    ])
    fonts = [
      { name: 'Display', data: display, weight: 700, style: 'normal' },
      { name: 'Sans', data: sans, weight: 500, style: 'normal' },
      { name: 'Mono', data: mono, weight: 500, style: 'normal' },
    ]
  } catch {
    fonts = []
  }

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          background: INK,
          padding: '64px 72px',
          position: 'relative',
        }}
      >
        {/* faint engraved grid */}
        <div
          style={{
            position: 'absolute',
            inset: 0,
            backgroundImage: `linear-gradient(${LINE} 1px, transparent 1px), linear-gradient(90deg, ${LINE} 1px, transparent 1px)`,
            backgroundSize: '80px 80px',
            opacity: 0.5,
          }}
        />
        {/* lime glow */}
        <div
          style={{
            position: 'absolute',
            top: -160,
            right: -120,
            width: 520,
            height: 520,
            background: 'radial-gradient(circle, rgba(204,255,0,0.10), transparent 65%)',
          }}
        />

        {/* header: wordmark */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <div
            style={{
              width: 44,
              height: 44,
              borderRadius: 11,
              background: LIME,
              color: INK,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontFamily: 'Display',
              fontSize: 22,
              fontWeight: 700,
              transform: 'rotate(-4deg)',
            }}
          >
            IN
          </div>
          <div style={{ display: 'flex', fontFamily: 'Sans', fontSize: 26, color: TEXT }}>
            <span style={{ fontWeight: 700 }}>INITE</span>
            <span style={{ color: DIM, marginLeft: 8 }}>Billing</span>
          </div>
        </div>

        {/* body: kicker + headline + subtitle */}
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <div
            style={{
              fontFamily: 'Mono',
              fontSize: 20,
              letterSpacing: 4,
              color: DIM,
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              marginBottom: 20,
            }}
          >
            <span style={{ color: LIME }}>◆</span>
            {kicker}
          </div>
          <div
            style={{
              fontFamily: 'Display',
              fontSize: 86,
              fontWeight: 700,
              color: TEXT,
              lineHeight: 1.02,
              letterSpacing: -1,
              maxWidth: 1000,
            }}
          >
            {title}
          </div>
          {subtitle ? (
            <div
              style={{
                fontFamily: 'Sans',
                fontSize: 27,
                color: DIM,
                lineHeight: 1.4,
                marginTop: 26,
                maxWidth: 900,
                display: 'flex',
              }}
            >
              {subtitle}
            </div>
          ) : null}
        </div>

        {/* footer: locator + chip */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ fontFamily: 'Mono', fontSize: 22, color: DIM }}>billing.inite.ai</div>
          <div
            style={{
              fontFamily: 'Mono',
              fontSize: 18,
              color: INK,
              background: LIME,
              padding: '8px 16px',
              borderRadius: 8,
              fontWeight: 500,
              display: 'flex',
            }}
          >
            AI-first
          </div>
        </div>
      </div>
    ),
    {
      width: 1200,
      height: 630,
      fonts,
      headers: {
        'Cache-Control': 'public, immutable, no-transform, max-age=86400, s-maxage=604800',
      },
    },
  )
}
