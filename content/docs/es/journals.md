---
title: Buen diario
description: Escribe entradas de diario que se aprueben, registra tus horas y mantén viva tu racha.
section: hardware
order: 1
icon: notebook-pen
---
# Buen diario

**Una entrada de diario es un resumen corto de un bloque de trabajo, más una foto o dos y las horas que dedicaste.** Publicas una mientras construyes, registra tu tiempo, mantiene viva la racha de tu proyecto y es la evidencia que lee un revisor cuando haces ship. Los buenos diarios consiguen que se aprueben tus horas. Los flojos o escritos por IA te rebotan.

Aquí está toda la tarea: escribe qué hiciste y **por qué**, muestra una foto y registra horas honestas. Eso es todo. El resto de esta página es cómo hacerlo bien.

## ¿Por qué importa mi diario?

Estás construyendo algo nuevo. Aprendiendo nuevas habilidades, cometiendo errores, tomando decisiones. Cuando mires tu proyecto en unos años, probablemente no recordarás la mayoría de eso.

**Llevar un diario es el recuerdo de tu viaje. También es un tesoro de conocimiento del que otros pueden aprender.**

Sin un diario, tus pasos no están documentados. ¿Cómo armaste esto? ¿Por qué hiciste X en lugar de Y? Llevar un diario permite que otros vean tu proceso de pensamiento y tus errores.

Los revisores también usan tus diarios. Después de enviar tu diseño, los revisores verifican tu trabajo para asegurarse de:

1. Tus decisiones tengan sentido
2. Tu trabajo sea original
3. Tu diseño cumple con los [requisitos de envío](/docs/submitting-design)

También hay un lado de recompensa. Las horas que registras en los diarios cuentan dentro de tus horas aprobadas cuando haces ship, y mantienen avanzando la racha de tu proyecto. Mira [Moneda](/docs/currency) para ver cómo las horas se convierten en oro.

## ¿Qué va en una entrada de diario?

Cuando publicas una entrada, llenas algunas cosas. La plataforma las verifica antes de guardar:

| Campo | Qué es | La regla |
|---|---|---|
| Título | Una línea corta que describe la entrada | Obligatorio, 75 caracteres o menos |
| Contenido | Tu resumen del trabajo | Obligatorio, al menos 100 caracteres de escritura real (las imágenes no cuentan) |
| Imagen | Una foto o captura de pantalla del trabajo | Obligatoria (hardware necesita más para sesiones largas, mira abajo) |
| Horas | Cuánto trabajaste | Se registran en pasos de 0.1 horas, hasta 20 por entrada |

Si una sesión duró más de 20 horas, divídela en varias entradas. De todos modos, cortas y frecuentes le ganan a un solo volcado gigante.

## ¿Cómo escribo una buena entrada?

Un buen diario es una historia. *Tu historia.*

No necesitas inglés o gramática perfectos. La IA no conoce tu historia, así que escribirá diarios malos. No la uses.

::warning{title="Nada de IA en los diarios"}
Los revisores pueden notar cuando un diario está generado por IA, y los diarios escritos por IA son motivo de rechazo. Escríbelo tú, incluso si crees que tu escritura es mala. Lo honesto le gana a lo pulido.
::

::tip
Escribe una entrada por cada día de trabajo o cuando alcances un hito. Cortas y frecuentes le ganan a largas y ocasionales.
::

### Explica tus decisiones, no solo tus acciones

La parte más importante de una entrada de diario es explicar *por qué*, no solo *qué*. Cada entrada debería responder:

- ¿Qué hiciste?
- ¿Por qué lo hiciste?
- ¿Qué problemas enfrentaste?

### Captura y documenta todo

*Todo.* Toma capturas de pantalla de tu trabajo en cada paso significativo, no solo cuando está pulido. Muestra los intermedios desordenados. Muestra el antes y el después cuando arregles algo. Lo mismo aplica para las fotos cuando trabajas en construcciones físicas.

Para hardware, la cantidad de imágenes escala con las horas que registras: aproximadamente **una imagen por cada 5 horas de trabajo**, con al menos una en cada entrada. Una entrada de 20 horas respaldada por una sola captura no es revisable, así que reparte las fotos a lo largo del trabajo.

### Comete errores. Descríbelos. Arréglalos.

Cometerás errores. Footprints que están mal, cableado que hay que rehacer. Escribe sobre ellos, luego arréglalos. Un diario sin errores es un manual, no un diario.

## ¿Puedo poner un video en mi diario?

Sí. Los videos son geniales para mostrar algo funcionando, un timelapse o un paso de construcción complicado. La única regla: **los enlaces de video deben estar alojados en `cdn.hackclub.com`**. Sube a través de los botones de formato del editor de diario y aterriza en el CDN por ti. Lo mismo pasa con las imágenes, deben ser URLs de `cdn.hackclub.com`, lo cual el botón de subir maneja automáticamente.

Un enlace normal a un video de YouTube está bien para pegarlo en tu texto. La regla del CDN solo aplica a los enlaces directos a archivos de video (cosas que terminan en `.mp4`, `.mov`, `.webm` y similares).

## ¿Puedo registrar el tiempo que pasé aprendiendo?

El tiempo que dedicas al proyecto cuenta cuando es trabajo real sobre el proyecto, incluyendo el descubrir cosas y los falsos comienzos. La regla exacta de qué horas cuentan para tu recompensa y tu racha (el tiempo de Hackatime más las horas de diario que registras, y el piso de 1 hora por día) vive en un solo lugar para que se mantenga consistente. Mira [Moneda](/docs/currency) para el desglose completo, y registra tus horas honestamente en la entrada.

