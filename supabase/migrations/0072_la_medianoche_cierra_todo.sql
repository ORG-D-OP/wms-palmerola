/**
 * «Por si no cierran jornada, pon que a todos se les cierra a las 12 de la noche.»
 *
 * El tope de horas (0070) sólo alcanza a quien entró temprano: el que entra a las dos de la
 * tarde no lo pasa hasta las dos de la mañana, y hasta entonces su turno sigue contando. La
 * medianoche es el corte duro, y a diferencia del tope **no perdona**: pasada, el turno se
 * cierra aunque la persona ande con una tarea en la mano y aunque acabe de dar señales. Nadie
 * arrastra un turno de un día de bodega al siguiente.
 *
 * Va dentro de la misma función y no en un segundo horario del reloj de la base, porque el
 * reloj de `pg_cron` corre en UTC y la medianoche que importa es la de la bodega
 * (`site.time_zone`). Calculándola aquí, cambiar la zona del sitio cambia la hora del corte
 * sin tocar nada más.
 *
 * La hora que queda apuntada sigue siendo la última señal de vida, como en la 0070: lo que la
 * medianoche garantiza es el cierre, no la hora. Si alguna vez hay turno de noche que cruza
 * las doce, esto hay que volver a mirarlo: partiría el turno en dos.
 */
create or replace function medianoche_de_su_dia(p_momento timestamptz) returns timestamptz
language sql stable set search_path = public as $f$
  -- La medianoche que cierra el día de bodega al que pertenece ese momento.
  select (((p_momento at time zone reloj_de_bodega())::date + 1)::timestamp)
         at time zone reloj_de_bodega();
$f$;

grant execute on function medianoche_de_su_dia to authenticated;

create or replace function cerrar_turnos_vencidos() returns integer
language plpgsql security definer set search_path = public as $f$
declare
  v_n integer := 0;
  v_turno record;
  v_hasta timestamptz;
begin
  for v_turno in
    select
      sa.id,
      sa.profile_id,
      sa.started_at,
      ultima_senal_de(sa.id) as ultima,
      medianoche_de_su_dia(sa.started_at) as medianoche,
      exists (
        select 1 from task t
        where t.assigned_to = sa.profile_id and t.status = 'IN_PROGRESS'
      ) as en_curso
    from shift_assignment sa
    where sa.ended_at is null
      and (
        sa.started_at + tope_de_turno() <= clock_timestamp()
        or medianoche_de_su_dia(sa.started_at) <= clock_timestamp()
      )
  loop
    if v_turno.medianoche > clock_timestamp() then
      -- Todavía es el mismo día de bodega: valen las guardas del tope.
      if v_turno.en_curso then
        continue;
      end if;
      if greatest(v_turno.started_at, v_turno.ultima)
         > clock_timestamp() - espera_antes_de_cerrar() then
        continue;
      end if;
      v_hasta := coalesce(v_turno.ultima, v_turno.started_at + tope_de_turno());
    else
      -- Pasó la medianoche de su día: se cierra sin más, y nunca más allá de esa medianoche.
      -- Sin rastro, el tope sigue mandando: de alguien que entró y no hizo nada no se puede
      -- decir que estuvo hasta las doce, sólo que no estuvo más de lo que dura un turno.
      v_hasta := least(
        v_turno.medianoche,
        coalesce(v_turno.ultima, v_turno.started_at + tope_de_turno())
      );
    end if;

    update shift_assignment
       set ended_at = v_hasta,
           auto_closed = true
     where id = v_turno.id;

    perform soltar_lo_de(v_turno.profile_id);
    v_n := v_n + 1;
  end loop;

  return v_n;
end;
$f$;
