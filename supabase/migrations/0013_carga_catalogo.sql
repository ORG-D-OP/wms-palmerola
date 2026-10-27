-- El maestro de origen da el total de cajas por pallet, pero no el patron (cajas por cama
-- x camas). El total pasa a ser el dato obligatorio y el patron queda opcional; si vienen
-- los dos, tienen que cuadrar.
alter table pallet_config
  drop column cases_per_pallet,
  alter column cases_per_layer drop not null,
  alter column layers drop not null,
  add column cases_per_pallet integer not null default 1 check (cases_per_pallet > 0),
  add constraint patron_cuadra_con_total check (
    cases_per_layer is null or layers is null
    or cases_per_layer::integer * layers = cases_per_pallet
  );

alter table pallet_config alter column cases_per_pallet drop default;

-- Lo que el maestro de origen dice que es el codigo de la caja. No es un codigo activo:
-- se muestra como pista en la pantalla de asignacion y alguien lo confirma escaneando.
alter table product add column external_barcode_hint text;

-- Quien confirmo el codigo escaneando la caja real, y cuando.
alter table barcode
  add column verified_at timestamptz,
  add column verified_by uuid references auth.users on delete set null;

-- El cargador del catalogo corre con la llave de servicio desde la maquina de un
-- administrador. Se le da acceso solo a las tablas del catalogo.
grant select, insert, update on
  product, product_category, packaging_level, pallet_config, box_type
  to service_role;
grant select on uom to service_role;
