create type lpn_status as enum ('active', 'consumed', 'cancelled');
create type movement_type as enum (
  'RECEIPT', 'PUTAWAY', 'PICK', 'MOVE', 'ADJUST', 'COUNT', 'SHIP', 'RETURN'
);
create type reason_category as enum (
  'VENTA', 'MERMA', 'SINIESTRO', 'CALIDAD', 'AJUSTE', 'TRASLADO', 'DEVOLUCION'
);

create table lpn (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (length(trim(code)) between 6 and 32),
  status lpn_status not null default 'active',
  created_at timestamptz not null default now(),
  created_by uuid references auth.users on delete set null
);

-- Los nombres y las reglas de cada motivo son datos: se editan desde /admin sin tocar codigo.
create table reason_code (
  code text primary key check (length(trim(code)) between 2 and 20),
  name text not null,
  description text,
  category reason_category not null,
  affects_inventory boolean not null default true,
  requires_photo boolean not null default false,
  requires_supervisor boolean not null default false,
  requires_note boolean not null default false,
  ledger_account text,
  is_active boolean not null default true,
  sort_order smallint not null default 100
);

-- Libro mayor: solo INSERT. Un trigger impide UPDATE y DELETE, y el hash encadenado
-- delata cualquier manipulacion hecha por fuera de la aplicacion.
create table stock_movement (
  id bigint generated always as identity primary key,
  occurred_at timestamptz not null default now(),
  type movement_type not null,
  product_id uuid not null references product on delete restrict,
  packaging_level_id uuid references packaging_level on delete restrict,
  qty_base numeric(14, 3) not null check (qty_base > 0),
  from_location_id uuid references location on delete restrict,
  to_location_id uuid references location on delete restrict,
  lpn_id uuid references lpn on delete restrict,
  lot text check (length(trim(lot)) between 1 and 40),
  expiry_date date,
  reason_code text references reason_code on delete restrict,
  note text check (length(note) <= 500),
  task_id uuid,
  actor_id uuid references auth.users on delete set null,
  device_id text,
  idempotency_key text unique,
  prev_hash text,
  hash text not null,
  constraint tiene_origen_o_destino check (from_location_id is not null or to_location_id is not null),
  constraint origen_distinto_de_destino check (from_location_id is distinct from to_location_id)
);

create index stock_movement_product on stock_movement (product_id, occurred_at desc);
create index stock_movement_from on stock_movement (from_location_id, occurred_at desc);
create index stock_movement_to on stock_movement (to_location_id, occurred_at desc);
create index stock_movement_lpn on stock_movement (lpn_id, occurred_at desc);

create function forbid_ledger_change() returns trigger
language plpgsql as $$
begin
  raise exception 'El libro mayor es inmutable: % no esta permitido sobre stock_movement', tg_op;
end;
$$;

create trigger stock_movement_inmutable before update or delete on stock_movement
for each row execute function forbid_ledger_change();

-- Saldo derivado. Se reconstruye entero desde stock_movement; si discrepa, manda el ledger.
create table stock (
  id uuid primary key default gen_random_uuid(),
  location_id uuid not null references location on delete restrict,
  product_id uuid not null references product on delete restrict,
  lpn_id uuid references lpn on delete restrict,
  lot text,
  expiry_date date,
  qty_base numeric(14, 3) not null check (qty_base >= 0),
  updated_at timestamptz not null default now(),
  unique nulls not distinct (location_id, product_id, lpn_id, lot, expiry_date)
);

create index stock_product on stock (product_id) where qty_base > 0;
create index stock_location on stock (location_id) where qty_base > 0;
create index stock_fefo on stock (product_id, expiry_date) where qty_base > 0;

-- Aplica un delta sobre el saldo de una ubicacion y nunca lo deja negativo.
create function apply_stock_delta(
  p_location_id uuid,
  p_product_id uuid,
  p_lpn_id uuid,
  p_lot text,
  p_expiry date,
  p_delta numeric
) returns void
language plpgsql as $$
declare
  v_qty numeric;
begin
  insert into stock (location_id, product_id, lpn_id, lot, expiry_date, qty_base)
  values (p_location_id, p_product_id, p_lpn_id, p_lot, p_expiry, 0)
  on conflict (location_id, product_id, lpn_id, lot, expiry_date) do nothing;

  select qty_base into v_qty
  from stock
  where location_id = p_location_id and product_id = p_product_id
    and lpn_id is not distinct from p_lpn_id
    and lot is not distinct from p_lot
    and expiry_date is not distinct from p_expiry
  for update;

  if v_qty + p_delta < 0 then
    raise exception 'Sin existencia suficiente: hay % y se piden %', v_qty, -p_delta
      using errcode = 'check_violation';
  end if;

  update stock set qty_base = v_qty + p_delta, updated_at = now()
  where location_id = p_location_id and product_id = p_product_id
    and lpn_id is not distinct from p_lpn_id
    and lot is not distinct from p_lot
    and expiry_date is not distinct from p_expiry;
end;
$$;

