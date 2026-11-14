/**
 * Y el código que nadie conoce se dice así, no como un producto en blanco.
 *
 * `producto_por_codigo` devuelve nulo cuando el código no está en el maestro, y la comprobación
 * de la 0087 lo metía en el mensaje: «Escaneaste <NULL>. Esta tarea es de Ranchitas». Son dos
 * cosas distintas y la persona hace algo distinto con cada una: un código que no conocemos se
 * avisa al jefe, y un producto equivocado se devuelve y se busca el bueno.
 */
create or replace function comprobar_codigo_de_tarea(p_task_id uuid, p_codigo text)
returns void
language plpgsql stable security definer set search_path = public as $f$
declare
  v_esperado uuid;
  v_leido uuid;
begin
  select product_id into v_esperado from task where id = p_task_id;
  if v_esperado is null then
    raise exception 'La tarea no existe';
  end if;

  v_leido := producto_escaneado(p_task_id, p_codigo);

  if v_leido is null then
    raise exception 'No conozco el código %. Esta tarea es de %',
      trim(p_codigo),
      (select p.name from product p where p.id = v_esperado);
  end if;

  if v_leido is distinct from v_esperado then
    raise exception 'Escaneaste %. Esta tarea es de %',
      (select p.name from product p where p.id = v_leido),
      (select p.name from product p where p.id = v_esperado);
  end if;
end;
$f$;
