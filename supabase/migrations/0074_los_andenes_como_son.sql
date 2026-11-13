/**
 * Los andenes, como los separó la bodega de verdad.
 *
 * Los 29 que había —AND-N-01..15 de ingreso y AND-S-01..14 de despacho— eran una suposición
 * mía de la migración 0003. Son **24**, numerados del 1 al 24, y el 1 es el más próximo a las
 * oficinas. Los 1 al 14 están en la franja sur, junto a oficinas, y los 15 al 24 en la del
 * norte, donde la numeración va al revés: el 15 es el de la derecha del todo.
 *
 * Y no son «de ingreso» o «de despacho» a secas, que era la otra suposición: cada tramo tiene
 * su oficio.
 *
 *   1–4    despacho de mayoreo y súper
 *   5–8    despacho a cross
 *   9–14   recepción de snacks y abarrotería
 *   15     jaula de devoluciones
 *   16–17  recepción de jabones, que es el centro 3010
 *   18–24  inhabilitados
 *
 * El oficio es un dato y no una columna de sí o no, porque de él cuelga lo que la pantalla
 * ofrece: a quien va a recibir un camión no se le pueden ofrecer la jaula de devoluciones ni
 * los siete cerrados, y con la dirección sola no se distinguen —la jaula también es de
 * entrada—.
 *
 * La dirección deja de poder discrepar del oficio: la clave foránea es compuesta, así que un
 * andén de despacho no puede quedarse marcado de entrada ni al revés, y cambiarle la dirección
 * a un oficio se propaga sola. Los inhabilitados no tienen oficio, y por eso quedan en «both»:
 * no es que hagan las dos cosas, es que todavía no hacen ninguna.
 */
create table if not exists dock_purpose (
  code text primary key,
  name text not null,
  direction dock_direction not null,
  -- Si por ahí entran camiones. La jaula de devoluciones es de entrada y no recibe camiones.
  receives_trucks boolean not null default false,
  sort_order smallint not null default 0,
  unique (code, direction)
);

comment on table dock_purpose is
  'Para qué sirve cada andén. El jefe lo cambia sin pedirle nada a nadie.';

insert into dock_purpose (code, name, direction, receives_trucks, sort_order) values
  ('MAYOREO', 'Despacho de mayoreo y súper', 'outbound', false, 1),
  ('CROSSDOCK', 'Despacho a cross', 'outbound', false, 2),
  ('RECEPCION', 'Recepción de snacks y abarrotería', 'inbound', true, 3),
  ('JABONES', 'Recepción de jabones', 'inbound', true, 4),
  ('DEVOLUCIONES', 'Jaula de devoluciones', 'inbound', false, 5)
on conflict (code) do update set
  name = excluded.name,
  direction = excluded.direction,
  receives_trucks = excluded.receives_trucks,
  sort_order = excluded.sort_order;

alter table dock_purpose enable row level security;
drop policy if exists dock_purpose_read on dock_purpose;
create policy dock_purpose_read on dock_purpose for select to authenticated using (true);
grant select on dock_purpose to authenticated;

alter table dock_door add column if not exists purpose_code text;

alter table dock_door drop constraint if exists dock_door_purpose_fk;
alter table dock_door add constraint dock_door_purpose_fk
  foreign key (purpose_code, direction) references dock_purpose (code, direction)
  on update cascade;

comment on column dock_door.purpose_code is
  'Su oficio. Sin oficio es un andén que todavía no se usa.';

/**
 * Los cinco que sobran se van, y antes se comprueba que no cuelgue nada de ellos: de
 * `sales_order` y `wave` cuelga con `on delete restrict` y la base avisaría, pero el turno es
 * `on delete set null` y se borraría la asignación en silencio.
 */
do $sobran$
declare
  v_lio integer;
begin
  select count(*) into v_lio
  from dock_door d
  where d.code in ('AND-S-10', 'AND-S-11', 'AND-S-12', 'AND-S-13', 'AND-S-14')
    and (
      exists (select 1 from sales_order o where o.dock_door_id = d.id)
      or exists (select 1 from wave w where w.dock_door_id = d.id)
      or exists (select 1 from shift_assignment s where s.dock_door_id = d.id)
      or exists (
        select 1 from location l join stock s on s.location_id = l.id
        where l.code = 'STG-' || d.code and s.qty_base > 0
      )
    );
  if v_lio > 0 then
    raise exception 'De % de los andenes que sobran todavía cuelga trabajo o existencia', v_lio;
  end if;
end
$sobran$;

update location set retired_at = now()
where code in ('STG-AND-S-10', 'STG-AND-S-11', 'STG-AND-S-12', 'STG-AND-S-13', 'STG-AND-S-14')
  and retired_at is null;

delete from dock_door
where code in ('AND-S-10', 'AND-S-11', 'AND-S-12', 'AND-S-13', 'AND-S-14');

