'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import type { NavItem } from './nav-items'

/** Navegacion de escritorio, para supervisores y administracion. */
export function TopNav({ items }: { items: NavItem[] }) {
  const path = usePathname()

  return (
    <nav className="hidden md:block">
      <ul className="flex items-center gap-1">
        {items.map((item) => {
          const activo = item.href === '/' ? path === '/' : path.startsWith(item.href)
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={activo ? 'page' : undefined}
                className={`rounded-lg px-3 py-2 text-sm transition-colors ${
                  activo ? 'bg-white/15 text-white' : 'text-white/70 hover:text-white'
                }`}
              >
                {item.label}
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
