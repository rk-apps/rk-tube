# rk-tube (R.K APPs)

Modificaciones sobre TizenTube (reisxd/TizenTube, GPL-3.0):

1. Actualizador desactivado por defecto y sin avisos (enableUpdater: false, updateRepo apuntando a este repositorio).
2. Barra lateral reducida a Buscar, Principal, Suscripciones y Biblioteca; Configuracion y Ayuda ocultas del menu (su codigo y funciones internas no se tocaron).
3. Interruptor de Shorts movido de Configuracion a la barra lateral principal (filas Shorts y Habilitar, misma preferencia enableShorts y mismo filtro original).
4. Marca "RK Tube - disfrutar sin anuncios" solo en la pagina principal; oculta en el resto (incluida la pantalla de inicio de sesion, que queda intacta).

El codigo fuente completo y las instrucciones de compilacion estan en este repositorio,
segun lo exige la licencia GPL-3.0 (ver LICENSE). El userscript compilado listo para
servir esta en ./userScript.js.
