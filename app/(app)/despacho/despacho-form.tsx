"use client";

import { useState, useTransition } from "react";
import { ScanInput } from "@/components/ui/scan-input";
import { Aviso, Logro } from "@/components/ui/feedback";
import { Icon } from "@/components/ui/icon";
import { BOTON, BOTON_SUAVE, CAMPO, ETIQUETA } from "@/components/ui/campos";
import { ESTADO } from "./estado";
import {
  abrirEnAnden,
  buscarDespacho,
  chequear,
  corregirCantidad,
  despachar,
  recargarDespacho,
  type Camion,
  type Linea,
} from "./actions";
import { plural } from "@/lib/plural";
import { desglose, textoCajas } from "@/lib/cajas";
import { nombrePosicion } from "@/lib/posiciones";

/**
 * Despachar un camión: la hoja, convertida en lista de chequeo.
 *
 * El escaneo del tabulado abre el camión y reparte el surtido. A partir de ahí la pantalla
 * es la hoja: todas las líneas con su cantidad, y el chequeador va escaneando lo que sube.
 * Lo escaneado queda en verde; lo que no alcanzó la bodega queda señalado como faltante
 * desde el primer momento, sin esperar a que alguien lo descubra en el andén.
 *
 * El escaneo da por buena toda la cantidad que bajó, porque ése es el caso normal, y la deja
 * corregible mientras el camión no haya salido: chequear es comprobar la cantidad, y nadie
 * cuenta bien a la primera con un camión esperando. Lo que el chequeador deje escrito es lo
 * que sale; lo que no subió se queda en el andén.
 *
 * El camión se puede cerrar incompleto, porque un camión que tiene que salir sale, pero eso
 * pide una razón: un faltante que nadie escribió es un descuadre que aparece la semana que
 * viene sin dueño.
 *
 * Y el chequeo es de uno: el que sube el producto no es el que lo comprueba. Quien no chequea
 * ve la hoja entera —la necesita para saber qué cargar— pero sin la caja de escaneo.
 */
/** Un camión que está cargándose ahora mismo, de quien sea. */
export type Abierto = {
  id: string;
  code: string;
  anden: string | null;
  lineas: number;
  pedido: number;
  surtido: number;
};

/** Un camión que SAP mandó y que nadie ha abierto todavía. */
export type PorCargar = {
  id: string;
  code: string;
  cliente: string | null;
  lineas: number;
};

