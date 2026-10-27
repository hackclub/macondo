---
title: Aprende a usar una API
description: Crea una página de nueva pestaña personalizada que carga la foto del día de la NASA, un reloj en vivo y el clima local, usando HTML, CSS y JavaScript puros para llamar APIs REST. Por Nico, de Resolution Coding.
section: guides
order: 5
icon: image
---
# Aprende a usar una API
Por [Nico](mailto:nico@resolution.hackclub.com)

## TL;DR

**Lo que vas a construir:** una única página estática que lee tres APIs distintas para crear una página de inicio personalizada que puedes usar como fondo de la nueva pestaña en tu navegador. La NASA elige la imagen, JavaScript corre el reloj y Open-Meteo trae el clima en vivo del lugar donde estés.

**Lo que necesitas:** lo básico de HTML y JavaScript, un editor de código y cualquier navegador moderno. Sin Node, sin herramientas de build, solo tres archivos en una carpeta.

**La forma de todo esto:** vas a aprender qué es una API REST, a llamar APIs con `fetch` y `async`/`await`, a manejar errores con `try`/`catch`, a leer la ubicación del usuario, a correr código en un temporizador y a armar un fondo a pantalla completa. Tómalo una parte a la vez y al final vas a tener una página de inicio funcionando.

¿Nuevo en las APIs? Para eso es justamente esta guía. Vamos a explicar cada pieza a medida que aparezca, y hay una sección de **Errores comunes** cerca del final para cuando algo se ponga raro.

## Qué vas a construir

Una única página estática que lee tres APIs distintas para crear una página de inicio personalizada que puedes usar como fondo de la nueva pestaña en tu navegador. La NASA elige la imagen, JavaScript se encarga del reloj y Open-Meteo trae el clima en vivo del lugar donde estés.

