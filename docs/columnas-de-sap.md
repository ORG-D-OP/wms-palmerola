# Las columnas de SAP que el WMS ocupa

Seis reportes caen en la pantalla **Datos**. El archivo se abre en la máquina de quien lo sube
—Vercel no deja pasar un cuerpo de más de 4.5 MB y el de despacho pesa ocho— y al servidor
viajan sólo las filas ya entendidas.

**Todo se busca por el nombre de la columna, no por su posición.** El día que la descarga venga
recortada a lo que está en esta lista, el WMS la lee igual: lo único que no puede cambiar es
cómo se llaman las columnas y qué hoja las trae. Ninguna columna que no esté aquí se mira.

El reporte se reconoce solo: nadie tiene que acertar un desplegable a las seis de la mañana. Se
mira el nombre de la hoja y, si no, dos columnas que delatan el archivo. Ésas son las que nunca
pueden faltar.

---

## De ingreso

### 1. ZRDN — traslados vía NEST

Es el ingreso de verdad: trae **pallet, lote y vencimiento**, que es lo que nadie más trae. Son
cuatro archivos, uno por planta (3001, 3010, 3014, 5006), y los tres últimos vienen **sin pedido
de traslado**, así que esos camiones se guardan bajo su entrega y se reciben a ciegas.

- Hoja: **`RawData`** · cabecera en la primera fila
- Lo delatan: `Pallet` + `Salida Mercancia`
- Documento: **`Pedido Traslado`** (o `Entrega` cuando no viene)
- Se ocupan **13 de las 20 columnas**

| Columna | Para qué |
|---|---|
| `Pedido Traslado` | la llave del camión: es lo que viene impreso en el Comprobante de Carga |
| `Entrega` | la llave de repuesto para 3010, 3014 y 5006 |
| `Salida Mercancia` | el vale de acompañamiento; si viene, el camión ya salió |
| `Documento` | el número de envío de NEST |
| `Pallet` | la matrícula de la tarima |
| `Material` | el código del producto |
| `Cantidad` | cajas en ese pallet |
| `Lote` | el lote |
| `Vencimiento` | la fecha de vencimiento |
| `Planta` | de dónde sale |
| `Fecha` | cuándo se armó |
| `Nest Centro Destino` | para dejar fuera lo que no viene a Palmerola |
| `Nest Nombre Destino` | el destino cuando el centro viene vacío |

### 2. ZMB51 — salidas de planta

Cubre a las plantas que el ZRDN no ve: **el 40% de los camiones que llegan a Comayagua**. No
trae pallet, ni lote, ni vencimiento; crea el documento y sus líneas y deja los pallets para el
andén.

- Hoja: cualquiera · cabecera en la primera o la segunda fila
- Lo delatan: `CMv` + `Doc.mat.`, o `Clase de movimiento` + `Documento material`
- Documento: **`Pedido`**
- Se ocupan **8 de las 67 columnas**

> **La descarga tiene que venir sin filtrar la clase de movimiento.** Sólo los movimientos
> **641** llevan pedido de traslado, que es lo único que ata este archivo con el ZRDN. Los
> extractos del 16 y del 24 de noviembre venían con 303 y 304 solamente: cero 641, cero pedidos,
> cero documentos cargados.

SAP exporta este reporte con dos juegos de rótulos y **la correspondencia no es la obvia**:

| Para qué | rótulos cortos | rótulos largos |
|---|---|---|
| la llave del camión | `Pedido` | `Pedido` |
| el vale de acompañamiento | `Doc.mat.` | `Documento material` |
| el producto | `Material` | `Material` |
| cuánto | `Ctd.en UM entrada` | `Ctd.en UM entrada` |
| qué clase de movimiento | `CMv` | `Clase de movimiento` |
| **planta que despacha** | `Ce.` | `Centro` |
| **planta que recibe** | `Centro` | `Centro receptor` |
| fecha | `Fe.contab.` | `Fe.contabilización` |

---

## De despacho

### 3. ZRDT — datos de transporte

Es el camión que sale: lo que hay que surtir. El transporte entra **sin abrir** y sin andén —el
archivo no dice en qué andén se carga, y adivinarlo sería inventar—. Abrirlo es escanear el
tabulado.

- Hoja: la primera · cabecera en la primera o la segunda fila
- Lo delatan: `Número Transporte` + `UM venta`
- Documento: **`Número Transporte`**
- Se ocupan **7 de las 86 columnas**

