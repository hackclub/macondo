---
title: Ganar oro
description: Cómo ganas oro, por qué las rachas hacen que cada envío pague más, y qué significa tu cuenta histórica de frutas.
section: currency
order: 0
icon: apple
---
# Ganar oro

**Ganas oro dedicando horas a construir, y lo gastas en la tienda.** Cuando envías un proyecto y un revisor lo aprueba, el oro aparece en tu saldo. Cuánto ganas por hora depende del nivel de tu proyecto, y una racha larga hace que cada envío pague todavía más.

El oro es la única moneda que se puede gastar. Tu proyecto además recibe una **fruta** (una insignia decorativa de nivel), y tu cuenta lleva un historial de frutas como registro de todo lo que has construido. La fruta no es una segunda billetera, solo una etiqueta.

## ¿Cuánto oro gano por hora?

El nivel de tu proyecto fija tu **oro por hora** base. Los proyectos más difíciles pagan un poco más:

| Nivel | Etiqueta | Oro por hora |
|-------|-------|---------------|
| 1 | Principiante | 40 |
| 2 | Intermedio | 45 |
| 3 | Avanzado | 50 |
| 4 | Experto | 60 |

Eliges el nivel al crear un proyecto, y un revisor puede ajustarlo al aprobarlo si la complejidad no concuerda. Mira [Cómo funcionan los niveles](/docs/how-levels-work) para saber cómo elegir.

El oro que de verdad recibes cuando se aprueba un envío es:

**oro por hora × horas aprobadas × multiplicador de racha**

El multiplicador de racha es la parte que controlas día a día, y se explica más abajo.

## ¿Qué son las frutas del proyecto?

A cada proyecto se le asigna una de ocho frutas, repartidas entre software y hardware. La fruta sale del tipo y el nivel de tu proyecto, así que no la eliges.

### Software

| Fruta | Nivel |
|-------|-------|
| Mango | 1 |
| Piña | 2 |
| Papaya | 3 |
| Cacao | 4 |

### Hardware

| Fruta | Nivel |
|-------|-------|
| Guayaba | 1 |
| Coco | 2 |
| Sandía | 3 |
| Aguacate | 4 |

La fruta no cambia el oro que ganas, solo les dice a ti y al revisor en qué nivel está el proyecto. Tu estadística histórica `Mango: 124` significa "esta cuenta ha ganado el equivalente a 124 mangos" sumando todos los envíos L1 de software que has aprobado. Encuentras tu historial de frutas y una calculadora de oro en la [guía de la moneda](/currency).

## Carambola y envíos extra afrutados

Algunos artículos de la tienda están bloqueados detrás de un desbloqueo único con **carambola**. Los reconoces por la pequeña insignia de carambola en la tarjeta del artículo. Son artículos que de otro modo retiraríamos de la tienda, los que la gente conseguiría enviando proyectos de baja calidad en cadena, así que los ponemos detrás de un muro de calidad.

### ¿Cómo gano una carambola?

Cuando un revisor aprueba tu envío, puede marcar una pequeña casilla "extra afrutado" arriba de su justificación. Si lo hace, recibes **1 carambola** además de tu oro normal. La carambola llega a tu saldo de inmediato, incluso para proyectos de hardware (no forma parte del mecanismo de oro pendiente / construcción completada de más abajo).

La marca es **por envío**, no por proyecto. Cada envío que mandas es su propia oportunidad, incluyendo envíos de actualización en un proyecto que ya enviaste. Los revisores solo marcan construcciones excepcionales, así que la mayoría de los envíos no ganarán una. Eso es normal, y nunca pierdes progreso en el camino del oro por no obtenerla.

Una vez que cualquier envío de un proyecto ha sido marcado como extra afrutado, el proyecto lleva una insignia pública "Extra Afrutado" en su página y en su tarjeta de Explorar. La insignia es permanente: un envío posterior que no sea extra afrutado no la elimina.

### ¿Cómo gasto una carambola?

