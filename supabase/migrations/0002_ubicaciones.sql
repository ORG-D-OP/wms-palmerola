create type zone_type as enum ('rack', 'floor', 'staging', 'dock', 'quarantine', 'returns');
create type location_type as enum (
  'floor_stack', 'rack_single', 'rack_double_deep', 'staging', 'dock', 'quarantine'
);
create type location_status as enum ('available', 'occupied', 'blocked', 'damaged');
create type abc_class as enum ('A', 'B', 'C');
create type dock_direction as enum ('inbound', 'outbound', 'both');

create table site (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (length(trim(code)) between 1 and 10),
  name text not null,
  created_at timestamptz not null default now()
);

create table zone (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references site on delete restrict,
  code text not null check (length(trim(code)) between 1 and 12),
  name text not null,
  kind zone_type not null,
  abc_class abc_class,
  unique (site_id, code)
);

-- Un carril agrupa las posiciones que se alcanzan por la misma cara. Si depth > 1 es LIFO:
-- para sacar el fondo hay que mover el frente, y eso cuesta maniobras extra.
create table lane (
  id uuid primary key default gen_random_uuid(),
  zone_id uuid not null references zone on delete restrict,
  code text not null check (length(trim(code)) between 1 and 24),
  depth smallint not null default 1 check (depth between 1 and 6),
  aisle_code text,
  unique (zone_id, code)
);

create table location (
  id uuid primary key default gen_random_uuid(),
  lane_id uuid not null references lane on delete restrict,
  code text not null unique check (length(trim(code)) between 1 and 32),
  barcode text not null unique,
  kind location_type not null,
  level smallint not null default 0 check (level between 0 and 12),
  depth_index smallint not null default 1 check (depth_index between 1 and 6),
  max_weight_kg numeric(8, 2) check (max_weight_kg > 0),
  max_height_mm integer check (max_height_mm > 0),
  max_pallets_stacked smallint check (max_pallets_stacked between 1 and 10),
  coord_x numeric(7, 2),
  coord_y numeric(7, 2),
  coord_z numeric(7, 2),
  pick_sequence integer,
  status location_status not null default 'available',
  retired_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index location_lane on location (lane_id);
create index location_status_idx on location (status) where retired_at is null;
create index location_pick_sequence on location (pick_sequence) where retired_at is null;

create trigger location_updated_at before update on location
for each row execute function set_updated_at();

create trigger location_audit after insert or update or delete on location
for each row execute function audit_changes();

create table dock_door (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references site on delete restrict,
  code text not null check (length(trim(code)) between 1 and 12),
  direction dock_direction not null,
  coord_x numeric(7, 2),
  coord_y numeric(7, 2),
  is_active boolean not null default true,
  unique (site_id, code)
);

alter table site enable row level security;
alter table zone enable row level security;
alter table lane enable row level security;
alter table location enable row level security;
alter table dock_door enable row level security;

create policy site_read on site for select to authenticated using (true);
create policy zone_read on zone for select to authenticated using (true);
create policy lane_read on lane for select to authenticated using (true);
create policy location_read on location for select to authenticated using (true);
create policy dock_door_read on dock_door for select to authenticated using (true);

create policy site_write on site for all to authenticated
  using (has_role('admin')) with check (has_role('admin'));
create policy zone_write on zone for all to authenticated
  using (has_role('admin')) with check (has_role('admin'));
create policy lane_write on lane for all to authenticated
  using (has_role('admin')) with check (has_role('admin'));
create policy dock_door_write on dock_door for all to authenticated
  using (has_role('admin')) with check (has_role('admin'));

-- El supervisor puede bloquear o liberar una posicion; crearlas o borrarlas es de admin.
create policy location_write_admin on location for all to authenticated
  using (has_role('admin')) with check (has_role('admin'));
create policy location_update_supervisor on location for update to authenticated
  using (has_role('supervisor')) with check (has_role('supervisor'));

grant select on site, zone, lane, location, dock_door to authenticated;
grant insert, update, delete on site, zone, lane, location, dock_door to authenticated;
