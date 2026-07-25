import { ImageResponse } from 'next/og'

export const size = { width: 512, height: 512 }
export const contentType = 'image/png'

// The lime "IN" mark — the billing wordmark badge, generated (no static asset).
export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#CCFF00',
          color: '#0A0A0B',
          fontSize: 300,
          fontWeight: 800,
          fontFamily: 'sans-serif',
          borderRadius: 96,
        }}
      >
        IN
      </div>
    ),
    { ...size },
  )
}