/**
 * Y el renumerado. Por cada andén hay **cuatro** cosas que renombrar, no una: el andén, su
 * carril de preparación, su posición y el código de barras de esa posición, que se sembró
 * igual al código y es por donde entra el escaneo en media bodega. Van primero las tres de la
 * posición, porque se unen al andén por `'STG-' || code` y en cuanto se renombre el andén esa
 * unión se pierde.
 */
/**
 * Y el renumerado. Por cada andén hay **cuatro** cosas que renombrar, no una: el andén, su
 * carril de preparación, su posición y el código de barras de esa posición, que se sembró
 * igual al código y es por donde entra el escaneo en media bodega.
 *
 * Las cuatro van en una sola sentencia, con los tres `update` colgando del mismo `with`. No es
 * por elegancia: los tres se unen al andén viejo por `'STG-' || code`, y en cuanto una de las
 * tablas quede renombrada esa unión se pierde. Dentro de un `with` los tres miran la misma
 * foto, así que ninguno ve el renombrado del otro y no hay orden que acertar.
 */
with r (viejo, nuevo, oficio, activo) as (values
  ('AND-S-01', 'AND-01', 'MAYOREO', true),
  ('AND-S-02', 'AND-02', 'MAYOREO', true),
  ('AND-S-03', 'AND-03', 'MAYOREO', true),
  ('AND-S-04', 'AND-04', 'MAYOREO', true),
  ('AND-S-05', 'AND-05', 'CROSSDOCK', true),
  ('AND-S-06', 'AND-06', 'CROSSDOCK', true),
  ('AND-S-07', 'AND-07', 'CROSSDOCK', true),
  ('AND-S-08', 'AND-08', 'CROSSDOCK', true),
  ('AND-N-01', 'AND-09', 'RECEPCION', true),
  ('AND-N-02', 'AND-10', 'RECEPCION', true),
  ('AND-N-03', 'AND-11', 'RECEPCION', true),
  ('AND-N-04', 'AND-12', 'RECEPCION', true),
  ('AND-N-05', 'AND-13', 'RECEPCION', true),
  ('AND-N-06', 'AND-14', 'RECEPCION', true),
  ('AND-N-07', 'AND-15', 'DEVOLUCIONES', true),
  ('AND-N-08', 'AND-16', 'JABONES', true),
  ('AND-N-09', 'AND-17', 'JABONES', true),
  ('AND-N-10', 'AND-18', null, false),
  ('AND-N-11', 'AND-19', null, false),
  ('AND-N-12', 'AND-20', null, false),
  ('AND-N-13', 'AND-21', null, false),
  ('AND-N-14', 'AND-22', null, false),
  ('AND-N-15', 'AND-23', null, false),
  ('AND-S-09', 'AND-24', null, false)
),
carriles as (
  update lane la set code = 'STG-' || r.nuevo
    from r where la.code = 'STG-' || r.viejo
  returning la.id
),
posiciones as (
  update location l
     set code = 'STG-' || r.nuevo,
         -- El de barras se sembró igual al código. Si alguien ya lo cambió a mano, se respeta.
         barcode = case when l.barcode = l.code then 'STG-' || r.nuevo else l.barcode end
    from r where l.code = 'STG-' || r.viejo
  returning l.id
),
puertas as (
  -- El oficio y la dirección entran juntos: la clave foránea compuesta no admite otra cosa.
  update dock_door d
     set code = r.nuevo,
         purpose_code = r.oficio,
         direction = coalesce(
           (select p.direction from dock_purpose p where p.code = r.oficio),
           'both'
         ),
         is_active = r.activo
    from r where d.code = r.viejo
  returning d.id
)
select
  (select count(*) from carriles) as carriles,
  (select count(*) from posiciones) as posiciones,
  (select count(*) from puertas) as puertas;

/** Y quien tuviera turno en uno que queda cerrado se queda sin andén, no con uno que no abre. */
update shift_assignment s
   set dock_door_id = null
 where exists (
   select 1 from dock_door d where d.id = s.dock_door_id and not d.is_active
 );

/**
 * Los andenes por donde entra un camión, que es lo que la pantalla de recibir tiene que
 * ofrecer. Antes lo resolvía filtrando `STG-AND-N-%` por el texto del código, que es lo que
 * había: con los andenes renumerados eso devuelve cero filas y la pantalla dice que no hay
 * andenes configurados. Y con la dirección sola tampoco sale, porque la jaula de devoluciones
 * también es de entrada y por ahí no entra ningún camión.
 */
create or replace view anden_de_recibo as
select
  l.id as location_id,
  d.id as dock_door_id,
  d.code as anden,
  p.code as oficio_code,
  p.name as oficio
from dock_door d
join dock_purpose p on p.code = d.purpose_code
join location l on l.code = 'STG-' || d.code and l.retired_at is null
where d.is_active and p.receives_trucks;

grant select on anden_de_recibo to authenticated;