Gastar 1 carambola en un artículo bloqueado lo desbloquea para ti. Después del desbloqueo el artículo funciona como cualquier otro: sigues necesitando el precio normal en oro (o fruta) para comprarlo de verdad. Los desbloqueos son de una vez por artículo, no vuelves a pagar carambola para recomprar ese mismo artículo, y el desbloqueo se mantiene aunque el administrador edite el artículo después.

La carambola solo hace esta cosa. No puedes convertirla a oro, no puedes intercambiarla, y no la pierdes si no la gastas. Es solo una ficha en tu cuenta hasta que encuentres un artículo bloqueado que valga la pena abrir.

## El sistema de rachas

Aparecer de forma constante rinde más que un solo estallido grande. Cada proyecto lleva su propia **racha de proyecto**, los días seguidos que has puesto trabajo real en esa planta específica.

### ¿Qué hace la racha?

::doc-card-grid{:cols="2"}
  ::doc-card{to="#plant-growth" title="Las plantas crecen" description="La racha del proyecto define la etapa de la planta en tu granja: brote, retoño, frondosa, fructífera." icon="sprout"}
  ::

  ::doc-card{to="#ship-bonus" title="Enviar paga más" description="Cada día de racha del proyecto suma +1% al oro que ganas al enviarlo. Diez días = 1.10×." icon="trending-up"}
  ::
::

#### Plant growth

La etapa de cada planta viene directamente de la racha del proyecto:

| Racha del proyecto | Etapa |
|----------------|-------|
| 1-2 días | Brote |
| 3-5 días | Retoño |
| 6-9 días | Frondosa |
| 10+ días | Fructífera |

La etapa por ahora es solo visual, pero es la forma más rápida de ver de un vistazo en qué proyectos has sido constante.

#### Ship bonus

Cuando envías un proyecto, su recompensa en oro se multiplica por `1 + (días de racha del proyecto × 0.01)`. Una racha de 10 días = **1.10× de oro**, una de 30 días = **1.30× de oro**, y así sucesivamente. El multiplicador se guarda en el momento de enviar, así que aguantar una racha larga antes de mandar el envío vale la pena.

### ¿Cómo mantengo vivas mis rachas?

Aquí está la parte que la mayoría malentiende: mientras tus proyectos tengan la **auto-congelación activada** (el valor por defecto, mira más abajo), **no** tienes que tocar cada proyecto todos los días. Registra al menos **1 hora de trabajo en cualquiera de tus proyectos** en un día, y la racha de cada proyecto con auto-congelación activada sigue viva ese día. Llegar a la hora una vez, en un solo proyecto, protege a todos esos proyectos de resetearse.

Esa hora es tu **tiempo de Hackatime y tus horas de diario sumados**:

- **El tiempo de Hackatime** en un proyecto que vinculaste cuenta.
- **Las horas de diario** también cuentan. Cuando publicas un diario anotas cuánto trabajaste, y esas horas se suman a tu Hackatime del día. Así puedes llegar a la hora solo con Hackatime, solo con horas de diario, o una mezcla (por ejemplo 30 min de Hackatime más un diario que registra 30 min). Así es como los proyectos de hardware, o programar fuera de Hackatime, mantienen viva una racha.

Un diario con **0 horas registradas no cuenta por sí solo** cuando tienes menos de una hora de Hackatime ese día. Un día de racha necesita **1 hora en total (Hackatime más tiempo de diario)**.

### ¿Qué racha sube en realidad?

Mantener tus rachas vivas y *hacer crecer* una son dos cosas distintas. Todas tus rachas sobreviven con una sola hora gastada en cualquier lado, pero la racha de un proyecto solo **sube** (y gana el multiplicador de envío más grande) los días en que pones la hora en **ese** proyecto. Los proyectos en los que no trabajas ese día se mantienen firmes (siempre que tengan la auto-congelación activada): no se resetean, solo no crecen. Así que si repartes tu día entre proyectos, ninguno se rompe, pero solo un proyecto que recibió una hora completa avanza.

