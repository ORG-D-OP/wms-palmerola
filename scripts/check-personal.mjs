import { bootDb, check } from './lib/boot-db.mjs'

/**
 * Quien entra a la bodega. Lo que aqui se fija: que una cuenta recien registrada no vea nada
 * hasta que el jefe la acepte, que supervision pueda aceptar, sacar y devolver gente sin poder
 * fabricarse administradores, y que solo los correos dados de alta puedan registrarse.
 */
const db = await bootDb()
const one = async (sql, params) => (await db.query(sql, params)).rows[0]
const todos = async (sql, params) => (await db.query(sql, params)).rows
const falla = async (sql, params) =>
  db.query(sql, params).then(
    () => null,
    (e) => e.message,
  )

/** Alguien que se registro por la pantalla publica: el disparador le crea el perfil apagado. */
const registrar = async (correo, nombre, identidad) =>
  (
    await one(
      `insert into auth.users (email, raw_user_meta_data)
       values ($1, jsonb_build_object('full_name', $2::text, 'employee_code', $3::text)) returning id`,
      [correo, nombre, identidad],
    )
  ).id

/** Alguien que ya trabaja aqui. */
const dentro = async (correo, rol) => {
  const id = await registrar(correo, correo, null)
  await db.query(
    `update profile set role = $2, is_active = true, approved_at = now() where id = $1`,
    [id, rol],
  )
  return id
}

const como = (id) => db.query(`select set_config('request.jwt.claim.sub', '${id}', false)`)

const jefe = await dentro('jefe@ejemplo.test', 'supervisor')
const dueno = await dentro('admin@ejemplo.test', 'admin')
const auxiliar = await dentro('aux@ejemplo.test', 'auxiliar')

// --- el que se registra -------------------------------------------------------------------

const nuevo = await registrar('subcontratado@gmail.test', 'Juan Perez', 'ID-9981')
const perfil = await one(`select * from profile where id = $1`, [nuevo])
check(perfil.is_active === false, 'quien se registra nace apagado')
check(perfil.approved_at === null, 'y sin aceptar: pendiente, no dado de baja')
check(perfil.full_name === 'Juan Perez', 'el nombre que escribio queda guardado')
check(perfil.employee_code === 'ID-9981', 'y su numero de identidad, para que el jefe lo ubique')
check(perfil.role === 'solo_lectura', 'mientras tanto no tiene rol de bodega')

await como(nuevo)
const noVe = await falla(`select * from listar_personal()`)
check(noVe?.includes('permiso'), 'un recien registrado no ve el personal')
const noAprueba = await falla(`select aprobar_persona($1, 'supervisor')`, [nuevo])
check(noAprueba?.includes('permiso'), 'ni se aprueba a si mismo')

await como(auxiliar)
const auxNoVe = await falla(`select * from listar_personal()`)
check(auxNoVe?.includes('permiso'), 'un auxiliar tampoco ve el personal')

// --- el jefe de bodega --------------------------------------------------------------------

await como(jefe)
const lista = await todos(`select * from listar_personal()`)
check(lista.length === 4, 'el jefe ve a todos')
check(lista[0].id === nuevo, 'y los pendientes salen primero, que es lo que tiene que atender')
check(lista[0].email === 'subcontratado@gmail.test', 'con el correo con el que se registro')

const aprobado = await one(`select * from aprobar_persona($1, 'chequeador')`, [nuevo])
check(aprobado.is_active === true, 'al aceptarlo, entra')
check(aprobado.role === 'chequeador', 'con el rol que el jefe le puso')
check(aprobado.approved_at !== null, 'y queda sellado cuando fue')
check(aprobado.approved_by === jefe, 'y quien lo acepto')

const dosVeces = await falla(`select aprobar_persona($1, 'auxiliar')`, [nuevo])
check(dosVeces?.includes('ya estaba aceptada'), 'no se acepta dos veces')

// --- los limites del supervisor -----------------------------------------------------------

const otro = await registrar('otro@gmail.test', 'Maria Lopez', 'ID-7742')
const seFabricaAdmin = await falla(`select aprobar_persona($1, 'admin')`, [otro])
check(seFabricaAdmin?.includes('ese rol'), 'un supervisor no se fabrica administradores')

const rolMuerto = await falla(`select aprobar_persona($1, 'inventarios')`, [otro])
check(rolMuerto?.includes('ese rol'), 'ni asigna el rol muerto que quedo en el enum')

await como(dueno)
const porAdmin = await one(`select * from aprobar_persona($1, 'admin')`, [otro])
check(porAdmin.role === 'admin', 'un administrador si puede nombrar a otro')

