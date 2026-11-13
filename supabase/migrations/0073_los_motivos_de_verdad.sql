/**
 * Los motivos por los que un producto sale del almacén, los de verdad.
 *
 * Los trece que había en `reason_code` desde la migración 0007 me los inventé yo para que el
 * libro mayor tuviera con qué arrancar. Los que la empresa usa llegaron el 13 de noviembre, en
 * la hoja «Motivos» de `Codigos EAN y Motivos.xlsx`, y son los de SAP: clase **Z01** y un
 * código de cuatro dígitos. Esos son los que tienen que salir en pantalla, porque son los que
 * cuadran con la papelería.
 *
 * Y el motivo deja de ser sólo una palabra del WMS: lleva su clase y su código de SAP al lado,
 * que es el idioma en que se habla del tema fuera de la bodega.
 */
alter table reason_code add column if not exists sap_class text;
alter table reason_code add column if not exists sap_code text;

comment on column reason_code.sap_class is 'La clase de SAP (Z01). Es el idioma de la papelería.';
comment on column reason_code.sap_code is 'El código de SAP dentro de su clase, con sus ceros.';

create unique index if not exists reason_code_sap_uk
  on reason_code (sap_class, sap_code)
  where sap_class is not null;

/**
 * Los seis de la hoja, en la categoría **MERMA**, que es la que ya existía para el producto
 * que se pierde estando aquí. No se abre una categoría nueva por ellos: la hoja los agrupa a
 * los seis bajo un solo título («Producto averiado en Almacén») y MERMA es ese título.
 *
 * Van de primeros en la lista (`sort_order` por debajo de los demás) y
 * todos piden visto bueno del jefe, porque sacar producto del almacén descuadra la existencia
 * y eso no lo hace nadie solo. Nota no piden: el motivo ya dice qué pasó.
 */
insert into reason_code (
  code, name, description, category, affects_inventory,
  requires_note, requires_supervisor, sort_order, is_active, sap_class, sap_code
)
values
  ('MALA_CALIDAD', 'Mala calidad de fábrica', 'Vino mal de planta.',
   'MERMA', true, false, true, 1, true, 'Z01', '0001'),
  ('ROTACION_MAY', 'Rotación de cliente mayorista', 'Vuelve del mayorista por rotación.',
   'MERMA', true, false, true, 2, true, 'Z01', '0003'),
  ('FECHA_CORTA', 'Fecha corta', 'Le queda poca vida y ya no sale a ruta.',
   'MERMA', true, false, true, 3, true, 'Z01', '0004'),
  ('MALAS_PRACTICAS', 'Malas prácticas, averiado', 'Se averió por el manejo en bodega.',
   'MERMA', true, false, true, 4, true, 'Z01', '0005'),
  ('CONTAMINACION', 'Contaminación cruzada', 'Se contaminó con otro producto.',
   'MERMA', true, false, true, 5, true, 'Z01', '0007'),
  ('VENCIDO_BOD', 'Vencido en bodega', 'Se venció estando aquí.',
   'MERMA', true, false, true, 6, true, 'Z01', '0008')
on conflict (code) do update set
  name = excluded.name,
  description = excluded.description,
  category = excluded.category,
  affects_inventory = excluded.affects_inventory,
  requires_note = excluded.requires_note,
  requires_supervisor = excluded.requires_supervisor,
  sort_order = excluded.sort_order,
  is_active = excluded.is_active,
  sap_class = excluded.sap_class,
  sap_code = excluded.sap_code;

/**
 * Y los que me inventé para lo mismo se apagan, porque dos listas de motivos para una sola
 * cosa es peor que ninguna: el de bodega escoge uno y la papelería pide otro. No se borran
 * —hay movimientos apuntados con ellos y el libro mayor no se toca—, sólo dejan de ofrecerse.
 *
 * Se quedan encendidos los que **no** son salida por avería: la pérdida desconocida, que es
 * del conteo; el bloqueo de calidad, que retiene y no saca; el reetiquetado; y los del
 * sistema (venta, traslado, carga inicial, ajuste de conteo, devolución de cliente).
 */
update reason_code set is_active = false
where code in ('DANADO', 'ROTO', 'GOLPEADO', 'MOJADO', 'VENCIDO');
