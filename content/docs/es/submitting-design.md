---
title: Enviando tu diseño
description: Todo lo que tu envío de software o hardware necesita para pasar la revisión, además de qué poner en la URL jugable o de demo.
section: shipping
order: 1
icon: file-check
---
# Enviando tu proyecto

Antes de que un revisor pueda ver tu proyecto y puedas empezar a ganar oro, necesita dos cosas: un **buen README** y un **proyecto completo y funcional**. Esta página recorre ambos, más el campo que la gente confunde con más frecuencia, tu URL jugable o de demo. Esto aplica a **proyectos de software y hardware**.

Queremos que crees [**proyectos reales con shipping**](/docs/what-is-shipping). Que falte cualquiera de los dos requisitos hace que tu proyecto sea devuelto, así que lee ambos con cuidado.

::danger{title="El 95% de los rechazos vienen de problemas que toman 5 minutos arreglar"}
Lee los requisitos abajo con cuidado **antes** de enviar. Archivos faltantes, enlaces rotos o un README poco claro son las razones de rechazo más comunes, y cada una de ellas es barata de arreglar antes de enviar.
::

---

## 1. Un buen README

Tu README es la primera impresión de la gente. Alguien llegando a tu repositorio por primera vez debería entender qué es tu proyecto, qué hace y por qué existe sin abrir un solo archivo.

Como mínimo, tu README debe incluir:

**Descripción:**
- Una breve descripción de qué es tu proyecto y qué lo hace único
- Cómo utilizarlo (sé detallado, otros no pueden leer tu mente)
- Por qué lo hiciste (sé personal, ¿qué problema estás resolviendo?)

**Visuales:**
- **Software:** Una **URL jugable** al sitio desplegado (o una descarga compilada si no se puede desplegar, como una CLI, no el repo pelado). Las capturas de pantalla o un GIF de la app en acción son recomendadas, no obligatorias, siempre que el README explique qué hace el proyecto.
- **Hardware:** Capturas de pantalla de un modelo 3D completo de tu proyecto totalmente ensamblado, renders del PCB si aplica y un diagrama de cableado si no estás usando un PCB. Cuando tu build esté funcionando, agrega además un **video de demo** corto del dispositivo en acción.

**Solo hardware:**
- Una **tabla BOM** con cada material de tu construcción: nombre del material, cantidad, precio y un enlace a dónde comprarlo. Es la misma lista que tu `bom.csv` (mira el checklist del repo abajo), en formato de tabla para que un revisor pueda leerla sin salir del README.
- **Instrucciones de ensamblaje.** Explica cómo se arma el proyecto: cualquier cosa más allá de soldar los componentes donde están etiquetados en el PCB. Orden de cableado, configuración de impresión para las piezas 3D, sujetadores, cómo flashear el firmware. Si construirlo requiere conocimiento que no está escrito en ningún lado, escríbelo aquí.

Para proyectos de software, el README también se valida al enviar: un README vacío se bloquea, y a partir del Nivel 2 necesita al menos 200 caracteres con detalle real. Así que escribe unas cuantas frases, no una sola línea.

---

## 2. Un proyecto completo

Para que tu proyecto esté completo, alguien más debería poder leer tu repo, entenderlo y ejecutarlo o replicarlo. La vara es la **reproducibilidad**: alguien con conocimientos técnicos mínimos debería poder recrear tu proyecto usando solo lo que está en tu envío. Para hardware, eso significa que tu repo tiene todo lo necesario para construir el dispositivo desde cero: la BOM, los archivos de diseño y las instrucciones de ensamblaje.

Un proyecto que solo tú puedes usar no tiene [shipping](/docs/what-is-shipping). Solo vive en tu cabeza.

Antes de enviarlo, tu proyecto también necesita **al menos 1 hora de trabajo real registrada**. En software, eso es tiempo de Hackatime sobre el proyecto vinculado. En hardware, son horas de journals. Los proyectos mixtos pueden usar cualquiera de los dos. No queremos que la cola de revisión se llene de proyectos con casi nada de trabajo todavía.

