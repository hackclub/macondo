---
title: Enviando tu build
description: Checklist solo para hardware para enviar tu build terminado, más cómo funcionan los ships de actualización y los caminos de arreglo con financiamiento.
section: shipping
order: 2
icon: check-circle
---
# Enviando lo que construiste

**Este es el segundo paso para los proyectos de hardware: envías tu build una vez que el dispositivo está realmente construido y funcionando.** Los builds aprobados desbloquean el oro que ha estado esperando en tu proyecto, así puedes gastarlo en la tienda.

<div style="background:rgb(200 160 50/0.15);border:3px solid rgb(200 160 50/0.4);padding:1rem 1.25rem;margin-bottom:1.5rem"><strong style="color:rgb(104 77 58)">Esto es solo para proyectos de hardware.</strong><span style="color:rgb(104 77 58/0.8);font-size:0.875rem"> Envía tu construcción después de haber diseñado tu proyecto, recibido tus materiales y ensamblado en la vida real. Los proyectos de software no necesitan este paso ya que se revisan a través del proceso de <a href="/docs/submitting-design" style="color:rgb(104 77 58);font-weight:600;text-decoration:underline">envío de proyecto</a>.</span></div>

> Si aún no has enviado tu proyecto a revisión, [hazlo primero](/docs/submitting-design).

## ¿Necesito un prototipo real, o me bastan mis archivos de PCB?

Depende de cuál ship estás enviando, y esa es la parte en la que la mayoría se enreda. El hardware tiene dos etapas:

- **Ship de diseño** (cubierto en [Enviando tu diseño](/docs/submitting-design)): el build aún no está construido. Tu fuente de CAD, tu BOM y tus archivos de PCB son la prueba. **No necesitas un prototipo físico.** Este es el ship donde puedes pedir financiamiento para comprar materiales.
- **Ship de build** (esta página): el dispositivo está construido y funcionando. Ahora necesitamos ver la cosa real.

Así que la respuesta corta: los archivos de PCB por sí solos están bien para el ship de diseño. El ship de build es donde demuestras que la construcción física es real. No puedes saltar directo a un ship de build con solo archivos, y no tienes que imprimir ni construir nada para enviar tu diseño.

## ¿Cómo envío mi build?

Una vez que tu hardware esté construido y funcionando, abre la página de tu proyecto, marca **Esta es mi construcción terminada** en el panel de financiamiento, y dale a **Enviar a revisión** (dice **Reenviar a revisión** si estás corrigiendo un ship devuelto).

Hay requisitos mínimos abajo. La falta de cualquiera de estos hace que tu proyecto sea devuelto, así que léelos primero.

::danger{title="El 95% de los rechazos vienen de problemas que toman 5 minutos arreglar"}
Lee los requisitos abajo con cuidado **antes** de enviar. Archivos faltantes, enlaces rotos o un README poco claro son las razones de rechazo más comunes, y cada una de ellas es barata de arreglar antes de enviar.
::

## Cumplir con todos los requisitos del proyecto

Enviar tu build aún requiere que cumplas con todos los requisitos de [enviar tu proyecto](/docs/submitting-design). Asegúrate de que esos sigan en orden.

## Muestra tu proyecto construido en la vida real

Un ship de build necesita pruebas de que el dispositivo funciona en la vida real. Como mínimo, incluye:

- Fotos de tu proyecto terminado, construido en la vida real
- Un video demo mostrándolo y cómo funciona (un YouTube público, un canvas de Slack o un clip de Reddit, cualquiera sirve)

El video va en el campo **Demo URL** de la página de tu proyecto. Para un ship de build ese campo es **obligatorio**, ya que el hardware no se puede cargar en un navegador y el video es la forma en que un revisor confirma que el build es real. (Para un ship de diseño es opcional. Mira [Project URL: jugable vs. demo](/docs/submitting-design) para el desglose completo.)

## Actualiza tu repositorio

Asegúrate de que tu repo de GitHub (o tu documento de Onshape, si esa es tu fuente) refleje el estado final de tu proyecto:

