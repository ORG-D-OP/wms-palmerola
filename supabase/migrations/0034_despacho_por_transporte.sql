/**
 * El despacho se abre escaneando, igual que el ingreso.
 *
 * El codigo de barras de la hoja de picking es el **numero de transporte**, y un mismo
 * transporte puede venir impreso en varias hojas: el caso real son tres tabulados del
 * transporte 3916464, separados por la linea «Denominacion». Esa separacion es del cliente,
 * no de la bodega: para nosotros mismo transporte es un solo despacho y se muestra todo
 * junto. Por eso `transporte` es unico y no se guarda la denominacion.
 *
 * `entregas` guarda los documentos que trae la hoja —«Documentos ( 02 ) 0314014533,
 * 0314015681»— para poder cruzar contra el papel cuando algo no cuadre.
 */
alter table sales_order
  add column if not exists transporte text
    check (transporte is null or length(trim(transporte)) between 1 and 20),
  add column if not exists entregas text[];

create unique index if not exists sales_order_transporte on sales_order (transporte)
  where transporte is not null;

comment on column sales_order.transporte is
  'Numero de transporte: lo que trae el codigo de barras del tabulado. Unico.';
comment on column sales_order.entregas is
  'Documentos impresos en la hoja. Para cruzar contra el papel, no para identificar.';

-- ---------------------------------------------------------------------------
-- Lo que el chequeador necesita ver de un camion
-- ---------------------------------------------------------------------------

create or replace view despacho_progreso as
  select
    o.id,
    o.code,
    o.transporte,
    o.entregas,
    o.customer,
    o.status,
    d.code as anden,
    count(ol.id)::integer as lineas,
    coalesce(sum(ol.qty_base), 0) as pedido,
    coalesce(
      (select sum(t.qty_base)
       from order_line l
       join allocation a on a.order_line_id = l.id
       join task t on t.id = a.task_id and t.status = 'DONE'
       where l.order_id = o.id),
      0
    ) as surtido,
    (select count(*)
     from order_line l
     join allocation a on a.order_line_id = l.id
     join task t on t.id = a.task_id and t.status not in ('DONE', 'CANCELLED')
     where l.order_id = o.id)::integer as pendientes
  from sales_order o
  left join dock_door d on d.id = o.dock_door_id
  left join order_line ol on ol.order_id = o.id
  group by o.id, d.code;

grant select on despacho_progreso to authenticated;

/** Un escaneo abre el camion: el codigo de barras trae el transporte, pero el pedido
 * tambien se puede teclear por su codigo, que es lo unico que hay mientras SAP no nos
 * mande el transporte. */
create or replace function buscar_despacho(p_codigo text) returns uuid
language sql stable security definer set search_path = public as $$
  select id
  from sales_order
  where transporte = trim(p_codigo) or code = trim(p_codigo)
  order by (transporte = trim(p_codigo)) desc
  limit 1;
$$;

grant execute on function buscar_despacho(text) to authenticated;

-- ---------------------------------------------------------------------------
-- Cerrar el camion
-- ---------------------------------------------------------------------------

/**
 * Nadie marcaba un pedido como surtido: el estado se quedaba en PICKING para siempre y
 * SHIPPED no lo ponia nadie. Esto cierra la primera mitad, cuando ya no queda tarea viva.
 */
create or replace function marcar_pedido_surtido() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update sales_order o set status = 'PICKED'
  where o.status in ('RELEASED', 'PICKING')
    and exists (
      select 1 from order_line l join allocation a on a.order_line_id = l.id
      where l.order_id = o.id and a.task_id = new.id
    )
    and not exists (
      select 1
      from order_line l
      join allocation a on a.order_line_id = l.id
      join task t on t.id = a.task_id
      where l.order_id = o.id and t.status not in ('DONE', 'CANCELLED')
    );
  return null;
end;
$$;

drop trigger if exists task_cierra_pedido on task;
create trigger task_cierra_pedido
  after update of status on task
  for each row when (new.type = 'PICK' and new.status = 'DONE')
  execute function marcar_pedido_surtido();

/** La segunda mitad: el camion cargado y afuera. No se cierra con tareas pendientes. */
create or replace function despachar(p_order_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_estado order_status;
  v_pendientes integer;
begin
  if not has_role('chequeador', 'supervisor', 'admin') then
    raise exception 'No tienes permiso para despachar';
  end if;

  select status into v_estado from sales_order where id = p_order_id;
  if v_estado is null then raise exception 'Ese pedido no existe'; end if;
  if v_estado = 'SHIPPED' then raise exception 'Ese camión ya salió'; end if;
  if v_estado = 'CANCELLED' then raise exception 'Ese pedido está anulado'; end if;

  -- Sin liberar no hay tareas, y sin tareas la cuenta de pendientes da cero: un borrador
  -- pasaria el filtro de abajo y saldria sin que nadie lo surtiera.
  if v_estado = 'DRAFT' then
    raise exception 'Ese pedido todavía no se ha liberado a surtido';
  end if;

  select pendientes into v_pendientes from despacho_progreso where id = p_order_id;
  if coalesce(v_pendientes, 0) > 0 then
    raise exception 'Faltan % tareas de surtido por terminar', v_pendientes;
  end if;

  update sales_order set status = 'SHIPPED', shipped_at = now() where id = p_order_id;
end;
$$;

grant execute on function despachar(uuid) to authenticated;
