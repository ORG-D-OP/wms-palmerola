-- Un solo lugar para los numeros del almacen. Cambiar una altura, un nivel o un conteo
-- es editar una fila, no buscar el valor repartido por el codigo.
create table zone_spec (
  zone_id uuid primary key references zone on delete cascade,
  depth_columns smallint not null check (depth_columns > 0),
  bays smallint not null check (bays > 0),
  levels smallint not null default 1 check (levels between 1 and 12),
  lane_depth smallint not null default 1 check (lane_depth between 1 and 6),
  level_height_mm integer check (level_height_mm > 0),
  max_weight_kg numeric(8, 2) check (max_weight_kg > 0),
  max_pallets_stacked smallint check (max_pallets_stacked between 1 and 10),
  aisle_width_mm integer check (aisle_width_mm > 0),
  -- true mientras los numeros vengan de un calculo y no de una medicion en sitio.
  -- No se imprimen etiquetas de una zona provisional.
  is_provisional boolean not null default false,
  source text,
  constraint lane_depth_cabe_en_columnas check (depth_columns % lane_depth = 0)
);

alter table zone_spec enable row level security;

create policy zone_spec_read on zone_spec for select to authenticated using (true);
create policy zone_spec_write on zone_spec for all to authenticated
  using (has_role('admin')) with check (has_role('admin'));

grant select, insert, update, delete on zone_spec to authenticated;

-- La version de 0001 asumia que la clave se llama "id". Ahora recibe el nombre como argumento.
create or replace function audit_changes() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_key text := coalesce(tg_argv[0], 'id');
  v_new jsonb := case when tg_op = 'DELETE' then null else to_jsonb(new) end;
  v_old jsonb := case when tg_op = 'INSERT' then null else to_jsonb(old) end;
begin
  insert into audit_log (actor_id, table_name, record_id, action, old_value, new_value)
  values (auth.uid(), tg_table_name, coalesce(v_new, v_old) ->> v_key, tg_op, v_old, v_new);
  return coalesce(new, old);
end;
$$;

create trigger zone_spec_audit after insert or update or delete on zone_spec
for each row execute function audit_changes('zone_id');

-- Crea las posiciones que falten para una zona, a partir de su spec. Idempotente:
-- correrla de nuevo tras subir `levels` agrega solo los niveles nuevos.
create function generate_zone_locations(p_zone_code text) returns integer
language plpgsql security definer set search_path = public as $$
declare
  s record;
  v_lane uuid;
  v_lane_no integer;
  v_depth integer;
  v_bay integer;
  v_level integer;
  v_code text;
  v_created integer := 0;
begin
  select z.id as zone_id, z.code, sp.* into s
  from zone z join zone_spec sp on sp.zone_id = z.id
  where z.code = p_zone_code;

  if not found then
    raise exception 'La zona % no tiene parametros definidos', p_zone_code;
  end if;

  for v_lane_no in 1 .. (s.depth_columns / s.lane_depth) loop
    insert into lane (zone_id, code, depth)
    values (s.zone_id, s.code || '-L' || lpad(v_lane_no::text, 2, '0'), s.lane_depth)
    on conflict (zone_id, code) do update set depth = excluded.depth
    returning id into v_lane;

    for v_bay in 1 .. s.bays loop
      for v_level in 1 .. s.levels loop
        for v_depth in 1 .. s.lane_depth loop
          v_code := s.code
            || '-L' || lpad(v_lane_no::text, 2, '0')
            || '-B' || lpad(v_bay::text, 2, '0')
            || '-N' || v_level
            || '-P' || v_depth;

          insert into location (
            lane_id, code, barcode, kind, level, depth_index,
            max_weight_kg, max_height_mm, max_pallets_stacked
          )
          values (
            v_lane, v_code, v_code,
            (case when s.lane_depth > 1 then 'rack_double_deep' else 'rack_single' end)::location_type,
            v_level, v_depth,
            s.max_weight_kg, s.level_height_mm, s.max_pallets_stacked
          )
          on conflict (code) do nothing;

          v_created := v_created + 1;
        end loop;
      end loop;
    end loop;
  end loop;

  return v_created;
end;
$$;