export function DespachoForm({
  deAnden,
  abierto,
  anden,
  andenes,
  abiertos,
  porCargar,
}: {
  /** Si esta persona es la que chequea el andén: marca líneas, corrige cantidades y cierra. */
  deAnden: boolean;
  /** El camión que se está cargando en su andén, traído ya por el servidor. */
  abierto: Camion | null;
  /** El andén del turno. Es el que viene primero cuando hay que elegir. */
  anden: string | null;
  andenes: string[];
  /**
   * Todos los que están a medias, el de su andén primero. Sin esta lista, seguir con el
   * camión del compañero pedía tener su hoja en la mano.
   */
  abiertos: Abierto[];
  /** Los que SAP mandó y no ha abierto nadie, del último que apareció hacia atrás. */
  porCargar: PorCargar[];
}) {
  const [camion, setCamion] = useState<Camion | null>(abierto);
  const [aviso, setAviso] = useState("");
  const [error, setError] = useState("");
  const [verLista, setVerLista] = useState(false);
  const [cerrandoCorto, setCerrandoCorto] = useState(false);
  const [cerrando, setCerrando] = useState(false);
  const [pending, empezar] = useTransition();

  // Los andenes que tienen más de un camión abierto a la vez.
  const apilados = Object.entries(
    abiertos.reduce<Record<string, number>>((cuenta, a) => {
      if (a.anden) cuenta[a.anden] = (cuenta[a.anden] ?? 0) + 1;
      return cuenta;
    }, {}),
  ).filter(([, cuantos]) => cuantos > 1);

  /** De las listas se abre por id: el camión ya está identificado, no hay nada que buscar. */
  const abrirPorId = (id: string) =>
    empezar(async () => {
      setError("");
      resolver(await recargarDespacho(id));
    });

  function resolver(respuesta: Awaited<ReturnType<typeof buscarDespacho>>) {
    if (respuesta.ok) {
      setCamion(respuesta.camion);
      setError("");
    } else {
      setError(respuesta.error);
    }
  }

  if (!camion) {
    return (
      <div className="flex flex-col gap-5">
        <ScanInput
          label="Escanea el código de la hoja de despacho"
          disabled={pending}
          onScan={(codigo) =>
            empezar(async () => resolver(await buscarDespacho(codigo)))
          }
          formato="transporte"
        />
        <p className="text-sm text-azul/60">
          El código de barras de la hoja es el número de transporte, y también
          sirve el número de entrega de cualquiera de las paradas. Si el mismo
          camión trae varias hojas, se abren todas juntas: no importa cuál
          tengas en la mano. Al escanearla se reparte el surtido entre los que
          estén en el andén.
        </p>
        {error ? <Aviso>{error}</Aviso> : null}

        {abiertos.length > 0 ? (
          <section className="flex flex-col gap-2 border-t border-borde pt-5">
            <span className={ETIQUETA}>Camiones cargándose</span>

            {/*
              Un andén es un sitio donde cabe un camión. No se impide —uno de ayer sin cerrar
              no puede dejar el andén muerto hoy— pero se le pone delante al que está mirando,
              porque dos camiones abiertos en el mismo andén mandan producto al mismo sitio.
            */}
            {apilados.length > 0 ? (
              <p className="rounded-xl bg-celeste/15 p-3 text-sm">
                {apilados
                  .map(
                    ([donde, cuantos]) =>
                      `${nombrePosicion(donde)}: ${cuantos} camiones`,
                  )
                  .join(" · ")}
                . En un andén cabe un camión: si alguno ya se fue, ciérralo.
              </p>
            ) : null}

            <ul className="flex flex-col divide-y divide-borde">
              {abiertos.map((a) => (
                <li key={a.id}>
                  <Fila
                    code={a.code}
                    disabled={pending}
                    onClick={() => abrirPorId(a.id)}
                    pie={`${a.anden ? nombrePosicion(a.anden) : "sin andén"} · ${porciento(
                      a.surtido,
                      a.pedido,
                    )} % surtido · ${plural(a.lineas, "línea", "líneas")}`}
                  />
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {porCargar.length > 0 ? (
          <section className="flex flex-col gap-2 border-t border-borde pt-5">
            <span className={ETIQUETA}>Camiones por cargar</span>

            <ul className="flex flex-col divide-y divide-borde">
              {porCargar.map((c) => (
                <li key={c.id}>
                  <Fila
                    code={c.code}
                    disabled={pending}
                    onClick={() => abrirPorId(c.id)}
                    pie={`${c.cliente ?? "sin cliente"} · ${plural(c.lineas, "línea", "líneas")}`}
                  />
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </div>
    );
  }

  /**
   * El camión que vino de un Excel de SAP no trae andén, y sin andén no se reparte nada. Se
   * pregunta aquí, que es donde la persona lo está viendo: el camión está delante de ella.
   */
  if (camion.estado === "DRAFT") {
    return (
      <div className="flex flex-col gap-5">
        <div className="flex flex-col gap-1 rounded-2xl border border-borde p-4">
          <span className="text-lg tabular-nums">
            {camion.transporte ?? camion.code}
          </span>
          <p className="text-sm text-azul/60">
            {camion.cliente ?? "sin cliente"} ·{" "}
            {plural(camion.lineas, "línea", "líneas")}
          </p>
        </div>

        <p className="text-sm text-azul/60">
          ¿En qué andén está este camión? SAP no lo dice. Al elegirlo se reparte
          el surtido entre los que estén ahí.
        </p>

        {/*
          El del turno primero y marcado: casi siempre es ése, y en una lista de veinticuatro
          botones iguales el de uno no se encuentra de un vistazo.
        */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[...andenes]
            .sort((a, b) => Number(b === anden) - Number(a === anden))
            .map((donde) => (
              <button
                key={donde}
                type="button"
                disabled={pending}
                onClick={() =>
                  empezar(async () =>
                    resolver(await abrirEnAnden(camion.id, donde)),
                  )
                }
                className={donde === anden ? BOTON : BOTON_SUAVE}
              >
                {nombrePosicion(donde)}
              </button>
            ))}
        </div>

        {error ? <Aviso>{error}</Aviso> : null}

        <button
          type="button"
          onClick={() => setCamion(null)}
          className={BOTON_SUAVE}
        >
          Otro camión
        </button>
      </div>
    );
  }

  const despachado = camion.estado === "SHIPPED";
  const chequeadas = camion.detalle.filter((l) => l.chequeada).length;
  const faltantes = camion.detalle.filter((l) => l.apartado < l.pedido);
  const completo =
    chequeadas === camion.detalle.length && camion.pendientes === 0;
  /**
   * Y si alguna línea sale por debajo de lo que pedía, el camión va corto aunque esté todo
   * chequeado: es justo lo que pasa cuando el chequeador baja una cantidad. Eso pide razón.
   */
  const corto = camion.detalle.some((l) => (l.arriba ?? l.surtido) < l.pedido);

  const marcar = (codigo: string) =>
    empezar(async () => {
      const res = await chequear(camion.id, codigo);
      if (!res.ok) {
        setAviso("");
        return setError(res.error);
      }
      setCamion(res.camion);
      setAviso(res.aviso);
      setError("");
    });

  /**
   * Y el botón dice lo que está pasando de verdad. La transición es una sola para toda la
   * pantalla, así que mientras el chequeador escaneaba una caja el botón de cerrar ponía
   * «Despachando...»: visto a clic, y es de las cosas que asustan en un andén.
   */
  const cerrar = (nota?: string) =>
    empezar(async () => {
      setCerrando(true);
      const res = await despachar(camion.id, nota);
      setCerrando(false);
      if (!res.ok) return setError(res.error);
      setCamion(res.camion);
      setCerrandoCorto(false);
      setAviso("");
      setError("");
    });

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-1 rounded-2xl border border-borde p-4">
        <div className="flex items-baseline justify-between gap-3">
          <span className="text-lg tabular-nums">
            {camion.transporte ?? camion.code}
          </span>
          <span className="shrink-0 rounded-md bg-azul-08 px-2 py-1 text-xs">
            {ESTADO[camion.estado as keyof typeof ESTADO] ?? camion.estado}
          </span>
        </div>
        <p className="text-sm text-azul/60">
          {camion.cliente ?? "sin cliente"} ·{" "}
          {camion.anden ? nombrePosicion(camion.anden) : "sin andén"} ·{" "}
          {plural(camion.lineas, "línea", "líneas")}
        </p>
        {camion.entregas.length > 0 ? (
          <p className="text-sm text-azul/60">
            Documentos: {camion.entregas.join(", ")}
          </p>
        ) : null}
      </div>

      {despachado ? (
        <Logro>El camión salió. No queda nada por hacer con esta hoja.</Logro>
      ) : deAnden ? (
        <>
          <ScanInput
            label="Escanea lo que va subiendo al camión"
            disabled={pending}
            onScan={marcar}
          />
          {aviso ? <Logro>{aviso}</Logro> : null}
        </>
      ) : (
        <p className="text-sm text-azul/60">
          Ésta es la hoja del camión: carga lo que dice. Chequearla es del
          chequeador del andén, que es quien compara lo que sube contra el
          papel.
        </p>
      )}

      <div className="flex flex-col gap-2">
        <p className="text-sm text-azul/60">
          {chequeadas} de{" "}
          {plural(
            camion.detalle.length,
            "línea chequeada",
            "líneas chequeadas",
          )}
          {faltantes.length > 0
            ? ` · ${faltantes.length} sin producto suficiente`
            : ""}
        </p>
        {/*
          Cómo va el camión, de un vistazo y desde lejos. Con doscientas líneas, contar
          palomitas no es una respuesta.
        */}
        <div
          className="h-2 overflow-hidden rounded-full bg-azul-08"
          role="progressbar"
          aria-valuenow={chequeadas}
          aria-valuemax={camion.detalle.length}
        >
          <div
            className="h-full bg-[var(--verde)] transition-[width]"
            style={{
              width: `${porciento(chequeadas, camion.detalle.length)}%`,
            }}
          />
        </div>
      </div>

      {/*
        La hoja entera se esconde. Un camión de doscientas cincuenta líneas dejaba la caja de
        escaneo fuera de la pantalla a la primera pasada de dedo, y lo que el chequeador hace
        todo el rato es escanear.
      */}
      <button
        type="button"
        onClick={() => setVerLista(!verLista)}
        className="flex items-center gap-1.5 self-start text-sm text-azul/60 underline"
      >
        <Icon
          name={verLista ? "expand_less" : "expand_more"}
          className="!text-[18px]"
        />
        {verLista
          ? "Ocultar la hoja"
          : `Ver la hoja: ${camion.detalle.length - chequeadas} sin chequear`}
      </button>

      <ul
        className={`flex-col divide-y divide-borde ${verLista ? "flex" : "hidden"}`}
      >
        {camion.detalle.map((l) => (
          <Renglon
            key={l.lineNo}
            linea={l}
            editable={!despachado && deAnden}
            onCorregir={(cajas) =>
              empezar(async () => {
                const res = await corregirCantidad(camion.id, l.id, cajas);
                if (!res.ok) return setError(res.error);
                setCamion(res.camion);
                setAviso(
                  `${l.name}: ${textoCajas(cajas * l.porCaja, l.porCaja)} arriba.`,
                );
                setError("");
              })
            }
          />
        ))}
      </ul>

      {!despachado && deAnden ? (
        cerrandoCorto ? (
          <form
            action={(datos) => cerrar(String(datos.get("nota") ?? ""))}
            className="flex flex-col gap-3 rounded-2xl border border-borde p-4"
          >
            <label className="flex flex-col gap-1.5">
              <span className={ETIQUETA}>¿Por qué sale sin todo?</span>
              <input
                name="nota"
                required
                maxLength={200}
                autoFocus
                placeholder="No había producto y el cliente lo recibe así"
                className={CAMPO}
              />
            </label>
            <p className="text-sm text-azul/60">
              Lo que quedó apartado y sin surtir se suelta para otro camión, y
              la razón queda guardada en la hoja.
            </p>
            <button type="submit" disabled={pending} className={BOTON}>
              {cerrando ? "Cerrando..." : "Cerrar el camión así"}
            </button>
            <button
              type="button"
              onClick={() => setCerrandoCorto(false)}
              className={BOTON_SUAVE}
            >
              Mejor no
            </button>
          </form>
        ) : (
          <div className="flex flex-col gap-3">
            <button
              type="button"
              disabled={pending || !completo}
              onClick={() => (corto ? setCerrandoCorto(true) : cerrar())}
              className={BOTON}
            >
              {cerrando ? "Despachando..." : "Marcar camión despachado"}
            </button>
            {!completo ? (
              <>
                <p className="text-sm text-azul/60">
                  {camion.pendientes > 0
                    ? `${camion.pendientes === 1 ? "Queda" : "Quedan"} ${plural(camion.pendientes, "tarea de surtido abierta", "tareas de surtido abiertas")}.`
                    : "Falta chequear líneas."}{" "}
                  El camión se cierra cuando esté todo arriba.
                </p>
                <button
                  type="button"
                  onClick={() => setCerrandoCorto(true)}
                  className={BOTON_SUAVE}
                >
                  Cerrarlo igual, sin todo
                </button>
              </>
            ) : corto ? (
              <p className="text-sm text-azul/60">
                Alguna línea sale con menos de lo que pedía. Al cerrarlo hay que
                decir por qué.
              </p>
            ) : null}
          </div>
        )
      ) : null}

      {!despachado && !deAnden && completo ? (
        <p className="text-sm text-azul/60">
          Ya está todo arriba. El camión lo cierra el chequeador con la hoja en
          la mano.
        </p>
      ) : null}

      <div className="flex gap-3">
        <button
          type="button"
          disabled={pending}
          onClick={() =>
            empezar(async () => resolver(await recargarDespacho(camion.id)))
          }
          className={BOTON_SUAVE}
        >
          <Icon name="refresh" />
          Actualizar
        </button>
        <button
          type="button"
          onClick={() => {
            setCamion(null);
            setError("");
            setAviso("");
          }}
          className={BOTON_SUAVE}
        >
          <Icon name="barcode_scanner" />
          Otro camión
        </button>
      </div>

      {error ? <Aviso>{error}</Aviso> : null}
    </div>
  );
}

/** Un camión de las listas: el número grande y debajo cómo va. */
function Fila({
  code,
  pie,
  disabled,
  onClick,
}: {
  code: string;
  pie: string;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="flex w-full items-baseline gap-3 py-2 text-left"
    >
      <span className="font-mono tabular-nums">{code}</span>
      <span className="min-w-0 flex-1 text-xs text-azul/60">{pie}</span>
      <Icon name="chevron_right" className="!text-[18px] shrink-0" />
    </button>
  );
}

/** Lo que lleva hecho, en por ciento y sin dividir entre cero. */
function porciento(hecho: number, total: number) {
  return total > 0 ? Math.round((hecho / total) * 100) : 0;
}

/**
 * Una línea de la hoja. Cuatro estados y se distinguen de un vistazo desde un metro:
 * completa y chequeada en verde, chequeada pero corta en rojo con fondo, corta sin chequear
 * en rojo sin fondo, y pendiente en gris.
 *
 * Antes la palomita verde la ponía el chequeo solo, así que una línea de la que subieron la
 * mitad salía igual que una completa: el verde decía «alguien la tocó», no «está completa».
 * Y lo que falta se cuenta contra lo que subió de verdad en cuanto hay chequeo; antes se
 * contaba siempre contra lo apartado, que es lo que la bodega prometió, no lo que hay en el
 * andén.
 */
function Renglon({
  linea,
  editable,
  onCorregir,
}: {
  linea: Linea;
  editable: boolean;
  onCorregir: (cajas: number) => void;
}) {
  const [corrigiendo, setCorrigiendo] = useState(false);
  // Sin corregir nada, lo que sube es todo lo que bajó: el escaneo no congela una cifra,
  // porque una línea casi nunca baja de un solo viaje.
  const arriba = linea.arriba ?? linea.surtido;
  const falta = linea.pedido - (linea.chequeada ? arriba : linea.apartado);
  const corta = falta > 0;
  const { cajas: cajasArriba } = desglose(arriba, linea.porCaja);
  const deMenos = linea.chequeada && arriba < linea.surtido;

  return (
    <li
      className={`-mx-2 flex flex-col gap-2 rounded-xl px-2 py-3 ${
        linea.chequeada ? (corta ? "bg-rojo/10" : "bg-[var(--verde)]/20") : ""
      }`}
    >
      <div className="flex items-center gap-3">
        <Icon
          name={
            corta
              ? "error"
              : linea.chequeada
                ? "check_circle"
                : "radio_button_unchecked"
          }
          className={
            corta ? "text-rojo" : linea.chequeada ? "text-azul" : "text-azul/30"
          }
        />
        <span className="min-w-0 flex-1">
          <span className="block truncate">{linea.name}</span>
          <span className="block text-sm text-azul/60">
            {linea.sku}
            {corta ? (
              <span className="text-rojo">
                {" "}
                · faltan {textoCajas(falta, linea.porCaja)}
              </span>
            ) : null}
          </span>
          {/*
            De dónde sale. El chequeador lo usa para preguntar de dónde lo trajeron: si el
            que sube el producto dice otra posición, algo se movió sin registrarse.
          */}
          {linea.desde.length > 0 ? (
            <span className="block text-sm tabular-nums text-azul/60">
              de {linea.desde.map(nombrePosicion).join(", ")}
            </span>
          ) : null}
        </span>
        <span className="shrink-0 text-right tabular-nums">
          <span className="block">
            {textoCajas(linea.pedido, linea.porCaja)}
          </span>
          <span className="block text-xs text-azul/60">
            {linea.chequeada
              ? `${textoCajas(arriba, linea.porCaja)} arriba`
              : linea.surtido > 0
                ? `${textoCajas(linea.surtido, linea.porCaja)} surtidas`
                : "sin surtir"}
          </span>
        </span>
      </div>

      {/*
        Corregir la cantidad es parte del oficio: el chequeador cuenta y la hoja dice otra
        cosa. Sólo sale cuando la línea ya está chequeada, porque antes no hay nada que
        corregir, y se va con el camión: despachado, el número ya no se toca.
      */}
      {linea.chequeada && editable ? (
        corrigiendo ? (
          <form
            action={(datos) => {
              onCorregir(Number(datos.get("cajas")));
              setCorrigiendo(false);
            }}
            className="flex items-end gap-2"
          >
            <label className="flex flex-1 flex-col gap-1.5">
              <span className={ETIQUETA}>¿Cuántas cajas subieron?</span>
              <input
                name="cajas"
                type="number"
                min={0}
                step={1}
                inputMode="numeric"
                defaultValue={cajasArriba}
                autoFocus
                required
                className={CAMPO}
              />
            </label>
            <button type="submit" className={BOTON}>
              Guardar
            </button>
            <button
              type="button"
              onClick={() => setCorrigiendo(false)}
              className={BOTON_SUAVE}
            >
              Mejor no
            </button>
          </form>
        ) : (
          <div className="flex items-center gap-3 pl-9">
            {deMenos ? (
              <span className="text-sm text-rojo">
                Subieron {textoCajas(linea.surtido - arriba, linea.porCaja)}{" "}
                menos de las que bajaron
              </span>
            ) : null}
            <button
              type="button"
              onClick={() => setCorrigiendo(true)}
              className="text-sm text-azul/60 underline"
            >
              Corregir la cantidad
            </button>
          </div>
        )
      ) : null}
    </li>
  );
}
