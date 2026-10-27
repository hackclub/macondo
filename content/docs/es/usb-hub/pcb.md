---
title: PCB
description: Convierte tu esquemático en una placa real, coloca componentes en grupos funcionales, enruta los pares de datos, vierte cobre para alimentación y tierra, y agrega tu toque personal.
section: guides
order: 2
icon: circuit-board
group: usb-hub
groupTitle: USB Hub
groupOrder: 1
requiresJournal: true
---
# PCB

Aquí es donde tu concentrador USB deja de ser un diagrama y se convierte en una placa real y física que puedes sostener. Convertirás tu esquemático en una PCB, colocarás los componentes en grupos funcionales ordenados, enrutarás las pistas (incluidos los pares de datos USB), verterás cobre para alimentación y tierra, y luego agregarás algunos toques personalizados como una ranura para llavero y arte en serigrafía.

**Lo que necesitarás antes de empezar:** un esquemático terminado de la página anterior (el editor de PCB lo toma directamente de ahí). Todo lo demás sucede dentro del editor de EasyEDA.

Tómate tu tiempo y no apuntes a la perfección en el primer intento. La disposición y el enrutamiento son habilidades que desarrollas haciéndolas, y siempre puedes volver y ajustar las cosas sobre la marcha.

## Abriendo el editor de PCB

Ahora viene la parte divertida, al menos para mí. Es hora de diseñar tu PCB y comenzar a enrutar pistas. Aquí es donde todo deja de ser abstracto y se convierte en algo real.

Para empezar, dirígete a la barra superior y haz clic en **Convert Schematic to PCB**. Eso abrirá el editor de PCB. Verás una ventana emergente pidiéndote que confirmes la importación de cambios. Simplemente pulsa **Apply Changes** y estarás listo para comenzar a disponer las cosas.

<video controls muted playsinline>
  <source src="https://fallout.hackclub.com/docs-assets/guided-projects/usb-hub/20260215-0120-56.4242577.mp4" type="video/mp4">
</video>

Cuando se abra el editor de PCB, te recibirá lo que parece un caos total. Componentes esparcidos por todas partes como si los hubieran dejado caer del cielo.

Y luego notarás un montón de líneas azules delgadas que se entrecruzan por la pantalla. Esas se llaman ratlines (líneas de rata). Piensa en ellas como pequeños recordatorios que dicen: "Oye, este pad aún necesita conectarse a ese pad". No representan cobre real todavía. Solo te muestran las conexiones que existen en tu esquemático pero que aún no se han enrutado físicamente en la placa.