---

## Horas de arte y assets

Muchos proyectos registran horas de arte, diseño y assets a través de diarios: sprite art, mockups de UI, música, modelos 3D, diseño de niveles, etc. Esas horas cuentan dentro de tu total aprobado junto con las horas de código o construcción.

Como regla general, **las horas de arte y assets no deberían superar aproximadamente el 40% del total de horas aprobadas de tu proyecto.** Los revisores pueden hacer excepciones cuando el arte es de calidad excepcional y eleva claramente el proyecto, pero la vara para una excepción es pulido auténtico, trabajo original e intermedios documentados en tus entradas de diario. Bocetos rápidos, assets genéricos de stock y arte generado por IA no calificarán para la excepción.

### Graba un timelapse del trabajo artístico

La forma más confiable de respaldar las horas de arte y assets es un **timelapse del trabajo**. [Lapse](https://lapse.hackclub.com) está hecho exactamente para esto y funciona genial para arte digital, Figma, producción musical y similares. También puedes grabar tu pantalla manualmente si prefieres.

Cuando registres la entrada de diario, **incluye un enlace al video del timelapse** para que los revisores puedan verificar las horas. Súbelo a YouTube (sin listar funciona perfecto) y pega el enlace, o alójalo en un CDN o almacenamiento de archivos y enlaza la URL reproducible. Pon el enlace directamente en el texto del diario para que el revisor no tenga que buscarlo.

Si tu proyecto es por naturaleza muy artístico y quieres que cada hora cuente, haz que los diarios lo muestren: referencias, iteraciones, fotos del antes y el después, el enlace al timelapse y un proceso de pensamiento claro. Aplica el mismo estándar de "Explica tus decisiones, no solo tus acciones".

---

## Qué hacer y qué no

| Hacer | No hacer |
|:---|:------|
| Explicar qué hiciste, por qué lo hiciste y cómo | Decir solo qué hiciste sin explicar por qué |
| Capturar y documentar TODO | Tener declaraciones genéricas como "lo cableé" o "hice CAD" |
| Describir tus errores | Mostrar solo el producto final |

---

## Ejemplos

### Mala entrada de diario

<div style="background:rgb(104 77 58/0.1);border:3px solid rgb(104 77 58/0.2);padding:1.25rem;margin:1rem 0">
<p style="margin:0 0 1rem 0">Agregué un convertidor reductor y lo cableé. Hice CAD y agregué una carcasa. ¡Soldé todo y funcionó!</p>
<img src="/images/docs/journal-bad.webp" alt="Ejemplo de mal diario" style="border:3px solid rgb(104 77 58/0.2);max-width:200px" />
</div>

Qué está mal con esto:
- ¿Por qué hiciste esto?
- ¿Para qué son el convertidor reductor y la carcasa?
- ¿Qué características tiene la carcasa? ¿Algún diseño especial?
- ¿Cómo probaste que funcionara?
- La imagen es genérica y no muestra lo que *tú* hiciste.

---

### Buena entrada de diario

<div style="font-size:0.8rem;color:rgb(104 77 58/0.5);margin-bottom:0.5rem"><em>De <a href="https://github.com/qcoral/" style="color:rgb(104 77 58);font-weight:600">@alexren</a>'s <a href="https://hwdocs.hackclub.dev/shipping/example-journal/" style="color:rgb(104 77 58);font-weight:600">hwdocs</a></em></div>
<div style="background:rgb(104 77 58/0.1);border:3px solid rgb(104 77 58/0.2);padding:1.25rem;margin:1rem 0"><p style="margin:0 0 0.5rem 0"><strong>8 de junio: ¡Hice funcionar la pantalla!</strong></p><p style="margin:0 0 1rem 0">¡Logré que la Raspberry Pi mostrara en la LCD! Basé el cableado en otro proyecto originalmente, pero usaban un driver de pantalla diferente. Eso significó que tuve que descubrir cómo modificarlo para la pantalla que estaba usando.</p><img src="/images/docs/journal-good-1.webp" alt="Ejemplo de buen diario 1" style="border:3px solid rgb(104 77 58/0.2);max-width:100%;margin-bottom:1rem" /><p style="margin:0 0 1rem 0">El proyecto original documentaba cómo se configuró el software, lo que me dio un punto de partida. El problema principal era descubrir los parámetros correctos del driver del kernel para mi pantalla específica. Un montón de búsqueda en repos de GitHub me llevó al archivo de driver correcto. Usándolo, hice funcionar la salida de video.</p><img src="/images/docs/journal-good-2.webp" alt="Ejemplo de buen diario 2" style="border:3px solid rgb(104 77 58/0.2);max-width:100%" /></div>

**Diferencia clave:** El buen ejemplo muestra el proceso de pensamiento, la cadena de investigación, los errores y la solución. Incluye imágenes en etapas intermedias, no solo el resultado final. Se lee como una historia, no como una lista de verificación.

## Mira también

- [Moneda](/docs/currency) , cómo las horas registradas y las rachas se convierten en oro
- [Haz ship de tu diseño](/docs/submitting-design) , qué verifican los revisores cuando haces ship
- [Hackatime](/docs/hackatime) , cómo se rastrea tu tiempo de programación