También necesitarás subir un **thumbnail** antes de poder enviar. Esa es la imagen de portada que la gente ve en la granja y en el feed, y también funciona como el banner de tu proyecto. Tiene que mostrar el **proyecto real**: una captura de pantalla de la app funcionando, o una foto o render del hardware. Un logo, un mockup o una imagen genérica no cuenta, y un revisor te devolverá el ship por eso.

---

## Obteniendo financiación (solo hardware)

Los proyectos de hardware pueden pedir una financiación para los materiales. En el panel del carrito, marca **Necesito financiamiento** antes de enviar. Cuando tu diseño sea aprobado, Hack Club te envía un bono por el costo de construcción que ingresaste, en lugar de otorgar frutas por este ship.

### Financiación por nivel

La financiación está limitada según el [nivel](/docs/how-levels-work) de tu proyecto. El campo de costo de construcción en la página del proyecto aplica estos topes, no te dejará guardar un costo por encima del límite de tu nivel:

<div class="not-prose" style="display:grid;grid-template-columns:repeat(2,1fr);gap:0.75rem;margin:1rem 0">
  <div style="background:rgb(104 77 58/0.05);border:3px solid rgb(104 77 58/0.2);padding:0.85rem 1rem;display:flex;flex-direction:column">
    <div style="font-weight:700;font-size:0.95rem;color:rgb(104 77 58)">Nivel 1 - Principiante</div>
    <div style="font-size:0.8rem;color:rgb(104 77 58/0.75);line-height:1.45;margin-top:0.35rem">Tu primera construcción. LEDs, circuitos simples, matriz LED, soldadura básica, un macropad pequeño.</div>
    <div style="font-weight:700;font-size:0.8rem;color:rgb(104 77 58/0.7);margin-top:auto;padding-top:0.6rem">Hasta $100 de financiación</div>
    <div style="display:flex;align-items:center;gap:0.5rem;margin-top:0.6rem;padding-top:0.6rem;border-top:2px solid rgb(104 77 58/0.15)"><img src="/images/fruits/guava/icon_interior.webp" alt="Guayaba" style="width:1.75rem;height:1.75rem;object-fit:contain"><span style="font-weight:700;font-size:0.8rem;color:rgb(104 77 58)">Guayaba</span></div>
  </div>
  <div style="background:rgb(104 77 58/0.05);border:3px solid rgb(104 77 58/0.2);padding:0.85rem 1rem;display:flex;flex-direction:column">
    <div style="font-weight:700;font-size:0.95rem;color:rgb(104 77 58)">Nivel 2 - Intermedio</div>
    <div style="font-size:0.8rem;color:rgb(104 77 58/0.75);line-height:1.45;margin-top:0.35rem">Un dispositivo que tú diseñas y construyes, como un portátil, registrador de sensores, placa de desarrollo o teclado completo.</div>
    <div style="font-weight:700;font-size:0.8rem;color:rgb(104 77 58/0.7);margin-top:auto;padding-top:0.6rem">Hasta $200 de financiación</div>
    <div style="display:flex;align-items:center;gap:0.5rem;margin-top:0.6rem;padding-top:0.6rem;border-top:2px solid rgb(104 77 58/0.15)"><img src="/images/fruits/coco/icon_interior.webp" alt="Coco" style="width:1.75rem;height:1.75rem;object-fit:contain"><span style="font-weight:700;font-size:0.8rem;color:rgb(104 77 58)">Coco</span></div>
  </div>
  <div style="background:rgb(104 77 58/0.05);border:3px solid rgb(104 77 58/0.2);padding:0.85rem 1rem;display:flex;flex-direction:column">
    <div style="font-weight:700;font-size:0.95rem;color:rgb(104 77 58)">Nivel 3 - Avanzado</div>
    <div style="font-size:0.8rem;color:rgb(104 77 58/0.75);line-height:1.45;margin-top:0.35rem">Varios subsistemas trabajando juntos: un robot que siente y se mueve, un wearable con conexión inalámbrica, un dispositivo con firmware personalizado.</div>
    <div style="font-weight:700;font-size:0.8rem;color:rgb(104 77 58/0.7);margin-top:auto;padding-top:0.6rem">Hasta $400 de financiación</div>
    <div style="display:flex;align-items:center;gap:0.5rem;margin-top:0.6rem;padding-top:0.6rem;border-top:2px solid rgb(104 77 58/0.15)"><img src="/images/fruits/watermelon/icon_interior.webp" alt="Sandía" style="width:1.75rem;height:1.75rem;object-fit:contain"><span style="font-weight:700;font-size:0.8rem;color:rgb(104 77 58)">Sandía</span></div>
  </div>
  <div style="background:rgb(104 77 58/0.05);border:3px solid rgb(104 77 58/0.2);padding:0.85rem 1rem;display:flex;flex-direction:column">
    <div style="font-weight:700;font-size:0.95rem;color:rgb(104 77 58)">Nivel 4 - Experto</div>
    <div style="font-size:0.8rem;color:rgb(104 77 58/0.75);line-height:1.45;margin-top:0.35rem">Robots autónomos, SBCs personalizadas, proyectos FPGA, sistemas satelitales, construcciones mecánicas complejas.</div>
    <div style="font-weight:700;font-size:0.8rem;color:rgb(104 77 58/0.7);margin-top:auto;padding-top:0.6rem">Hasta $1000 de financiación</div>
    <div style="display:flex;align-items:center;gap:0.5rem;margin-top:0.6rem;padding-top:0.6rem;border-top:2px solid rgb(104 77 58/0.15)"><img src="/images/fruits/avocado/icon_interior.webp" alt="Aguacate" style="width:1.75rem;height:1.75rem;object-fit:contain"><span style="font-weight:700;font-size:0.8rem;color:rgb(104 77 58)">Aguacate</span></div>
  </div>
