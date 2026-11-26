-- La carga inicial contaba movimientos y los llamaba pallets.
--
-- La pantalla cerraba con «157,258 pallets cargados hasta ahora» en una bodega de 5,605
-- posiciones cuyo techo medido son 5,283 pallets. Eran dos cosas a la vez:
--
--   1. Contaba filas de `stock_movement`, no matrículas. Un pallet que entró en varios
--      renglones contaba varias veces: 157,258 movimientos para 7,403 matrículas.
--   2. No distinguía la siembra de lo real. El motivo `CARGA_INICIAL` no lo escribe sólo la
--      función de la pantalla: también `scripts/datos-sinteticos.mjs` y
--      `scripts/existencia-de-sap.mjs`. Medido: 157,257 de los 157,258 van **sin actor**,
--      porque la siembra corre con la llave de servicio y no hay `auth.uid()`. El único con
--      actor es la única carga inicial que alguien hizo de verdad en una pantalla.
--
-- De ahí la cuenta: matrículas distintas, y sólo las que llevan el nombre de quien las cargó.
-- Así el contador no se envenena al resembrar la bodega, que es lo que va a pasar antes de
-- arrancar, cuando el libro mayor no se deja borrar.
--
-- Va como función porque PostgREST no sabe `count(distinct)`: el mismo camino que `planta()`.

create or replace function pallets_de_carga_inicial()
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select count(distinct m.lpn_id)::integer
  from stock_movement m
  where m.reason_code = 'CARGA_INICIAL'
    and m.actor_id is not null
    and m.lpn_id is not null;
$$;

comment on function pallets_de_carga_inicial() is
  'Matrículas distintas cargadas a mano desde /carga-inicial. Deja fuera la siembra, que no lleva actor.';

grant execute on function pallets_de_carga_inicial() to authenticated;
