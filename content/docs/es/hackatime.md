---
title: Hackatime
description: Hackatime rastrea tus horas de código automáticamente, así que los envíos de software cuentan sin tener que registrar cada minuto. Configúralo, vincula tu proyecto, recupera el tiempo perdido.
section: software
order: 1
icon: clock
---
# Hackatime

**Hackatime es un contador de tiempo de programación gratuito y de código abierto que registra tus horas por ti.** Instálalo una vez, programa como siempre, y cuenta el tiempo que pasas en tu editor. Esas horas son las que se convierten en **oro** (la moneda que gastas en la tienda) cuando un revisor aprueba tu envío de software.

Funciona enviando "latidos" desde tu editor al servidor de Hackatime cada vez que escribes o guardas un archivo. Macondo suma esos latidos en las horas de la página de tu proyecto. Hackatime está construido por Hack Club, usa el ecosistema de plugins de WakaTime, y funciona con cualquier editor que soporte WakaTime. Piénsalo como WakaTime, pero gratis y hecho para adolescentes.

## ¿Necesito hacer diario para un proyecto de software?

**No, no para programar en sí.** Hackatime rastrea tu tiempo de código automáticamente, así que no tienes que escribir un diario de cada sesión de programación para recibir crédito por ella. Hacer diario sigue siendo un buen hábito (les muestra a los revisores qué construiste), pero tus horas de código vienen de Hackatime, no de un cronómetro que llevas a mano.

Solo registras tiempo a mano para el trabajo que Hackatime no puede ver, que es todo lo que haces fuera de un editor de código. El arte, el diseño, la música y el ensamblaje de hardware van por diario. El código lo rastrea Hackatime. Mira el aviso de abajo para registrar las horas que no son de programación.

::danger{title="DEBES usar Hackatime para cada proyecto de software"}
Hackatime es cómo rastreamos las horas que dedicaste a programar. Sin él, tu proyecto de software **no puede enviarse** a revisión y **no recibirás crédito** por el trabajo que hiciste. Completa los pasos de configuración a continuación antes de escribir cualquier línea de código.
::

::tip{title="¿Y el arte, diseño u otro trabajo que no sea programación?"}
Hackatime solo rastrea el tiempo dentro de un editor, así que cosas como sprite art, mockups de UI, diseño de niveles, música, o cualquier trabajo fuera del editor no aparecerán ahí. No hay problema, registra esas horas de otra forma:

