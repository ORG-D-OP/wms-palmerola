'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Icon } from '@/components/ui/icon'
import type { NavGrupo, NavItem } from './nav-items'

/**
 * La barra lateral de escritorio, para supervisores y administración. No existe en el
 * teléfono: ahí manda la barra de abajo.
 */
export function SideNav({ sueltos, grupos }: { sueltos: NavItem[]; grupos: NavGrupo[] }) {
  const path = usePathname()

  const enlace = (item: NavItem) => {
    const activo = item.href === '/' ? path === '/' : path.startsWith(item.href)
    return (
      <li key={item.href}>
        <Link
          href={item.href}
          aria-current={activo ? 'page' : undefined}
          className={`flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm transition-colors ${
            activo ? 'bg-white/15 text-white' : 'text-white/70 hover:bg-white/10 hover:text-white'
          }`}
        >
          <Icon name={item.icon} className="!text-[20px]" />
          {item.label}
        </Link>
      </li>
    )
  }

  return (
    <nav className="flex-1 overflow-y-auto px-3 pb-4">
      <ul>{sueltos.map(enlace)}</ul>
      {grupos.map((g) => (
        <div key={g.titulo}>
          <h2 className="mt-5 mb-1.5 px-2.5 text-[11px] tracking-wider text-white/50 uppercase">
            {g.titulo}
          </h2>
          <ul>{g.items.map(enlace)}</ul>
        </div>
      ))}
    </nav>
  )
}