</div>

Los proyectos de nivel L4 Experto pueden pedir hasta **$1000**, pero esas solicitudes reciben un análisis extra por parte de los revisores al momento de revisar el diseño. Si tu proyecto genuinamente necesita más que el tope de tu nivel, pregunta en **#macondo-help** en Slack antes de enviar para resolverlo caso por caso.

Cuando marcas financiación, también necesitarás al menos una **captura del carrito o de la lista de materiales** y un **costo total de construcción** llenados, así es como los revisores ven qué estás comprando y verifican el monto en dólares.

Una vez que tus materiales lleguen y hayas construido el proyecto de verdad, vuelve y envía un [ship de actualización](/docs/submitting-build) con la casilla de financiamiento sin marcar. Ese ship gana oro por las horas que pasaste construyendo. Puedes seguir iterando con más ships de actualización si algo se rompe después, cada uno pidiendo más financiamiento o ganando oro por tu trabajo.

### Para proyectos de software, tu repositorio debería tener:

- Todo el código fuente (no solo una compilación)
- Un archivo de dependencias (`package.json`, `requirements.txt`, `Cargo.toml`, etc.)
- Instrucciones claras de configuración: cómo instalar dependencias, cómo ejecutarlo localmente
- Un `.gitignore` que excluya `node_modules`, `.env`, carpetas de build, etc.
- Un enlace de demo o despliegue funcional, si es posible

### Para proyectos de hardware, tu repo debería tener:

