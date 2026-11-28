-- La etiqueta de pallet que imprime el WMS
--
-- Los pallets que llegan de planta traen la etiqueta de Nest y con ella se escanean. Los que
-- llegan a granel —cajas sueltas que alguien arma en el andén— no traen nada, y hasta hoy el
-- sistema les ponía matrícula propia (`matricula_wms_seq`, desde la 0035) que **nadie podía
-- leer**: no estaba impresa en ninguna parte. Un pallet así sólo se encuentra por la posición
-- donde quedó guardado, y en cuanto se mueve se pierde.
--
-- Medido el 28/11/2026 contra la Zebra ZD421 de la bodega: acepta ZPL por el puerto 9100 y
-- también por `POST /pstprnt` en el 80, y el contador de etiquetas subió en las dos pruebas.
-- Imprime 832 x 1224 puntos a 8 puntos/mm, que son los 104 x 153 mm del rollo que tiene puesto.
--
-- ---------------------------------------------------------------------------------------
-- Por qué una cola y no una llamada directa
-- ---------------------------------------------------------------------------------------
--
-- La aplicación corre en Vercel, fuera de la bodega, y la impresora tiene dirección privada:
-- un servidor en la nube no la alcanza nunca. Quien sí la alcanza es el teléfono que está en
-- la misma red, y por eso es el teléfono el que entrega el trabajo.
--
-- Eso deja el envío a merced de lo que el navegador permita, que es cosa de Chrome y puede
-- cambiar. La cola es lo que no cambia: el servidor arma el ZPL y lo guarda aquí, y entregarlo
-- es un paso aparte que se reintenta. Si mañana la entrega la hace otra cosa —un aparato en la
-- bodega, la propia impresora conectándose hacia afuera— se cambia quién consume la cola y no
-- se toca nada más. Y mientras tanto queda escrito qué se mandó a imprimir, cuándo y a quién
-- le falló, que es lo que hoy no se sabe de ninguna etiqueta.
--
-- La dirección de la impresora no está aquí ni en el repositorio, que es público: vive en la
-- configuración del despliegue, porque la misma dirección tiene que alimentar dos cosas que no
-- se pueden contradecir —a dónde manda el navegador y qué le deja la política de seguridad del
-- sitio—, y dos fuentes para un mismo dato acaban diciendo cosas distintas. Una sola, y en
-- configuración, que se cambia sin desplegar.

create type print_status as enum ('pendiente', 'impresa', 'fallida');

create table print_job (
  id bigint generated always as identity primary key,
  -- El pallet al que pertenece la etiqueta. De él cuelgan en `stock` el producto, el lote, el
  -- vencimiento y las cajas: eso es lo que la etiqueta vincula, y no hace falta copiarlo aquí.
  -- Va nulo en la etiqueta de prueba, que no es de ningún pallet.
  lpn_id uuid references lpn on delete set null,
  -- El ZPL tal cual se mandó. Guardado y no recalculado a propósito: una etiqueta reimpresa
  -- tiene que salir idéntica a la que ya está pegada en el pallet, aunque el saldo haya
  -- cambiado desde entonces.
  zpl text not null check (length(zpl) between 1 and 20000),
  -- Para la lista, que no va a cargar el ZPL entero de cada trabajo sólo para decir qué es.
  titulo text not null check (length(trim(titulo)) between 1 and 120),
  status print_status not null default 'pendiente',
  error text,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users on delete set null,
  printed_at timestamptz
);

create index print_job_recientes on print_job (created_at desc);
create index print_job_del_pallet on print_job (lpn_id) where lpn_id is not null;

alter table print_job enable row level security;

create policy print_job_read on print_job for select to authenticated using (true);
create policy print_job_write on print_job for all to authenticated
  using (has_role('auxiliar', 'chequeador', 'montacargista', 'supervisor', 'admin'))
  with check (has_role('auxiliar', 'chequeador', 'montacargista', 'supervisor', 'admin'));

grant select, insert, update, delete on print_job to authenticated;

-- Lo que la etiqueta dice de un pallet, en una sola fila.
--
-- Un pallet es de un producto, un lote y un vencimiento —comprobado en 10,527 pallets de
-- planta—, así que la etiqueta no lista nada: enseña lo que hay. La cantidad se suma porque el
-- mismo pallet puede tener saldo en más de una fila de `stock` si pasó por varias posiciones.
create or replace view etiqueta_de_pallet
with (security_invoker = true) as
select
  l.id as lpn_id,
  l.code as matricula,
  p.sku,
  p.name as producto,
  s.lot,
  s.expiry_date,
  sum(s.qty_base) as qty_base,
  max(pl.qty_base_units) as por_caja
from lpn l
join stock s on s.lpn_id = l.id and s.qty_base > 0
join product p on p.id = s.product_id
left join packaging_level pl on pl.product_id = p.id and pl.is_receipt_unit
group by l.id, l.code, p.sku, p.name, s.lot, s.expiry_date;

grant select on etiqueta_de_pallet to authenticated;

comment on view etiqueta_de_pallet is
  'Producto, lote, vencimiento y cajas de un pallet, para imprimir su etiqueta.';