![img](https://raw.githubusercontent.com/Outdatedcandy92/USB-Hub-Guide/main/attachmentscompressed/Pasted%20image%2020260214202209.webp)


Antes de empezar a arrastrar piezas, aquí hay un pequeño consejo que hará tu vida mucho más fácil.

Al principio de un diseño, generalmente es mejor ocultar las ratlines de tierra. La tierra se conecta a muchas cosas, por lo que esas líneas tienden a saturar la pantalla y hacer que todo parezca más abrumador de lo que realmente es. Dado que la tierra a menudo se maneja limpiamente al final, ocultarla por ahora te ayuda a centrarte primero en las conexiones de señal más críticas.

Para hacer esto, ve a la barra lateral izquierda y abre la pestaña **Net**. Expande la sección **Ratlines**, encuentra la red **GND** y alterna su visibilidad a desactivada.

<video controls muted playsinline>
  <source src="https://fallout.hackclub.com/docs-assets/guided-projects/usb-hub/20260215-0123-23.5098350.mp4" type="video/mp4">
</video>

---
### Planeándolo

Ahora espera. Antes de empezar a enrutar pistas por todas partes, necesitas colocar tus componentes correctamente.

Un buen diseño comienza con intención. Tómate un momento y piensa en cómo quieres que se vea realmente esta placa. ¿Va a ser un simple rectángulo que hace su trabajo silenciosamente? Claro, eso funciona. Pero, ¿dónde está la diversión en eso?

Este es tu proyecto. Dale algo de personalidad. Tal vez sea una forma divertida. Tal vez sea algo que puedas convertir en un llavero. Tal vez sea completamente ridículo en el mejor sentido posible. Yo estoy convirtiendo la mía en una pequeña placa con forma de llavero, pero se te anima absolutamente a diseñar algo loco.


#### Contornos de placa personalizados

Si quieres ir más allá y experimentar con contornos más avanzados, como siluetas o dibujos detallados, echa un vistazo a esta pequeña guía adicional sobre la creación de formas de placa personalizadas. Puedes ser sorprendentemente creativo con los contornos de PCB.

Para importar y usar formas más complejas para el contorno de tu placa, podemos usar **archivos DXF**.

##### Imagen a DXF

Primero, crea la forma que quieras en un programa de dibujo o encuentra una imagen en línea. Para obtener los mejores resultados, la imagen debe ser principalmente de un color sólido con un contorno claramente definido y cerrado.

Para mi ejemplo, estoy usando este contorno de gato que encontré en línea.

![img](https://raw.githubusercontent.com/Outdatedcandy92/USB-Hub-Guide/main/attachmentscompressed/Pasted%20image%2020260319164729.webp)

A continuación, iré a un sitio web que pueda convertir imágenes a DXF. Estoy usando [Convertio](https://convertio.co/jpg-dxf/). Subiré mi imagen de gato y la descargaré como un archivo DXF.

##### DXF a contorno de placa

Una vez que tengas el archivo DXF, regresa al editor de PCB de EasyEDA y selecciona **File → Import → DXF**.

![img](https://raw.githubusercontent.com/Outdatedcandy92/USB-Hub-Guide/main/attachmentscompressed/Pasted%20image%2020260319164749.webp)
Aparecerá un cuadro de diálogo. Aquí, necesitas hacer dos cosas principales. Primero, establece la **Import Layer** en **Board Outline Layer**.

![img](https://raw.githubusercontent.com/Outdatedcandy92/USB-Hub-Guide/main/attachmentscompressed/Pasted%20image%2020260319164813.webp)

Segundo, ajusta la **Scaling Ratio** para que la forma importada tenga menos de 100×100 mm.

<video controls muted playsinline>
  <source src="https://raw.githubusercontent.com/Outdatedcandy92/USB-Hub-Guide/main/attachmentscompressed/zen_efcMaIrs0R%201.webm" type="video/webm">
</video>

Una vez hecho eso, haz clic en **Import** para colocar el contorno de la placa en el editor.

En mi caso, el DXF se importó con dos conjuntos de contornos, así que simplemente seleccioné uno y lo eliminé.

<video controls muted playsinline>
  <source src="https://raw.githubusercontent.com/Outdatedcandy92/USB-Hub-Guide/main/attachmentscompressed/zen_toZxBwfz8d.webm" type="video/webm">
</video>

¡Todo listo! Has importado con éxito una forma personalizada como tu contorno de placa 🎉

![img](https://raw.githubusercontent.com/Outdatedcandy92/USB-Hub-Guide/main/attachmentscompressed/Pasted%20image%2020260319164909.webp)

---

Personalmente, estoy apuntando a algo que se ve un poco así…

![img](https://raw.githubusercontent.com/Outdatedcandy92/USB-Hub-Guide/main/attachmentscompressed/Pasted%20image%2020260214202856.webp)

Para que eso suceda, necesitamos definir la forma de la placa.

Selecciona la herramienta **Board Outline** y elige la opción **Polygon**. Alternativamente, puedes hacer clic directamente en la capa **Board Outline** y usar la herramienta **Polyline** para dibujar tu forma manualmente.

A partir de ahí, solo comienza a hacer clic para colocar puntos y esbozar tu diseño. Piensa en ello como conectar puntos para tallar la silueta de tu placa. Tómate tu tiempo y ajusta las esquinas hasta que la forma se sienta bien. Este contorno es literalmente el límite de tu creación, ¡así que hazlo bonito!

<video controls muted playsinline>
  <source src="https://fallout.hackclub.com/docs-assets/guided-projects/usb-hub/20260215-0131-57.5973164.mp4" type="video/mp4">
</video>

Y no te estreses por hacerlo perfecto en el primer intento.

El contorno de la placa no es fijo. Siempre puedes volver más tarde y ajustarlo, modificar curvas, mover esquinas o reformarlo completamente si surge la inspiración. Piensa en él como un marco flexible en lugar de una decisión final.


### Disposición

Una vez que tu contorno de placa esté esbozado, es hora de colocar los componentes. Este paso importa más que cualquier otra cosa. Una buena colocación es lo que separa una placa limpia y profesional de un desastre frustrante. Cuando la disposición se hace bien, el enrutamiento se siente fluido y lógico. Cuando se hace mal, el enrutamiento se convierte en un dolor.

Sé intencional. Piensa en grupos funcionales. La forma en que los componentes están conectados en el esquemático debe guiar cómo se colocan en la PCB.

Toma el conector USB upstream como ejemplo. En el esquemático, tenía un condensador y dos resistencias pull-down conectadas directamente a él. Ese es un pequeño grupo funcional. En la PCB, esas piezas pasivas deben colocarse cerca del conector.

Aquí hay un flujo de trabajo útil: regresa al editor de esquemático y selecciona toda la circuitería del puerto USB C upstream como un grupo. Luego cambia al editor de PCB. Verás que esos componentes correspondientes ahora están resaltados. Esto hace mucho más fácil agarrarlos, moverlos juntos y colocarlos en tu placa.

<video controls muted playsinline>
  <source src="https://fallout.hackclub.com/docs-assets/guided-projects/usb-hub/20260215-0135-44.0773307.mp4" type="video/mp4">
</video>

Ahora que mi circuitería USB-C está seleccionada, voy a arrastrarla aproximadamente a donde la quiero en la placa. No te preocupes por hacerlo perfecto todavía, solo estamos encontrando un buen lugar para este pequeño grupo antes de afinar la colocación.

<video controls muted playsinline>
  <source src="https://fallout.hackclub.com/docs-assets/guided-projects/usb-hub/20260215-0138-12.5805731.mp4" type="video/mp4">
</video>

A continuación, posicionaré el conector USB-C para que sobresalga ligeramente del borde de la placa. Luego colocaré las resistencias y el condensador cerca de sus respectivos pines.

<video controls muted playsinline>
  <source src="https://fallout.hackclub.com/docs-assets/guided-projects/usb-hub/20260215-1630-55.4421849.mp4" type="video/mp4">
</video>

Ahora ordenaré los designadores de serigrafía, moviéndolos para que estén bien alineados y fáciles de leer.

<video controls muted playsinline>
  <source src="https://fallout.hackclub.com/docs-assets/guided-projects/usb-hub/20260215-1641-03.9007279.mp4" type="video/mp4">
</video>

Aquí, puedes usar la herramienta **Align** para enderezar las cosas y hacer que todo se vea ordenado. Totalmente opcional, pero le da a tu placa una apariencia más limpia y organizada.

<video controls muted playsinline>
  <source src="https://fallout.hackclub.com/docs-assets/guided-projects/usb-hub/20260215-1644-08.3633036.mp4" type="video/mp4">
</video>

A continuación, colocaré el IC del concentrador USB junto con su circuitería de soporte dentro del contorno de la placa.

<video controls muted playsinline>
  <source src="https://fallout.hackclub.com/docs-assets/guided-projects/usb-hub/20260215-1645-53.0597721.mp4" type="video/mp4">
</video>

Ahora rotaré el IC para descubrir qué orientación hace más fácil conectar un cable desde el conector USB upstream. Girarlo 90 grados funciona perfectamente, permitiendo que los pines de datos USB vayan directamente desde el IC al conector.

<video controls muted playsinline>
  <source src="https://fallout.hackclub.com/docs-assets/guided-projects/usb-hub/20260215-1653-29.2559362.mp4" type="video/mp4">
</video>

A continuación, colocaré los condensadores de desacoplamiento para el IC del concentrador USB. Ten en cuenta que la proximidad importa. Un condensador que esté demasiado lejos del pin del chip no hará mucho. Intenta mantener cada uno lo más cerca posible de su pin, pero no lo pongas directamente sobre el pin. Deja un poco de espacio para que se conecte correctamente.

<video controls muted playsinline>
  <source src="https://fallout.hackclub.com/docs-assets/guided-projects/usb-hub/20260215-1656-07.1748536.mp4" type="video/mp4">
</video>

Una vez más, asegúrate de que nada se superponga. Tómate un momento para ajustar los designadores de serigrafía y espacia los condensadores un poco lejos del IC para que haya espacio para enrutar pistas más tarde.

![img](https://raw.githubusercontent.com/Outdatedcandy92/USB-Hub-Guide/main/attachmentscompressed/Pasted%20image%2020260215120020.webp)


Ahora comenzaré a colocar los puertos downstream. Sé lógico con sus posiciones, manteniéndolos donde las ratlines permanezcan mayormente rectas y no crucen sobre las ratlines de otros conectores.

<video controls muted playsinline>
  <source src="https://fallout.hackclub.com/docs-assets/guided-projects/usb-hub/20260215-1710-43.5538184.mp4" type="video/mp4">
</video>


Aquí hay un ejemplo. En este momento mis puertos USB-A están dispuestos así, y puedes ver las ratlines superponiéndose. Si cambio las posiciones de estos dos conectores, las ratlines se vuelven mucho más limpias.

![img](https://raw.githubusercontent.com/Outdatedcandy92/USB-Hub-Guide/main/attachmentscompressed/Pasted%20image%2020260215121419.webp)

Nota cómo me estoy quedando sin espacio y uno de mis conectores USB está colgando fuera de la placa. Puedo arreglar esto extendiendo el contorno de la placa y haciéndolo un poco más grande. Como mencioné anteriormente, el contorno de la placa no es fijo, y es normal ajustarlo a medida que avanza el diseño.

<video controls muted playsinline>
  <source src="https://fallout.hackclub.com/docs-assets/guided-projects/usb-hub/20260215-1715-00.4834708.mp4" type="video/mp4">
</video>

Ahora volveré al esquemático y traeré las resistencias pull-down de soporte y los condensadores de desacoplamiento, colocándolos cerca de sus respectivos conectores.

<video controls muted playsinline>
  <source src="https://fallout.hackclub.com/docs-assets/guided-projects/usb-hub/20260215-1721-29.6427212.mp4" type="video/mp4">
</video>

Al final, tu placa debería verse algo así. Cada pin de alimentación debe tener un condensador de desacoplamiento cerca, y los conectores USB-C deben tener las resistencias pull-down o pull-up correctas en su lugar.

![img](https://raw.githubusercontent.com/Outdatedcandy92/USB-Hub-Guide/main/attachmentscompressed/Pasted%20image%2020260215122404.webp)

---
### Enrutamiento

Ahora pasamos a la parte divertida y satisfactoria: ¡el enrutamiento! Para empezar, puedes usar la herramienta **Routing** en la barra superior o simplemente presionar **Alt + W**.

<video controls muted playsinline>
  <source src="https://fallout.hackclub.com/docs-assets/guided-projects/usb-hub/20260215-1725-13.2480438.mp4" type="video/mp4">
</video>

Comenzaré conectando todos los componentes pasivos a su conector USB por ahora. Esto me da algo así. Aún no me preocupo por los pines de datos ni por conectar todas las pistas de 5 V.

![img](https://raw.githubusercontent.com/Outdatedcandy92/USB-Hub-Guide/main/attachmentscompressed/Pasted%20image%2020260215122639.webp)

Ahora enfoquémonos en enrutar los pines de datos. Los pines de datos USB se enrutan como un par diferencial, que son básicamente dos cables, uno positivo y uno negativo, corriendo uno al lado del otro. Esta configuración permite que las señales viajen más rápido y resistan mejor el ruido.

Para enrutarlos como un par diferencial, ve a **Route → Differential Pair** o simplemente presiona **Alt + D**. Comenzando en el IC, seleccionaré el pin **DP**. Aparecerá una ventana emergente y crearé el par diferencial seleccionando el pin **DN** como la red negativa y luego presionando **Process**.

Una vez enrutado, verás dos cables corriendo uno al lado del otro como un par diferencial. Luego lo cablearé directamente al conector USB-C.

<video controls muted playsinline>
  <source src="https://fallout.hackclub.com/docs-assets/guided-projects/usb-hub/20260215-1727-27.3497844.mp4" type="video/mp4">
</video>

Ahora saldré del enrutamiento diferencial y volveré al enrutamiento simple seleccionando la herramienta **Single Routing** o presionando **Alt + W**. Luego iré al conector USB y cablearé los pads **DP** y **DN** juntos como se muestra a continuación.

<video controls muted playsinline>
  <source src="https://fallout.hackclub.com/docs-assets/guided-projects/usb-hub/20260215-1728-39.3746789.mp4" type="video/mp4">
</video>

Ahora repetiré este paso para el resto de los conectores USB, cableando sus pines de datos diferenciales de la misma manera.

![img](https://raw.githubusercontent.com/Outdatedcandy92/USB-Hub-Guide/main/attachmentscompressed/Pasted%20image%2020260215123419.webp)

Ahora puede que te encuentres con una situación con un conector USB-C donde no puedes conectar los pines de datos directamente. No te preocupes. Nuestra PCB tiene dos capas, así que podemos cambiar a la capa posterior y luego volver a la capa frontal para hacer la conexión. Esto se hace usando una **vía**, que puedes colocar presionando **Alt + V** mientras enrutas.

<video controls muted playsinline>
  <source src="https://fallout.hackclub.com/docs-assets/guided-projects/usb-hub/20260215-1736-06.5042659.mp4" type="video/mp4">
</video>

Ahí vamos, las conexiones están completas.

A continuación, enrutaré todos los pares diferenciales restantes, y terminamos con algo así.

![img](https://raw.githubusercontent.com/Outdatedcandy92/USB-Hub-Guide/main/attachmentscompressed/Pasted%20image%2020260215123655.webp)

Ahora todo lo que queda es enrutar las líneas de 5 V y tierra. Antes de comenzar, volvamos a activar las ratlines de GND.

<video controls muted playsinline>
  <source src="https://fallout.hackclub.com/docs-assets/guided-projects/usb-hub/20260215-1737-23.5850568.mp4" type="video/mp4">
</video>


Ahora para las conexiones de 5 V y tierra, usaremos un vertido de cobre ya que hay muchos pads para conectar. Un vertido de cobre básicamente llena un área de la placa con cobre para una red específica, que en este caso será 5 V en la capa superior y tierra en la capa inferior.

Comenzaremos con el vertido de 5 V en la capa superior. Selecciona la herramienta **Copper Area** de la barra superior y dibuja un rectángulo que cubra la placa. Cuando hagas clic izquierdo para confirmar la forma, aparecerá un cuadro de diálogo. Asegúrate de que la capa esté configurada como **Top Layer** y la red sea **+5V**, luego haz clic en **Confirm**. La herramienta llenará automáticamente el área con cobre conectado a la red de 5 V.

<video controls muted playsinline>
  <source src="https://fallout.hackclub.com/docs-assets/guided-projects/usb-hub/20260215-1738-40.9458459.mp4" type="video/mp4">
</video>

Ahora haremos lo mismo para la capa inferior. Cambia a la capa inferior usando el panel lateral de capas, luego sigue los mismos pasos que antes. Esta vez, asegúrate de que la capa esté configurada como **Bottom Layer** y la red sea **GND**. El área se llenará con cobre conectado a tierra.

<video controls muted playsinline>
  <source src="https://fallout.hackclub.com/docs-assets/guided-projects/usb-hub/20260215-1741-50.8380560.mp4" type="video/mp4">
</video>

Aún no hemos terminado. La mayoría de nuestros pads de tierra están en la capa superior, y solo vertimos cobre en la inferior, por lo que no están conectados.

Vuelve a la capa superior, enruta una pista desde un pad de tierra, extiéndela un poco lejos del pad y presiona **Alt + V** para colocar una vía que la conecte hacia abajo a la capa inferior.

<video controls muted playsinline>
  <source src="https://fallout.hackclub.com/docs-assets/guided-projects/usb-hub/20260215-1744-11.8806114.mp4" type="video/mp4">
</video>

Ahora solo repite esto para todos los pads de tierra en la capa superior. Eventualmente, terminarás con algo así. Intenta colocar una vía por pad siempre que sea posible, y evita compartir la misma vía entre múltiples componentes.

![img](https://raw.githubusercontent.com/Outdatedcandy92/USB-Hub-Guide/main/attachmentscompressed/Pasted%20image%2020260215124643.webp)

Para los conectores USB-C, simplemente puedes conectar los pads de tierra directamente a los agujeros del blindaje.

<video controls muted playsinline>
  <source src="https://fallout.hackclub.com/docs-assets/guided-projects/usb-hub/20260215-1747-11.2607435.mp4" type="video/mp4">
</video>

Casi terminas, pero hay un último paso. Cada vez que agregues cables, vías o hagas cambios, necesitas reconstruir tus zonas de cobre para actualizarlas. Simplemente presiona **Shift + B** para hacer esto, y verás la disposición actualizada. Este paso es crucial, así que no olvides reconstruir zonas después de mover cualquier cosa.

<video controls muted playsinline>
  <source src="https://fallout.hackclub.com/docs-assets/guided-projects/usb-hub/20260215-1748-37.6759420.mp4" type="video/mp4">
</video>

¡Ahora saltemos al visor 3D y echemos un vistazo a cómo se ve nuestra placa!

<video controls muted playsinline>
  <source src="https://fallout.hackclub.com/docs-assets/guided-projects/usb-hub/20260215-1749-26.3123437.mp4" type="video/mp4">
</video>

¡Se ve bastante genial!

En este punto, básicamente has terminado y podrías seguir adelante y ordenar tu placa. Pero si quieres agregar algo de estilo extra, sigue leyendo esta guía.

---
### Añadiendo una ranura para llavero

Al principio, cuando planeaba la disposición, esbocé un pequeño agujero en la PCB para que pudiera funcionar como llavero. Ahora es momento de agregar realmente esa ranura a la placa. Si no te convence la idea del llavero, puedes agregar agujeros de montaje, lo cual recomiendo mucho. Si alguna vez decides diseñar un encapsulado más tarde, los agujeros de montaje hacen mucho más fácil atornillar la placa en una carcasa y mantener todo seguro.

Para agregar una ranura, dirígete a la barra de herramientas superior y elige la herramienta de región de ranura. Dibuja un pequeño rectángulo donde lo quieras, luego ajusta la posición hasta que se vea bien.

<video controls muted playsinline>
  <source src="https://fallout.hackclub.com/docs-assets/guided-projects/usb-hub/20260216-1813-24.8146150.mp4" type="video/mp4">
</video>

Después de eso, solo afina el tamaño y asegúrate de que no esté demasiado cerca del borde o de ningún componente.

<video controls muted playsinline>
  <source src="https://fallout.hackclub.com/docs-assets/guided-projects/usb-hub/20260216-1814-24.9924495.mp4" type="video/mp4">
</video>

Ahora, si abres el visor 3D nuevamente, verás tu PCB actualizada con la ranura en su lugar.

<video controls muted playsinline>
  <source src="https://fallout.hackclub.com/docs-assets/guided-projects/usb-hub/20260216-1815-36.9776924.mp4" type="video/mp4">
</video>

Si no te convence la idea del llavero pero crees que podrías diseñar una carcasa más tarde, recomiendo encarecidamente agregar agujeros de montaje. El proceso es casi el mismo, excepto que esta vez eliges un círculo en lugar de una ranura desde el mismo menú de herramientas.

Cuando lo coloques, necesitarás ingresar un radio. Ese valor depende del tornillo que planeas usar, como M2, M2.5 o M3. El número M se refiere al diámetro del tornillo en milímetros, así que un tornillo M2 tiene un diámetro de 2 mm. Si estás usando tornillos M2 para el montaje, establecer el radio en aproximadamente 1.1 mm es una buena opción.

<video controls muted playsinline>
  <source src="https://fallout.hackclub.com/docs-assets/guided-projects/usb-hub/20260216-1816-58.7933093.mp4" type="video/mp4">
</video>

Como mínimo, sugiero agregar al menos dos agujeros de montaje, pero si tienes el espacio, cuatro es aún mejor. Para la colocación, distribúyelos y elige posiciones estratégicas. En mi caso, estos puntos tendrían más sentido si estuviera agregando agujeros de montaje.

![img](https://raw.githubusercontent.com/Outdatedcandy92/USB-Hub-Guide/main/attachmentscompressed/Pasted%20image%2020260216132008.webp)

---
### Serigrafía

Ahora, ¿qué es una PCB sin alguna serigrafía chévere y llamativa? Como se mencionó antes, la serigrafía es la capa impresa sobre la máscara de soldadura. Se usa para designadores de referencia como C1 y C2, junto con todas las marcas amarillas que ves en la placa.

![img](https://raw.githubusercontent.com/Outdatedcandy92/USB-Hub-Guide/main/attachmentscompressed/Pasted%20image%2020260216132138.webp)

Pero también puedes agregar tu propio texto e ilustraciones para darle un poco de personalidad.

Para hacer eso, selecciona la capa de serigrafía superior, elige la herramienta de texto, escribe lo que te guste y colócalo en la placa.

<video controls muted playsinline>
  <source src="https://fallout.hackclub.com/docs-assets/guided-projects/usb-hub/20260216-1825-11.7230639.mp4" type="video/mp4">
</video>

El texto personalizado es divertido, pero agregar tus propios gráficos es aún mejor. Para hacerlo, ve a File → Import → Image y selecciona la imagen que deseas usar. Recuerda que la serigrafía es de un solo color, por lo que es mejor elegir una imagen que ya esté en blanco y negro. Si importas algo con muchos colores, la herramienta EDA lo convertirá a blanco y negro automáticamente, lo que a veces puede crear artefactos extraños.

Voy a colocar una imagen de Orpheus en el frente. Al insertar la imagen, comienza con un tamaño pequeño, alrededor de 20 mm de ancho o así. Siempre puedes redimensionarla más tarde, pero empezar más pequeña hace que sea más fácil posicionar y afinar.

<video controls muted playsinline>
  <source src="https://fallout.hackclub.com/docs-assets/guided-projects/usb-hub/20260216-1829-18.6244182.mp4" type="video/mp4">
</video>

Asegúrate de que tu serigrafía no se superponga con ninguna otra serigrafía en el área, y deberías estar listo.

Abre el visor 3D para ver tu nuevo diseño de serigrafía y ver cómo se ve en la placa.

<video controls muted playsinline>
  <source src="https://fallout.hackclub.com/docs-assets/guided-projects/usb-hub/20260216-2355-39.0515505.mp4" type="video/mp4">
</video>

Si echas un vistazo en el visor 3D, notarás que el lado posterior está básicamente vacío sin gráficos. Arreglemos eso. Regresa al editor de PCB, selecciona la capa de serigrafía inferior y agrega algunos diseños a ella.

<video controls muted playsinline>
  <source src="https://fallout.hackclub.com/docs-assets/guided-projects/usb-hub/20260216-2357-49.3142817.mp4" type="video/mp4">
</video>

Notarás que todo lo que agregas se ve invertido. Eso es porque es el lado posterior. Para arreglarlo, usa la herramienta de voltear placa en la barra de herramientas superior para dar vuelta la placa.

<video controls muted playsinline>
  <source src="https://fallout.hackclub.com/docs-assets/guided-projects/usb-hub/20260216-2358-49.6524352.mp4" type="video/mp4">
</video>

Ahora seguiré los mismos pasos que usé para la capa superior y agregaré algunos diseños a la inferior. Una vez que termino, termino con algo bastante genial así.

![img](https://raw.githubusercontent.com/Outdatedcandy92/USB-Hub-Guide/main/attachmentscompressed/Pasted%20image%2020260216190933.webp)

<video controls muted playsinline>
  <source src="https://fallout.hackclub.com/docs-assets/guided-projects/usb-hub/20260217-0009-59.5174061.mp4" type="video/mp4">
</video>

---
### Puliendo

Antes de ordenar nuestras placas, hay algunos pequeños toques que puedes agregar para que se vean más pulidos, como redondear los bordes (filleting).

El filleting redondea los bordes. Por defecto, las PCB tienen esquinas afiladas, que no solo se ven duras sino que pueden realmente pincharte.

Para aplicar fillet a tu contorno de placa, selecciónalo, haz clic derecho, elige Add → Fillet y establece el radio que desees. Yo voy con 2 mm.

<video controls muted playsinline>
  <source src="https://fallout.hackclub.com/docs-assets/guided-projects/usb-hub/20260217-0012-06.5848408.mp4" type="video/mp4">
</video>

También agregaré algunos fillets a la ranura en mi placa.

<video controls muted playsinline>
  <source src="https://fallout.hackclub.com/docs-assets/guided-projects/usb-hub/20260217-0013-04.5421053.mp4" type="video/mp4">
</video>

Recuerda siempre reconstruir tus zonas presionando Shift+B.

<video controls muted playsinline>
  <source src="https://fallout.hackclub.com/docs-assets/guided-projects/usb-hub/20260217-0014-20.9411084.mp4" type="video/mp4">
</video>

¡Nota cuánto más limpia se ve ahora nuestra placa!

![img](https://raw.githubusercontent.com/Outdatedcandy92/USB-Hub-Guide/main/attachmentscompressed/Pasted%20image%2020260216191609.webp)

---