- Una BOM (Lista de materiales) como archivo `bom.csv` con **cada material** de la construcción, su cantidad, precio y un enlace a dónde se puede comprar cada uno. La misma lista va también como tabla en tu README (mira arriba).
- Archivos fuente de tu PCB (.kicad_pro, .kicad_sch, .kicad_pcb, o equivalente de EasyEDA, más gerbers.zip)
- Archivos .STEP de tu CAD 3D y el archivo de diseño fuente (.f3d, .FCStd, o enlace de Onshape)
- Código fuente del firmware, si aplica, con instrucciones de compilación
- Instrucciones de ensamblaje en el README que cubran cualquier cosa más allá de soldar los componentes donde están etiquetados en el PCB
- Cualquier otro archivo que sea parte de tu proyecto

::tip{title="La prueba de reproducibilidad"}
¿Podría un desconocido con habilidades básicas de soldadura construir tu proyecto exacto este fin de semana, usando solo tu repo? Si tendría que escribirte con una pregunta, la respuesta pertenece a tu README.
::

### Ambos deberían ser:

- Tu propio trabajo. El código con ayuda de IA está bien si lo entendiste, lo puliste y puedes explicarlo. No copiado de un tutorial, no el proyecto de alguien más.
- Bien organizado con una estructura de carpetas clara y nombres de archivos sensatos
- Verificado por alguien más. Pregúntale a un amigo o pregunta en #macondo en Slack antes de enviar.

---

## URL del proyecto: ¿enlace jugable o video de demo?

Cada ship tiene un **único campo de URL** en su página del proyecto, etiquetado como **Playable Demo URL**. Es el mismo campo ya sea que envíes software o hardware, pero lo que esperamos que pongas ahí cambia según el tipo. Poner lo equivocado es una de las razones más comunes por las que un ship es devuelto, así que aquí está exactamente qué va dónde.

### Ships de software: un enlace jugable

Pega el **enlace desplegado** para que un revisor pueda hacer clic y probar tu proyecto en su navegador. Si tu proyecto realmente no es desplegable (una CLI, una app de escritorio, un script que alguien corre localmente), enlaza en su lugar una **descarga compilada** que un revisor pueda ejecutar, un binario o instalador, o una página de GitHub `/releases`. Un repo de código pelado no es un enlace jugable, así que pon tu código en el campo **Repositorio** aparte, no aquí.

Algunas cosas que **no** pasan para software, para que no te tomen por sorpresa:

- Un repo de código pelado, una página de navegación `/tree` o `/blob`, o un archivo fuente crudo (como `bagel.cpp`). Enlaza el sitio en funcionamiento en su lugar. Una página de GitHub `/releases` o `/tags`, o una descarga directa de una compilación lista (`.exe`, `.dmg`, `.apk`, un `.zip` del binario) está bien cuando tu proyecto es una app descargable.
- Un **video**. Los videos son prueba de construcción solo para hardware, nunca un demo de software.
- Un host gratuito que se duerme cuando está inactivo (Render, Replit, Glitch y similares). Funciona cuando está despierto, pero un revisor que lo abre más tarde a menudo lo encuentra caído y le pone una multa. Prefiere un host que se mantenga arriba: GitHub Pages, Netlify, Vercel o Cloudflare Pages.

El enlace jugable es **siempre obligatorio** para ships de software.

### Ships de hardware: un video de demo

Para hardware, el mismo campo significa algo distinto: un **video** corto y público que prueba que el dispositivo funciona en la vida real. El hardware no se puede cargar en un navegador, así que no podemos probarlo nosotros mismos. El video es la forma en la que los revisores verifican la construcción. Un enlace de YouTube no listado, un Loom, un canvas de Slack con video, o cualquier clip público sirven.

Cuándo necesitas el video depende de qué tipo de ship de hardware sea este:

| Tipo de ship | Qué es | Video de demo |
|---|---|---|
| Design ship | Solicitando financiamiento para comprar piezas, todavía no construido | Opcional |
| Build ship | Sin solicitar financiamiento (costeado por ti o ya recibiste un grant) | Obligatorio |

