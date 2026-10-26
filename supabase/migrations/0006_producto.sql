create type uom_kind as enum ('count', 'weight', 'volume', 'length');
create type packaging_code as enum ('UNIT', 'INNER', 'CASE', 'LAYER', 'PALLET');
create type product_status as enum ('active', 'blocked', 'discontinued');
create type contamination_class as enum ('ALIMENTO', 'QUIMICO', 'AROMATICO', 'NO_ALIMENTO');
create type weight_category as enum ('LIGERO', 'MEDIO', 'PESADO');
create type barcode_symbology as enum ('EAN13', 'EAN8', 'GTIN14', 'CODE128', 'INTERNO');

create table uom (
  code text primary key check (length(trim(code)) between 1 and 6),
  name text not null,
  kind uom_kind not null
);

-- Corrugados. Se llena con la carga del catalogo; el codigo viene del maestro de origen.
create table box_type (
  code text primary key check (length(trim(code)) between 1 and 10),
  name text not null,
  is_returnable boolean not null default false
);

create table pallet_type (
  code text primary key check (length(trim(code)) between 1 and 10),
  name text not null,
  length_mm integer not null check (length_mm > 0),
  width_mm integer not null check (width_mm > 0),
  height_mm integer not null check (height_mm > 0),
  tare_weight_g integer not null check (tare_weight_g >= 0)
);

create table product_category (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (length(trim(code)) between 1 and 20),
  name text not null,
  parent_id uuid references product_category on delete restrict
);

create table product (
  id uuid primary key default gen_random_uuid(),
  sku text not null unique check (length(trim(sku)) between 1 and 40),
  name text not null check (length(trim(name)) between 1 and 200),
  brand text,
  category_id uuid references product_category on delete restrict,
  base_uom text not null references uom on delete restrict,
  status product_status not null default 'active',

  contamination_class contamination_class,
  weight_category weight_category,
  is_fragile boolean not null default false,
  humidity_sensitive boolean not null default false,
  temp_min_c numeric(4, 1),
  temp_max_c numeric(4, 1),

  requires_fefo boolean not null default false,
  shelf_life_days integer check (shelf_life_days > 0),
  min_days_on_dispatch integer check (min_days_on_dispatch >= 0),

  external_source text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint temp_coherente check (temp_min_c is null or temp_max_c is null or temp_min_c <= temp_max_c),
  constraint vida_cubre_despacho check (
    min_days_on_dispatch is null or shelf_life_days is null or min_days_on_dispatch <= shelf_life_days
  )
);

-- Un nivel por forma de empaque: unidad, paquete interno, corrugado, cama y pallet.
-- qty_base_units es cuantas unidades base trae, que es la unica conversion que necesita el WMS.
create table packaging_level (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references product on delete cascade,
  code packaging_code not null,
  qty_base_units numeric(12, 3) not null check (qty_base_units > 0),
  box_type_code text references box_type on delete restrict,
  length_mm integer check (length_mm > 0),
  width_mm integer check (width_mm > 0),
  height_mm integer check (height_mm > 0),
  gross_weight_g numeric(12, 2) check (gross_weight_g > 0),
  net_weight_g numeric(12, 2) check (net_weight_g > 0),
  is_pick_unit boolean not null default false,
  is_receipt_unit boolean not null default false,
  unique (product_id, code),
  constraint neto_no_supera_bruto check (
    net_weight_g is null or gross_weight_g is null or net_weight_g <= gross_weight_g
  )
);

create unique index packaging_level_una_unidad_pick
  on packaging_level (product_id) where is_pick_unit;

-- Sin unique global a proposito: el maestro de origen trae codigos repetidos entre SKU.
-- La vista barcode_conflict los saca a la luz y el escaneo pide desambiguar.
create table barcode (
  id uuid primary key default gen_random_uuid(),
  packaging_level_id uuid not null references packaging_level on delete cascade,
  code text not null check (length(trim(code)) between 6 and 48),
  symbology barcode_symbology not null,
  is_primary boolean not null default false,
  created_at timestamptz not null default now(),
  unique (packaging_level_id, code)
);

create index barcode_code on barcode (code);

create unique index barcode_un_primario
  on barcode (packaging_level_id) where is_primary;

