import type { Metadata, Viewport } from 'next'
import { Inter } from 'next/font/google'
import './globals.css'

const inter = Inter({ variable: '--font-inter', subsets: ['latin'], weight: ['400', '500'] })

export const metadata: Metadata = {
  title: 'WMS Palmerola',
  description: 'Sistema de gestión de almacén',
  robots: { index: false, follow: false },
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  themeColor: '#2c2b8f',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es" className={`${inter.variable} h-full`}>
      <head>
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        {/* Dos reglas desactivadas a proposito, no por descuido:
            - no-page-custom-font apunta a pages/_document, que no existe en App Router,
              y el @import dentro del CSS lo elimina el build.
            - google-font-display prefiere "optional", que para una fuente de iconos
              significa que a veces no carga y queda a la vista el nombre del icono como
              texto. "block" es lo que recomienda Google para Material Symbols. */}
        {/* eslint-disable-next-line @next/next/no-page-custom-font, @next/next/google-font-display */}
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Material+Symbols+Rounded:opsz,wght,FILL,GRAD@24,400,0,0&display=block"
        />
      </head>
      <body className="flex min-h-full flex-col antialiased">{children}</body>
    </html>
  )
}