Si la racha de un proyecto "no subió aunque programé una hora", la hora normalmente cayó bajo un nombre de proyecto de Hackatime distinto, se repartió de modo que ningún proyecto llegó a una hora completa, o hubo un hueco en el seguimiento. Si tu panel muestra menos tiempo total del que esperas, casi siempre es un hueco en el seguimiento de Hackatime. Mira [Hackatime](/docs/hackatime) para saber cómo se cuenta el tiempo.

### ¿Qué pasa si me salto un día?

Un "día perdido" es un día en el que registras **ninguna hora válida en ningún proyecto**, no un día en el que te saltas un proyecto. Para los proyectos con auto-congelación activada, eso es lo único que pone en riesgo tus rachas.

- Si tienes un **congelado de racha**, se gasta automáticamente para cubrir el día perdido y tus proyectos con auto-congelación activada quedan protegidos.
- Si **no te queda ningún congelado**, tus rachas de proyecto se resetean a 0 y las plantas vuelven a la etapa de brote.

**Los congelados de racha** (cómpralos en la [tienda](/docs/shop)) se gastan automáticamente en un día perdido para que no pierdas tu progreso. Puedes guardar hasta 5 a la vez.

::warning{title="Auto-congelación desactivada = racha diaria estricta"}
Cada proyecto tiene una casilla de **auto-congelación** en los ajustes de racha de tu perfil. Si la desmarcas, ese proyecto queda fuera de toda la protección de arriba: la racha de un proyecto sin auto-congelación se resetea a 0 el primer día que no registres una hora válida en **ese proyecto específico**, aunque hayas trabajado en tus otros proyectos ese día, y aunque tengas congelados guardados (nunca se gastan en él). Deja la auto-congelación activada a menos que quieras que esa planta exija trabajo todos los días.
::

::tip{title="¿Cuándo termina un día de racha?"}
Un día de racha va de **medianoche a medianoche en tu hora local**. El trabajo registrado después de medianoche cuenta para el nuevo día de racha. Tu recordatorio se envía X horas antes de ese límite local (mira tus ajustes para el valor exacto). Viajeros: actualiza la zona horaria en los ajustes de tu cuenta si cambia, para que la racha avance cuando lo esperas.
::

::tip{title="No archives el diario que acabas de publicar"}
Archivar un diario el mismo día que lo creaste cuenta como retirarlo, y quita sus horas registradas del total de hoy. Si eso deja tu Hackatime más tiempo de diario combinado en el proyecto por debajo de 1 hora, la racha baja un punto. Restaurarlo ese mismo día vuelve a extender la racha.
::

::tip{title="La racha en palabras simples"}
La racha de cada proyecto es "días seguidos en que trabajé en *esta* planta". Dos proyectos pueden tener rachas muy distintas aunque hayas enviado ambos, ya que cada planta se cuenta de forma independiente.
::

## Oro pendiente en proyectos de hardware

Los proyectos de hardware bloquean su recompensa en oro detrás de un envío de **construcción completa**. Cuando se aprueba un envío de hardware que no es de construcción completa, el oro se registra pero queda pendiente: no cuenta en tu saldo y no puedes gastarlo. Envía un siguiente envío marcado como "construcción completa" en el mismo proyecto y todas las filas pendientes se desbloquean a la vez. La cantidad pendiente se muestra en tu perfil para que sepas qué está en juego.

> El tipo de fruta de tu proyecto se asigna automáticamente según si es software o hardware y el nivel en que está calificado. No eliges tu fruta, pero los proyectos más difíciles ganan más oro por hora.

## Ver también

- [Cómo funcionan los niveles](/docs/how-levels-work), qué paga cada nivel en oro, financiamiento y fruta
- [Hackatime](/docs/hackatime), cómo se rastrea y se cuenta tu tiempo de construcción
- [¿Qué es enviar?](/docs/what-is-shipping), cómo las revisiones convierten horas en oro
- [La tienda](/docs/shop), dónde gastas oro, carambola y congelados de racha
