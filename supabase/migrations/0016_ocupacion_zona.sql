create view zone_occupancy as
select
  z.code,
  z.kind,
  count(l.id)::int as total,
  count(l.id) filter (
    where exists (select 1 from stock s where s.location_id = l.id and s.qty_base > 0)
  )::int as ocupadas
from zone z
join lane la on la.zone_id = z.id
join location l on l.lane_id = la.id and l.retired_at is null
group by z.code, z.kind;

grant select on zone_occupancy to authenticated;
