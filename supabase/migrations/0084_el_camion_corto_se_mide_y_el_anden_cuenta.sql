/**
 * La precisión de los despachos mentía en las dos direcciones, y el chequeador salía con el
 * turno entero improductivo. Los dos números son de los primeros que se miran.
 *
 * **La precisión.** Se calculaba con `ship_note is null`: «el campo de la razón sólo se llena
 * al cerrar un camión corto, así que vacío es completo». Un campo que significa dos cosas
 * —una nota y «salió corto»— se contamina solo, y se contaminó por los dos lados:
 *
 * - Por arriba, el cargador de datos de prueba le escribe nota a todos los pedidos que crea,
 *   así que `SINT-TAB010`, que salió con las 1,920 unidades que pedía, contaba **corto**.
 * - Por abajo, desde el PR 77 un camión sale corto **sin forzar** —cuando el chequeador baja
 *   la cantidad—, y por esa rama no se escribía nada: `SINT-TAB005` dejó 81 unidades en el
 *   andén 6 y el indicador lo habría contado completo.
 *
 * Así que la precisión deja de leer un campo de notas y se calcula con lo que de verdad pasó:
 * un camión está completo cuando **ninguna línea salió por debajo de lo que pedía**. Eso es un
 * dato, no una convención, y no hay forma de contaminarlo.
 */
create or replace function camion_completo(p_order_id uuid) returns boolean
language sql stable set search_path = public as $f$
  select not exists (
    select 1 from order_line l
    where l.order_id = p_order_id
      and coalesce(l.checked_qty_base, surtido_de_linea(l.id)) < l.qty_base
  );
$f$;

comment on function camion_completo is
  'Si el camión salió con todo lo que pedía: ninguna línea por debajo de su cantidad.';

grant execute on function camion_completo to authenticated;

create or replace view kpi_despacho_dia as
select
  (so.shipped_at at time zone reloj_de_bodega())::date as dia,
  count(*) as camiones,
  count(*) filter (where camion_completo(so.id)) as completos,
  sum((select count(*) from order_line l where l.order_id = so.id)) as lineas,
  sum((
    select count(*) from order_line l
    where l.order_id = so.id and l.checked_at is not null
  )) as chequeadas
from sales_order so
where so.shipped_at is not null
  and so.shipped_at >= now() - (kpi_dias_atras() || ' days')::interval
group by 1;

grant select on kpi_despacho_dia to authenticated;

/**
 * **Y el trabajo del andén.** `kpi_tarea` sólo cuenta filas de `task` terminadas, y el
 * chequeador no tiene ninguna: chequear una línea no crea tarea, recibir un pallet crea una de
 * **guardar**, que es de otro, y desde la 0083 no le cae ni un conteo. Un chequeador podía
 * pasarse ocho horas recibiendo camiones y el indicador decía **0 tareas, 100 % improductivo**,
 * justamente por hacer bien lo suyo.
 *
 * Su trabajo sí queda registrado, con nombre y hora: la línea chequeada guarda `checked_by` y
 * el movimiento de recibo guarda `actor_id`. Así que se cuenta, pero **como lo que es** —líneas
 * y pallets, no tareas ni minutos—: inventarle una duración para que el porcentaje se vea bien
 * sería maquillar el número, y el porcentaje de improductivo no se le aplica.
 */
create or replace view kpi_andenes as
select
  (l.checked_at at time zone reloj_de_bodega())::date as dia,
  l.checked_by as profile_id,
  count(*) as lineas_chequeadas,
  0::bigint as pallets_recibidos
from order_line l
where l.checked_by is not null
  and l.checked_at >= now() - (kpi_dias_atras() || ' days')::interval
group by 1, 2
union all
select
  (sm.occurred_at at time zone reloj_de_bodega())::date,
  sm.actor_id,
  0::bigint,
  count(distinct coalesce(sm.lpn_id::text, sm.id::text))
from stock_movement sm
where sm.type = 'RECEIPT'
  and sm.actor_id is not null
  and sm.occurred_at >= now() - (kpi_dias_atras() || ' days')::interval
group by 1, 2;

grant select on kpi_andenes to authenticated;

drop function if exists kpi_por_persona(date, date);

create or replace function kpi_por_persona(p_desde date default null, p_hasta date default null)
returns table (
  profile_id uuid,
  nombre text,
  rol user_role,
  tareas bigint,
  cajas numeric,
  horas_turno numeric,
  horas_trabajando numeric,
  improductivo_pct numeric,
  cajas_por_hora numeric,
  turnos_calculados bigint,
  lineas_chequeadas bigint,
  pallets_recibidos bigint
)
language plpgsql security definer set search_path = public as $f$
declare
  v_hasta date;
  v_desde date;