- README actualizado con fotos de la vida real
- Cualquier cambio de firmware hecho durante la construcción
- BOM final con los materiales realmente usados (no solo lo que planeaste), tanto en el `bom.csv` como en la tabla del README
- Instrucciones de ensamblaje que coincidan con cómo lo construiste de verdad, incluyendo lo que descubriste a la mala
- Notas sobre cualquier cosa que harías diferente la próxima vez

## Cuando tu construcción no funciona: ships de actualización

El hardware no siempre coopera. Un chip se fríe, una pista del PCB está mal, un material llega muerto, el firmware corrompe la memoria flash. Eso es normal, y no tienes que abandonar tu proyecto cuando pasa. Después de cualquier ship aprobado, puedes enviar otro en el mismo proyecto, llamado **ship de actualización**.

Cada ship de actualización es una de dos cosas, y eliges cuál según cómo dejas dos casillas en el panel de financiamiento. Son **mutuamente excluyentes**: marcar una desmarca la otra, y puedes dejar ambas sin marcar para un ship sencillo de progreso.

### Opción 1: Necesito financiamiento (camino de arreglo)

Si tu proyecto está roto y necesitas materiales de reemplazo para arreglarlo, marca **Necesito financiamiento** antes de enviar. En la aprobación, Hack Club te envía una beca nueva por el costo actualizado de construcción en lugar de recompensar con oro.

Tienes que documentar tus hallazgos para tomar este camino. El revisor necesita ver qué salió mal y qué estás cambiando:

- Una nueva entrada de diario explicando la falla (qué pasó, cuándo y cómo lo diagnosticaste)
- Fotos de la construcción rota, más cualquier depuración que hayas hecho para confirmar el problema
- Qué materiales estás reemplazando y por qué
- Una BOM actualizada con los materiales de reemplazo y el costo total actualizado

Los ships de actualización vagos tipo "no funcionó, envíen más dinero" serán devueltos. Sé específico.

### Opción 2: Estoy listo (construcción completa)

Si la construcción funciona y terminaste, marca **Esta es mi construcción terminada** y envía. El sistema lo trata como tu revisión final de construcción: en la aprobación ganas oro por todas las horas que registraste desde el último ship, Y todas las filas de oro pendiente que acumulaste en este proyecto desde ships anteriores se desbloquean al mismo tiempo.

Este es el único ship que desbloquea tu oro pendiente. Hasta que envíes un ship de construcción completa, el oro de tus ships de hardware queda pendiente mientras los revisores esperan la prueba del build funcional.

No hay una tercera casilla de "este ship está terminado" escondida en algún lado. Las dos casillas son toda la decisión: **Necesito financiamiento** significa "necesito dinero para materiales", **Esta es mi construcción terminada** significa "terminé, desbloquea mi oro", y dejar ambas sin marcar es un ship sencillo de progreso que sigue registrando horas con el oro todavía pendiente. Elige máximo una por ship.

::tip{title="Financiamiento y construcción completa no pueden estar ambos activados"}
Un ship que está pidiendo dinero para materiales nunca es el build terminado, así que marcar **Necesito financiamiento** desmarca **Esta es mi construcción terminada**, y viceversa. Si quieres desbloquear tu oro pendiente, deja el financiamiento apagado y marca la casilla de construcción terminada.
::

> **Cada ship de actualización necesita pruebas de nuevo trabajo desde la última aprobación.** Eso significa estrictamente más horas de Hackatime, o al menos una nueva entrada de diario con horas reales registradas. Reenviar sin nuevo trabajo hará que el ship sea devuelto, sin importar qué camino elijas.

## Mira también

- [Enviando tu diseño](/docs/submitting-design) , el primer paso, incluyendo el ship de diseño y las reglas de URL jugable vs. demo
- [Consiguiendo materiales](/docs/sourcing-parts) , cómo funcionan las becas de financiamiento de hardware
- [Cómo funcionan los niveles](/docs/how-levels-work) , cómo tu nivel define tu tasa de oro y tu límite de financiamiento
- [Moneda](/docs/currency) , cómo funcionan el oro, el oro pendiente y las rachas
- [Diarios](/docs/journals) , cómo funcionan las actualizaciones diarias y las horas registradas
