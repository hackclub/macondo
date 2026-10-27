---
title: Configuración de software
description: Deja tu computadora lista para programar, instala GitHub Desktop y VS Code, y conecta Hackatime, todo desde cero.
section: software
order: 0
icon: code
---
# Configuración de software

**Necesitas dos apps gratuitas en tu computadora antes de escribir cualquier línea de código: GitHub Desktop (para guardar y compartir tu proyecto) y VS Code (para escribir código).** Esta página te guía a instalar ambas desde cero, y luego te lleva a la página de Hackatime para que tus horas queden registradas. Si nunca has hecho esto, estás en el lugar correcto, sigue los pasos en orden y quedarás listo para armar tu proyecto.

> ### **DEBES usar Hackatime para cada proyecto de software.**
>
> **Hackatime es la forma en que nosotros verificamos las horas que dedicaste a programar. Sin él, tu proyecto de software no puede enviarse a revisión y no recibirás fruta por el trabajo realizado.** Configúralo en la siguiente página antes de escribir cualquier código.
>
> Hackatime solo rastrea tiempo dentro del editor. Arte, diseño de UI, música y otro trabajo que no sea programación para un proyecto de software van en una **entrada de diario** (o un timelapse de [Lapse](https://lapse.hackclub.com)). [Más sobre esto aquí.](/docs/hackatime)

::danger{title="Usar IA está permitido, pero el proyecto debe estar pulido"}
HC AI y otras herramientas de IA están bien para ayudarte. **No** están bien para soltarnos un proyecto generado por IA. Tu envío debe ser código que entiendas, con pulido evidente, pruebas, y tu propia iteración encima. **El uso intenso de IA sin pulir será rechazado. Eso incluye código generado sin revisar, salida copiada y pegada, y journals escritos por IA.** Cuando tengas dudas, reescríbelo con tus propias palabras. Los journals siempre los escribes tú, nunca la IA.
::

## ¿Qué estoy configurando, y para qué?

Dos cosas, y trabajan en pareja:

- **Git y GitHub** guardan versiones de tu código y lo ponen en línea para que los revisores puedan verlo. Piénsalo como un sistema de guardado para tu proyecto, excepto que cada guardado es permanente y puedes volver a cualquier versión anterior cuando quieras. GitHub es el sitio web donde tu código vive, y **GitHub Desktop** es una app que facilita usar Git sin tocar la línea de comandos.
- **VS Code** es el editor donde realmente escribes código.

Primero instalarás GitHub Desktop, luego VS Code, y después abrirás tu proyecto en ambos. El resto de esta página es justo eso, un clic a la vez.

## ¿Cómo configuro Git con GitHub Desktop?

### 1. Crea una cuenta de GitHub

Si aún no tienes una, regístrate en [github.com](https://github.com). Elige un nombre de usuario con el que estés contento, pues será el que va a aparecer en todos tus proyectos.

---

### 2. Descarga GitHub Desktop

Ve a [desktop.github.com](https://desktop.github.com) y descarga la app. Instálala, luego inicia sesión con tu cuenta de GitHub cuando se te pida.

---

### 3. Crea un nuevo repositorio

Un repositorio (o "repo") es simplemente una carpeta de tu proyecto que Git rastrea. En GitHub Desktop, haz clic en **File -> New Repository**. Dale un nombre (el nombre de tu proyecto funciona), elige dónde guardarlo en tu computadora y marca "Initialize this repository with a README". Haz clic en **Create Repository**.

![Diálogo de crear repositorio de GitHub Desktop](/images/docs/lets-get-started.webp)

---

### 4. Explora la interfaz

Después de crear tu repo, verás la interfaz principal de GitHub Desktop. El lado izquierdo muestra tus cambios, el medio muestra los diffs de archivos y la barra superior te permite cambiar entre repositorios y ramas.

![Interfaz principal de GitHub Desktop](/images/docs/explore-github-desktop.webp)

---

## ¿Cómo instalo VS Code?

VS Code (Visual Studio Code) es un editor de código gratuito hecho por Microsoft. Es lo que la mayoría de la gente usa, y funciona en Windows, Mac y Linux.

### 1. Descárgalo

Ve a [code.visualstudio.com](https://code.visualstudio.com) y haz clic en el botón grande de descarga. Debería detectar tu sistema operativo automáticamente. Ejecuta el instalador cuando termine de descargar.

---

### 2. Abre tu repo en VS Code

De vuelta en GitHub Desktop, haz clic en **Repository -> Open in Visual Studio Code** (o el botón "Open in Visual Studio Code"). Esto abre la carpeta que acabas de crear directamente en VS Code.

![Botón abrir en editor de GitHub Desktop](/images/docs/open-in-editor.webp)

---

### 3. Familiarízate con el diseño

A la izquierda verás un explorador de archivos que muestra todos los archivos en tu carpeta. Haz clic en cualquier archivo para abrirlo en el editor. El panel inferior tiene una terminal integrada, puedes abrirla con `Ctrl+\`` (tecla acento grave, arriba a la izquierda de tu teclado). Esta terminal es la misma que tu terminal del sistema, solo que incrustada dentro de VS Code.

---

### 4. Instala extensiones

Haz clic en el icono de cuadros en la barra lateral izquierda (o presiona `Ctrl+Shift+X`) para abrir el panel de Extensiones. Busca e instala cualquier cosa relevante para tu proyecto. Si estás construyendo un sitio web, busca "Live Server" (te permite previsualizar tu sitio en el navegador). Si usas Python, toma la extensión "Python".

> También querrás instalar la extensión **WakaTime** aquí si estás trabajando en un proyecto de software. Eso es lo que se conecta a Hackatime para contabilizar el tiempo que pasas programando. Consulta la página de [Hackatime](/docs/hackatime) para más detalles.

---

## ¿Cómo trabajan juntas las dos apps?

Ahora que ambas están instaladas, este es el ciclo que repetirás mientras armas tu proyecto: escribes código en VS Code, luego lo guardas y lo subes con GitHub Desktop.

### Haciendo commits (guardando tu trabajo)

Después de hacer algunos cambios a tu código en VS Code, cambia de vuelta a GitHub Desktop. Verás una lista de archivos que cambiaron en el lado izquierdo. El lado derecho muestra exactamente qué cambió en cada archivo, con líneas verdes para adiciones y rojas para eliminaciones.

![GitHub Desktop mostrando cambios de archivos](/images/docs/viewing-changes.webp)

En la parte inferior izquierda, hay un campo de texto "Summary". Escribe una breve descripción de lo que cambiaste (como "agregar layout de homepage" o "arreglar color de botón") y haz clic en **Commit to main**. Eso guarda una instantánea de tu código.

![Campo de mensaje de commit y botón de commit de GitHub Desktop](/images/docs/commit-message.webp)

---

### Enviando a GitHub

Después de hacer commit, haz clic en **Push origin** en la parte superior. Esto sube tu código a GitHub para que quede guardado en línea y los revisores puedan verlo. Si es tu primera vez enviando el proyecto, te pedirá publicar el repositorio primero, por lo que solo harás clic en el botón y Git manejará todo.

![Botón push origin de GitHub Desktop](/images/docs/push-to-origin.webp)

> **El flujo es:** escribir código en VS Code -> cambiar a GitHub Desktop -> escribir un mensaje de commit corto -> hacer clic en Commit -> hacer clic en Push. Haz esto regularmente mientras trabajas para que tu progreso siempre esté guardado.

::tip{title="Haz commits pronto y seguido"}
No guardes todo tu trabajo para un solo commit gigante al final. Haz commit de cada cambio pequeño que funcione mientras avanzas (varias veces por hora es saludable). Tu historial de commits es la prueba más clara de que construiste el proyecto tú mismo, paso a paso, así que un flujo constante de commits reales es tu mejor protección si un revisor alguna vez cuestiona tus horas. Además, así nunca pierdes más de unos minutos de trabajo.
::

---

## ¿Y si ya tengo un repo en GitHub?

Si ya tienes un repo en GitHub (o alguien compartió uno contigo), puedes descargarlo con GitHub Desktop. Haz clic en **File -> Clone Repository**, encuentra el repo en la lista (o pega la URL), elige dónde guardarlo y haz clic en **Clone**. Luego ábrelo en VS Code de la misma forma que hiciste antes.

## Ver también

- [Hackatime](/docs/hackatime) , conecta el rastreador de tiempo para que tus horas de programación cuenten
- [¿Qué es shipear?](/docs/what-is-shipping) , cómo funcionan las revisiones y aprobaciones
- [Journals](/docs/journals) , cómo registrar trabajo que no es programación, como arte y diseño
- [¿Sigues atascado?](/docs/still-stuck) , dónde conseguir ayuda en #macondo-help en Slack
