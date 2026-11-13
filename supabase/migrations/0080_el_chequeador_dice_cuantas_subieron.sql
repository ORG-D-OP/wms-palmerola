/**
 * Chequear era decir «sí», no decir «cuántas».
 *
 * Un escaneo marcaba la línea entera: se escaneaba una caja de Tostada y las 300 quedaban
 * dadas por arriba, sin que la pantalla le pusiera el número delante a nadie. El oficio del
 * chequeador es justamente ése —comprobar que la cantidad es la que dice la hoja—, así que lo
 * que hace ahora es confirmar el número o corregirlo.
 *
 * Y lo que confirma es lo que sale: `despachar` descuenta por línea **hasta lo chequeado**, no
 * todo lo surtido. Lo que no subió se queda donde está, en la posición del andén, con su
 * existencia intacta: nada de inventar una salida de algo que sigue en el piso.
 *
 * Sin corregir nada, todo sigue como estaba: al marcar la línea se apunta como chequeado todo
 * lo surtido, que es el caso normal. Sólo una corrección a mano baja la cantidad.
 */
alter table order_line add column if not exists checked_qty_base numeric;

alter table order_line drop constraint if exists order_line_checked_qty_no_negativa;
alter table order_line add constraint order_line_checked_qty_no_negativa
  check (checked_qty_base is null or checked_qty_base >= 0);

comment on column order_line.checked_qty_base is
  'Cuánto dijo el chequeador que subió de verdad al camión, en unidades base. Nulo: no se ha '
  'chequeado, y entonces sale todo lo surtido.';

/** Lo que de verdad bajó al andén de esa línea: lo surtido más lo que entró por crossdock. */
create or replace function surtido_de_linea(p_order_line_id uuid) returns numeric
language sql stable set search_path = public as $f$
  select coalesce((
    select sum(sm.qty_base) from allocation a
    join stock_movement sm on sm.task_id = a.task_id and sm.type = 'PICK'
    where a.order_line_id = p_order_line_id
  ), 0)
  + coalesce((
    select sum(c.qty_base) from order_crossdock c where c.order_line_id = p_order_line_id
  ), 0);
$f$;

grant execute on function surtido_de_linea to authenticated;

-- Devuelve una columna mas —la cantidad—, y eso no lo aguanta un `create or replace`.
drop function if exists verificar_linea(uuid, text);

create function verificar_linea(p_order_id uuid, p_codigo text)
returns table (linea smallint, sku text, nombre text, ya_estaba boolean, cajas numeric)
language plpgsql security definer set search_path = public as $f$
declare
  v_linea order_line;
  v_surtido numeric;
  v_repetida boolean := false;
begin
  if not has_role('auxiliar', 'chequeador', 'montacargista', 'supervisor', 'admin') then
    raise exception 'No tienes permiso para chequear el camión';
  end if;

  /**
   * De las líneas de este camión, la que lleva ese código y todavía no está marcada. Si todas
   * las que lo llevan ya están marcadas, se devuelve una para avisar de que se repitió.
   */
  select * into v_linea
  from order_line l
  where l.order_id = p_order_id
    and l.product_id in (select productos_por_codigo(p_codigo))
  order by (l.checked_at is not null), l.line_no
  limit 1;

  if not found then
    -- Distinguir el código que nadie conoce del que no va en este camión: son dos cosas.
    if not exists (select 1 from productos_por_codigo(p_codigo)) then
      raise exception 'No conozco el código %', trim(p_codigo);
    end if;
    raise exception 'Ese producto no va en este camión';
  end if;

  v_repetida := v_linea.checked_at is not null;
  v_surtido := surtido_de_linea(v_linea.id);

  if not v_repetida then
    if v_surtido <= 0 then
      raise exception 'De % no hay nada surtido todavía: no se puede chequear lo que no bajó',
        (select p.name from product p where p.id = v_linea.product_id);
    end if;

    -- Al marcarla se da por buena toda la cantidad que bajó. Corregirla es aparte, y a mano.
    update order_line
    set checked_at = now(), checked_by = auth.uid(), checked_qty_base = v_surtido
    where id = v_linea.id;
  end if;

  return query
    select v_linea.line_no, p.sku, p.name, v_repetida,
           coalesce(v_linea.checked_qty_base, v_surtido)
    from product p where p.id = v_linea.product_id;