create function post_movement(
  p_type movement_type,
  p_product_id uuid,
  p_qty numeric,
  p_from_location_id uuid default null,
  p_to_location_id uuid default null,
  p_lpn_id uuid default null,
  p_lot text default null,
  p_expiry date default null,
  p_reason_code text default null,
  p_note text default null,
  p_packaging_level_id uuid default null,
  p_task_id uuid default null,
  p_device_id text default null,
  p_idempotency_key text default null
) returns bigint
language plpgsql security definer set search_path = public as $$
declare
  v_existing bigint;
  v_reason reason_code;
  v_prev text;
  v_hash text;
  v_id bigint;
begin
  if p_idempotency_key is not null then
    select id into v_existing from stock_movement where idempotency_key = p_idempotency_key;
    if found then
      return v_existing;
    end if;
  end if;

  if p_reason_code is not null then
    select * into v_reason from reason_code where code = p_reason_code and is_active;
    if not found then
      raise exception 'Motivo % no existe o esta inactivo', p_reason_code;
    end if;
    if v_reason.requires_note and coalesce(trim(p_note), '') = '' then
      raise exception 'El motivo % exige una nota', p_reason_code;
    end if;
  elsif p_type = 'ADJUST' then
    raise exception 'Un ajuste siempre lleva motivo';
  end if;

  -- Serializa la cadena de hash. Los movimientos son pocos por segundo, asi que no estorba.
  perform pg_advisory_xact_lock(hashtext('stock_movement_chain'));

  if p_from_location_id is not null then
    perform apply_stock_delta(
      p_from_location_id, p_product_id, p_lpn_id, p_lot, p_expiry, -p_qty
    );
  end if;

  if p_to_location_id is not null then
    perform apply_stock_delta(
      p_to_location_id, p_product_id, p_lpn_id, p_lot, p_expiry, p_qty
    );
  end if;

  select hash into v_prev from stock_movement order by id desc limit 1;

  v_hash := encode(
    sha256(convert_to(
      coalesce(v_prev, '') || p_type::text || p_product_id::text || p_qty::text
        || coalesce(p_from_location_id::text, '') || coalesce(p_to_location_id::text, '')
        || coalesce(p_lot, '') || coalesce(p_expiry::text, '') || coalesce(auth.uid()::text, ''),
      'utf8'
    )),
    'hex'
  );

  insert into stock_movement (
    type, product_id, packaging_level_id, qty_base, from_location_id, to_location_id,
    lpn_id, lot, expiry_date, reason_code, note, task_id, actor_id, device_id,
    idempotency_key, prev_hash, hash
  ) values (
    p_type, p_product_id, p_packaging_level_id, p_qty, p_from_location_id, p_to_location_id,
    p_lpn_id, p_lot, p_expiry, p_reason_code, p_note, p_task_id, auth.uid(), p_device_id,
    p_idempotency_key, v_prev, v_hash
  ) returning id into v_id;

  return v_id;
end;
$$;

-- Recorre el ledger y devuelve el primer movimiento cuya cadena no cuadra.
create function verify_ledger() returns table (first_broken_id bigint)
language sql stable as $$
  select m.id
  from stock_movement m
  left join lateral (
    select hash from stock_movement p where p.id < m.id order by p.id desc limit 1
  ) prev on true
  where m.prev_hash is distinct from prev.hash
  order by m.id
  limit 1;
$$;

alter table lpn enable row level security;
alter table reason_code enable row level security;
alter table stock_movement enable row level security;
alter table stock enable row level security;

create policy lpn_read on lpn for select to authenticated using (true);
create policy lpn_write on lpn for all to authenticated
  using (has_role('operador_recibo', 'supervisor', 'admin'))
  with check (has_role('operador_recibo', 'supervisor', 'admin'));

create policy reason_code_read on reason_code for select to authenticated using (true);
create policy reason_code_write on reason_code for all to authenticated
  using (has_role('admin')) with check (has_role('admin'));

create policy stock_read on stock for select to authenticated using (true);
create policy stock_movement_read on stock_movement for select to authenticated using (true);

grant select on stock, stock_movement to authenticated;
grant select, insert, update, delete on lpn, reason_code to authenticated;
grant execute on function post_movement to authenticated;
grant execute on function verify_ledger to authenticated;

-- Nadie escribe saldos ni asientos a mano: todo pasa por post_movement.
revoke insert, update, delete on stock, stock_movement from authenticated;

insert into reason_code (code, name, category, requires_photo, requires_supervisor, requires_note, sort_order) values
  ('VENTA',      'Venta',                      'VENTA',      false, false, false, 10),
  ('TRASLADO',   'Traslado entre bodegas',     'TRASLADO',   false, false, false, 20),
  ('DEVOL_CLI',  'Devolucion de cliente',      'DEVOLUCION', false, false, true,  30),
  ('DANADO',     'Danado en manipulacion',     'MERMA',      true,  true,  true,  40),
  ('MOJADO',     'Mojado',                     'SINIESTRO',  true,  true,  true,  50),
  ('ROTO',       'Roto',                       'MERMA',      true,  true,  true,  60),
  ('GOLPEADO',   'Golpeado',                   'MERMA',      true,  true,  true,  70),
  ('VENCIDO',    'Vencido',                    'CALIDAD',    false, true,  true,  80),
  ('BLOQ_CAL',   'Bloqueado por calidad',      'CALIDAD',    false, true,  true,  90),
  ('AJUSTE_CNT', 'Ajuste por conteo',          'AJUSTE',     false, true,  true,  100),
  ('PERDIDA',    'Perdida desconocida',        'MERMA',      false, true,  true,  110);
