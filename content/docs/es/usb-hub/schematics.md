---
title: Esquemáticos
description: Dibuja el esquemático para tu USB hub en EasyEDA, desde colocar el SL2.1S y los conectores hasta cablear alimentación, datos, resistencias pull y condensadores de desacoplamiento.
section: guides
order: 1
icon: git-branch
group: usb-hub
groupTitle: USB Hub
groupOrder: 1
requiresJournal: true
---
# Esquemáticos

**Lo que construirás aquí:** el esquemático completo para tu USB hub, el plano que le dice al editor de placa qué se conecta con qué. Al final habrás colocado el chip concentrador **SL2.1S** y tus conectores USB, y luego habrás cableado alimentación, tierra, líneas de datos, resistencias pull y condensadores de desacoplamiento, todo en una disposición limpia de izquierda a derecha.

**Lo que necesitas:** el proyecto de EasyEDA que configuraste antes, con el editor de esquemático abierto. Eso es todo. Recorreremos cada parte juntos, así que no te preocupes si algunos de estos símbolos son nuevos para ti.

Como hablamos antes, el esquemático es el plano para tu PCB. Le dice al editor de placa qué se conecta con qué, así que si el esquemático está desordenado o mal, tu PCB también lo estará. Por eso es importante mantenerlo claro, ordenado y fácil de entender a simple vista por otra persona.

Muy bien, entremos en materia. Abre el editor de esquemático y comencemos.

### Colocando símbolos

Para este concentrador USB, vamos a usar el **SL2.1S** de **CoreChips**. Este pequeño chip es donde ocurre toda la magia. Conectas una conexión USB en él y divide ese único puerto en cuatro puertos USB utilizables.

Como vamos a tener la placa ensamblada por JLCPCB, el número de pieza que necesitaremos es `C2684433`.

