-- Trazabilidad hasta la caja, áreas funcionales y equipos.
--
-- Tres ideas cargan con todo:
--   1. El LPN se anida: pallet y caja son la misma entidad con padre. Si mañana aparece otro
--      nivel (el contenedor de afuera, la fila del pallet) no hay que tocar el esquema.
--   2. La identidad de la caja es opcional. El saldo cuelga del nivel más profundo que tenga
--      identidad, y de uno solo, nunca de dos: así no se duplica el inventario.
--   3. La estructura física (rack, piso) y la función (almacén, picking, calidad) son cosas
--      distintas, porque las áreas se mueven y la estructura no.

-- ---------------------------------------------------------------------------
-- 1. El LPN anidado
-- ---------------------------------------------------------------------------

alter table lpn
  add column parent_id uuid references lpn on delete restrict,
  add column level packaging_code not null default 'PALLET',
  add column source text not null default 'INTERNO'
    check (source in ('NEST', 'INTERNO', 'PROVISIONAL')),
  add constraint lpn_no_se_contiene check (parent_id is distinct from id);

create index lpn_parent_idx on lpn (parent_id) where parent_id is not null;

-- Un pallet lleva un solo producto, un solo lote y un solo vencimiento. Verificado sobre los
-- 10,527 pallets del archivo de origen: cero excepciones. Como `stock` es único por
-- (location, product, lpn, lot, expiry), basta con permitir una sola fila por LPN.
create unique index un_producto_por_lpn on stock (lpn_id) where lpn_id is not null;

-- Qué hay dentro de un LPN, a cualquier profundidad.
create or replace function lpn_contenido(p_lpn_id uuid)
returns table (lpn_id uuid, code text, level packaging_code, depth integer)
language sql stable set search_path = public as $$
  with recursive arbol as (
    select l.id, l.code, l.level, 0 as depth
    from lpn l where l.id = p_lpn_id
    union all
    select h.id, h.code, h.level, a.depth + 1
    from lpn h join arbol a on h.parent_id = a.id
  )
  select id, code, level, depth from arbol;
$$;

-- ---------------------------------------------------------------------------
-- 2. Áreas funcionales, separadas de la estructura física
-- ---------------------------------------------------------------------------

create table area_type (
  code text primary key check (length(trim(code)) between 2 and 20),
  name text not null,
  -- Sin posiciones, sin capacidad y sin límite de apilado: calidad, desguace, el contenedor
  -- de afuera y el cross-dock. Se sabe qué hay y de dónde salió, no dónde está.
  is_virtual boolean not null default false,
  -- Terminal: lo que entra no vuelve al inventario (desguace).
  is_terminal boolean not null default false,
  is_active boolean not null default true,
  sort_order smallint not null default 100
);

create table area (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references site on delete restrict,
  code text not null check (length(trim(code)) between 1 and 20),
  name text not null,
  type_code text not null references area_type on delete restrict,
  -- Las áreas virtuales se escanean completas, o se eligen de una lista. Las dos válidas.
  barcode text unique,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (site_id, code)
);

create table location_area (
  location_id uuid not null references location on delete cascade,
  area_id uuid not null references area on delete restrict,
  valid_from timestamptz not null default now(),
  valid_to timestamptz,
  primary key (location_id, valid_from),
  constraint vigencia_en_orden check (valid_to is null or valid_to > valid_from)
);

create unique index un_area_vigente_por_posicion
  on location_area (location_id) where valid_to is null;

-- ---------------------------------------------------------------------------
-- 3. Para qué sirve cada posición
-- ---------------------------------------------------------------------------

create table location_usage (
  code text primary key check (length(trim(code)) between 2 and 20),
  name text not null,
  -- En false el motor de ubicación ignora la posición y el saldo se lleva sólo por cantidad,
  -- sin límite de apilado: ramplas, corrugado, pallets vacíos.
  holds_product boolean not null default false,
  is_active boolean not null default true,
  sort_order smallint not null default 100
);

-- El catálogo se llena antes del alter: las 5,581 posiciones existentes toman el valor por
-- defecto en el mismo enunciado, y la clave foránea se valida en el acto.
insert into location_usage (code, name, holds_product, sort_order) values
  ('PRODUCTO',     'Guarda producto', true,  10),
  ('PALLET_VACIO', 'Guarda pallets vacíos', false, 20),
  ('CORRUGADO',    'Guarda corrugado de retorno', false, 30),
  ('RAMPLA',       'Guarda ramplas', false, 40);

alter table location
  add column usage_code text not null default 'PRODUCTO'
    references location_usage on delete restrict;