create table pallet_config (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references product on delete cascade,
  pallet_type_code text not null references pallet_type on delete restrict,
  cases_per_layer smallint not null check (cases_per_layer > 0),
  layers smallint not null check (layers > 0),
  cases_per_pallet integer generated always as (cases_per_layer::integer * layers) stored,
  total_height_mm integer check (total_height_mm > 0),
  total_weight_kg numeric(8, 2) check (total_weight_kg > 0),
  allows_stacking boolean not null default false,
  max_stack smallint check (max_stack between 1 and 10),
  is_default boolean not null default true,
  unique (product_id, pallet_type_code)
);

create unique index pallet_config_un_default
  on pallet_config (product_id) where is_default;

create view barcode_conflict as
select b.code, count(distinct p.id) as productos, array_agg(distinct p.sku) as skus
from barcode b
join packaging_level pl on pl.id = b.packaging_level_id
join product p on p.id = pl.product_id
group by b.code
having count(distinct p.id) > 1;

-- Un producto no se puede almacenar hasta tener lo que el motor de ubicacion necesita.
create view product_readiness as
select
  p.id,
  p.sku,
  p.name,
  (p.contamination_class is not null) as tiene_clase,
  exists (
    select 1 from packaging_level pl
    where pl.product_id = p.id and pl.code = 'CASE'
      and pl.length_mm is not null and pl.width_mm is not null
      and pl.height_mm is not null and pl.gross_weight_g is not null
  ) as tiene_corrugado,
  exists (select 1 from pallet_config pc where pc.product_id = p.id) as tiene_estiba,
  exists (
    select 1 from barcode b join packaging_level pl on pl.id = b.packaging_level_id
    where pl.product_id = p.id and b.is_primary
  ) as tiene_codigo,
  not exists (
    select 1 from barcode b
    join packaging_level pl on pl.id = b.packaging_level_id
    join barcode_conflict bc on bc.code = b.code
    where pl.product_id = p.id
  ) as codigo_sin_conflicto
from product p;

create trigger product_updated_at before update on product
for each row execute function set_updated_at();

create trigger product_audit after insert or update or delete on product
for each row execute function audit_changes();
create trigger packaging_level_audit after insert or update or delete on packaging_level
for each row execute function audit_changes();
create trigger barcode_audit after insert or update or delete on barcode
for each row execute function audit_changes();
create trigger pallet_config_audit after insert or update or delete on pallet_config
for each row execute function audit_changes();

alter table uom enable row level security;
alter table box_type enable row level security;
alter table pallet_type enable row level security;
alter table product_category enable row level security;
alter table product enable row level security;
alter table packaging_level enable row level security;
alter table barcode enable row level security;
alter table pallet_config enable row level security;

do $$
declare
  t text;
begin
  foreach t in array array[
    'uom', 'box_type', 'pallet_type', 'product_category',
    'product', 'packaging_level', 'barcode', 'pallet_config'
  ] loop
    execute format(
      'create policy %1$s_read on %1$s for select to authenticated using (true)', t
    );
    execute format(
      'create policy %1$s_write on %1$s for all to authenticated
         using (has_role(''admin'')) with check (has_role(''admin''))', t
    );
    execute format('grant select, insert, update, delete on %s to authenticated', t);
  end loop;
end;
$$;

grant select on barcode_conflict, product_readiness to authenticated;

insert into uom (code, name, kind) values
  ('ST', 'Pieza', 'count'),
  ('EA', 'Unidad', 'count'),
  ('CES', 'Caja', 'count'),
  ('DZ', 'Docena', 'count'),
  ('JGO', 'Juego', 'count'),
  ('KG', 'Kilogramo', 'weight'),
  ('KI', 'Kilo', 'weight'),
  ('LB', 'Libra', 'weight'),
  ('OZ', 'Onza', 'weight'),
  ('TO', 'Tonelada', 'weight'),
  ('L', 'Litro', 'volume'),
  ('GLL', 'Galon', 'volume'),
  ('FT', 'Pie', 'length');

insert into pallet_type (code, name, length_mm, width_mm, height_mm, tare_weight_g) values
  ('STD', 'Estandar 1.00 x 1.20 m', 1200, 1000, 145, 25000),
  ('EUR', 'Europeo 0.80 x 1.20 m', 1200, 800, 144, 25000);
