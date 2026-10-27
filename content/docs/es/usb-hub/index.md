---
title: USB Hub
description: Diseña tu primera PCB de USB hub personalizada desde cero en EasyEDA, sin necesidad de conocimientos de electrónica. Empieza aquí para aprender los editores de EasyEDA antes de construir.
section: guides
order: 0
icon: cpu
group: usb-hub
groupTitle: USB Hub
groupOrder: 1
requiresJournal: true
---
# Guía USB Hub
Creado por [@Rudy](https://github.com/Outdatedcandy92)

**Al final de este proyecto guiado habrás diseñado tu propio USB hub personalizado y lo habrás pedido como una placa de circuito real y ensamblada.** No necesitas experiencia previa con PCB. Esta primera página es la rampa de entrada suave: configurarás tu cuenta gratuita de EasyEDA, crearás un proyecto y te familiarizarás con los dos editores en los que vivirás (el editor de esquemático y el editor de PCB). La construcción práctica empieza en la siguiente página, así que trata esta como tu mapa del espacio de trabajo.

**Lo que necesitarás**

- Una cuenta gratuita de `EasyEDA Pro` (la crearemos juntos abajo). Es en línea, así que no hay nada que instalar.
- Unos minutos para hacer clic por ahí. No necesitas memorizar nada aquí, solo estás orientándote.

::tip{title="Lleva un diario mientras avanzas"}
Este es un proyecto guiado, así que registra tu progreso en tu diario a medida que recorres cada página. Hay un banner recordatorio en la parte superior de cada página de esta guía con un enlace por si lo necesitas.
::

Para este tutorial vamos a usar `EasyEDA Pro`, una herramienta gratuita y en línea que usaremos para diseñar nuestro elegante USB hub.

Para comenzar, dirígete a [pro.easyeda.com](https://pro.easyeda.com/), crea una cuenta e inicia sesión.

Una vez que hayas iniciado sesión correctamente, haz clic en el botón `Use Online` o simplemente ve a [pro.easyeda.com/editor](https://pro.easyeda.com/editor). Cuando el editor se abra, serás llevado al panel principal, que debería verse algo así.


![Pasted%20image%2020260214134758](https://raw.githubusercontent.com/Outdatedcandy92/USB-Hub-Guide/main/attachmentscompressed/Pasted%20image%2020260214134758.webp)


Para crear un proyecto, ve a `File -> New -> Project` o simplemente usa el atajo `Shift + N`. Aparecerá un nuevo cuadro de diálogo donde puedes nombrar tu proyecto y agregar una pequeña descripción si quieres.

![img](https://raw.githubusercontent.com/Outdatedcandy92/USB-Hub-Guide/main/attachmentscompressed/Pasted%20image%2020260214134815.webp)


Después de guardarlo, el editor abrirá automáticamente ese proyecto y así es como debería verse.

![img](https://raw.githubusercontent.com/Outdatedcandy92/USB-Hub-Guide/main/attachmentscompressed/Pasted%20image%2020260214134843.webp)

En la barra lateral izquierda verás el nombre de tu proyecto y debajo un `Schematic1` y un `PCB`. Estos son los archivos en los que trabajaremos y editaremos para crear nuestro USB hub.

Antes de lanzarnos a crear nuestro USB hub, te daré un resumen rápido de los editores de esquemático y PCB en EasyEDA.

## Editor de esquemático

Para abrir el editor de esquemático, simplemente haz doble clic en el `Schematic1` que está en la barra lateral izquierda. Debería abrirse el editor de esquemático, que se verá algo así:

<video controls muted playsinline>
  <source src="https://fallout.hackclub.com/docs-assets/guided-projects/usb-hub/20260214-1847-11.9442387.mp4" type="video/mp4">
</video>

El editor de esquemático es donde diseñas el circuito de tu placa. Representa visualmente cómo se conecta todo, usando símbolos en lugar de componentes físicos. Aquí es donde defines la lógica de tu diseño. Si alguien entiende tu esquemático, entiende cómo funciona tu circuito, incluso sin ver la PCB real.

>Si el editor de PCB es construir la casa, el editor de esquemático es el plano. Define qué va dónde y cómo se conecta todo antes de preocuparte por la disposición física.


En la parte superior de la pantalla, verás la barra de herramientas. Aquí es donde viven todas las herramientas que necesitarás para construir tu esquemático. Encontrarás opciones para agregar componentes, dibujar cables, colocar resistencias, agregar banderas de red y más.

<video controls muted playsinline>
  <source src="https://fallout.hackclub.com/docs-assets/guided-projects/usb-hub/20260214-1849-21.0176422.mp4" type="video/mp4">
</video>

Puede parecer un poco abrumador al principio. Eso es totalmente normal. Vamos a repasar rápidamente las herramientas más importantes para que sepas qué es qué. Obtendrás más práctica con ellas en el siguiente tutorial.


**Componentes**  
Esta herramienta te permite agregar símbolos de la biblioteca de piezas. Puedes buscar cosas como microcontroladores, conectores, reguladores y más, y luego colocar sus símbolos en tu esquemático.

**Resistencia**  
Este es un atajo para colocar rápidamente un símbolo de resistencia. Si haces clic derecho sobre él, verás opciones para otros componentes pasivos comunes como condensadores, inductores y diodos. Estos se usan tan a menudo que tienen su propia herramienta de acceso rápido.

**Cable**  
Bastante autoexplicativo. Esta herramienta te permite dibujar cables para conectar diferentes componentes entre sí.

**Bandera/Etiqueta de red**  
Piensa en esto como una forma más limpia de conectar cosas. En lugar de dibujar un cable largo que atraviese tu esquemático, puedes colocar banderas de red y darles el mismo nombre. Si dos banderas de red comparten un nombre, están eléctricamente conectadas, aunque no haya un cable visible entre ellas. Esto ayuda a mantener tu esquemático ordenado y fácil de leer.


Ahora, en el lado derecho, tienes la barra lateral de propiedades. Básicamente te muestra la propiedad del componente que esté seleccionado. Por defecto, si no hay nada seleccionado, te muestra las propiedades de la página.

![img](https://raw.githubusercontent.com/Outdatedcandy92/USB-Hub-Guide/main/attachmentscompressed/Pasted%20image%2020260214134939.webp)

## Editor de PCB

Para abrir el editor de PCB, simplemente haz clic en `PCB1` en la barra lateral izquierda. Esto abre el editor de PCB, que se ve algo así.

<video controls muted playsinline>
  <source src="https://fallout.hackclub.com/docs-assets/guided-projects/usb-hub/20260214-1850-03.7155826.mp4" type="video/mp4">
</video>

El editor de PCB es donde tu diseño se vuelve real. Aquí es donde defines cómo se verá y conectará tu placa físicamente en la vida real. Establecerás la forma de la placa, organizarás los componentes en el diseño y dibujarás las pistas de cobre que conectan todo.

>A diferencia del editor de esquemático, que se centra en la lógica, el editor de PCB se trata completamente de colocación física y enrutamiento. Estás pensando en espaciado, caminos de pistas y cómo encaja todo en la placa.


<video controls muted playsinline>
  <source src="https://fallout.hackclub.com/docs-assets/guided-projects/usb-hub/20260214-1850-52.5533107.mp4" type="video/mp4">
</video>

Al igual que el editor de esquemático, el editor de PCB también tiene una barra de herramientas en la parte superior con las herramientas que usarás con más frecuencia. No te preocupes si te resultan desconocidas al principio. Aquí tienes un resumen rápido y sencillo de las primeras cinco herramientas, sin ponerse muy técnico:

**Pad**  
Los pads son los puntos de aterrizaje de cobre donde se sueldan las patillas o pines de los componentes. Cada huella está compuesta de pads, y también puedes colocar pads personalizados si es necesario.

**Vía**  
Una vía es un pequeño agujero que conecta pistas de cobre entre diferentes capas de la placa. Por ejemplo, te permite enrutar una pista desde la capa superior a la capa inferior.

**Contorno de placa**  
Esto define la forma y el tamaño real de tu PCB. Lo que sea que dibujes aquí es lo que el fabricante cortará.

**Área de cobre**  
Esta herramienta te permite crear grandes regiones de cobre, generalmente para cosas como planos de tierra o planos de alimentación. En lugar de enrutar muchas pistas individuales, puedes verter un área de cobre y conectarla a una red específica.

**Región de relleno**  
Similar a un área de cobre, pero de propósito más general. Llena un espacio definido con cobre y se usa a menudo para blindaje o formas de cobre personalizadas.


En la barra lateral derecha, verás una larga lista de capas. A primera vista, puede parecer un poco intimidante. Hay muchas de ellas, y los nombres pueden no tener sentido de inmediato.

![img](https://raw.githubusercontent.com/Outdatedcandy92/USB-Hub-Guide/main/attachmentscompressed/Pasted%20image%2020260214135110.webp)

Pero no te preocupes. Para la mayoría de las placas para principiantes, realmente solo necesitas centrarte en cinco capas: la **capa superior**, la **capa inferior**, la **serigrafía superior**, la **serigrafía inferior** y la **capa de contorno de placa**. Sobre las cuales aprenderás más en la siguiente sección que habla sobre la anatomía de una PCB.

### Anatomía de una PCB

En su esencia, una PCB estándar de 2 capas es bastante simple. Está hecha de dos capas de cobre separadas por un material no conductor llamado sustrato. El sustrato suele ser FR4, que le da a la placa su fuerza y estructura mientras mantiene las capas de cobre eléctricamente aisladas entre sí.

Ahora bien, no podemos dejar el cobre expuesto. El cobre desnudo se oxidaría con el tiempo y podría hacer cortocircuito fácilmente contra otras superficies conductoras. Para protegerlo, los fabricantes cubren la mayor parte del cobre con algo llamado máscara de soldadura. Se trata de un recubrimiento protector delgado y no conductor. Puedes pensar en él como pintura para tu PCB. Protege el cobre y ayuda a prevenir puentes de soldadura accidentales.

Encima de la máscara de soldadura está la capa de serigrafía. Aquí es donde se imprimen texto y gráficos en la placa. Los nombres de componentes, designadores de referencia como R1 o U2, marcas de polaridad e incluso logotipos, todo va aquí. No lleva electricidad. Es puramente para etiquetado y claridad, lo que se vuelve extremadamente útil al ensamblar, depurar o modificar tu placa más adelante.

Aquí tienes una ilustración rápida para ayudarte a visualizar cómo se apilan estas capas:

![img](https://raw.githubusercontent.com/Outdatedcandy92/USB-Hub-Guide/main/attachmentscompressed/Pasted%20image%2020260214135131.webp)

---

Ahora que entiendes los conceptos básicos y te sientes cómodo navegando por EasyEDA, es hora de poner ese conocimiento en práctica.