![img](https://raw.githubusercontent.com/Outdatedcandy92/USB-Hub-Guide/main/attachmentscompressed/Pasted%20image%2020260214135310.webp)

Agreguemos el chip a nuestro esquemático.

Haz clic en la herramienta **Component** en la barra de herramientas superior, o simplemente presiona `Shift + F`. En la barra de búsqueda, escribe `C2684433` y presiona Enter. Deberías ver el **SL2.1S** aparecer en los resultados.

Haz clic en **Place**, muévelo a tu esquemático y haz clic izquierdo para colocarlo donde quieras. Cuando termines, haz clic derecho para salir de la herramienta de colocación. Así de fácil, el cerebro de tu concentrador USB está ahora en la página.

<video controls muted playsinline>
  <source src="https://fallout.hackclub.com/docs-assets/guided-projects/usb-hub/20260214-1853-57.9253130.mp4" type="video/mp4">
</video>

Ahora que el IC principal está en el esquemático, agreguemos los conectores USB. Aquí es donde puedes darle forma a cómo se verá realmente tu concentrador.

El chip admite **cinco puertos USB en total**:

- **1 puerto upstream**, que se conecta a tu computadora
- **4 puertos downstream**, donde conectas tus dispositivos

La forma de configurar esos puertos depende completamente de ti. Podrías hacer todo USB Tipo C, todo USB Tipo A, o mezclar y combinar como quieras. Esa es parte de la diversión.

Para mi diseño, estoy usando:

- 1 USB Tipo C para la conexión upstream
- 2 USB Tipo C para downstream
- 2 USB Tipo A para downstream

Para el conector Tipo C, estoy usando `TYPE-C 16PIN 2MD(073)` con número de pieza `C2765186`.  
Para el conector Tipo A, estoy usando `10.0 QHHTZB6.3` con número de pieza `C668591`.

Adelante, coloca tus conectores según la configuración que quieras. Una vez que estén en el esquemático, verás claramente cómo se forma la estructura de tu concentrador USB de 1 entrada y 4 salidas.

<video controls muted playsinline>
  <source src="https://fallout.hackclub.com/docs-assets/guided-projects/usb-hub/20260214-1856-02.6137470.mp4" type="video/mp4">
</video>

Los esquemáticos normalmente se leen de izquierda a derecha, como un flujo de información. Entradas a la izquierda, procesamiento en el medio, salidas a la derecha. Disponer las cosas de esta manera hace que tu diseño sea mucho más fácil de entender a simple vista.

Moveré mi puerto USB Tipo C upstream a la parte superior izquierda, colocaré el IC del concentrador en el centro y organizaré todos los puertos downstream a lo largo del lado derecho. Ahora el flujo de datos es visualmente claro: computadora → chip concentrador → dispositivos conectados.

![img](https://raw.githubusercontent.com/Outdatedcandy92/USB-Hub-Guide/main/attachmentscompressed/Pasted%20image%2020260214135735.webp)

Para piezas como los conectores USB Tipo C y Tipo A, el símbolo ya deja claro qué son. No necesitamos grandes números de pieza del fabricante llenando la página y haciendo el esquemático más difícil de leer.

Para limpiar las cosas, mantén presionado `Ctrl` y selecciona todos tus conectores USB. Luego, en la barra lateral de propiedades, desmarca el campo **Manufacturer Part**. Esto oculta los largos números de pieza de la vista del esquemático sin eliminar ningún dato real.

El objetivo aquí es la legibilidad. Un esquemático limpio es mucho más fácil de depurar, compartir y revisar más tarde sin darte dolor de cabeza.

<video controls muted playsinline>
  <source src="https://fallout.hackclub.com/docs-assets/guided-projects/usb-hub/20260214-1858-08.6900930.mp4" type="video/mp4">
</video>

Listo, ¡ahora se ve mucho más limpio!


### Uniéndolo todo

Ahora que todas las piezas están en la página, es hora de cablear todo.

En este punto, es posible que te estés preguntando cómo se supone que debes saber qué se conecta a qué. Aquí es donde las hojas de datos se convierten en tu mejor amiga. Cada fabricante proporciona una, y dentro encontrarás descripciones de pines, circuitos de ejemplo, especificaciones eléctricas y generalmente incluso un diseño de referencia. La sección de definiciones de pines es la que nos importa ahora mismo. Ese es tu mapa.

Comencemos con el puerto USB Tipo C upstream. Si buscas definiciones de pines USB C, encontrarás muchos diagramas que explican cada señal en detalle. Cuando miras el símbolo en tu esquemático, notarás algo interesante: pines como DP1 y DP2, CC1 y CC2, etcétera.

Esa duplicación existe porque USB Tipo C es reversible. El conector tiene pines coincidentes en ambos lados para que funcione sin importar de qué manera enchufes el cable. Eléctricamente, sirven para el mismo propósito, pero están duplicados para admitir el volteo del conector.

Aquí tienes un desglose rápido de los pines clave USB Tipo C que verás en el esquemático:

- **DPx / DNx**, son las líneas de datos. Transportan la información real de ida y vuelta a través del cable USB.

- **CC1 / CC2**, pines de configuración de canal. Manejan cosas como la negociación de entrega de energía y otras características USB-C, pero para nuestro proyecto de concentrador, no nos preocuparemos demasiado por esos extras.

- **SBU1 / SBU2**, pines de uso de banda lateral. Estos entran en juego para modos alternativos como DisplayPort o pueden llevar señales de audio.

- **VBUS**, es el suministro de voltaje, generalmente 5 V.

- **GND**, tierra, tu punto de referencia de 0 V.

- **SH**, blindaje. Esta es la carcasa metálica alrededor del conector que ayuda con la conexión a tierra y protege contra interferencias.

Comencemos el cableado con la alimentación, ya que es un poco especial. Debido a que la usamos con tanta frecuencia, los esquemáticos tienen símbolos dedicados para tierra y alimentación para mantener las cosas ordenadas.

Antes de conectar nada, rotaré el símbolo USB-C 180° seleccionándolo y presionando `Space` dos veces para que los pines miren hacia el lado correcto. De esta manera, nuestro cableado puede fluir ordenadamente de izquierda a derecha.

Para empezar, vamos a unir todos los pines **VBUS** usando una **bandera de alimentación +5 V**. Haz clic en la herramienta en la barra de herramientas superior etiquetada **VCC**, elige **5 V** y colócala en el primer pin VBUS. Para mantener el esquemático limpio, me gusta mover la bandera ligeramente lejos del pin para que sea legible. Repite este paso para todos los pines VBUS restantes del conector.

Ahora todos tus pines VBUS están conectados a +5 V, dándole a tu concentrador un suministro de alimentación adecuado para funcionar.

<video controls muted playsinline>
  <source src="https://fallout.hackclub.com/docs-assets/guided-projects/usb-hub/20260214-1859-20.2875897.mp4" type="video/mp4">
</video>

Lo siguiente es la **tierra**. Al igual que hicimos con VBUS, conectaremos todos los pines **GND** usando banderas de tierra.

Ten cuidado de mantener los cables y banderas ordenados. No dejes que se superpongan o crucen innecesariamente. Un enredo desordenado hace que el esquemático sea difícil de leer y puede confundir a cualquiera que intente seguir tu diseño más tarde. Las conexiones limpias y espaciadas mantienen todo comprensible y con apariencia profesional.

<video controls muted playsinline>
  <source src="https://fallout.hackclub.com/docs-assets/guided-projects/usb-hub/20260214-1904-15.3163576.mp4" type="video/mp4">
</video>

Ahora conectaremos los pines **SH (blindaje)** a tierra.

Selecciona la herramienta **Wire** y dibuja líneas desde cada pin SH a una bandera GND. Esto conecta a tierra el blindaje metálico del conector, lo que ayuda a reducir la interferencia y mantiene tu concentrador eléctricamente estable.

<video controls muted playsinline>
  <source src="https://fallout.hackclub.com/docs-assets/guided-projects/usb-hub/20260214-1906-34.0312758.mp4" type="video/mp4">
</video>

Los siguientes son los pines **SBU1 y SBU2**. Para nuestro concentrador, no los usaremos, pero dejar los pines completamente flotantes generalmente es mala práctica.

Para manejar esto, usaremos una **bandera de No Conexión (NC)**. Selecciónala de la barra de herramientas superior y colócala en ambos pines SBU1 y SBU2. Esto indica claramente que estos pines están intencionalmente desconectados, manteniendo tu esquemático limpio y profesional.

<video controls muted playsinline>
  <source src="https://fallout.hackclub.com/docs-assets/guided-projects/usb-hub/20260214-1907-23.1363482.mp4" type="video/mp4">
</video>


Ahora manejemos los pines **CC1 y CC2**. Estos pines básicamente le dicen al host "oye, soy un puerto downstream y necesito algo de corriente". Para hacer esto, usamos **resistencias de 5.1 kΩ** conectadas a tierra. Estas se llaman **resistencias pull-down** porque "tiran" el voltaje hacia abajo a 0 V.

Aquí te explico cómo agregarlas:

1. Selecciona la herramienta **Resistor** de la barra de herramientas superior.

2. Coloca dos resistencias apuntando **hacia abajo**. Esa es la forma estándar de mostrar un pull-down en esquemáticos.

3. Selecciona cada resistencia y cambia su valor a **5.1 kΩ**.

4. Conecta un extremo de cada resistencia a un pin CC y el otro extremo a una bandera GND.


Y así de simple, tu concentrador pide cortésmente alimentación siempre que se conecta un dispositivo.

<video controls muted playsinline>
  <source src="https://fallout.hackclub.com/docs-assets/guided-projects/usb-hub/20260214-1908-34.5195255.mp4" type="video/mp4">
</video>


Ahora es el momento de manejar los **pines de datos**. Estos necesitan conectarse al chip **SL2.1S**, pero como el IC está un poco lejos en el esquemático, no queremos un revoltijo de cables. Aquí es donde entran las **etiquetas de red**, que te permiten conectar señales "virtualmente". Cualquier pin con la misma etiqueta de red está eléctricamente conectado, sin importar dónde esté en el esquemático.

Esto es lo que haremos:

1. Coloca una etiqueta de red en **DP2** y haz doble clic para renombrarla **DP** (para Data Positive).

2. Copia esa etiqueta y pégala en **DP1**.

3. Haz lo mismo para **DN1** y **DN2**, renombrando la etiqueta **DN** (para Data Negative).


Asegúrate de que el etiquetado sea correcto: **DP** va en ambos DP1 y DP2, y **DN** va en ambos DN1 y DN2. Una vez hecho esto, estas señales pueden "conectarse" limpiamente al IC del concentrador, sin cables desordenados cruzando el esquemático.

<video controls muted playsinline>
  <source src="https://fallout.hackclub.com/docs-assets/guided-projects/usb-hub/20260214-1911-56.7148365.mp4" type="video/mp4">
</video>


A continuación, abordemos el **SL2.1S** en sí. Para averiguar cómo cablearlo, la hoja de datos es tu mejor amiga. Te dice exactamente qué hace cada pin y cómo debería conectarse.

Una forma rápida de llegar allí es hacer clic en el símbolo del IC, luego, en la pestaña **Properties**, haz clic en el enlace del dispositivo. Esto te llevará a su página de LCSC, donde puedes encontrar y abrir la hoja de datos oficial. Una vez que la tengas abierta, podrás ver todas las asignaciones de pines y conexiones recomendadas para tu concentrador USB.

<video controls muted playsinline>
  <source src="https://fallout.hackclub.com/docs-assets/guided-projects/usb-hub/20260214-1913-23.1970679.mp4" type="video/mp4">
</video>

La hoja de datos original está en parte en chino y en parte en inglés, por lo que si no puedes leerla, un truco rápido es descargar el PDF y usar Google Translate para obtener una versión completa en inglés (o español).

Desplázate hacia abajo hasta la **tabla de definición de pines**. Este es el mapa que usaremos para descubrir todas las conexiones. Empezando con la alimentación:

- **VSS**, tierra (GND)

- **VDD5**, entrada de 5 V para el chip

- **VDD33**, suministro interno de 3.3 V

- **VDD18**, suministro interno de 1.8 V


Estos pines se aseguran de que el IC obtenga los voltajes correctos que necesita para funcionar.

![img](https://raw.githubusercontent.com/Outdatedcandy92/USB-Hub-Guide/main/attachmentscompressed/Pasted%20image%2020260214141502.webp)

Conectemos los pines de alimentación del IC:

- Conecta **VSS** a **GND**.

- Conecta **VDD5** a la bandera de alimentación **+5 V**.

Los pines **VDD33** (3.3 V) y **VDD18** (1.8 V) son generados internamente por el IC, así que por ahora podemos dejarlos sin conectar. Se encargarán de sí mismos una vez que el chip se encienda.

<video controls muted playsinline>
  <source src="https://fallout.hackclub.com/docs-assets/guided-projects/usb-hub/20260214-1915-38.5952988.mp4" type="video/mp4">
</video>

A continuación, veamos los pines **XOUT** y **XIN**. Son para conectar un cristal externo.

Cada chip necesita una sincronización precisa para comunicarse y operar correctamente, y esa sincronización proviene de una señal de reloj. Un reloj interno generalmente es suficientemente bueno para tareas simples, pero puede desviarse y causar errores. Ahí es donde entra un **cristal externo**. Es como un metrónomo súper preciso, dando al IC una frecuencia estable y exacta para que todo se mantenga perfectamente sincronizado. Sin él, el chip podría funcionar un poco demasiado rápido o demasiado lento, lo que rompería la comunicación USB.

Si nos desplazamos hacia abajo en la hoja de datos, especifica un **oscilador de cristal de 12 MHz**. Eso significa que necesitamos un cristal con una **frecuencia resonante de 12 MHz** para conectar a XIN y XOUT.

![img](https://raw.githubusercontent.com/Outdatedcandy92/USB-Hub-Guide/main/attachmentscompressed/Pasted%20image%2020260214141709.webp)

Normalmente, agregarías un cristal aquí, pero este chip en particular se sabe que funciona perfectamente bien usando su reloj interno. Eso significa que podemos omitir agregar el cristal externo y dejar que el IC maneje la sincronización por sí solo.

Para mantener el esquemático limpio:

- Conecta **XIN** a **GND**.

- Coloca una **bandera de No Conexión (NC)** en **XOUT**.


Esto muestra claramente que el cristal no se usa, manteniendo tu esquemático ordenado y correcto.

![img](https://raw.githubusercontent.com/Outdatedcandy92/USB-Hub-Guide/main/attachmentscompressed/Pasted%20image%2020260214141742.webp)


Volviendo a la tabla de definición de pines, notarás **UDM** y **UDP**. Estas son las señales USB D, y D+ del **puerto upstream**, el que se conecta a la computadora host.

En otras palabras, estos pines son cómo tu concentrador habla con la computadora. Todo lo que viene o va al host pasa a través de **UDM** y **UDP**, así que estas son las señales que conectaremos a nuestras etiquetas de red del puerto USB-C upstream.

![img](https://raw.githubusercontent.com/Outdatedcandy92/USB-Hub-Guide/main/attachmentscompressed/Pasted%20image%2020260214141932.webp)

Ahora es el momento de conectar las líneas de datos desde nuestro conector USB-C upstream.

Notarás una pequeña diferencia de nomenclatura: el conector tiene **DP** y **DN**, mientras que el IC usa **DP** y **DM**. ¡No te preocupes! **DN y DM son lo mismo**, ambos se refieren a la línea de datos negativa, mientras que DP es la línea de datos positiva.

Para conectarlos, simplemente **copia las etiquetas de red DP y DN** que colocaste en el conector USB-C anteriormente y **pégalas en los pines DP y DM correspondientes del IC**. De esta manera, el puerto upstream está correctamente cableado sin cables desordenados corriendo por el esquemático.

<video controls muted playsinline>
  <source src="https://fallout.hackclub.com/docs-assets/guided-projects/usb-hub/20260214-1920-09.3263336.mp4" type="video/mp4">
</video>

Finalmente, conectemos los **puertos de datos downstream**.

Para cada uno de los pines DPx/DMx del IC, crea **etiquetas de red** tal como hicimos para el puerto upstream.

![img](https://raw.githubusercontent.com/Outdatedcandy92/USB-Hub-Guide/main/attachmentscompressed/Pasted%20image%2020260214142144.webp)

Una vez hecho esto, conecta cada etiqueta de red a los pines de datos de uno de tus cuatro conectores USB downstream. Recuerda: **cada par de datos va a un solo puerto USB**. No compartas un par entre múltiples conectores.

![img](https://raw.githubusercontent.com/Outdatedcandy92/USB-Hub-Guide/main/attachmentscompressed/Pasted%20image%2020260214142305.webp)



A continuación, termina de cablear los pines restantes en tus conectores USB downstream.

- **VBUS / VCC** se conecta a **+5 V**.

- **GND** y **SH** (blindaje) se conectan a **GND**.

- Para los puertos USB-C downstream, cablearlos de la misma manera que el puerto upstream, **excepto** que necesitarás agregar **resistencias pull-up de 56 kΩ en los pines CC** en lugar de pull-downs.

Para los puertos USB-C downstream, los **pines CC** usan **resistencias pull-up** en lugar de pull-downs. La forma estándar de mostrar un pull-up en un esquemático es tener la resistencia **apuntando hacia arriba** hacia el suministro de voltaje.

Así que para cada puerto USB-C downstream, coloca una **resistencia de 56 kΩ** en los pines CC1 y CC2, oriéntala apuntando hacia arriba y conecta el otro extremo a **+5 V**.

Si has seguido todos estos pasos, tu esquemático debería verse ahora limpio y completo, con todas las señales de alimentación, datos y control correctamente conectadas.

![img](https://raw.githubusercontent.com/Outdatedcandy92/USB-Hub-Guide/main/attachmentscompressed/zen_FFMfDI7HfY.webp)


¡Casi hemos terminado! La última pequeña pieza por agregar son los **condensadores**, específicamente **condensadores de desacoplamiento**.

Los condensadores hacen dos cosas principales: **almacenan energía** y **permiten que las señales de alta frecuencia pasen**. Usamos estas propiedades a nuestro favor colocándolos en los rieles de alimentación. Ayudan a suavizar pequeñas caídas de voltaje y filtran el ruido eléctrico, manteniendo nuestro concentrador USB estable.

Para este proyecto, coloca **condensadores de 1 uF** entre **VBUS** (o VCC) y **GND** en cada conector USB. Esto asegura que cada puerto obtenga alimentación limpia y constante, y mantiene el concentrador funcionando de manera confiable.

![img](https://raw.githubusercontent.com/Outdatedcandy92/USB-Hub-Guide/main/attachmentscompressed/Pasted%20image%2020260214142859.webp)


<video controls muted playsinline>
  <source src="https://fallout.hackclub.com/docs-assets/guided-projects/usb-hub/20260214-1930-04.0631176.mp4" type="video/mp4">
</video>

Básicamente, cada condensador de desacoplamiento tendrá **un extremo conectado al pin de alimentación** y el **otro extremo conectado a tierra**.

Un pequeño consejo de etiqueta de esquemático: **las banderas de alimentación deben apuntar hacia arriba** y **las banderas de tierra deben apuntar hacia abajo**. Para mantener las cosas ordenadas, coloca tus condensadores de desacoplamiento siguiendo esta convención, extremo de alimentación hacia la bandera +5 V y extremo de tierra hacia la bandera GND. Esto hace que el esquemático sea más fácil de leer y visualmente consistente.

![img](https://raw.githubusercontent.com/Outdatedcandy92/USB-Hub-Guide/main/attachmentscompressed/zen_At1Ew0Cgyv%201.webp)

Para los pines de suministro interno del IC, **VDD33** (3.3 V) y **VDD18** (1.8 V), agregaremos **dos condensadores cada uno**: uno de **1 uF** y otro de **100 nF**. Ambos actúan como condensadores de desacoplamiento, pero el **condensador más pequeño de 100 nF reacciona más rápido** a los picos repentinos de voltaje, lo que lo hace excelente para filtrar ruido de alta frecuencia.

Haremos lo mismo para el pin **VDD5**: un condensador de 1 uF y uno de 100 nF a tierra. Esto mantiene todos los rieles de alimentación del IC limpios y estables, asegurando un funcionamiento confiable del concentrador.

![img](https://raw.githubusercontent.com/Outdatedcandy92/USB-Hub-Guide/main/attachmentscompressed/Pasted%20image%2020260214143235.webp)

Aquí está aproximadamente cómo debería verse tu esquemático completado al final: todos los rieles de alimentación, conexiones a tierra, líneas de datos, resistencias pull-up/pull-down y condensadores de desacoplamiento en su lugar, con un flujo limpio de izquierda a derecha desde el puerto upstream a través del IC hasta los puertos downstream. Todo debería estar claramente etiquetado y fácil de leer, listo para la etapa de PCB.

![img](https://raw.githubusercontent.com/Outdatedcandy92/USB-Hub-Guide/main/attachmentscompressed/zen_nKM5G6KMHf.webp)


Y así, ¡**esquemáticos completos!** 🎉

No olvides **guardar tu trabajo** presionando `Ctrl + S` para que todo tu arduo trabajo esté a salvo. Tu concentrador USB ahora está completamente diseñado en papel, listo para el siguiente paso.

---
