-- Parametros de las zonas ya sembradas. Aqui viven los numeros del plano A-2.
insert into zone_spec (zone_id, depth_columns, bays, levels, lane_depth, aisle_width_mm, source)
select z.id, s.cols, s.rows, 1, 1, 3200, 'Plano A-2'
from (values
  ('F1', 25, 11), ('F2', 34, 11), ('F3', 33, 18), ('F4', 37, 17),
  ('F5', 14, 19), ('F6', 25, 11), ('F7', 32, 11)
) as s(code, cols, rows)
join zone z on z.code = s.code;

insert into zone (site_id, code, name, kind)
select (select id from site where code = 'PLM'), r.code, r.name, 'rack'
from (values
  ('R-ABA', 'Racks abarrotes'),
  ('R-SNK', 'Racks snacks')
) as r(code, name);

-- depth_columns y bays salen de repartir las posiciones declaradas en el plano entre los
-- 4 niveles; lane_depth 2 es la doble profundidad. La altura por nivel y la carga por
-- larguero quedan nulas hasta tener el plano de racks: por eso is_provisional.
insert into zone_spec (
  zone_id, depth_columns, bays, levels, lane_depth, aisle_width_mm, is_provisional, source
)
select z.id, r.depth_columns, r.bays, 4, 2, 3200, true,
       'Derivado del total de posiciones del plano A-2; falta el plano de racks'
from (values
  ('R-ABA', 18, 16),
  ('R-SNK', 26, 16)
) as r(code, depth_columns, bays)
join zone z on z.code = r.code;

select generate_zone_locations('R-ABA');
select generate_zone_locations('R-SNK');

do $$
declare
  n_aba integer;
  n_snk integer;
begin
  select count(*) into n_aba from location l
    join lane la on la.id = l.lane_id join zone z on z.id = la.zone_id where z.code = 'R-ABA';
  select count(*) into n_snk from location l
    join lane la on la.id = l.lane_id join zone z on z.id = la.zone_id where z.code = 'R-SNK';

  if n_aba <> 1152 or n_snk <> 1664 then
    raise exception 'Racks: se esperaban 1152 y 1664 y hay % y %', n_aba, n_snk;
  end if;
end;
$$;
