/**
 * Los mensajes de error se leen en el telefono del operario, asi que van bien escritos.
 * Tres se quedaron sin tilde al rehacer las funciones en 0024-0026.
 *
 * Se corrigen sobre la definicion que ya tiene la base, en lugar de volver a escribir
 * cuatro funciones completas: asi la correccion no puede arrastrar sin querer una version
 * vieja del cuerpo. Cada frase se reemplaza entera, no palabra por palabra.
 */
do $$
declare
  v_frases text[][] := array[
    ['Hace falta una sesion para', 'Hace falta una sesión para'],
    ['El producto esta % y no se puede recibir', 'El producto está % y no se puede recibir'],
    ['Motivo % no existe o esta inactivo', 'Motivo % no existe o está inactivo']
  ];
  v_frase text[];
  v_def text;
  r record;
begin
  foreach v_frase slice 1 in array v_frases loop
    for r in
      select p.oid
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and p.prokind = 'f'
        and position(v_frase[1] in pg_get_functiondef(p.oid)) > 0
    loop
      v_def := replace(pg_get_functiondef(r.oid), v_frase[1], v_frase[2]);
      execute v_def;
    end loop;
  end loop;
end $$;