- **Publica una entrada de diario** describiendo qué hiciste y cuánto te tomó. Adjunta capturas, archivos, o una grabación corta. Una entrada por sesión basta.
- **O usa [Lapse](https://lapse.hackclub.com)** para grabar un timelapse del trabajo (genial para arte y Figma).

Hackatime sigue siendo obligatorio para el código en sí. Usa diarios o Lapse para *agregar* las horas que no son de programación encima.

Cuando grabes un Lapse (o cualquier otro timelapse o grabación de pantalla) del trabajo artístico o de assets, **pega el enlace del video en tu entrada de diario** (YouTube sin listar funciona, o cualquier URL de CDN que reproduzca el archivo) para que el revisor pueda confirmar las horas.

Aviso: las horas de arte y assets generalmente no deberían superar el ~40% de las horas aprobadas de tu proyecto, salvo que el arte sea de calidad excepcional. Consulta [Buen diario](/docs/journals#horas-de-arte-y-assets) para la regla completa.
::

::danger{title="Usar IA está permitido, pero el proyecto debe estar pulido"}
HC AI y otras herramientas de IA están bien para ayudarte. **No** están bien para soltarnos un proyecto generado por IA. Tu envío debe ser código que entiendas, con pulido evidente, pruebas, y tu propia iteración encima. **El uso intenso de IA será rechazado. Eso incluye código generado sin revisar, salida copiada y pegada, y journals escritos por IA.** Cuando tengas dudas, reescríbelo con tus propias palabras. Los journals siempre los escribes tú, nunca la IA.
::

## ¿Cómo configuro Hackatime?

Son dos partes, y el asistente se encarga de la primera por ti.

Primero, instala el plugin del editor para que empiecen a fluir los latidos. Abre el asistente de configuración de abajo.

<a href="https://hackatime.hackclub.com/my/wakatime_setup" target="_blank" style="display: block; width: 100%; padding: 1rem; background-color: rgb(104 77 58); color: rgb(245 240 230); font-weight: 700; font-size: 1.1rem; text-align: center; text-decoration: none; border: none; cursor: pointer; margin-bottom: 1rem;">Abrir el asistente de configuración de Hackatime →</a>

El asistente te guía a través de todo: crear tu cuenta, obtener tu clave API y darte un comando de instalación personalizado para ejecutar en tu terminal. El comando es único para ti porque incluye tu clave API.

> **macOS / Linux / WSL:** El asistente te da un comando `curl` para pegar en tu terminal.
>
> **Windows:** El asistente te da un comando de PowerShell en su lugar.

El script configura todo automáticamente, y para VS Code, IDEs de JetBrains, Zed y Xcode incluso instala el plugin del editor por ti.

Segundo, conecta Hackatime a tu cuenta de Macondo. Ve a tu **perfil**, busca la fila de **Hackatime**, y haz clic en **Vincular**. Es una vinculación de cuenta de una sola vez, y una vez conectado se queda conectado. Con las dos partes hechas, tu tiempo de programación puede fluir hacia tus proyectos.

::tip{title="¿No ves tu tiempo?"}
Intenta reiniciar tu editor después de ejecutar el asistente de configuración. Si sigues atascado, pide ayuda en **#hackatime-help** en el Slack de Hack Club.
::

## ¿Cómo cuentan mis horas?

Tus **horas aprobadas** son las que se convierten en **oro** cuando un revisor acepta un envío. Las horas aprobadas vienen de dos lugares, que se suman:

- **Tiempo de Hackatime** en el o los proyectos que vinculaste a este proyecto de Macondo.
- **Horas de diario** que registraste para trabajo que no es programación (arte, diseño, ensamblaje de hardware), que el revisor puede aceptar encima.

Programar también hace avanzar tu **racha de proyecto**. Las rachas son por proyecto, así que sigue trabajando en el mismo proyecto para hacer crecer una. Los revisores deciden las horas aprobadas finales y pueden recortar el tiempo que no esté respaldado por trabajo real, así que mantén tus diarios detallados.

## ¿Cómo vinculo el proyecto correcto de Hackatime?

Hackatime rastrea el tiempo por **nombre de proyecto**, que normalmente es el nombre de la carpeta que abriste en tu editor. En la página de tu proyecto de Macondo vinculas uno o más de esos nombres de proyecto de Hackatime a tu proyecto, y **solo cuentan los nombres vinculados** para tus horas. El selector empieza con los proyectos en los que de verdad has pasado tiempo, y esconde las carpetas tranquilas detrás de un botón "Mostrar todo".

Algunas cosas que confunden a la gente:

- **Cambio de nombre.** Si renombras la carpeta de tu proyecto, Hackatime empieza a registrar bajo un nombre nuevo. Vincula también el nombre nuevo, o tus horas recientes no aparecerán.
- **Varias carpetas.** Si divides el trabajo en varias carpetas, vincula cada proyecto de Hackatime que pertenezca a esta construcción.
- **Proyecto equivocado vinculado.** El tiempo solo cuenta una vez, en el proyecto bajo el que se registró. Vincular un proyecto no relacionado no traslada sus horas.

Puedes agregar o cambiar los proyectos de Hackatime vinculados desde la página de tu proyecto en cualquier momento antes de enviar.

## Mi tiempo no aparece. ¿Qué reviso?

El tiempo de Hackatime no siempre es instantáneo. Los latidos se envían mientras escribes, pero tardan un momento en sumarse, y Macondo vuelve a sincronizar los totales de todos según un horario (y cada vez que abres tu panel). Si tus horas se ven bajas, repasa esta lista:

1. **Reinicia tu editor** después de ejecutar el asistente, escribe un minuto, y luego revisa [tu panel de Hackatime](https://hackatime.hackclub.com).
2. **Confirma que los latidos están llegando** en ese panel. Si no llegan, el plugin del editor no está configurado, vuelve a ejecutar el asistente.
3. **Revisa que el nombre del proyecto** coincida con uno que vinculaste en Macondo (ver arriba).
4. **Dale tiempo.** Una racha reciente de programación puede tardar un poco en reflejarse del todo en la página de tu proyecto.

¿Sigues atascado? Pregunta en **#hackatime-help** en el Slack de Hack Club.

## ¿Cómo funcionan la confianza y la verificación?

Hackatime evalúa qué tan confiable se ve el tiempo de una cuenta. Las cuentas nuevas, y las cuentas con patrones de latidos inusuales, empiezan con menos confianza, lo que puede hacer que tus horas reciban una revisión más cuidadosa antes de aprobarse. Construyes confianza simplemente programando con normalidad con el tiempo.

No intentes inflar tu tiempo. Los editores inactivos, los latidos falsos y los scripts que simulan escritura son fáciles de detectar y harán que un proyecto sea rechazado. El progreso real y constante respaldado por buenos diarios siempre es el camino más rápido a través de la revisión.

## Ver también

- [Diarios](/docs/journals) , cómo registrar horas que no son de programación y qué hace una buena entrada
- [¿Qué es enviar?](/docs/what-is-shipping) , cómo funcionan las revisiones y las horas aprobadas
- [Moneda](/docs/currency) , cómo se ganan el oro, las rachas y la fruta
- [Obtener ayuda](/docs/help) , a qué canal de Slack preguntar
