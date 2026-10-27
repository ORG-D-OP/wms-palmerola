update reason_code set name = 'Devolución de cliente' where code = 'DEVOL_CLI';
update reason_code set name = 'Dañado en manipulación' where code = 'DANADO';
update reason_code set name = 'Pérdida desconocida' where code = 'PERDIDA';

update zone set name = 'Área de preparación norte' where code = 'PREP-N';
update zone set name = 'Área de preparación sur' where code = 'PREP-S';
update zone set name = 'Racks de abarrotes' where code = 'R-ABA';

update uom set name = 'Galón' where code = 'GLL';
update pallet_type set name = 'Estándar 1.00 x 1.20 m' where code = 'STD';

-- Los mensajes de las funciones son los que lee el operario en el escáner. Se corrigen
-- reescribiendo cada funcion a partir de su propia definicion, frase por frase, para no
-- tener que repetir los cuerpos completos y arriesgar una diferencia.
do $$
declare
  f record;
  def text;
  nuevo text;
  frases text[][] := array[
    ['Hace falta una sesion para recibir', 'Hace falta una sesión para recibir'],
    ['Hace falta una sesion para tomar trabajo', 'Hace falta una sesión para tomar trabajo'],
    ['El producto esta % y no se puede recibir', 'El producto está % y no se puede recibir'],
    ['El pallet % ya esta en el sistema%', 'El pallet % ya está en el sistema%'],
    ['La tarea ya empezo o esta cerrada', 'La tarea ya empezó o está cerrada'],
    ['Ese no es el pallet de esta tarea. Buscas el %', 'Ese no es el pallet de esta tarea. El correcto es el %'],
    ['No existe la posicion %', 'No existe la posición %'],
    ['La posicion % no esta disponible', 'La posición % no está disponible'],
    ['La posicion % esta apartada para otra tarea', 'La posición % está apartada para otra tarea'],
    ['No tienes permiso para asignar codigos', 'No tienes permiso para asignar códigos'],
    ['El codigo es demasiado corto', 'El código es demasiado corto'],
    ['Ese codigo ya esta asignado al producto %', 'Ese código ya está asignado al producto %'],
    ['La tarea no esta asignada a ti o ya empezo', 'La tarea no está asignada a ti o ya empezó'],
    ['La zona % no tiene parametros definidos', 'La zona % no tiene parámetros definidos'],
    ['El libro mayor es inmutable: % no esta permitido sobre stock_movement',
     'El libro mayor es inmutable: % no está permitido sobre stock_movement'],
    ['Motivo % no existe o esta inactivo', 'Motivo % no existe o está inactivo']
  ];
  i integer;
begin
  for f in
    select p.oid
    from pg_proc p
    where p.pronamespace = 'public'::regnamespace and p.prokind = 'f'
  loop
    def := pg_get_functiondef(f.oid);
    nuevo := def;
    for i in 1 .. array_length(frases, 1) loop
      nuevo := replace(nuevo, frases[i][1], frases[i][2]);
    end loop;
    if nuevo <> def then
      execute nuevo;
    end if;
  end loop;
end;
$$;
