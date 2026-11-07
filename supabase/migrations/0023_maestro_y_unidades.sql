-- El catalogo del DW (4,791 materiales de toda la empresa) se va. La bodega trabaja con
-- el maestro de materiales: 667 productos con DUN-14, medidas, peso y cajas por pallet.
-- Con `delete` y en orden, nunca con `truncate ... cascade`: `location` apunta a `task` por
-- el hueco apartado, y `task` apunta a `product`, asi que un truncate en cascada desde
-- product se lleva por delante las 5,610 posiciones del almacen. Con `delete`, si quedara
-- existencia o alguna tarea abierta, la carga falla en vez de borrar la bodega.
delete from barcode;
delete from product_label_profile;
delete from pallet_config;
delete from packaging_level;
delete from inbound_line;
delete from product;
delete from product_category;
delete from box_type;

/**
 * El codigo de material de Dinant es base de 5 digitos + separador + digito de variante:
 * 61244.4, 61244C4 y 61244P4 son el mismo producto en tres empaques distintos. Y los tres
 * comparten el mismo DUN-14, porque el DUN identifica al producto base, no a la variante.
 * Por eso la base y la variante viven en columnas: son lo que permite decidir si dos
 * materiales que escanean igual son de verdad el mismo producto.
 */
alter table product
  add column base_code text,
  add column variant text,
  add column sector text,
  add column units_label text;

create index product_base_code on product (base_code);

comment on column product.base_code is 'Los 5 primeros digitos del material: identifica al producto base';
comment on column product.variant is 'Separador y digito que distinguen el empaque: «.4», «C4», «P4», «/5», «_9»';
comment on column product.units_label is 'Como viene escrito el contenido en el nombre del maestro: «240s», «12s»';

-- Forma del empaque exterior, que no es lo mismo que el corrugado: una charola y una caja
-- pueden ser del mismo carton y se manejan distinto.
create table packaging_form (
  code text primary key,
  name text not null,
  sort_order integer not null default 100
);

insert into packaging_form (code, name, sort_order) values
  ('CAJA', 'Caja', 10),
  ('CHAROLA', 'Charola', 20),
  ('FARDO', 'Fardo', 30);

alter table product
  add column packaging_form_code text references packaging_form on delete restrict;

alter table packaging_form enable row level security;

create policy packaging_form_read on packaging_form for select to authenticated using (true);
create policy packaging_form_write on packaging_form for all to authenticated
  using (has_role('admin')) with check (has_role('admin'));

/**
 * Un DUN-14 repetido entre variantes del mismo producto base NO es un conflicto: es como
 * esta hecho el maestro. Conflicto es que el mismo codigo apunte a dos productos base
 * distintos, porque ahi el escaneo no se puede resolver ni preguntando.
 */
drop view product_readiness;
drop view barcode_conflict;

create view barcode_conflict as
  select
    b.code,
    count(distinct coalesce(p.base_code, p.sku)) as bases,
    count(distinct p.id) as productos
  from barcode b
  join packaging_level pl on pl.id = b.packaging_level_id
  join product p on p.id = pl.product_id
  group by b.code
  having count(distinct coalesce(p.base_code, p.sku)) > 1;

/**
 * Un producto esta listo para operarse cuando se puede recibir, ubicar y escanear.
 * El codigo compartido entre variantes dejo de descalificarlo; lo que descalifica es no
 * tener codigo, no tener medidas del corrugado o no saber cuantas cajas lleva el pallet.
 */
create view product_readiness as
  select
    p.id, p.sku, p.name, p.base_code,
    p.contamination_class is not null as tiene_clase,
    exists (
      select 1 from packaging_level pl
      where pl.product_id = p.id and pl.code = 'CASE'
        and pl.length_mm is not null and pl.width_mm is not null
        and pl.height_mm is not null and pl.gross_weight_g is not null
    ) as tiene_corrugado,
    exists (select 1 from pallet_config pc where pc.product_id = p.id) as tiene_estiba,
    exists (
      select 1 from barcode b
      join packaging_level pl on pl.id = b.packaging_level_id
      where pl.product_id = p.id and b.is_primary
    ) as tiene_codigo,
    not exists (
      select 1 from barcode b
      join packaging_level pl on pl.id = b.packaging_level_id
      join barcode_conflict bc on bc.code = b.code
      where pl.product_id = p.id
    ) as codigo_sin_conflicto,
    (
      select count(*) from barcode b
      join packaging_level pl on pl.id = b.packaging_level_id
      join barcode b2 on b2.code = b.code
      join packaging_level pl2 on pl2.id = b2.packaging_level_id
      where pl.product_id = p.id and pl2.product_id <> p.id
    ) > 0 as codigo_compartido
  from product p;