// --- rechazar -----------------------------------------------------------------------------

await como(jefe)
const colado = await registrar('colado@gmail.test', 'Nadie', null)
await db.query(`select rechazar_registro($1)`, [colado])
const quedo = await one(`select count(*)::int as n from auth.users where id = $1`, [colado])
check(quedo.n === 0, 'rechazar a un desconocido borra la cuenta')

const noBorra = await falla(`select rechazar_registro($1)`, [nuevo])
check(noBorra?.includes('se da de baja, no se borra'), 'a quien ya trabajo no se le borra la cuenta')

// --- dar de baja y devolver ---------------------------------------------------------------

const aSiMismo = await falla(`select dar_de_baja($1)`, [jefe])
check(aSiMismo?.includes('a ti mismo'), 'el jefe no puede darse de baja solo')

const alAdmin = await falla(`select dar_de_baja($1)`, [dueno])
check(alAdmin?.includes('administrador'), 'un supervisor no da de baja a un administrador')

const baja = await one(`select * from dar_de_baja($1)`, [nuevo])
check(baja.is_active === false, 'dar de baja apaga la cuenta')
check(baja.approved_at !== null, 'pero no la vuelve pendiente: se sabe que trabajo aqui')

await como(nuevo)
const sinRol = await one(`select current_role_name() as r`)
check(sinRol.r === null, 'y de inmediato deja de tener rol, sin esperar a que cierre sesion')

await como(jefe)
const vuelta = await one(`select * from reactivar_persona($1)`, [nuevo])
check(vuelta.is_active === true, 'y se puede devolver cuando regresa')
check(vuelta.role === 'chequeador', 'con el rol que tenia')

const nuncaAceptada = await registrar('pendiente@gmail.test', 'Pendiente', null)
const noReactiva = await falla(`select reactivar_persona($1)`, [nuncaAceptada])
check(noReactiva?.includes('acéptala'), 'a una pendiente se la acepta, no se la reactiva')

// --- cambiar rol --------------------------------------------------------------------------

// Con un rol que si puede repartir, para que lo que frene sea la regla de no tocarse a si mismo.
const miPropioRol = await falla(`select cambiar_rol($1, 'auxiliar')`, [jefe])
check(miPropioRol?.includes('a ti mismo'), 'nadie se cambia el rol a si mismo')

const cambiado = await one(`select * from cambiar_rol($1, 'montacargista')`, [nuevo])
check(cambiado.role === 'montacargista', 'el jefe si le cambia el rol a su gente')

// --- la lista de correos ------------------------------------------------------------------

await como(jefe)

const altas = await one(
  `select autorizar_correos(array['Nuevo@Dinant.com', ' otro@gmail.com ', 'nuevo@dinant.com']) as n`,
)
check(altas.n === 2, 'da de alta varios de un jalon y el repetido no cuenta dos veces')

const guardado = await todos(`select email from correo_autorizado where nota is null order by email`)
check(
  guardado.some((c) => c.email === 'nuevo@dinant.com'),
  'el correo se guarda en minusculas y sin espacios',
)

const basura = await falla(`select autorizar_correos(array['no-es-un-correo'])`)
check(/correo nuevo/i.test(basura ?? ''), 'algo que no es correo no entra a la lista')

await one(`select autorizar_correos(array['jefe@ejemplo.test'])`)
const enLista = await todos(`select * from listar_correos()`)
check(
  enLista.find((c) => c.email === 'jefe@ejemplo.test')?.ya_registrado === true,
  'un correo que ya tiene cuenta sale marcado como usado',
)
check(
  enLista.find((c) => c.email === 'otro@gmail.com')?.ya_registrado === false,
  'y uno recien dado de alta sale como pendiente de registrarse',
)

const quitado = await one(`select quitar_correo(' Otro@Gmail.com ') as e`)
check(quitado.e === 'otro@gmail.com', 'se quita sin importar como lo escriban')

const noEsta = await falla(`select quitar_correo('nadie@ejemplo.test')`)
check(noEsta?.includes('no esta en la lista') || noEsta?.includes('no está en la lista'),
  'quitar uno que no esta avisa en vez de callarse')

await como(auxiliar)
const auxAutoriza = await falla(`select autorizar_correos(array['colado@gmail.com'])`)
check(auxAutoriza?.includes('permiso'), 'un auxiliar no da de alta correos')

const auxLee = await falla(`select * from listar_correos()`)
check(auxLee?.includes('permiso'), 'ni ve la lista')

const auxQuita = await falla(`select quitar_correo('nuevo@dinant.com')`)
check(auxQuita?.includes('permiso'), 'ni quita a nadie de ella')

await db.close()
