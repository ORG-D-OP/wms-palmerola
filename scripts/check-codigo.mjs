import { check } from './lib/boot-db.mjs'
import { cumpleGs1, digitoGs1, esConfiable, normalizar } from '../lib/warehouse/codigo.ts'

/**
 * Lo que separa una lectura buena de una mala.
 *
 * Con laser esto no hacia falta: el hardware no entrega un codigo que no cierre. Con camara
 * si, y el peligro no es que falle sino que acierte a medias: el ITF se lee de a pares de
 * digitos y sin este filtro un DUN-14 leido por la mitad entra al inventario como si fuera
 * otro producto, sin que nadie se entere.
 */

// Codigos reales del almacen, con su digito verificador tal como esta impreso.
check(cumpleGs1('17501234567890') === true, 'acepta un DUN-14 con el verificador correcto')
check(cumpleGs1('17501234567891') === false, 'rechaza el mismo DUN-14 con el verificador cambiado')
check(digitoGs1('1750123456789') === 0, 'calcula el verificador de un DUN-14')
check(digitoGs1('750123456789') === 3, 'calcula el verificador de un EAN-13')
check(cumpleGs1('7501234567893') === true, 'acepta un EAN-13 valido')
check(cumpleGs1('1750123456') === false, 'rechaza un largo que no es de GS1')
check(cumpleGs1('1750123456789X') === false, 'rechaza un codigo con letras')

// Un ITF leido a medias es el caso que importa: 14 digitos partidos en 8 siguen siendo
// pares, asi que el decodificador los entrega sin quejarse.
check(esConfiable('17501234567890', 'itf') === true, 'deja pasar el ITF completo')
check(esConfiable('17501234', 'itf') === false, 'frena el ITF leido a medias')
check(esConfiable('1750123456', 'ITF14') === false, 'frena el ITF corto, venga el formato como venga')

// El Code 128 del tabulado son siete digitos sin verificador: no es GS1 y no se le exige.
check(esConfiable('3916464', 'code_128') === true, 'deja pasar el transporte del tabulado')
check(esConfiable('5839228', 'qr_code') === true, 'deja pasar el tabulado del comprobante')
check(esConfiable('', 'code_128') === false, 'rechaza una lectura vacia')

// Los lectores agregan terminadores y, a veces, el identificador de simbologia.
check(normalizar(' 3916464\r\n') === '3916464', 'quita espacios y salto de linea')
check(normalizar('39\u000016464').length === 7, 'quita los caracteres de control de en medio')
