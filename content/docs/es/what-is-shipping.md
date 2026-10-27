---
title: ¿Qué es shipping?
description: Hacer shipping vuelve público tu proyecto y lo envía a revisión. Cuando un revisor lo aprueba, ganas oro. Aquí está todo el flujo.
section: shipping
order: 0
icon: package
---
# ¿Qué es "shipping"?

**Hacer shipping significa volver público tu proyecto y enviarlo a revisión.** Cuando un revisor lo aprueba, ganas oro por las horas que le pusiste. Ese oro compra cosas en la [tienda](/docs/shop), financia construcciones de hardware y cuenta para el viaje.

Un proyecto que solo vive en tu computadora no puede pasar por shipping. Solo tú puedes verlo, nadie más puede aprender de él, y en unos años no recordarás mucho sobre él. El shipping arregla eso. Es casi tan importante como el proyecto mismo.

## Lo que necesitas antes de hacer shipping

Tres mínimos convierten una carpeta de archivos en algo a lo que puedes hacerle shipping. Hazlos bien y el resto es fácil.

### 1. Documenta qué es tu proyecto

- **Por qué** lo construiste: tu motivación y tu historia.
- Una breve descripción de **qué hace**.
- **Cómo todo encaja**, con fotos para el hardware.

### 2. Hazlo comprensible y organizado

Todos los archivos y recursos deberían ser fáciles de encontrar y estar bien organizados. Incluye los archivos fuente para que alguien más pueda replicar o construir sobre tu trabajo. Un montón de archivos con un README de dos frases hace difícil que alguien reconozca tu trabajo o aprenda de él.

### 3. Hazlo público y en línea

Tu proyecto tiene que vivir en **GitHub** donde otras personas puedan leerlo y clonarlo. Repos privados y "descarga este zip de Google Drive" no cuentan.

