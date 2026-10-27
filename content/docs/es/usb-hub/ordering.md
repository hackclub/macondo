---
title: Realizar el pedido
description: Ejecuta el DRC y luego pide tu concentrador USB como PCBA ensamblado en JLCPCB con el color, acabado, cantidad y BOM correctos.
section: guides
order: 3
icon: shopping-bag
group: usb-hub
groupTitle: USB Hub
groupOrder: 1
requiresJournal: true
---
# Realizando el pedido

::note{title="Lo que harás aquí"}
Este es el último paso: convertir tu placa terminada en un concentrador USB real y fabricado. Ejecutarás una verificación rápida del diseño (el DRC), corregirás el único error que casi siempre aparece y luego realizarás un pedido PCBA en JLCPCB con el color, acabado de superficie, cantidad y BOM correctos. No necesitas experiencia previa pidiendo placas, cada clic se muestra a continuación.
::

Ahora que nuestra placa está terminada, ¡es hora de ordenarla! Vamos por PCBA, que significa Printed Circuit Board Assembly (ensamblaje de placa de circuito impreso), porque estamos haciendo que nos ensamblen la placa. Esto es perfecto ya que tenemos algunos componentes diminutos de paso fino que son difíciles de soldar a mano, especialmente si recién estás comenzando.

Pero antes de presionar ese botón de ordenar, hay una pequeña pero muy importante verificación que siempre ejecutamos primero: el DRC.

### DRC

El Design Rule Checker, o DRC para abreviar, es una herramienta que escanea tu diseño en busca de cualquier problema que pudiera causar problemas durante la fabricación. Verifica cosas como si diferentes redes están accidentalmente conectadas o si algo más podría impedir que tu placa se haga correctamente. Si todo pasa, estás listo.

Ejecutar el DRC es fácil. Solo haz clic en DRC en la barra inferior, luego presiona Check DRC.

<video controls muted playsinline>
  <source src="https://fallout.hackclub.com/docs-assets/guided-projects/usb-hub/20260218-2123-12.1039924.mp4" type="video/mp4">
</video>

Probablemente verás aparecer un Differential Pair Error. Esto sucede porque los pares diferenciales idealmente necesitan tener la misma longitud para señales de alta velocidad. Como solo estamos haciendo un concentrador USB 2.0, las reglas para longitudes iguales son bastante relajadas, así que podemos ajustar la configuración del DRC.

Para arreglarlo, ve a Design en la barra superior y haz clic en Design Rules. Se abrirá una nueva pestaña. En el lateral, encuentra Differential Pair, haz clic en él y cambia la tolerancia de longitud a 10. Luego presiona Confirm, y estarás listo.

<video controls muted playsinline>
  <source src="https://fallout.hackclub.com/docs-assets/guided-projects/usb-hub/20260218-2124-07.0257039.mp4" type="video/mp4">
</video>

Después de actualizar la tolerancia, haz clic en Check DRC nuevamente. Esta vez, no deberías ver más errores, lo que significa que tu diseño está listo para usarse.

<video controls muted playsinline>
  <source src="https://fallout.hackclub.com/docs-assets/guided-projects/usb-hub/20260218-2124-56.2626131.mp4" type="video/mp4">
</video>

Si aún ves algunos errores DRC, intenta buscarlos en Google para encontrar una solución. Si eso no ayuda, pregunta en foros o, si estás en el Slack de Hack Club, deja una pregunta en el canal `#electronics`.

### Ordenando desde JLCPCB

Con el DRC limpio, estás listo para enviar la placa. Para realizar tu pedido, haz clic en el botón Order PCB en la barra superior. Te preguntará si quieres ejecutar el DRC una vez más, así que adelante, verifícalo para estar seguro. Luego haz clic en Confirm en el siguiente cuadro de diálogo y serás redirigido a JLCPCB, donde tu PCB se subirá automáticamente.

<video controls muted playsinline>
  <source src="https://fallout.hackclub.com/docs-assets/guided-projects/usb-hub/20260218-2131-45.1865201.mp4" type="video/mp4">
</video>

Hay muchas configuraciones aquí, lo cual puede ser un poco abrumador, pero las únicas por las que realmente necesitas preocuparte son PCB Color y Surface Finish.

![img](https://raw.githubusercontent.com/Outdatedcandy92/USB-Hub-Guide/main/attachmentscompressed/Pasted%20image%2020260218163322.webp)

PCB Color es bastante sencillo. Decide el color de tu placa. El predeterminado es verde, que ya se ve genial, pero puedes elegir cualquier color que te guste. En mi opinión, el verde, el negro y el blanco se ven más chévere.

![img](https://raw.githubusercontent.com/Outdatedcandy92/USB-Hub-Guide/main/attachmentscompressed/Pasted%20image%2020260218163850.webp)

Surface Finish se refiere a cómo se recubren los pads expuestos en tu PCB. HASL es el predeterminado y da un acabado plateado. HASL Lead Free es lo mismo pero sin plomo, y ENIG da un acabado dorado. Para este proyecto, recomiendo usar HASL, aunque puedes elegir la opción Lead Free si lo prefieres.

A continuación, desplázate hacia abajo y selecciona la opción PCB Assembly. En las configuraciones, asegúrate de que el PCBA Type esté configurado como Economic y la PCBA Quantity sea 2. Puedes dejar el resto de las configuraciones como están.

<video controls muted playsinline>
  <source src="https://fallout.hackclub.com/docs-assets/guided-projects/usb-hub/20260218-2139-57.9695767.mp4" type="video/mp4">
</video>


Ahora haz clic en Next, y luego Next nuevamente. Llegarás a la página de BOM. Asegúrate de que todas las piezas estén seleccionadas, ya que algunas pueden estar desmarcadas por defecto. Después de eso, simplemente continúa con el resto de los pasos.

<video controls muted playsinline>
  <source src="https://fallout.hackclub.com/docs-assets/guided-projects/usb-hub/20260218-2143-05.3479768.mp4" type="video/mp4">
</video>

Llegarás a la página de cotización y pedido. Aquí solo necesitas ingresar una descripción del producto. Realmente no importa lo que pongas, así que elegí DIY. Luego haz clic en Save to Cart, y habrás terminado.

![img](https://raw.githubusercontent.com/Outdatedcandy92/USB-Hub-Guide/main/attachmentscompressed/Pasted%20image%2020260218164615.webp)

¡Ahora puedes seguir adelante y ordenar tu propio concentrador USB personalizado!