begin
  if not has_role('supervisor', 'admin', 'solo_lectura') then
    raise exception 'Los números de cada persona los ve el jefe de bodega';
  end if;

  v_hasta := coalesce(p_hasta, (now() at time zone reloj_de_bodega())::date);
  v_desde := coalesce(p_desde, v_hasta - 6);
  if v_hasta < v_desde then
    raise exception 'El rango de fechas está al revés';
  end if;

  return query
  with trabajo as (
    select k.assigned_to as id, count(*) as tareas, sum(k.cajas) as cajas,
           sum(k.minutos) / 60 as horas
    from kpi_tarea k
    where k.dia between v_desde and v_hasta
    group by k.assigned_to
  ),
  turnos as (
    select s.profile_id as id, sum(s.horas) as horas
    from kpi_turno_dia s
    where s.dia between v_desde and v_hasta
    group by s.profile_id
  ),
  calculados as (
    select sa.profile_id as id, count(*) as turnos
    from shift_assignment sa
    where sa.auto_closed
      and ((sa.started_at at time zone reloj_de_bodega())::date) between v_desde and v_hasta
    group by sa.profile_id
  ),
  anden as (
    select a.profile_id as id,
           sum(a.lineas_chequeadas) as lineas,
           sum(a.pallets_recibidos) as pallets
    from kpi_andenes a
    where a.dia between v_desde and v_hasta
    group by a.profile_id
  )
  select
    p.id,
    p.full_name,
    p.role,
    coalesce(t.tareas, 0),
    round(coalesce(t.cajas, 0), 1),
    round(coalesce(h.horas, 0), 1),
    round(coalesce(t.horas, 0), 1),
    -- Y a quien trabajó el andén sin una sola tarea no se le pone porcentaje: su trabajo no se
    -- mide en minutos de tarea, así que un 100 % de improductivo sería una cifra inventada.
    case when coalesce(h.horas, 0) > 0
          and not (coalesce(t.tareas, 0) = 0 and coalesce(d.lineas, 0) + coalesce(d.pallets, 0) > 0)
         then greatest(round(100 - coalesce(t.horas, 0) / h.horas * 100), 0) end,
    case when coalesce(h.horas, 0) > 0
         then round(coalesce(t.cajas, 0) / h.horas, 1) end,
    coalesce(c.turnos, 0),
    coalesce(d.lineas, 0),
    coalesce(d.pallets, 0)
  from profile p
  left join trabajo t on t.id = p.id
  left join turnos h on h.id = p.id
  left join calculados c on c.id = p.id
  left join anden d on d.id = p.id
  where t.id is not null or h.id is not null or d.id is not null
  order by coalesce(t.cajas, 0) desc, coalesce(d.lineas, 0) desc, p.full_name;
end;
$f$;

grant execute on function kpi_por_persona to authenticated;

/**
 * Y el camión que sale corto pide razón **siempre**, no sólo cuando se fuerza.
 *
 * Era el agujero de abajo del fallo: bajar la cantidad chequeada deja el camión corto sin pasar
 * por la rama del `p_forzar`, así que salía sin que nadie preguntara por qué. Ahora la pregunta
 * la hace la cantidad, no el botón: si alguna línea sale por debajo de lo que pedía, hace falta
 * decirlo.
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

  -- Corto es corto, lo fuerce quien lo fuerce: si alguna línea sale por debajo de lo que
  -- pedía, hace falta decir por qué. Antes esto sólo se preguntaba al forzar, y bajar la
  -- cantidad chequeada no pasa por ahí.
  if (p_forzar or not camion_completo(p_order_id))
     and coalesce(trim(p_nota), '') = '' then
    raise exception 'Este camión sale sin todo lo que pedía: hace falta decir por qué';
  end if;

  if p_forzar then
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
  end if;

  if coalesce(trim(p_nota), '') <> '' then
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

/**
 * Y la nota que el cargador de datos de prueba le puso a 26 pedidos se borra, que no la
 * escribió nadie en un andén: decía «Datos sintéticos» en la casilla donde va la razón por la
 * que un camión salió corto. Ya no afecta al indicador, pero sigue siendo una razón inventada
 * en la hoja de un camión.
 */
update sales_order set ship_note = null where ship_note in ('Datos sintéticos', 'Datos sinteticos');
