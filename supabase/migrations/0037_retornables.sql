/**
 * Pallets vacíos y corrugado de retorno: un contador, no inventario.
 *
 * El catálogo de usos ya distingue las posiciones que no guardan producto —PALLET_VACIO,
 * CORRUGADO, RAMPLA— y el jefe de bodega ya puede marcar cualquier posición así desde
 * /areas. Lo que faltaba es qué se lleva ahí.
 *
 * Y lo que se lleva es una cuenta. No hay matrícula, ni lote, ni vencimiento, ni límite de
 * apilado: el espacio es de capacidad infinita a propósito —caben todos los pallets que
 * sea— y puede haber varios. La persona llega, escanea la posición, y escribe cuántas va a
 * guardar o a quitar. Nada más.
 *
 * Por eso esto no vive en `stock`: un pallet vacío no es producto, no tiene FEFO, no se
 * surte y no se despacha. Meterlo al saldo de inventario sólo habría ensuciado el motor de
 * ubicación y las consultas de existencia.
 */

create table if not exists returnable_count (
  location_id uuid primary key references location on delete restrict,
  qty integer not null default 0 check (qty >= 0),
  updated_at timestamptz not null default now()
);

-- Quién movió qué y cuándo. Un contador sin rastro es un número que nadie puede defender.
create table if not exists returnable_movement (
  id bigint generated always as identity primary key,
  location_id uuid not null references location on delete restrict,
  delta integer not null check (delta <> 0),
  qty_after integer not null check (qty_after >= 0),
  note text check (length(note) <= 200),
  occurred_at timestamptz not null default now(),
  actor_id uuid references auth.users on delete set null
);

create index if not exists returnable_movement_posicion
  on returnable_movement (location_id, occurred_at desc);

comment on table returnable_count is
  'Cuántos pallets vacíos o cuánto corrugado hay en una posición. Cuenta, no inventario.';

alter table returnable_count enable row level security;
alter table returnable_movement enable row level security;

create policy returnable_count_lectura on returnable_count
  for select to authenticated using (true);
create policy returnable_movement_lectura on returnable_movement
  for select to authenticated using (true);

/**
 * Suma o resta en una posición de retornables.
 *
 * Acepta el código de la posición o su código de barras, porque lo que la persona hace es
 * escanear la etiqueta que está pegada ahí.
 */
create or replace function contar_retornable(
  p_posicion text,
  p_delta integer,
  p_note text default null
) returns table (posicion text, uso text, quedan integer)
language plpgsql security definer set search_path = public as $$
declare
  v_loc record;
  v_antes integer;
  v_queda integer;
begin
  if not has_role('auxiliar', 'chequeador', 'montacargista', 'inventarios', 'supervisor', 'admin')
  then
    raise exception 'No tienes permiso para mover retornables';
  end if;

  if p_delta is null or p_delta = 0 then
    raise exception 'Escribe cuántas vas a guardar o a quitar';
  end if;

  select l.id, l.code, u.name as uso, u.holds_product, l.retired_at
  into v_loc
  from location l
  join location_usage u on u.code = l.usage_code
  where l.code = trim(p_posicion) or l.barcode = trim(p_posicion);

  if not found then
    raise exception 'No hay ninguna posición con el código %', trim(p_posicion);
  end if;
  if v_loc.retired_at is not null then
    raise exception 'La posición % está dada de baja', v_loc.code;
  end if;
  if v_loc.holds_product then
    raise exception 'La posición % guarda producto, no retornables', v_loc.code;
  end if;

  insert into returnable_count (location_id, qty) values (v_loc.id, 0)
  on conflict (location_id) do nothing;

  select qty into v_antes from returnable_count where location_id = v_loc.id for update;
  v_queda := v_antes + p_delta;

  if v_queda < 0 then
    raise exception 'En % hay %: no puedes quitar %', v_loc.code, v_antes, abs(p_delta);
  end if;

  update returnable_count set qty = v_queda, updated_at = now() where location_id = v_loc.id;

  insert into returnable_movement (location_id, delta, qty_after, note, actor_id)
  values (v_loc.id, p_delta, v_queda, nullif(trim(coalesce(p_note, '')), ''), auth.uid());

  return query select v_loc.code, v_loc.uso, v_queda;
end;
$$;

grant execute on function contar_retornable to authenticated;

/** Dónde están los retornables y cuántos hay. Las posiciones vacías también aparecen. */
create or replace view retornables as
  select
    l.id,
    l.code,
    l.usage_code,
    u.name as uso,
    coalesce(c.qty, 0) as cantidad,
    c.updated_at
  from location l
  join location_usage u on u.code = l.usage_code
  left join returnable_count c on c.location_id = l.id
  where not u.holds_product and l.retired_at is null;

grant select on retornables to authenticated;
