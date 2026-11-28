import type { NextConfig } from 'next'

const isDev = process.env.NODE_ENV === 'development'

/**
 * La impresora de etiquetas, que es lo único del sitio que no habla por HTTPS.
 *
 * No puede hablarlo: está dentro de la bodega, con dirección privada, y un certificado se
 * emite para un nombre público. El navegador deja la excepción para la red local desde Chrome
 * 142, pero la política de seguridad del sitio es nuestra y hay que abrirle la puerta aquí,
 * nombrando ese origen y ninguno más. Si la bodega no tiene impresora, no se abre nada.
 */
const impresora = process.env.NEXT_PUBLIC_IMPRESORA_ORIGEN?.trim()

const csp = [
  "default-src 'self'",
  // `wasm-unsafe-eval` es para zxing, el decodificador de respaldo: sin el, Chrome bloquea
  // la compilacion del WebAssembly y la camara no lee donde no hay `BarcodeDetector`.
  `script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'${isDev ? " 'unsafe-eval'" : ''}`,
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "img-src 'self' data: blob:",
  "font-src 'self' data: https://fonts.gstatic.com",
  `connect-src 'self' https://*.supabase.co wss://*.supabase.co${impresora ? ` ${impresora}` : ''}`,
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join('; ')

const nextConfig: NextConfig = {
  // `forbidden()` y su pantalla `app/forbidden.tsx`. Sin esto, un permiso negado sale por
  // `error.tsx` con un 500 y un numero de diez cifras, que es el fallo 108.
  experimental: { authInterrupts: true },
  // Todo vive detras del login y depende del usuario: no hay nada que prerenderizar.
  // cacheComponents obligaria a envolver cada pagina en Suspense sin ganar nada.
  cacheComponents: false,
  poweredByHeader: false,
  turbopack: {
    rules: {
      '*.css': { loaders: ['@tailwindcss/turbopack'], as: '*.css' },
    },
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'Content-Security-Policy', value: csp },
          { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          // La camara es como se escanea donde no hay lector laser. Con `camera=()` el
          // navegador la niega sin siquiera preguntarle al usuario: ni sale el permiso.
          { key: 'Permissions-Policy', value: 'camera=(self), microphone=(), geolocation=()' },
        ],
      },
    ]
  },
}

export default nextConfig