| Columna | Para qué |
|---|---|
| `Número Transporte` | la llave del camión: es lo que lleva el código de barras de la hoja |
| `Entrega` | el reparto dentro del camión |
| `Posición` | el número de línea |
| `Material` | el código del producto |
| `Cantidad` | cuánto |
| `UM venta` | si es caja, docena o unidad; decide cuántas unidades base es la línea |
| `Nombre Cliente` | a quién va |

---

## Los otros tres

### 4. Existencia de SAP (`Inventario DDMMYYYY.xlsx`)

Una foto con fecha, y **la fecha viene en el nombre del archivo**, no dentro.

- Lo delatan: `Libre utilización` + `Texto breve de material`
- Se ocupan **9 de las 12 columnas**: `Centro`, `Almacén`, `Material`,
  `Texto breve de material`, `Unidad medida base`, `Libre utilización`, `Cantidad pendiente`,
  `Bloqueado`, `Trans./Trasl.`

### 5. Pronóstico de venta (`FCST`)

Es la base del ABC y de la planimetría. Se queda sólo la zona de la bodega y se suma por
material y mes.

- Hoja: **`FCST`**
- Lo delatan: `Pronóstico` + `Cantidad cajas Pallet`
- Se ocupan **8 de las 18 columnas**: `País`, `Material`, `Descripción de Material`, `Año`,
  `Período`, `Pronóstico`, `PP`, `Cantidad cajas Pallet`

### 6. Trazabilidad de cajas por pallet (NEST)

**No se guarda nada.** Son 253,446 cajas en quince días y lo que el WMS necesita —pallet,
producto, lote, vencimiento— ya viene en el ZRDN; se comprobó que coinciden en los 5,684 pallets
en común. Se lee para contarla y dejar constancia de que llegó.

- Hoja: **`Cajas por Pallet`**
- La delatan: `Pallet Actual` + `Correlativo Caja`
- Se leen 2: `Pallet Actual`, `Planta`

---

## Qué pasa si la descarga se recorta

- **Quitar columnas que no están en esta lista: no pasa nada.** Ni se miran.
- **Quitar una de las dos que delatan el archivo:** el WMS no lo reconoce y lo rechaza diciendo
  que no trae las columnas de ninguno de los reportes conocidos.
- **Quitar una columna de la tabla pero no de las que delatan:** el archivo se reconoce, se carga
  y ese dato queda vacío. En las que son llave —pedido, transporte, material, cantidad— la fila
  entera se descarta y la pantalla lo dice.
- **Cambiarle el nombre a una columna:** es lo mismo que quitarla.
- Las filas de totales y las de cantidad cero ya se descartan solas: 1,143 líneas en cero del
  ZRDT de noviembre y la fila de totales de la existencia.

## Por qué no se manda el archivo entero cada vez

SAP no marca los complementos. Un transporte que a las ocho traía 20 líneas puede venir a las
once con 27 y **nada en el archivo dice cuáles son las siete nuevas**, así que el documento se
rehace entero cada vez y la unidad mínima que se puede mandar o no mandar es el documento, nunca
la fila.

Por eso se guarda una **huella** por documento —un resumen corto de todas sus filas, calculado en
la máquina de quien sube el archivo—. Antes de enviar nada, la pantalla pregunta por las huellas
que la base ya tiene y manda sólo los documentos cuya huella no coincide.

Lo que eso ahorra, con los archivos de noviembre:

| archivo | filas útiles | documentos | se mandaba | se manda cuando nada cambió |
|---|---|---|---|---|
| ZRDN 3001 | 5,317 | 183 | 1,302 KB | 5.3 KB |
| ZRDN 3010 | 526 | 30 | 125 KB | 0.9 KB |
| ZRDN 3014 | 1,161 | 113 | 286 KB | 3.3 KB |
| ZRDN 5006 | 1,323 | 82 | 318 KB | 2.4 KB |
| ZRDT | 24,726 | 385 | 3,206 KB | 10.7 KB |
| ZMB51 | 793 | 186 | 123 KB | 5.2 KB |
| **total** | **33,846** | **979** | **5.2 MB** | **28 KB** |

Un camión **ya abierto** es la excepción: no se le reescriben las líneas, porque sus tareas ya
están repartidas y puede haber gente surtiéndolo. Su complemento se cuenta y se dice en la
pantalla, y no se le guarda la huella, para que vuelva a ofrecerse en cada subida hasta que
alguien decida qué hacer con él.
