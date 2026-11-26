/**
 * Lo que uno trae entre manos no se pierde al salir de la pantalla.
 *
 * Dicho por José el 25/11/2026: «en ingreso si meto un pedido sale bien, pero si me voy a
 * tablero y luego regreso, el pedido se va». Y lo mismo en despacho.
 *
 * El trabajo sí estaba guardado —los pallets recibidos están en la base desde el primer
 * escaneo—, pero **quién lo está haciendo y dónde** vivía sólo en el navegador: el documento
 * abierto era una variable de React y al desmontarse la pantalla se iba con ella. Al volver,
 * el sistema no tenía forma de saber qué camión era el suyo, así que pedía escanear otra vez.
 *
 * Guardar y surtir no tienen ese agujero porque la tarea sí tiene dueño en la base y
 * `claim_next_task` devuelve primero lo que la persona ya trae. El ingreso y el despacho no
 * son tareas de nadie: son el andén. Así que lo que hay que guardar es **en qué andén se está
 * descargando ese camión**, y con eso quien esté parado ahí lo retoma, lo haya abierto él o
 * su compañero. Que es, además, como funciona la bodega: el camión es del andén, no de la
 * persona.
 */

-- El andén donde se descarga el camión. Hasta el primer pallet recibido no se sabe: el ZRDN
-- no lo trae y SAP tampoco.
alter table inbound_doc add column if not exists dock_door_id uuid references dock_door (id);

comment on column inbound_doc.dock_door_id is
  'El andén donde se está descargando, puesto al recibir cada pallet.';

create index if not exists inbound_doc_dock_door_idx
  on inbound_doc (dock_door_id) where status = 'RECEIVING';

/**
 * El andén se anota solo al recibir.
 *
 * Va de disparador y no dentro de `recibir_del_documento` porque hay tres puertas de entrada
 * —del documento, sin aviso y el pallet mixto— y las tres acaban marcando el pallet como
 * recibido. En ese momento la existencia del pallet está en el andén, que es de donde se lee.
 *
 * Siempre el último: un camión que se cambia de andén se lo lleva con él.
 */
create or replace function anotar_anden_del_ingreso() returns trigger
language plpgsql security definer set search_path = public as $f$
begin
  update inbound_doc d
  set dock_door_id = coalesce(
    (
      select dd.id
      from stock s
      join location l on l.id = s.location_id
      join dock_door dd on l.code = 'STG-' || dd.code
      where s.lpn_id = new.received_lpn_id
      limit 1
    ),
    d.dock_door_id
  )
  where d.id = new.doc_id;

  return new;
end;
$f$;

drop trigger if exists anotar_anden on inbound_pallet;

create trigger anotar_anden
after insert or update of received_lpn_id on inbound_pallet
for each row when (new.received_lpn_id is not null)
execute function anotar_anden_del_ingreso();

/**
 * Los camiones que ya estaban a medias cuando esto se puso: su andén sale de la tarea de
 * guardar, que nace con el andén de donde se recoge el pallet. Sin esto habría que recibir un
 * pallet más para que el camión se dejara retomar.
 */
update inbound_doc d
set dock_door_id = ultimo.dock_door_id
from (
  select distinct on (p.doc_id) p.doc_id, dd.id as dock_door_id
  from inbound_pallet p
  join task t on t.lpn_id = p.received_lpn_id and t.type = 'PUTAWAY'
  join location l on l.id = t.from_location_id
  join dock_door dd on l.code = 'STG-' || dd.code
  where p.received_at is not null
  order by p.doc_id, p.received_at desc
) ultimo
where d.id = ultimo.doc_id and d.dock_door_id is null;

/**
 * El camión que esta persona está descargando ahora.
 *
 * Primero el de su andén, que es el caso de la bodega. Y si no tiene andén puesto —casi todos
 * entran a trabajo sin elegir ninguno—, el último que ella misma recibió: sin eso, quien no
 * está asignado a un andén seguiría perdiendo el pedido al salir de la pantalla.
 */
create or replace function ingreso_en_curso() returns text
language sql stable security definer set search_path = public as $f$
  select d.pedido
  from inbound_doc d
  where d.status = 'RECEIVING'
    and (
      d.dock_door_id = (
        select sa.dock_door_id from shift_assignment sa
        where sa.profile_id = auth.uid() and sa.ended_at is null
      )
      or exists (
        select 1 from inbound_pallet p
        join lpn l on l.id = p.received_lpn_id
        where p.doc_id = d.id and l.created_by = auth.uid()
      )
    )
  order by (select max(p.received_at) from inbound_pallet p where p.doc_id = d.id) desc nulls last
  limit 1;