-- ---------------------------------------------------------------------------
-- 4. Las secciones del forecast son etiquetas con vigencia, no estructura
-- ---------------------------------------------------------------------------

create table tag (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (length(trim(kind)) between 2 and 20),
  code text not null check (length(trim(code)) between 1 and 20),
  name text not null,
  is_active boolean not null default true,
  unique (kind, code)
);

create table location_tag (
  location_id uuid not null references location on delete cascade,
  tag_id uuid not null references tag on delete restrict,
  valid_from timestamptz not null default now(),
  valid_to timestamptz,
  primary key (location_id, tag_id, valid_from),
  constraint tag_vigencia_en_orden check (valid_to is null or valid_to > valid_from)
);

create index location_tag_vigente_idx on location_tag (tag_id) where valid_to is null;

-- zone.abc_class queda obsoleto: el ABC cambia cada semana y no es estructura.
comment on column zone.abc_class is
  'Obsoleto desde 0021. El ABC vive en tag/location_tag, que tiene vigencia.';

-- ---------------------------------------------------------------------------
-- 5. Equipos, turnos y el reparto entre ingreso y despacho
-- ---------------------------------------------------------------------------

create table equipment_type (
  code text primary key check (length(trim(code)) between 2 and 24),
  name text not null,
  -- Hasta qué nivel alcanza. El de rack alcanza piso, así que la relación es de inclusión:
  -- el filtro va por alcance, nunca por nombre de rol.
  max_level smallint not null check (max_level between 0 and 12),
  is_active boolean not null default true
);

create table equipment (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (length(trim(code)) between 1 and 20),
  type_code text not null references equipment_type on delete restrict,
  is_active boolean not null default true
);

create table shift_assignment (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references profile on delete restrict,
  equipment_id uuid references equipment on delete restrict,
  -- Cuando coinciden ingreso y despacho la gente se reparte; la proporción es parámetro.
  flow text not null default 'BOTH' check (flow in ('INBOUND', 'OUTBOUND', 'BOTH')),
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  constraint turno_en_orden check (ended_at is null or ended_at > started_at)
);

create unique index un_turno_abierto_por_persona
  on shift_assignment (profile_id) where ended_at is null;

alter table task
  add column min_level smallint check (min_level between 0 and 12),
  add column flow text check (flow in ('INBOUND', 'OUTBOUND'));

alter table stock_movement
  add column equipment_id uuid references equipment on delete set null;

-- ---------------------------------------------------------------------------
-- 6. Empaque vendible y la etiqueta que todavía no está estandarizada
-- ---------------------------------------------------------------------------

-- Las ristras y las cajitas de 6 no se venden por unidad: sólo por ristra o por cajita.
alter table packaging_level
  add column is_sellable boolean not null default true;