end;
$f$;

grant execute on function verificar_linea to authenticated;

/**
 * La corrección: subieron menos cajas de las que bajaron al andén.
 *
 * Se recibe en **cajas**, que es como se cuenta un camión, y se guarda en unidades. Más de lo
 * que bajó no se puede cargar: eso no sería un chequeo, sería inventar producto. Y se puede
 * corregir mientras el camión no haya salido, porque el chequeador se equivoca igual que todos
 * y la pantalla tiene que dejarlo arreglar.
 */
create or replace function corregir_chequeo(p_order_line_id uuid, p_cajas numeric)
returns numeric
language plpgsql security definer set search_path = public as $f$
declare
  v_linea order_line;
  v_estado order_status;
  v_por_caja numeric;
  v_surtido numeric;
  v_base numeric;
begin
  if not has_role('chequeador', 'supervisor', 'admin') then
    raise exception 'La cantidad del chequeo la corrige el chequeador';
  end if;

  if p_cajas is null or p_cajas < 0 then
    raise exception 'Esa cantidad no se puede: escribe cuántas cajas subieron';
  end if;

  select * into v_linea from order_line where id = p_order_line_id for update;
  if not found then
    raise exception 'Esa línea del camión no existe';
  end if;

  select status into v_estado from sales_order where id = v_linea.order_id;
  if v_estado = 'SHIPPED' then
    raise exception 'Ese camión ya salió: la cantidad ya no se puede cambiar';
  end if;

  select coalesce(pl.qty_base_units, 1) into v_por_caja
  from packaging_level pl
  where pl.product_id = v_linea.product_id and pl.code = 'CASE';

  v_por_caja := coalesce(v_por_caja, 1);
  v_surtido := surtido_de_linea(p_order_line_id);
  v_base := p_cajas * v_por_caja;

  if v_base > v_surtido then
    raise exception 'De % sólo bajaron % al andén: no se puede cargar más de lo que hay',
      (select p.name from product p where p.id = v_linea.product_id),
      texto_cajas(v_surtido, v_por_caja);
  end if;

  update order_line
  set checked_qty_base = v_base,
      checked_at = coalesce(checked_at, now()),
      checked_by = coalesce(checked_by, auth.uid())
  where id = p_order_line_id;

  return v_base;
end;
$f$;

grant execute on function corregir_chequeo to authenticated;

/**
 * Y el camión sale con lo que el chequeador dijo que subió.
 *
 * El descuento va por línea, con un tope: lo chequeado. Se van consumiendo las piezas que
 * bajaron al andén hasta cubrirlo, y la última se parte si hace falta. Lo que sobre se queda
 * en la posición del andén tal como está, que es donde sigue estando de verdad.
 *
 * Sin corrección el tope es todo lo surtido, así que un camión normal sale igual que antes.
 */
create or replace function despachar(
  p_order_id uuid,
  p_forzar boolean default false,
  p_nota text default null
) returns void
language plpgsql security definer set search_path = public as $f$
declare
  v_estado order_status;
  v_pendientes integer;
  v_en_curso integer;
  v_linea uuid;
  v_resto numeric;
  v_cabe numeric;
  m record;
  a record;