$f$;

grant execute on function ingreso_en_curso to authenticated;

-- Quién escaneó la hoja y abrió el camión. Se anota solo, como el andén del ingreso.
alter table sales_order add column if not exists released_by uuid references profile (id);

comment on column sales_order.released_by is
  'Quién escaneó la hoja que abrió el camión y repartió el surtido.';

create or replace function anotar_quien_abrio() returns trigger
language plpgsql security definer set search_path = public as $f$
begin
  new.released_by := coalesce(new.released_by, auth.uid());
  return new;
end;
$f$;

drop trigger if exists anotar_quien_abrio on sales_order;

create trigger anotar_quien_abrio
before update of status on sales_order
for each row when (old.status = 'DRAFT' and new.status <> 'DRAFT')
execute function anotar_quien_abrio();

/**
 * El camión que esta persona está cargando ahora. Mismo criterio que el ingreso: el de su
 * andén primero, y si no, el último que ella misma abrió o chequeó —que es lo que salva a
 * quien entra a trabajo sin que el jefe le ponga andén, que son casi todos.
 *
 * El que todavía está en borrador no cuenta: sin andén no se ha abierto nada.
 */
create or replace function despacho_en_curso() returns uuid
language sql stable security definer set search_path = public as $f$
  with mio as (
    select sa.dock_door_id from shift_assignment sa
    where sa.profile_id = auth.uid() and sa.ended_at is null
  )
  select o.id
  from sales_order o
  where o.status in ('RELEASED', 'PICKING', 'PICKED')
    and (
      o.dock_door_id = (select dock_door_id from mio)
      or o.released_by = auth.uid()
      or exists (
        select 1 from order_line ol
        where ol.order_id = o.id and ol.checked_by = auth.uid()
      )
    )
  order by (o.dock_door_id = (select dock_door_id from mio)) desc nulls last,
           o.released_at desc nulls last
  limit 1;
$f$;

grant execute on function despacho_en_curso to authenticated;

/**
 * Dónde queda cada pallet del camión.
 *
 * Para el chequeador es con lo que pregunta y comprueba: el sistema reservó un hueco al
 * recibirlo y ahí es donde tiene que acabar. Sale de la tarea de guardar, que es la que lleva
 * el destino. Si esa tarea se canceló —el pallet se fue a crossdock, o lo soltó un
 * reinicio— entonces manda dónde está el pallet ahora, que es lo único cierto que queda.
 */
create or replace view inbound_detail as
select
  p.id,
  p.doc_id,
  d.pedido,
  p.pallet_code,
  p.qty_cases,
  p.lot,
  p.expiry_date,
  p.received_at,
  p.received_lpn_id,
  pr.id as product_id,
  pr.sku,
  pr.name,
  pr.base_code,
  bt.name as tipo_caja,
  destino.code as destino
from inbound_pallet p
join inbound_doc d on d.id = p.doc_id
join product pr on pr.id = p.product_id
left join packaging_level pl on pl.product_id = pr.id and pl.code = 'CASE'
left join box_type bt on bt.code = pl.box_type_code
left join lateral (
  select coalesce(
    (
      select l.code
      from task t
      join location l on l.id = t.to_location_id
      where t.lpn_id = p.received_lpn_id and t.type = 'PUTAWAY' and t.status <> 'CANCELLED'
      order by t.created_at desc
      limit 1
    ),
    (
      select l.code
      from stock s
      join location l on l.id = s.location_id
      where s.lpn_id = p.received_lpn_id and s.qty_base > 0
      limit 1
    )
  ) as code
) destino on true;

grant select on inbound_detail to authenticated;

/**
 * El andén del camión, para enseñarlo con el pedido. Es lo que contesta «¿en cuál andén está
 * este camión?» sin que nadie tenga que acordarse.
 */
create or replace view inbound_progress as
select
  d.id,
  d.pedido,
  d.status,
  d.planned_at,
  count(p.id)::integer as pallets,
  count(p.received_at)::integer as recibidos,
  count(distinct p.product_id)::integer as materiales,
  sum(p.qty_cases) as cajas,
  d.sin_aviso,
  d.nota,
  d.origin_plant,
  d.entrega,
  d.cajas_sap,
  (select count(*)::integer from inbound_line l where l.doc_id = d.id) as esperado_lineas,
  (select sum(l.qty_cases) from inbound_line l where l.doc_id = d.id) as esperado_cajas,
  (select dd.code from dock_door dd where dd.id = d.dock_door_id) as anden
from inbound_doc d
left join inbound_pallet p on p.doc_id = d.id
group by d.id;

grant select on inbound_progress to authenticated;