Para un **design ship**, el archivo fuente CAD, la BOM y los archivos de PCB en tu repo son la prueba, así que el video es opcional. Puedes dejar el campo vacío, o pegar un render giratorio o un enlace de animación si tienes uno.

Para un **build ship**, necesitamos ver el dispositivo encendido, haciendo lo que dice tu README que hace. Así es como los revisores saben que la construcción es real antes de desbloquear tus frutas pendientes, por eso el video es obligatorio.

Para un **ship solo-CAD** (sin electrónica) las reglas son distintas. Pasa a **Detalles específicos de CAD** abajo, donde el campo de URL lleva un enlace de Printables en lugar de un video.

> ¿Por qué un solo campo, dos significados? El software corre en línea, así que los revisores pueden jugarlo. El hardware corre en tu cuarto, así que los revisores necesitan video. Mismo campo de nuestro lado, expectativas distintas del tuyo.

---

## Detalles específicos de CAD

Si tu proyecto involucra modelado 3D, diseño paramétrico o cualquier cosa que se pueda imprimir en 3D, esto es lo que esperamos. Usa una herramienta de CAD real, envía el archivo fuente y haz que sea imprimible.

### Editores de CAD aprobados

Usa uno de:

- Fusion 360
- Onshape
- Shapr3D
- Solidworks
- FreeCAD
- OpenSCAD
- Blender
- Solvespace

**TinkerCAD no se acepta.** Es genial para aprender, pero no produce los archivos fuente paramétricos que necesitamos para verificar tu trabajo. Si quieres usar una herramienta que no está en esta lista, primero pregunta en **#macondo-help** en Slack.

### Entregables de CAD requeridos

Para cualquier parte de tu proyecto basada en CAD, tu repositorio debe incluir:

- El **archivo fuente nativo** de tu editor (`.f3d` para Fusion 360, `.FCStd` para FreeCAD, `.scad` para OpenSCAD, `.blend` para Blender, etc.). Para editores en la nube como Onshape o Shapr3D, incluye un enlace público en el README.
- Un archivo **`.STEP`** exportado para cada pieza que diseñaste. Los revisores lo usan para inspeccionar la geometría sin instalar tu editor.
- Un archivo **`.STL`** exportado para cada pieza que planeas imprimir en 3D, junto al .STEP.
- Una nota breve en el README explicando cómo encajan las piezas (orden de ensamblaje, sujetadores, tolerancias si son relevantes).

### Design ships para proyectos de CAD

Un proyecto solo-CAD puede enviar un **design ship** antes de imprimir, igual que los proyectos de electrónica. La única diferencia: la URL de demo no es opcional y no es un video, es tu enlace de Printables (ver abajo).

Para el build ship que sigue, **tienes que imprimir la pieza en la vida real**. Un render, una vista previa del slicer o un .STL sin imprimir no bastan. Si no podemos ver prueba de que la imprimiste, no podemos aprobar el build.

### Campo de URL e imágenes para un ship de CAD