::warning{title="El uso intensivo de IA sin pulir será rechazado"}
La IA está permitida cuando el resultado es trabajo que de verdad entiendes y has pulido. Un proyecto que es mayormente salida cruda de IA, sin revisión humana, refinamiento ni iteración encima, será rechazado en revisión. Los revisores te pedirán que expliques cómo funciona tu código, y "lo escribió la IA" no es una respuesta. Mira [Arregla mi proyecto](/docs/fix-my-project#6-too-much-ai) para saber cómo recuperarte si tu proyecto fue marcado por esto.
::

Así llegas al mínimo 3:

- ¿Nuevx en GitHub? Sigue primero la página de [Configuración de software](/docs/environment). Te guía para instalar GitHub Desktop y hacer tu primer commit.
- Crea un repositorio público. En GitHub Desktop, ve a **File → New repository**, nómbralo como tu proyecto, NO marques "Keep this code private", y haz push.
- Escribe un README real: una línea que diga qué es, un párrafo corto sobre por qué lo construiste, instrucciones de instalación para quien quiera probarlo, y fotos para proyectos de hardware. La página [¿Qué es un buen proyecto?](/docs/resources) tiene ejemplos.
- Agrega un archivo `LICENSE`. Cualquier licencia de código abierto sirve (MIT, Apache 2.0, GPL, y demás); MIT es solo la opción más sencilla si no tienes preferencia. El botón "Add file" de GitHub tiene una plantilla para cada una. Si construyes sobre el trabajo de código abierto de alguien más, respeta su licencia y dale crédito en tu README.
- Agrega topics en la página del repo (por ejemplo `hardware`, `pcb`, `keyboard`) para que el proyecto sea fácil de encontrar. Fíjalo en tu perfil de GitHub cuando te sientas orgullosx de él.

## ¿Cómo hago el shipping de verdad?

Cuando tu proyecto esté listo, abre su página de proyecto y busca la sección **Enviar a revisión**. Macondo corre una checklist rápida (repo de GitHub, README, miniatura, una dirección de envío en tu cuenta de Hack Club y suficiente tiempo registrado), y el botón se queda bloqueado hasta que cada elemento esté en verde. Luego pulsa **Enviar a revisión**.

Una regla de la miniatura que sorprende a mucha gente: tiene que ser una **captura o foto de tu proyecto funcionando**, no un logo ni una imagen genérica. Es el banner de tu proyecto y los revisores lo revisan. Un ship cuyo banner no muestra el proyecto real vuelve con cambios solicitados, así que ahórrate la vuelta.

El envío puede tardar hasta un minuto mientras corremos verificaciones automáticas en segundo plano. Eso es normal. No cierres la página.

Después de enviar, tu proyecto entra en la **cola de revisión** y sus detalles y journals quedan en solo lectura hasta que la revisión termine. Tu racha está protegida mientras esperas.

## ¿Qué pasa en la revisión?

Un revisor es una persona real que abre tu proyecto, lee tu README y tus journals, revisa tus horas registradas y decide una de tres cosas:

| Decisión | Qué significa | Qué haces después |
|---|---|---|
| **Aprobado** | Tu trabajo está en regla. El oro llega a tu balance. | Nada. Ve a gastarlo, o haz shipping de una actualización. |
| **Cambios solicitados** | Algo hay que arreglar primero. El revisor te dice qué. | Arréglalo, luego **Reenviar a revisión**. |
| **Rechazado** | El ship no se puede aceptar así. | Un revisor puede reabrirlo, pero un rechazo permanente es final. |

Cuando un revisor pide cambios, recibirás un mensaje que explica qué arreglar, en la app y por Slack y correo. El proyecto vuelve a tus manos para que puedas editarlo. Haz los arreglos, luego pulsa **Reenviar a revisión** para mandarlo de vuelta a la cola.

## Si reenvío, ¿a dónde va el tiempo de en medio?

**Tus horas se cuentan hasta el momento en que pulsas Enviar.** Todo lo que registraste hasta ese clic (dentro de la ventana del programa, y menos lo que un ship aprobado anterior ya pagó) es lo que se revisa y se paga en ese envío. El trabajo que registras después de enviar se acredita a tu **siguiente** envío, así que nada se pierde y nada se paga dos veces.

En concreto:

- **Un revisor pide cambios y reenvías.** Las horas se vuelven a contar cuando reenvías, así que el tiempo que pasaste haciendo los arreglos queda incluido en ese reenvío.
- **Tu ship es aprobado y luego haces shipping de una actualización.** La actualización paga solo el trabajo hecho después del momento de envío del ship aprobado. El tiempo que registraste mientras el ship aprobado esperaba en la cola cuenta para la actualización.

## ¿Cuándo recibo mi oro?

**Al aprobar.** Las horas que un revisor aprueba se pagan como oro directo a tu balance, usando la tasa del nivel de tu proyecto y tu multiplicador de racha. Mira [Cómo funcionan los niveles](/docs/how-levels-work) para la tabla de oro por hora y [Moneda](/docs/currency) para cómo el multiplicador de racha se suma encima.

Para **hardware** que pidió financiamiento de partes, la aprobación pone en cola un grant en lugar de oro (o junto con él). Mira [Conseguir partes](/docs/sourcing-parts) para saber cómo funciona el financiamiento.

::warning{title="Los revisores pueden ajustar tus horas"}
Un revisor te paga por las horas que puede **verificar**, que no siempre es el número crudo de tu panel. Si tu tiempo registrado no está respaldado por trabajo visible (commits, entradas de diario, una demo funcionando), pueden bajarlo. Esto es normal y no un castigo, es cómo las recompensas se mantienen justas para todos. La forma de evitar una sorpresa es simple: haz commits seguido, escribe diarios sobre la marcha, y mantén tu tiempo registrado honesto. Si tus horas se reducen, el revisor te dirá por qué.
::

## ¿Puedo volver a hacer shipping después de la aprobación?

**Sí.** Una vez que un proyecto tiene un ship aprobado, tu siguiente envío es un **ship de actualización**. Sigues construyendo, luego haces shipping de nuevo para que te paguen por el trabajo nuevo.

Dos cosas son obligatorias en una actualización:

- **Márcalo como actualización.** La página del proyecto tiene un toggle para esto. Macondo también lo detecta automáticamente a partir de tu ship aprobado anterior.
- **Describe qué cambió.** Una nota corta en lenguaje simple para que el revisor (y tú, más adelante) pueda ver qué hay de nuevo.

Un ship de actualización también tiene que contener **trabajo nuevo real** desde tu última aprobación: más tiempo registrado en Hackatime, o un journal nuevo con horas reales. No puedes cobrar dos veces por el mismo trabajo. Si haces shipping de una URL que ya fue enviada en otro lado, se te pedirá que la marques como actualización y expliques qué agregaste antes de que pase.

## ¿Por qué sube mi número en la cola de revisión?

Eso es normal, y no significa que hiciste algo mal. La cola es **primero en entrar, primero en salir**, y tu "#X de Y" cuenta cada proyecto de tu tipo (software o hardware) que está esperando ahora mismo. A medida que más makers hacen shipping, el total sube, así que el número puede crecer incluso mientras esperas sin moverte. Software y hardware tienen colas separadas, así que un ship de hardware solo avanza cuando se revisan otros ships de hardware, y lo mismo para software.

Tu página de proyecto también muestra una estimación aproximada de tiempo basada en cuánto han tardado las revisiones recientes. Es una conjetura, no una promesa.

---

## Ejemplos de proyectos con buen shipping

### Por Hack Clubbers

Todos estos fueron construidos por adolescentes. Fíjate cómo cada uno tiene un README claro, código fuente y puedes entender inmediatamente qué hace:

**Software:**
- [**DoomPDF**](https://github.com/ading2210/doompdf). Doom (1993) ejecutándose dentro de un documento PDF. Por Allen, 18.
- [**Vert**](https://github.com/VERT-sh/VERT). Un convertidor de archivos que usa WebAssembly para convertir archivos en tu dispositivo. Por Maya, 17.
- [**Specter**](https://github.com/ayessaaa/specter). Un juego sobre un caballero que escapa de una cueva, acechado por su propio fantasma. Por Ayessa, 18.
- [**Blind Defusal**](https://github.com/Jayx2u/blind-defusal). Un juego cooperativo de dos jugadores para desactivar bombas. Por Joshua, 17.

**Hardware:**

<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:1rem;margin:1rem 0;text-align:center;max-width:560px"><div><a href="https://github.com/notaroomba/cyberboard" target="_blank" style="text-decoration:none;color:inherit"><img src="/images/docs/project-cyberboard.webp" alt="Cyberboard V2" style="width:100%;aspect-ratio:1;object-fit:cover;border:3px solid rgb(104 77 58/0.2);border-radius:0" /><div style="margin-top:0.5rem;font-size:0.9rem;font-weight:700;color:rgb(104 77 58);text-decoration:underline">Cyberboard V2</div><div style="font-size:0.75rem;color:rgb(104 77 58/0.7)">por Nathan, 18</div></a></div><div><a href="https://github.com/geg-tech/biblicallyaccuratekeyboard" target="_blank" style="text-decoration:none;color:inherit"><img src="/images/docs/project-keyboard.webp" alt="Biblically Accurate Macropad" style="width:100%;aspect-ratio:1;object-fit:cover;border:3px solid rgb(104 77 58/0.2);border-radius:0" /><div style="margin-top:0.5rem;font-size:0.9rem;font-weight:700;color:rgb(104 77 58);text-decoration:underline">Biblically Accurate Macropad</div><div style="font-size:0.75rem;color:rgb(104 77 58/0.7)">por Alex, 16</div></a></div><div><a href="https://github.com/ConfusedHello/USB-Mic/" target="_blank" style="text-decoration:none;color:inherit"><img src="/images/docs/project-usb-mic.webp" alt="USB Mic" style="width:100%;aspect-ratio:1;object-fit:cover;border:3px solid rgb(104 77 58/0.2);border-radius:0" /><div style="margin-top:0.5rem;font-size:0.9rem;font-weight:700;color:rgb(104 77 58);text-decoration:underline">USB Mic</div><div style="font-size:0.75rem;color:rgb(104 77 58/0.7)">por Brandon</div></a></div></div>

También vale la pena revisar: [**LibrePods**](https://github.com/kavishdevar/librepods), AirPods liberados del ecosistema de Apple. Por Kavish, 17.

### Fuera de Hack Club

Estos son proyectos de código abierto reales con excelente documentación. Fíjate cómo todos tienen instrucciones y son públicos para que cualquiera aprenda de ellos:

- [**DuckyPad:** Macropad mecánico que hace de todo](https://github.com/dekuNukem/duckyPad)
- [**Voron 0:** Impresora 3D de código abierto](https://github.com/VoronDesign/Voron-0)
- [**Excalidraw:** Pizarra virtual para bocetos](https://github.com/excalidraw/excalidraw)
- [**CharlieBoard:** Mapa del metro de Boston en vivo](https://github.com/tomunderwood99/CharlieBoard)

## Ver también

- [Cómo funcionan los niveles](/docs/how-levels-work) , qué paga cada nivel en oro, financiamiento y fruta
- [Moneda](/docs/currency) , cómo funcionan el oro, las rachas y el conteo de fruta
- [Journals](/docs/journals) , cómo funcionan las actualizaciones diarias y las horas registradas
- [Arregla mi proyecto](/docs/fix-my-project) , cómo recuperarte cuando un ship es marcado o rebotado
- [Conseguir partes](/docs/sourcing-parts) , cómo funcionan los grants de financiamiento de hardware
