-- Un camión con papeles que llega corto no lo podía cerrar nadie
--
-- Lo más grave de la quinta vuelta, y venía apuntado desde la primera: una vez que un camión
-- con lista de pallets queda a medias, **no hay forma de cerrarlo**. Probado a clic con la
-- cuenta de administrador, que tiene todos los permisos: en `/ingreso` el pedido 60211120 (1
-- de 30 desde el 13/11) ofrece exactamente dos cosas, «Dejarlo para después» y «Ver los 29
-- pallets que faltan». Cerrar no está.
--
-- En la base la única función de cerrar era `cerrar_ingreso_sin_aviso`, y empezaba por negarse:
--
--     if not v_doc.sin_aviso then
--       raise exception 'El ingreso % se cierra solo cuando entra el último pallet de la lista';
--
-- Que es verdad y es el problema: se cierra solo cuando entra el último, y si el último no
-- existe el camión se queda en RECEIVING para siempre, ocupando su andén en el sistema. La
-- única salida era terminar de recibirlo —la usé con el 60213838, que estaba a 3 de 8 y se
-- cerró solo al escanear los cinco que le faltaban—, y eso sirve cuando el producto aparece,
-- no cuando no llegó.
--
-- El camión corto es lo más normal del mundo. Así que el cierre se hace igual que el del
-- despacho, que ya tenía resuelto el mismo problema: `despachar(p_order_id, p_forzar, p_nota)`
-- deja salir el camión incompleto, exige decir por qué y lo guarda en `ship_note`. Aquí es
-- `cerrar_ingreso(p_pedido, p_forzar, p_nota)`, la razón queda en `cierre_nota`, y lo que no
-- llegó queda marcado pallet por pallet, que es lo que pidió el dueño de la bodega: «dejar los
-- pallets faltantes marcados como no llegados».

alter table inbound_doc add column if not exists cierre_nota text;

comment on column inbound_doc.cierre_nota is
  'Por qué se cerró el camión sin que bajara toda la lista. Igual que sales_order.ship_note.';

alter table inbound_pallet add column if not exists no_llego_at timestamptz;

comment on column inbound_pallet.no_llego_at is
  'Cuándo se dio por no llegado este pallet de la lista. Se marca al cerrar el camión corto.';

/**
 * Cerrar el camión, venga con papeles o sin ellos.
 *
 * Sustituye a `cerrar_ingreso_sin_aviso`, que sólo sabía de los camiones a ciegas. Un camión
 * recibido a ciegas no tiene lista contra la que faltar —cada pallet nace recibido—, así que
 * ahí `v_faltan` es cero y cierra sin más, igual que antes.
 *
 * Sin `p_forzar` no cierra un camión al que le falta lista: eso protege del cierre por
 * accidente del que todavía está descargando. Con `p_forzar` hace falta la razón, porque un
 * faltante sin explicación no se puede reclamar a planta.
 */
create or replace function cerrar_ingreso(
  p_pedido text,
  p_forzar boolean default false,
  p_nota text default null
)
returns inbound_doc
language plpgsql security definer set search_path = public as $f$
declare
  v_doc inbound_doc;
  v_total integer;
  v_hechos integer;
  v_faltan integer;
begin
  if not has_role('chequeador', 'supervisor', 'admin') then
    raise exception 'El acta del camión la cierra el que chequea el andén';
  end if;

  select * into v_doc from inbound_doc where id = ingreso_por_codigo(p_pedido) for update;
  if not found then
    raise exception 'No hay ningún ingreso con el código %', trim(p_pedido);
  end if;
  if v_doc.status = 'CLOSED' then
    raise exception 'El ingreso % ya está cerrado', v_doc.pedido;
  end if;
  if v_doc.status = 'CANCELLED' then
    raise exception 'El ingreso % está anulado', v_doc.pedido;
  end if;

  select count(*)::integer, count(received_at)::integer
  into v_total, v_hechos
  from inbound_pallet where doc_id = v_doc.id;

  v_faltan := v_total - v_hechos;

  if v_faltan > 0 and not p_forzar then
    raise exception
      'Al camión le faltan % pallets de la lista: termina de bajarlos o ciérralo con razón',
      v_faltan;
  end if;

  if v_faltan > 0 then
    if coalesce(trim(p_nota), '') = '' then
      raise exception 'Para cerrar un camión que llegó corto hace falta decir por qué';
    end if;

    -- Lo que no bajó queda marcado uno por uno, no en un número suelto: así se puede decir a
    -- planta qué matrícula no llegó, y el inventario no carga con lo que no entró.
    update inbound_pallet set no_llego_at = now()
    where doc_id = v_doc.id and received_at is null;

    update inbound_doc set cierre_nota = trim(p_nota) where id = v_doc.id;
  end if;

  update inbound_doc set status = 'CLOSED' where id = v_doc.id returning * into v_doc;
  return v_doc;
end;
$f$;

grant execute on function cerrar_ingreso(text, boolean, text) to authenticated;

-- La de antes no se queda al lado: sabía menos y se llamaba como si el caso a ciegas fuera
-- otro mundo, cuando es el mismo cierre con cero faltantes.
drop function if exists cerrar_ingreso_sin_aviso(text);

/**
 * Los camiones que están abiertos ahora mismo.
 *
 * `/ingreso` era una caja de escaneo y nada más: para seguir con un camión a medias había que
 * saberse de memoria el pedido de ocho cifras. `ingreso_en_curso` resolvió el del que lo
 * dejó, y éste resuelve el del compañero que se fue a almorzar.
 *
 * Y de paso el otro aviso que falta: cinco camiones estuvieron a la vez en el andén 9 sin que
 * nadie se queje. Un andén es un sitio donde cabe **un** camión, así que la pantalla cuenta
 * cuántos tiene cada uno. No lo impide: un camión abierto de ayer no puede dejar el andén
 * muerto hoy, y el que decide si hay dos camiones ahí es el que los está viendo.
 */
create or replace view ingresos_abiertos as
  select
    d.pedido,
    d.sin_aviso,
    dd.code as anden,
    count(p.id)::integer as pallets,
    count(p.received_at)::integer as recibidos,
    greatest(d.updated_at, max(p.received_at)) as ultimo,
    coalesce(
      d.dock_door_id = (
        select sa.dock_door_id from shift_assignment sa
        where sa.profile_id = auth.uid() and sa.ended_at is null
      ),
      false
    ) as de_mi_anden
  from inbound_doc d
  left join dock_door dd on dd.id = d.dock_door_id
  left join inbound_pallet p on p.doc_id = d.id
  where d.status = 'RECEIVING'
  group by d.id, d.pedido, d.sin_aviso, dd.code, d.updated_at, d.dock_door_id;

grant select on ingresos_abiertos to authenticated;