begin
  if not has_role('chequeador', 'supervisor', 'admin') then
    raise exception 'No tienes permiso para despachar';
  end if;

  select status into v_estado from sales_order where id = p_order_id for update;
  if v_estado is null then raise exception 'Ese camión no existe'; end if;
  if v_estado = 'SHIPPED' then raise exception 'Ese camión ya salió'; end if;
  if v_estado = 'CANCELLED' then raise exception 'Ese camión está anulado'; end if;
  if v_estado = 'DRAFT' then
    raise exception 'Ese camión todavía no se ha abierto a surtido';
  end if;

  select pendientes into v_pendientes from despacho_progreso where id = p_order_id;

  if coalesce(v_pendientes, 0) > 0 and not p_forzar then
    raise exception 'Faltan % tareas de surtido por terminar', v_pendientes;
  end if;

  if falta_del_camion(p_order_id) > 0 and not p_forzar then
    raise exception 'Al camión le faltan % por apartar: reabastece picking o ciérralo con razón',
      trim_scale(falta_del_camion(p_order_id));
  end if;

  if p_forzar then
    if coalesce(trim(p_nota), '') = '' then
      raise exception 'Para cerrar un camión incompleto hace falta decir por qué';
    end if;

    select count(*) into v_en_curso
    from order_line l
    join allocation al on al.order_line_id = l.id
    join task t on t.id = al.task_id
    where l.order_id = p_order_id and t.status = 'IN_PROGRESS';

    if v_en_curso > 0 then
      raise exception 'Alguien anda surtiendo algo de este camión. Espera a que lo deje';
    end if;

    -- Lo apartado y no surtido se suelta: ese producto no se puede quedar reservado para un
    -- camión que ya se fue.
    for a in
      select al.id, al.stock_id, al.qty_base, al.task_id
      from order_line l
      join allocation al on al.order_line_id = l.id
      join task t on t.id = al.task_id
      where l.order_id = p_order_id and t.status in ('READY', 'ASSIGNED', 'BLOCKED')
    loop
      update stock set qty_allocated = greatest(qty_allocated - a.qty_base, 0)
      where id = a.stock_id;
      update task set status = 'CANCELLED' where id = a.task_id;
      delete from allocation where id = a.id;
    end loop;

    update sales_order set ship_note = trim(p_nota) where id = p_order_id;
  end if;

  for m in
    with piezas as (
      select
        l.id as order_line_id,
        'surtido-' || sm.id::text as clave,
        sm.product_id, sm.qty_base, sm.to_location_id, sm.lpn_id, sm.lot,
        sm.expiry_date, sm.packaging_level_id, sm.detached
      from order_line l
      join allocation a2 on a2.order_line_id = l.id and a2.task_id is not null
      join stock_movement sm on sm.task_id = a2.task_id and sm.type = 'PICK'
      where l.order_id = p_order_id
      union all
      select
        l.id,
        'xdock-' || c.id::text,
        c.product_id, c.qty_base, c.to_location_id, c.lpn_id, c.lot,
        c.expiry_date, null::uuid, null::boolean
      from order_line l
      join order_crossdock c on c.order_line_id = l.id
      where l.order_id = p_order_id
    )
    select
      p.order_line_id, p.clave, p.product_id, p.qty_base, p.to_location_id, p.lot,
      p.expiry_date, p.packaging_level_id,
      coalesce(
        (select l.checked_qty_base from order_line l where l.id = p.order_line_id),
        sum(p.qty_base) over (partition by p.order_line_id)
      ) as tope,
      case
        when coalesce(
          p.detached,
          -- Sin dato apuntado: se desprendió si en el andén no queda nada con esa matrícula.
          not exists (
            select 1 from stock s
            where s.location_id = p.to_location_id
              and s.product_id = p.product_id
              and s.lpn_id is not distinct from p.lpn_id
              and s.lot is not distinct from p.lot
              and s.expiry_date is not distinct from p.expiry_date
              and s.qty_base > 0
          )
        ) then null
        else p.lpn_id
      end as lpn_id
    from piezas p
    order by p.order_line_id, p.clave
  loop
    if v_linea is distinct from m.order_line_id then
      v_linea := m.order_line_id;
      v_resto := m.tope;
    end if;

    v_cabe := least(m.qty_base, greatest(v_resto, 0));

    if v_cabe > 0 then
      perform post_movement(
        'SHIP', m.product_id, v_cabe, m.to_location_id, null, m.lpn_id,
        m.lot, m.expiry_date, 'VENTA', null, m.packaging_level_id, null, null,
        'ship-' || m.clave
      );
      v_resto := v_resto - v_cabe;
    end if;
  end loop;

  update sales_order set status = 'SHIPPED', shipped_at = now() where id = p_order_id;
end;
$f$;