create table product_label_profile (
  product_id uuid primary key references product on delete cascade,
  -- El interruptor del modelo: en true el saldo cuelga de la caja, en false del pallet.
  -- Se cambia solo el día que se estandaricen las etiquetas, sin migrar nada.
  has_unique_case_code boolean not null default false,
  has_lot boolean not null default false,
  has_expiry boolean not null default false,
  has_gtin boolean not null default false,
  assessed_at date,
  source text,
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- 7. Tipo de producto
-- ---------------------------------------------------------------------------

create table product_type (
  code text primary key check (length(trim(code)) between 2 and 20),
  name text not null,
  is_active boolean not null default true,
  sort_order smallint not null default 100
);

insert into product_type (code, name, sort_order) values
  ('NORMAL',     'Producto regular', 10),
  ('OFERTA',     'Promoción (3x2 y similares)', 20),
  ('MUESTRA',    'Muestra sin valor comercial', 30),
  ('RETORNABLE', 'Pallet o corrugado de retorno', 40);

alter table product
  add column type_code text not null default 'NORMAL'
    references product_type on delete restrict;

-- ---------------------------------------------------------------------------
-- 8. Documento de ingreso
-- ---------------------------------------------------------------------------

create table inbound_doc (
  id uuid primary key default gen_random_uuid(),
  -- La llave. Impresa en el Comprobante de Carga, junto a la lista de productos, y presente
  -- en 352 de 352 envíos despachados. Ver EVALUACION-TRAZABILIDAD.md §36.
  pedido text not null unique check (length(trim(pedido)) between 1 and 20),
  -- Texto opaco: trae letras y largos distintos. Nunca parsearlo para sacarle fecha ni placa.
  mix text,
  -- Cuando el reporte traiga la columna, esto habilita escanear el QR en vez de teclear.
  tabulado text,
  transporte text,
  entrega text,
  goods_issue text,
  origin_plant text,
  planned_at date,
  status text not null default 'EXPECTED'
    check (status in ('EXPECTED', 'ARRIVED', 'RECEIVING', 'CLOSED', 'CANCELLED')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table inbound_line (
  id uuid primary key default gen_random_uuid(),
  doc_id uuid not null references inbound_doc on delete cascade,
  line_no smallint not null check (line_no > 0),
  product_id uuid not null references product on delete restrict,
  qty_cases numeric(14, 3) not null check (qty_cases > 0),
  lot text check (length(trim(lot)) between 1 and 40),
  expiry_date date,
  unique (doc_id, line_no)
);

create index inbound_line_doc_idx on inbound_line (doc_id);

-- ---------------------------------------------------------------------------
-- 9. Catálogos iniciales
-- ---------------------------------------------------------------------------

insert into area_type (code, name, is_virtual, is_terminal, sort_order) values
  ('ALMACEN',     'Área almacén: sólo pallets completos', false, false, 10),
  ('PICKING',     'Área picking: pallets abiertos, cajas y unidades', false, false, 20),
  ('CALIDAD',     'Producto retenido por daño o condición', true,  false, 30),
  ('DESGUACE',    'Desarmado: sale del inventario', true,  true,  40),
  ('CONTENEDOR',  'Contenedor fuera del almacén', true,  false, 50),
  ('CROSSDOCK',   'Pasa del ingreso al despacho sin posición', true,  false, 60),
  ('RETORNABLES', 'Pallets vacíos y corrugado de retorno', false, false, 70);

insert into equipment_type (code, name, max_level) values
  ('MONTACARGA_RACK', 'Montacargas de rack: alcanza rack y piso', 4),
  ('MONTACARGA_PISO', 'Montacargas de piso', 0),
  ('TRANSPALETA',     'Transpaleta', 0);

-- El catálogo de motivos de calidad ya existe desde 0007 (DANADO, MOJADO, ROTO, GOLPEADO,
-- BLOQ_CAL...). Falta el definitivo que dé Calidad. Aquí sólo el motivo del reetiquetado:
-- cuando la caja vuelve de calidad con una etiqueta rehecha con el mismo código, lote y
-- vencimiento, la identidad se conserva y queda el rastro de que el papel cambió.
insert into reason_code (code, name, category, requires_note, requires_photo, sort_order) values
  ('REETIQUETADO', 'Etiqueta rehecha con el mismo codigo, lote y vencimiento',
                   'CALIDAD', false, false, 120)
on conflict (code) do nothing;

-- ---------------------------------------------------------------------------
-- 10. Seguridad y auditoría
-- ---------------------------------------------------------------------------

alter table area_type enable row level security;
alter table area enable row level security;
alter table location_area enable row level security;
alter table location_usage enable row level security;
alter table tag enable row level security;
alter table location_tag enable row level security;
alter table equipment_type enable row level security;
alter table equipment enable row level security;
alter table shift_assignment enable row level security;
alter table product_label_profile enable row level security;
alter table product_type enable row level security;
alter table inbound_doc enable row level security;
alter table inbound_line enable row level security;

do $$
declare
  t text;
  solo_admin constant text[] := array[
    'area_type', 'location_usage', 'product_type', 'equipment_type', 'tag'];
  supervisor constant text[] := array[
    'area', 'location_area', 'location_tag', 'equipment', 'shift_assignment',
    'product_label_profile', 'inbound_doc', 'inbound_line'];
begin
  foreach t in array solo_admin || supervisor loop
    execute format(
      'create policy %1$s_read on %1$s for select to authenticated using (true)', t);
  end loop;

  foreach t in array solo_admin loop
    execute format(
      'create policy %1$s_write on %1$s for all to authenticated
         using (has_role(''admin'')) with check (has_role(''admin''))', t);
  end loop;

  foreach t in array supervisor loop
    execute format(
      'create policy %1$s_write on %1$s for all to authenticated
         using (has_role(''supervisor'', ''admin''))
         with check (has_role(''supervisor'', ''admin''))', t);
  end loop;

  foreach t in array array['area', 'location_area', 'location_tag', 'equipment',
                           'shift_assignment', 'product_label_profile',
                           'inbound_doc', 'inbound_line'] loop
    execute format(
      'create trigger %1$s_audit after insert or update or delete on %1$s
         for each row execute function audit_changes()', t);
  end loop;
end $$;

create trigger inbound_doc_updated_at before update on inbound_doc
for each row execute function set_updated_at();

create trigger product_label_profile_updated_at before update on product_label_profile
for each row execute function set_updated_at();