Para **todo ship de CAD, design o build**, sube tu modelo a [Printables](https://www.printables.com/) y pega el enlace de la página de Printables en el campo de URL del proyecto. Para los ships de CAD esa es tu URL jugable, un revisor debería poder descargar los mismos archivos que tú imprimes.

Cuando ya esté impresa tu pieza:

- Agrega una **foto real de la pieza impresa** junto a las capturas del modelo 3D. No un render, una foto real tomada con el celular del objeto impreso encima de un escritorio, en tu mano, donde sea, real.
- Asegúrate de que el repo todavía tenga el archivo fuente nativo, .STEP y .STL exportados que se listan en "Entregables de CAD requeridos" arriba.

### ¿Sin impresora 3D? Pide ayuda en la Printing Legion

Si no tienes acceso a una impresora, pregunta en [**#printing-legion**](https://hackclub.slack.com/archives/C083P4FJM46) en Slack y alguien ahí puede imprimir tu modelo y enviártelo por correo. Más info en [printlegion.hackclub.com](https://printlegion.hackclub.com/). Aún necesitas una foto real de la impresión terminada cuando llegue, la regla es la misma.

---

## Qué NO incluir

- Código, diseños o gráficos generados por IA enviados sin tu propio pulido, pruebas o entendimiento
- Proyectos copiados de otras personas (referenciar y dar crédito está bien, presentar su trabajo como tuyo no)
- Journals escritos por IA (los journals siempre deben estar en tu propia voz)
- Archivos fuente faltantes o repos incompletos

> Cualquier proyecto que incluya contenido robado, material generado por IA sin revisar y presentado como propio, u otro trabajo fraudulento puede ser permanentemente rechazado y podría resultar en una prohibición del programa.

¿Atascado en algo de esto, o no estás seguro de que tu proyecto esté listo? Es normal. Pregunta en **#macondo-help** en Slack antes de enviar, una verificación rápida vale más que un ship devuelto.

---

## Ejemplos de proyectos con buen shipping

### Software

- [**DoomPDF**](https://github.com/ading2210/doompdf). Doom (1993) ejecutándose dentro de un documento PDF. Excelente README, instrucciones claras de compilación y un concepto salvaje.
- [**Vert**](https://github.com/VERT-sh/VERT). Un convertidor de archivos que usa WebAssembly para convertir archivos en tu dispositivo. UI limpia, desplegado y bien documentado.
- [**Specter**](https://github.com/ayessaaa/specter). Un juego sobre un caballero escapando de una cueva, acechado por su propio fantasma. Arte original, jugabilidad pulida y un repo sólido.
- [**Blind Defusal**](https://github.com/Jayx2u/blind-defusal). Un juego cooperativo de dos jugadores para desactivar bombas. README claro con capturas de pantalla e instrucciones de configuración.

### Hardware

<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:1rem;margin:1rem 0;text-align:center;max-width:500px"><div><a href="https://github.com/notaroomba/cyberboard" target="_blank" style="text-decoration:none;color:inherit"><img src="/images/docs/design-cyberboard.webp" alt="Cyberboard" style="width:100%;aspect-ratio:1;object-fit:cover;border:3px solid rgb(104 77 58/0.2)" /><div style="margin-top:0.5rem;font-size:0.8rem;font-weight:600;color:rgb(104 77 58);text-decoration:underline">Cyberboard de NotARoomba</div></a></div><div><a href="https://github.com/KOEGlike/mito" target="_blank" style="text-decoration:none;color:inherit"><img src="/images/docs/design-split-keyboard.webp" alt="Teclado dividido" style="width:100%;aspect-ratio:1;object-fit:cover;border:3px solid rgb(104 77 58/0.2)" /><div style="margin-top:0.5rem;font-size:0.8rem;font-weight:600;color:rgb(104 77 58);text-decoration:underline">Teclado dividido de KOEGlike</div></a></div><div><a href="https://github.com/KaiPereira/Cheetah-MX4-Mini" target="_blank" style="text-decoration:none;color:inherit"><img src="/images/docs/design-cheetah.webp" alt="Cheetah MX4" style="width:100%;aspect-ratio:1;object-fit:cover;border:3px solid rgb(104 77 58/0.2)" /><div style="margin-top:0.5rem;font-size:0.8rem;font-weight:600;color:rgb(104 77 58);text-decoration:underline">Cheetah MX4 Mini de Kai</div></a></div></div>

---

## Ver también

- [¿Qué es shipping?](/docs/what-is-shipping) , cómo funcionan las revisiones y aprobaciones
- [Cómo funcionan los niveles](/docs/how-levels-work) , qué paga cada nivel en oro, financiación y frutas
- [Consiguiendo materiales](/docs/sourcing-parts) , cómo funcionan las financiaciones de hardware de principio a fin
- [Enviando un build](/docs/submitting-build) , el ship de actualización después de que lleguen tus materiales
