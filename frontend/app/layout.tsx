import { Analytics } from '@vercel/analytics/next'
import type { Metadata, Viewport } from 'next'
import { Geist, Geist_Mono, Archivo } from 'next/font/google'
import { SessionProvider } from 'next-auth/react'
import { ThemeProvider } from '@/components/theme-provider'
import { SettingsProvider } from '@/lib/settings-context'
import './globals.css'

const geistSans = Geist({ variable: '--font-geist-sans', subsets: ['latin'] })
const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
})
const archivo = Archivo({
  variable: '--font-display',
  subsets: ['latin'],
  weight: ['600', '700', '800', '900'],
  style: ['normal', 'italic'],
})

export const metadata: Metadata = {
  title: 'Rafeeq — Call Intelligence',
  description:
    'Rafeeq Call Intelligence — transcribe, classify and analyze support calls across Qatar.',
  generator: 'v0.app',
  icons: {
    icon: [
      {
        url: '/icon-light-32x32.png',
        media: '(prefers-color-scheme: light)',
      },
      {
        url: '/icon-dark-32x32.png',
        media: '(prefers-color-scheme: dark)',
      },
      {
        url: '/icon.svg',
        type: 'image/svg+xml',
      },
    ],
    apple: '/apple-icon.png',
  },
}

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#faf8fc' },
    { media: '(prefers-color-scheme: dark)', color: '#0d0619' },
  ],
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} ${archivo.variable}`}
    >
      <body className="font-sans antialiased">
        <SessionProvider>
          <ThemeProvider>
            <SettingsProvider>
              {children}
              {process.env.NODE_ENV === 'production' && <Analytics />}
            </SettingsProvider>
          </ThemeProvider>
        </SessionProvider>
      </body>
    </html>
  )
}
