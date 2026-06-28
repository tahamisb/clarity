import { Analytics } from '@vercel/analytics/next'
import type { Metadata, Viewport } from 'next'
import { Geist, Geist_Mono, Archivo } from 'next/font/google'
import localFont from 'next/font/local'
import { SessionProvider } from 'next-auth/react'
import { ThemeProvider } from '@/components/theme-provider'
import { SettingsProvider } from '@/lib/settings-context'
import { TimeFilterProvider } from '@/lib/time-filter-context'
import { NotificationsProvider } from '@/lib/notifications-context'
import { MessageStatusProvider } from '@/lib/message-status-context'
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

// Cairo — Arabic typeface, applied to the whole UI when the language is set to
// العربية (see globals.css `[dir="rtl"]`). Self-hosted from the .ttf weights.
const cairo = localFont({
  variable: '--font-arabic',
  display: 'swap',
  src: [
    { path: './fonts/Cairo-Light.ttf', weight: '300', style: 'normal' },
    { path: './fonts/Cairo-Regular.ttf', weight: '400', style: 'normal' },
    { path: './fonts/Cairo-SemiBold.ttf', weight: '600', style: 'normal' },
    { path: './fonts/Cairo-Bold.ttf', weight: '700', style: 'normal' },
    { path: './fonts/Cairo-Black.ttf', weight: '900', style: 'normal' },
  ],
})

export const metadata: Metadata = {
  title: 'Rafeeq — Call Intelligence',
  description:
    'Rafeeq Call Intelligence — transcribe, classify and analyze support calls across Qatar.',
  generator: 'v0.app',
  icons: {
    icon: [
      {
        url: '/gorafeeq_logo.svg',
        media: '(prefers-color-scheme: light)',
      },
      {
        url: '/gorafeeq_logo.svg',
        media: '(prefers-color-scheme: dark)',
      },
      {
        url: '/gorafeeq_logo.svg',
        type: 'image/svg+xml',
      },
    ],
    apple: '/apple-icon.png',
  },
}

// A small thank-you for anyone curious enough to open the inspector. It is
// emitted as a genuine HTML comment inside a hidden, inert node, so it stays
// invisible and harmless: valid markup, no a11y tree entry, no SEO weight, no
// console noise — it only surfaces in the DOM / view-source. The art avoids the
// "--", "<" and ">" sequences that would otherwise be illegal inside a comment.
const FOX_EASTER_EGG = [
  String.raw``,
  String.raw``,
  String.raw`          /\     /\ `,
  String.raw`         /  \___/  \ `,
  String.raw`         \         /`,
  String.raw`          \  o o  /         "`,
  String.raw`           )  ^  (           meow."`,
  String.raw`          /       \               ~ Your first ever interns`,
  String.raw`         (  |   |  )         we were kinda bored, so we made this for you.`,
  String.raw`          \ |   | /`,
  String.raw`           )  ~  (          ()_()`,
  String.raw`          (_______)        (='.'=)   ,`,
  String.raw`                           (")_(")   Signed Mahdi, Karthick & Taha.`,
].join("\n")
const EASTER_EGG_HTML = `<!--\n${FOX_EASTER_EGG}\n-->`

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
      className={`${geistSans.variable} ${geistMono.variable} ${archivo.variable} ${cairo.variable}`}
    >
      <body className="font-sans antialiased">
        <SessionProvider>
          <ThemeProvider>
            <SettingsProvider>
              <TimeFilterProvider>
                <MessageStatusProvider>
                  <NotificationsProvider>
                    {children}
                    {process.env.NODE_ENV === 'production' && <Analytics />}
                  </NotificationsProvider>
                </MessageStatusProvider>
              </TimeFilterProvider>
            </SettingsProvider>
          </ThemeProvider>
        </SessionProvider>
        <div hidden aria-hidden="true" dangerouslySetInnerHTML={{ __html: EASTER_EGG_HTML }} />
      </body>
    </html>
  )
}
