-- Los nombres de corrugado del maestro no caben en 10 caracteres sin chocar: «Corrugado
-- AD 38 ZO» y «Corrugado AD 38 ZCL» se cortaban al mismo codigo. El mas largo que hay es
-- «AD 40 OFERTA ESPECIAL», 21 caracteres ya normalizado.
alter table box_type drop constraint box_type_code_check;
alter table box_type add constraint box_type_code_check
  check (length(trim(code)) between 1 and 24);

-- Lo mismo con las categorias: el codigo es «SECTOR-GRUPO» y los grupos externos del
-- maestro son largos («CUIDADO_DEL_HOGAR-LAVAPLATOS_CREMA»). Cortarlos a 20 los chocaba.
alter table product_category drop constraint product_category_code_check;
alter table product_category add constraint product_category_code_check
  check (length(trim(code)) between 1 and 60);