-- ---------------------------------------------------------------------------------------
-- Las cantidades, en unidades base
-- ---------------------------------------------------------------------------------------

/**
 * `stock.qty_base` guarda unidades base, que es lo que su nombre dice y lo que hace falta
 * para saber cuantas cajas completas y cuantas unidades sueltas hay. Antes guardaba cajas,
 * porque las pantallas pasaban cajas sin convertir: con eso, «cajas = qty / unidades por
 * caja» daba cualquier cosa.
 *
 * Las pantallas siguen pidiendo cajas, que es lo que el operario cuenta. La conversion
 * pasa aqui, una sola vez, con el factor del nivel de empaque.
 */
create function unidades_por(p_packaging_level_id uuid) returns numeric
language sql stable set search_path = public as $$
  select qty_base_units from packaging_level where id = p_packaging_level_id;
$$;

/** Cuantas cajas completas y cuantas unidades sueltas son una cantidad en unidades base. */
create function desglose(p_product_id uuid, p_qty numeric)
returns table (cajas integer, sueltas numeric, por_caja numeric)
language sql stable set search_path = public as $$
  with f as (
    select coalesce(
      (
        select qty_base_units from packaging_level
        where product_id = p_product_id and code = 'CASE'
      ),
      1
    ) as por_caja
  )
  select
    floor(p_qty / por_caja)::integer,
    p_qty - floor(p_qty / por_caja) * por_caja,
    por_caja
  from f;
$$;

grant execute on function unidades_por, desglose to authenticated;

-- ---------------------------------------------------------------------------------------
-- El detalle por pallet del documento de ingreso
-- ---------------------------------------------------------------------------------------

/**
 * El archivo de origen trae una fila por pallet con su matricula de Nest, su material, su
 * lote, su vencimiento y su cantidad. Con eso, recibir es escanear la etiqueta que el
 * pallet ya trae: el sistema no pregunta nada, porque ya lo sabe todo.
 */
create table inbound_pallet (
  id uuid primary key default gen_random_uuid(),
  doc_id uuid not null references inbound_doc on delete cascade,
  pallet_code text not null,
  product_id uuid not null references product on delete restrict,
  qty_cases numeric(12, 3) not null check (qty_cases > 0),
  lot text,
  expiry_date date,
  received_lpn_id uuid references lpn on delete set null,
  received_at timestamptz,
  unique (doc_id, pallet_code)
);

create index inbound_pallet_doc on inbound_pallet (doc_id);
create index inbound_pallet_code on inbound_pallet (pallet_code);

alter table inbound_pallet enable row level security;

create policy inbound_pallet_lectura on inbound_pallet for select to authenticated using (true);
create policy inbound_pallet_escritura on inbound_pallet for all to authenticated
  using (has_role('supervisor', 'admin'))
  with check (has_role('supervisor', 'admin'));

create trigger inbound_pallet_audit after insert or update or delete on inbound_pallet
  for each row execute function audit_changes();

-- El cargador de documentos de ingreso corre con la llave de servicio, igual que el del
-- catalogo: necesita escribir el documento y su detalle, nada mas.
grant select, insert, update on inbound_doc, inbound_line, inbound_pallet to service_role;
grant select on product, packaging_level to service_role;
grant select, insert, update on packaging_form to service_role;

-- El DUN-14 ahora viene en el maestro, asi que el cargador tambien escribe codigos. El
-- escaneo de confirmacion en la pantalla de productos sigue existiendo para los que no lo
-- traen y para los que hay que verificar contra la caja real.
grant select, insert, update on barcode to service_role;
