/**
 * La subdivisión de los racks sale ahora de las cotas, no de un reparto supuesto.
 *
 * Abarrotes: los módulos dibujados son 2.39 + 5.03 + 5.03 + 2.39 con tres pasillos de
 * 3.20 m, que suman 24.44 m, exactamente el ancho disponible. Eso da 12 posiciones de
 * fondo. Con 16 bahías (19.00 m / 1.19 m por pallet), las 1,152 posiciones declaradas
 * solo cierran con 6 niveles.
 *
 * Snacks: seis módulos de 5.03 más uno de 2.39 con seis pasillos suman 51.77 m, de la
 * línea de F4 hasta 107.27 m, con la pared en 108. Eso da 26 de fondo, y con 16 bahías
 * las 1,664 declaradas cierran con 4 niveles.
 *
 * Los dos siguen marcados como provisionales hasta que llegue el plano de racks: si la
 * altura resulta otra, se cambia la fila y se vuelve a generar.
 */
delete from location l
using lane la, zone z
where l.lane_id = la.id and la.zone_id = z.id and z.code = 'R-ABA';

delete from lane la using zone z where la.zone_id = z.id and z.code = 'R-ABA';

update zone_spec sp
set depth_columns = 12, bays = 16, levels = 6,
    source = 'Cotas del plano A-2: 4 módulos en 24.44 m; 6 niveles es lo único que cierra 1,152'
from zone z
where z.id = sp.zone_id and z.code = 'R-ABA';

update zone_spec sp
set source = 'Cotas del plano A-2: 7 módulos en 51.77 m, 26 de fondo x 16 bahías x 4 niveles'
from zone z
where z.id = sp.zone_id and z.code = 'R-SNK';

select generate_zone_locations('R-ABA');

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
