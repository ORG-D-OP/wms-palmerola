-- Asignar un codigo nuevo tiene que desplazar al anterior: un empaque solo puede tener
-- uno principal, y la version de 0014 chocaba con esa restriccion.
create or replace function assign_barcode(
  p_product_id uuid,
  p_code text,
  p_packaging_code packaging_code default 'CASE',
  p_symbology barcode_symbology default 'GTIN14'
) returns barcode
language plpgsql security definer set search_path = public as $$
declare
  v_code text := trim(p_code);
  v_level uuid;
  v_ajeno text;
  v_barcode barcode;
begin
  if not has_role('inventarios', 'supervisor', 'admin') then
    raise exception 'No tienes permiso para asignar codigos';
  end if;

  if length(v_code) < 6 then
    raise exception 'El codigo es demasiado corto';
  end if;

  select pl.id into v_level
  from packaging_level pl
  where pl.product_id = p_product_id and pl.code = p_packaging_code;

  if not found then
    raise exception 'El producto no tiene empaque %', p_packaging_code;
  end if;

  select p.sku into v_ajeno
  from barcode b
  join packaging_level pl on pl.id = b.packaging_level_id
  join product p on p.id = pl.product_id
  where b.code = v_code and p.id <> p_product_id
  limit 1;

  if found then
    raise exception 'Ese codigo ya esta asignado al producto %', v_ajeno;
  end if;

  update barcode set is_primary = false
  where packaging_level_id = v_level and is_primary and code <> v_code;

  insert into barcode (packaging_level_id, code, symbology, is_primary, verified_at, verified_by)
  values (v_level, v_code, p_symbology, true, now(), auth.uid())
  on conflict (packaging_level_id, code) do update
    set is_primary = true, verified_at = now(), verified_by = auth.uid()
  returning * into v_barcode;

  return v_barcode;
end;
$$;
