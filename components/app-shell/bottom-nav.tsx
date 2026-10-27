'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Icon } from '@/components/ui/icon'
import type { NavItem } from './nav-items'

/** Barra inferior: el operario trabaja de pie, con una mano y guantes. */
export function BottomNav({ items }: { items: NavItem[] }) {
  const path = usePathname()

  return (
    <nav className="sticky bottom-0 z-10 border-t border-borde bg-white pb-[env(safe-area-inset-bottom)] md:hidden">
      <ul className="grid" style={{ gridTemplateColumns: `repeat(${items.length}, 1fr)` }}>
        {items.map((item) => {
          const activo = item.href === '/' ? path === '/' : path.startsWith(item.href)
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={activo ? 'page' : undefined}
                className={`flex h-16 flex-col items-center justify-center gap-0.5 ${
                  activo ? 'text-azul' : 'text-azul/50'
                }`}
              >
                <Icon name={item.icon} />
                <span className="text-[11px]">{item.label}</span>
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
