-- Posiciones de piso tomadas del plano A-2. Cada bloque viene numerado columnas x filas
-- y el producto cuadra con las posiciones pallet declaradas (2,765 en total).
-- Los racks no se siembran aqui: faltan las medidas del plano de racks.

insert into site (code, name) values ('PLM', 'Bodega Palmerola');

do $$
declare
  v_site uuid := (select id from site where code = 'PLM');
  v_zone uuid;
  v_lane uuid;
  b record;
  c integer;
  r integer;
  bloques constant jsonb := '[
    {"code": "F1", "name": "Piso superior izquierda", "cols": 25, "rows": 11},
    {"code": "F2", "name": "Piso superior derecha",   "cols": 34, "rows": 11},
    {"code": "F3", "name": "Piso media izquierda",    "cols": 33, "rows": 18},
    {"code": "F4", "name": "Piso media derecha",      "cols": 37, "rows": 17},
    {"code": "F5", "name": "Piso central",            "cols": 14, "rows": 19},
    {"code": "F6", "name": "Piso inferior izquierda", "cols": 25, "rows": 11},
    {"code": "F7", "name": "Piso inferior derecha",   "cols": 32, "rows": 11}
  ]'::jsonb;
begin
  for b in select * from jsonb_to_recordset(bloques) as x(code text, name text, cols int, rows int)
  loop
    insert into zone (site_id, code, name, kind)
    values (v_site, b.code, b.name, 'floor')
    returning id into v_zone;

    for c in 1 .. b.cols loop
      insert into lane (zone_id, code, depth)
      values (v_zone, b.code || '-' || lpad(c::text, 3, '0'), 1)
      returning id into v_lane;

      for r in 1 .. b.rows loop
        insert into location (lane_id, code, barcode, kind)
        values (
          v_lane,
          b.code || '-' || lpad(c::text, 3, '0') || '-' || lpad(r::text, 2, '0'),
          b.code || '-' || lpad(c::text, 3, '0') || '-' || lpad(r::text, 2, '0'),
          'floor_stack'
        );
      end loop;
    end loop;
  end loop;
end;
$$;

-- Direccion pendiente de confirmar en sitio: norte descarga, sur (lado de oficinas) carga.
insert into dock_door (site_id, code, direction)
select (select id from site where code = 'PLM'), 'AND-N-' || lpad(n::text, 2, '0'), 'inbound'
from generate_series(1, 15) as n;

insert into dock_door (site_id, code, direction)
select (select id from site where code = 'PLM'), 'AND-S-' || lpad(n::text, 2, '0'), 'outbound'
from generate_series(1, 14) as n;

insert into zone (site_id, code, name, kind)
select (select id from site where code = 'PLM'), z.code, z.name, z.kind
from (values
  ('PREP-N', 'Area de preparacion norte', 'staging'::zone_type),
  ('PREP-S', 'Area de preparacion sur',   'staging'),
  ('CUAR',   'Cuarentena',                'quarantine'),
  ('DEVOL',  'Devoluciones',              'returns')
) as z(code, name, kind);

do $$
declare
  n integer := (select count(*) from location);
begin
  if n <> 2765 then
    raise exception 'Se esperaban 2765 posiciones de piso y se crearon %', n;
  end if;
end;
$$;
