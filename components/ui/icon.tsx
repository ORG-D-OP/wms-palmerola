/** Material Symbols Rounded es el unico set permitido por el manual de marca. */
export function Icon({ name, className = '' }: { name: string; className?: string }) {
  return (
    <span aria-hidden className={`material-symbols-rounded ${className}`}>
      {name}
    </span>
  )
}