![Ejemplo de página de inicio con fondo de estelas estelares de la NASA y una superposición con efecto de vidrio mostrando la hora y el clima](https://cdn.hackclub.com/019d2ac3-f9c8-7c88-8d6a-ae6302c9cb15/example.jpg)

## Qué vas a aprender

- Qué es una API REST y cómo se ve un JSON
- Cómo llamar APIs con `fetch` y `async`/`await`
- Cómo manejar errores con `try`/`catch`
- Cómo leer la ubicación del usuario con `navigator.geolocation`
- Cómo correr código en un temporizador con `setInterval`
- Cómo armar un fondo a pantalla completa con CSS

## Requisitos previos

- Lo básico de las semanas 1 y 2 de Resolution Coding (escribir HTML y JavaScript).
- Un editor de código. VS Code está bien, cualquiera sirve.
- Cualquier navegador moderno (Chrome, Firefox, Safari, Edge).
- Sin Node, sin herramientas de build. Solo tres archivos en una carpeta.

Si te trabas con algo de esta guía, pregunta en el canal **#macondo-help** en Slack o escríbele a Nico a [nico@resolution.hackclub.com](mailto:nico@resolution.hackclub.com).

## ¿Qué es una API?

Quizá te estés preguntando "¿qué ES una API?" API significa **Application Programming Interface** (Interfaz de Programación de Aplicaciones). Las APIs son la base de casi todas las apps y sitios web. Por ejemplo, al programar para Android e iOS, usas una API para hablar con el firmware del dispositivo y pedirle cosas como la batería restante o la ubicación.

En este proyecto vamos a usar **APIs REST**. REST (Representational State Transfer) es el estilo de API más usado para servicios web. Para usar una API REST envías una solicitud a un endpoint y este responde con un objeto JSON.

Ejemplos de APIs REST públicas:

- Pronósticos del clima
- Fotos del espacio
- Datos curiosos de gatos

Una respuesta JSON típica se ve así:

```json
{
  "firstName": "John",
  "lastName": "Doe",
  "age": 30,
  "isEmployee": true
}
```

## El proyecto

Vamos a construir una página de inicio con tres funciones:

1. La Foto Astronómica del Día de la NASA como fondo a pantalla completa
2. Un reloj en vivo
3. El clima local

Crea una carpeta nueva para el proyecto y dentro crea tres archivos vacíos: `index.html`, `main.css` y `script.js`.

## Parte 1: La imagen de fondo

La primera función es una imagen de fondo diaria que viene de la API **APOD** (Astronomy Picture of the Day) de la NASA. Regístrate gratis para obtener tu propia clave de API en [api.nasa.gov](https://api.nasa.gov/) para que no te bloqueen por exceso de uso mientras pruebas.

::warning{title="Ojo con las claves de API"}
**No hay forma segura** de esconder una clave de API en un sitio estático de HTML/CSS/JS. El navegador siempre puede inspeccionar el código fuente. La clave de APOD de la NASA se puede exponer sin problema porque la API es gratuita y de solo lectura, pero para cualquier proyecto que toque servicios de pago o datos privados, mueve la llamada a una ruta de servidor o a un proxy (el [ai.hackclub.com](https://ai.hackclub.com) de Hack Club es un buen ejemplo). Exponer claves privadas es bajo tu propio riesgo.
::

Empieza con una plantilla HTML normal que enlace tu CSS y tu JS:

```html
<!doctype html>
<html>
  <head>
    <title>Really cool thing!</title>
    <link rel="stylesheet" href="main.css" />
  </head>

  <body>
    <!-- Aquí pondremos nuestra imagen de fondo -->

    <script src="script.js" defer></script>
  </body>
</html>
```

Ahora agrega un `div` para sostener el fondo. ¿Por qué un `div` en vez de un `<img>`? Porque un `div` nos deja recortar la imagen para que ocupe la pantalla usando `background-size: cover`.

```html
<div id="background">
  <p>STUFF CAN GO HERE</p>
</div>
```

Agrega este CSS para que el div llene la pantalla y recorte la imagen:

```css
#background {
  width: 100vw;
  height: 100vh;
  background-position: center;
  background-size: cover;
  text-align: right;
  display: flow-root;
}

html,
body,
p {
  margin: 0;
  padding: 0;
}

p {
  color: white;
  font-family: Arial, Helvetica, sans-serif;
  font-weight: bold;
}
```

Ya estamos listos para traer la imagen desde la API de la NASA. Vamos a escribir una función que llame a APOD y devuelva la URL de la imagen.

¿Por qué no podemos poner la URL de la API directamente en un `background-image` de CSS? Porque la API de la NASA no devuelve los bytes crudos de la imagen, devuelve un objeto JSON con el título, la descripción, los créditos, la URL y más. Aquí tienes una respuesta de ejemplo:

```json
{
  "copyright": "Juan Carlos Casado",
  "date": "2026-03-20",
  "explanation": "The defining astronomical moment of the equinox today is at 14:46 UTC...",
  "hdurl": "https://apod.nasa.gov/apod/image/2603/equinox-3k-jcc.jpg",
  "media_type": "image",
  "service_version": "v1",
  "title": "Spring Equinox at Teide Observatory",
  "url": "https://apod.nasa.gov/apod/image/2603/equinox-3k-jcc_1087c.jpg"
}
```

Cuando una función llama a una API, la marcas como `async`. `async` permite que una función se pause en un `await` sin congelar el resto de la página. Aquí no importa tanto, pero en páginas interactivas sí, así que JavaScript lo exige cada vez que haces `await` de algo.

En `script.js`, empieza con:

```js
const background = document.getElementById("background");

async function getBackground() {
  const url =
    "https://api.nasa.gov/planetary/apod?api_key=DEMO_KEY";
  // Replace this with your own key from api.nasa.gov.
}
```

Ahora necesitamos realmente llamar a la API. Cuando algo puede fallar (y una llamada de red siempre puede), envuélvelo en un bloque `try`/`catch`. El `try` se ejecuta primero, y si algo lanza un error, se ejecuta el `catch` en su lugar. Esto evita que un tropiezo de la API tumbe toda tu página.

Dentro del `try`, usamos `fetch`. `fetch` hace la solicitud HTTP y espera una respuesta. Luego revisamos la propiedad `ok` de la respuesta, que es `true` para cualquier estado en el rango 200. Si todo está bien, parseamos el JSON y verificamos que `media_type` sea `"image"` (APOD a veces devuelve un video, que no podemos usar como fondo).

Agrega esto dentro de `getBackground`:

```js
try {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Response status: ${response.status}`);
  }

  const result = await response.json();
  console.log(result);

  if (result.media_type !== "image") {
    console.log("APOD returned a non-image media type.");
    return null;
  }

  return result.url;
} catch (error) {
  console.log(error.message);
  return null;
}
```

Ahora lo conectaremos para que la función corra cuando la página cargue, y vamos a fijar la propiedad CSS `background-image` del div:

::tip
En JavaScript puedes usar **acentos invertidos** con `${}` para meter variables dentro de un string. Ejemplo: `` `Cats are ${value}!` ``. Usamos este truco para armar el string `url(...)` para la propiedad de CSS.
::

```js
window.onload = function () {
  getBackground().then(function (imageUrl) {
    if (!imageUrl) return;

    console.log(imageUrl);

    if (background) {
      background.style["background-image"] = `url('${imageUrl}')`;
    }
  });
};
```

Eso es todo para el fondo. Abre `index.html` en tu navegador y deberías ver la APOD de hoy llenando la pantalla.

::warning{title="Abre con una URL real, no con file://"}
Algunas funciones del navegador (especialmente la geolocalización, que usaremos más adelante) solo funcionan sobre `http://` o `https://`. No abras `index.html` con doble clic desde Finder/Explorer; usa un servidor de desarrollo pequeñito en su lugar. Las opciones más rápidas son la extensión **Live Server** en VS Code, o correr `bunx serve` (o `npx serve`) dentro de la carpeta de tu proyecto.
::

## Parte 2: El reloj

Sigue un reloj. Antes de escribir código, planea dónde va. En el ejemplo de arriba está fijado en la esquina superior derecha con efecto de vidrio. Intenta resolver tú mismo el diseño, pero el HTML y los estilos finales están abajo como punto de control.

El reloj en sí es solo un `<p id="time">`, ubicado dentro del div `#background`. Un segundo contenedor `<div class="gloss">` nos da la tarjeta de vidrio esmerilado.

**HTML**

```html
<!doctype html>
<html>
  <head>
    <title>Really cool thing!</title>
    <link rel="stylesheet" href="main.css" />
  </head>

  <body>
    <div id="background">
      <div class="gloss">
        <p id="time">00:00:00</p>
        <p id="weather">0% 0°F 0 MPH</p>
      </div>
    </div>

    <script src="script.js" defer></script>
  </body>
</html>
```

**CSS**

```css
#background {
  width: 100vw;
  height: 100vh;
  background-position: center;
  background-size: cover;
  text-align: right;
  display: flow-root;
}

html,
body,
p {
  margin: 0;
  padding: 0;
}

p {
  color: white;
  font-family: Arial, Helvetica, sans-serif;
  font-weight: bold;
}

#time {
  font-size: 15vh;
  margin: 1vw;
}

.gloss {
  background: rgba(255, 255, 255, 0.2);
  border-radius: 16px;
  box-shadow: 0 4px 30px rgba(0, 0, 0, 0.1);
  backdrop-filter: blur(5px);
  -webkit-backdrop-filter: blur(5px);
  border: 1px solid rgba(255, 255, 255, 0.3);
  display: inline-block;
  margin: 5vw;
}
```

Ahora el JS. En vez de darte la respuesta, aquí tienes las herramientas que necesitas. Intenta escribir el reloj por tu cuenta.

JavaScript tiene un objeto `Date` integrado. Llamar a `dateObject.getTime()` devuelve **tiempo Unix**: el número de milisegundos desde el 1 de enero de 1970. JS también tiene métodos auxiliares como `getHours()`, pero ¿dónde está la gracia en eso? Tu desafío es convertir tiempo Unix en horas, minutos y segundos legibles por tu cuenta.

Cosas que vas a querer saber:

### Correr código cada X segundos

`setInterval` corre una función en bucle:

```js
setInterval(() => {
  // code goes here
}, 1000); // every 1000 ms = 1 second
```

### Crear un objeto Date

Necesitas un `Date` nuevo cada vez que lees la hora, si no, vas a estar leyendo siempre el mismo instante.

```js
let dateObject = new Date();
dateObject.getTime(); // Unix milliseconds
```

Para manejar zonas horarias, usa `dateObject.getTimezoneOffset()`. Devuelve la diferencia entre UTC y la hora local **en minutos**. La fórmula es `UTC - Local`, y recuerda que el tiempo Unix está en **milisegundos**, no minutos (`1000 ms = 1 s`).

### Residuo y piso

El operador `%` te da el residuo: `10 % 3 === 1`. Útil para "milisegundos dentro del día actual".

`Math.floor(x)` redondea hacia abajo. Útil cuando la división entera te da algo como `9.45`.

### Logging

Usa `console.log()` para inspeccionar valores mientras depuras:

```js
console.log(`Some logs, and a ${variable}!`);
```

### Actualizar un párrafo

Para cambiar lo que aparece en pantalla, asigna `.innerText`:

```js
const time = document.getElementById("time");
time.innerText = `Some nice text. Here's a ${variable}!`;
```

::tip{title="Tú puedes"}
Eso es todo lo que necesitas para que el reloj funcione. A concentrarse.
::

## Parte 3: El clima

Mismo trato. Las herramientas están abajo, tú escribes el código.

El HTML y el CSS ya casi están hechos; solo dale estilo al párrafo `#weather`.

**HTML (sin cambios respecto a lo de arriba)**

```html
<div id="background">
  <div class="gloss">
    <p id="time">00:00:00</p>
    <p id="weather">0% 0°F 0 MPH</p>
  </div>
</div>
```

**CSS (agrega esto)**

```css
#weather {
  font-size: 5vh;
  margin: 1vw;
}
```

Para la API, usa [Open-Meteo](https://open-meteo.com/). Es gratis y no requiere clave de API. Su página de documentación tiene un constructor que puedes usar para elegir los campos que quieras. Para verificar que puedes alcanzarla, pega esta URL en tu navegador, deberías ver una respuesta JSON:

```
https://api.open-meteo.com/v1/forecast?latitude=40.7&longitude=-74.0&current=temperature_2m,wind_speed_10m,precipitation_probability&temperature_unit=fahrenheit&wind_speed_unit=mph
```

Una vez que hayas elegido tus campos, escribe una función que la llame igual que `getBackground`, pero que devuelva **el JSON entero** esta vez, no solo una propiedad.

Lo único nuevo es obtener la ubicación del usuario. JavaScript tiene `navigator.geolocation.getCurrentPosition()`, que recibe un callback al que le llega un `GeolocationPosition`. Puedes leer las coordenadas de `position.coords.latitude` y `position.coords.longitude` y meterlas en la URL de Open-Meteo.

::warning{title="La geolocalización necesita HTTPS o localhost"}
`navigator.geolocation` no le pedirá permiso al usuario si la página se abre desde una URL `file://`. Corre un servidor de desarrollo (Live Server en VS Code, o `bunx serve`), o sube el proyecto a GitHub Pages, antes de probar esta parte.
::

Una vez que la llamada regrese, elige los valores que quieras del JSON y mételos en `#weather` con `.innerText`. Eres libre de formatearlo como quieras, el ejemplo es `0% 50.2°F 8.2 MPH`.

## Errores comunes

Algunas cosas que salen mal con este proyecto específico, y cómo arreglarlas:

- **El fondo nunca aparece, la página está completamente negra.** Abre la consola de DevTools. Si ves un `403`, tu clave de la NASA está bloqueada por exceso de uso (cada IP tiene una pequeña asignación diaria en `DEMO_KEY`); regístrate y pídela tú en [api.nasa.gov](https://api.nasa.gov/) y pégala en `getBackground`.
- **APOD devolvió un media_type que no es imagen.** APOD a veces es un video de YouTube. La verificación `if (result.media_type !== "image")` que escribimos maneja esto, pero significa que la respuesta de hoy no tiene nada para renderizar. Espera un día, o vuelve a `result.hdurl` de una fecha previa.
- **El permiso de geolocalización nunca aparece.** Estás en `file://`. Mira el aviso de arriba.
- **Error de CORS en la consola.** Open-Meteo y APOD ambas permiten CORS desde el navegador, así que esto casi siempre quiere decir que escribiste mal la URL o que llamaste accidentalmente a otro endpoint. Vuelve a revisarlo pegando la URL directo en una pestaña del navegador.
- **`Uncaught ReferenceError: background is not defined`.** Tu etiqueta `<script>` corrió antes de que existiera el div `#background`. O mantén `defer` en la etiqueta del script, o mueve la etiqueta del script debajo del div en el HTML.

## Agrega algo único

Una vez que la página de inicio funcione, dale tu propio toque. Algunas ideas con APIs públicas y sin clave:

- Una tira de datos curiosos de gatos diaria desde [catfact.ninja](https://catfact.ninja/).
- Una pregunta de trivia desde la [Open Trivia Database](https://opentdb.com/).
- Un mini chat respaldado por [ai.hackclub.com](https://ai.hackclub.com), el proxy gratuito de Llama de Hack Club.
- Tu canción reproduciéndose en este momento (la API de Spotify, pero ojo, necesita OAuth).

::warning{title="Tu envío debe tener tu propio toque"}
Una copia directa de esta guía será rechazada. Úsala para aprender los movimientos, luego envía algo que sea reconociblemente tuyo.
::

## No olvides el README

Antes de enviar, agrega un `README.md` en la raíz de tu repo que explique qué es tu proyecto, cómo lo construiste y cómo otra persona puede probarlo. Sin uno, tu proyecto no se marcará como enviado.
