import { ImageResponse } from 'next/og'

export const size = { width: 180, height: 180 }
export const contentType = 'image/png'

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#0A0A0B',
          color: '#CCFF00',
          fontSize: 104,
          fontWeight: 800,
          fontFamily: 'sans-serif',
        }}
      >
        IN
      </div>
    ),
    { ...size },
  )
}
