/**
 * «1 cajas y 1 sueltas» no lo dice nadie.
 *
 * `texto_cajas` arma el texto que ven el surtidor, el contador y la pantalla de conteos, y lo
 * decía siempre en plural. Es el detalle que hace que un sistema parezca escrito por alguien
 * que nunca pisó la bodega.
 */
create or replace function texto_cajas(p_qty numeric, p_por_caja numeric) returns text
language sql immutable set search_path = public as $$
  with d as (
    select floor(p_qty / p_por_caja) as cajas, mod(p_qty, p_por_caja) as sueltas
  ),
  t as (
    select
      trim_scale(cajas) || case when cajas = 1 then ' caja' else ' cajas' end as en_cajas,
      trim_scale(sueltas) || case when sueltas = 1 then ' suelta' else ' sueltas' end as en_sueltas,
      cajas, sueltas
    from d
  )
  select case
    when cajas = 0 then en_sueltas
    when sueltas = 0 then en_cajas
    else en_cajas || ' y ' || en_sueltas
  end
  from t;
$$;
