---
title: Herramientas y software
description: Elige rápido tus herramientas CAD y de PCB. Basadas en navegador para empezar, apps de escritorio cuando se te queden pequeñas, con opciones gratis para cualquier computadora.
section: hardware
order: 0
icon: wrench
---
# Hardware: Herramientas y software

Necesitas dos tipos de software para un proyecto de hardware: **CAD** para cualquier parte impresa en 3D, y **diseño de PCB** para una placa de circuito personalizada. Para cada uno eliges entre una herramienta de navegador (fácil, funciona en cualquier computadora) y una app de escritorio (más poderosa, necesita una mejor máquina). Esta página te dice cuál tomar para que dejes de investigar y empieces a construir.

Empezar con hardware puede sentirse abrumador. Palabras nuevas, herramientas nuevas, decisiones que aún no sabes cómo tomar. Eso es normal, y se pasa rápido una vez que tienes la herramienta correcta abierta frente a ti.

::tip{title="Búscalo"}
La habilidad más importante en hardware: **búscalo**. Si estás atascado, casi con certeza hay una publicación de foro, un tutorial o una hoja de datos que responde a tu pregunta. Acostúmbrate a buscar antes de preguntar.
::

::danger{title="Usar IA está permitido, pero mantenlo pulido"}
HC AI y otras herramientas de IA están bien para ayudarte. **No** están bien para soltarnos un diseño generado por IA. Tu envío debe ser un proyecto que entiendas, con pulido evidente, pruebas, y tu propia iteración encima. **El uso intenso de IA sin pulir será rechazado. Eso incluye esquemáticos o CAD generados sin revisar, salida copiada y pegada, y journals escritos por IA.** Cuando tengas dudas, rehazlo con tus propias palabras. Los journals siempre los escribes tú, nunca la IA.
::

## ¿Herramienta de navegador o app de escritorio?

Tanto para CAD como para diseño de PCB, elegirás entre los mismos dos sabores:

- **Basadas en navegador** son el punto de partida fácil. Elige esto si tu computadora es antigua, estás en un Chromebook, o solo quieres empezar sin instalar nada.
- **Apps de escritorio** son más poderosas para trabajo a largo plazo, pero necesitan una computadora capaz (8GB+ de RAM, CPU decente).

Las herramientas de navegador están perfectamente bien para la mayoría de proyectos. No dejes que tu computadora te impida empezar.

---

## ¿Qué uso para diseñar partes 3D?

Si tu proyecto tiene una **carcasa**, un **estuche** o cualquier parte impresa en 3D, necesitas software **CAD**. Aquí están las dos que recomendamos.

<div style="display:flex;flex-direction:column;gap:1rem;margin:1rem 0"><div style="background:rgb(104 77 58/0.1);border:3px solid rgb(104 77 58/0.2);padding:1.25rem;cursor:pointer" onclick="window.open('https://www.onshape.com','_blank')"><div><strong style="color:rgb(104 77 58);font-size:1rem">Onshape</strong> <span style="color:rgb(104 77 58/0.5);font-size:0.85rem">Basado en navegador</span></div><div style="margin-top:0.5rem;font-size:0.875rem;color:rgb(104 77 58/0.8);line-height:1.6">Se ejecuta completamente en el navegador, así que funciona en cualquier computadora, incluso un Chromebook. Más fácil de aprender, tiene excelentes funciones de compartir y es gratis para aficionados y estudiantes. También lo usan ingenieros profesionales, así que no se te quedará pequeño. Un buen lugar para empezar si nunca has hecho CAD antes.</div><div style="margin-top:0.5rem;font-size:0.8rem"><a href="https://www.onshape.com" target="_blank" style="color:rgb(104 77 58);font-weight:600;text-decoration:underline">onshape.com</a></div></div><div style="background:rgb(104 77 58/0.1);border:3px solid rgb(104 77 58/0.2);padding:1.25rem;cursor:pointer" onclick="window.open('https://www.autodesk.com/products/fusion-360','_blank')"><div><strong style="color:rgb(104 77 58);font-size:1rem">Autodesk Fusion</strong> <span style="color:rgb(104 77 58/0.5);font-size:0.85rem">App de escritorio</span></div><div style="margin-top:0.5rem;font-size:0.875rem;color:rgb(104 77 58/0.8);line-height:1.6">Una app de escritorio que maneja modelos complejos mejor y corre más fluido para proyectos grandes. Más pesada en tu computadora (necesita una GPU y RAM decentes). Gratis para estudiantes. Si tu computadora puede manejarlo, Fusion es la opción más poderosa.</div><div style="margin-top:0.5rem;font-size:0.8rem"><a href="https://www.autodesk.com/products/fusion-360" target="_blank" style="color:rgb(104 77 58);font-weight:600;text-decoration:underline">autodesk.com/products/fusion-360</a></div></div></div>

**Versión corta:** empieza con Onshape. Pásate a Fusion más adelante si quieres más potencia y tu computadora lo aguanta.

---

## ¿Qué uso para diseñar una placa de circuito?

Si tu proyecto tiene una **placa de circuito personalizada**, necesitas software de **diseño de PCB**. La misma elección de dos sabores que con CAD.

<div style="display:flex;flex-direction:column;gap:1rem;margin:1rem 0"><div style="background:rgb(104 77 58/0.1);border:3px solid rgb(104 77 58/0.2);padding:1.25rem;cursor:pointer" onclick="window.open('https://easyeda.com','_blank')"><div><strong style="color:rgb(104 77 58);font-size:1rem">EasyEDA</strong> <span style="color:rgb(104 77 58/0.5);font-size:0.85rem">Basado en navegador</span></div><div style="margin-top:0.5rem;font-size:0.875rem;color:rgb(104 77 58/0.8);line-height:1.6">Se ejecuta en el navegador, amigable para principiantes y genial para empezar. Integrado con LCSC/JLCPCB para ordenar materiales y placas. Puede ser limitante para proyectos más complejos, pero perfectamente bien para tus primeros PCBs. Nuestra <a href="/docs/usb-hub" style="color:rgb(104 77 58);font-weight:600;text-decoration:underline">guía de hub USB</a> usa EasyEDA.</div><div style="margin-top:0.5rem;font-size:0.8rem"><a href="https://easyeda.com" target="_blank" style="color:rgb(104 77 58);font-weight:600;text-decoration:underline">easyeda.com</a></div></div><div style="background:rgb(104 77 58/0.1);border:3px solid rgb(104 77 58/0.2);padding:1.25rem;cursor:pointer" onclick="window.open('https://www.kicad.org','_blank')"><div><strong style="color:rgb(104 77 58);font-size:1rem">KiCad</strong> <span style="color:rgb(104 77 58/0.5);font-size:0.85rem">App de escritorio</span></div><div style="margin-top:0.5rem;font-size:0.875rem;color:rgb(104 77 58/0.8);line-height:1.6">Código abierto, grado profesional y usado en la industria. Funciona para proyectos introductorios hasta placas complejas multicapa. Curva de aprendizaje más empinada, pero sin límites en lo que puedes diseñar. Si tu computadora tiene el espacio y estás dispuesto a invertir el tiempo para aprender, KiCad es la mejor opción a largo plazo. Gratis.</div><div style="margin-top:0.5rem;font-size:0.8rem"><a href="https://www.kicad.org" target="_blank" style="color:rgb(104 77 58);font-weight:600;text-decoration:underline">kicad.org</a></div></div></div>

**Versión corta:** empieza con EasyEDA. Es lo que usa nuestra [guía de hub USB](/docs/usb-hub), así que puedes seguirla paso a paso. Cámbiate a KiCad cuando quieras sin límites.

::tip{title="Tu tiempo de diseño también cuenta"}
Las horas de hardware cuentan, no solo programar. KiCad tiene un plugin de WakaTime que puedes apuntar a Hackatime, así que tu tiempo de diseño de placas se registra automáticamente igual que el tiempo de código (pregunta en **#hackatime-help** para configurarlo). Para herramientas sin plugin, registra tu tiempo de diseño y construcción en un [diario](/docs/journals).
::

---

## ¿Qué construyo?

¿Aún no sabes qué hacer? Empieza con uno de nuestros proyectos guiados. Cada uno te lleva por un build real de principio a fin, así lo sigues, aprendes la herramienta, y luego lo reinventas en algo tuyo.

::doc-card{to="/docs/guided-projects" title="Revisa las Guías" description="Tutoriales paso a paso para sitios web con HTML, hubs USB con PCB, hosting y más. Empieza con uno y luego dale tu propio toque." icon="book-open" size="lg"}
::

¿Aún quieres más ideas? Estos recursos externos están llenos de builds de hardware para inspirarte:

- [Adafruit Learn](https://learn.adafruit.com) tiene guías increíbles para todos los niveles. Sus tutoriales te llevan paso a paso por proyectos completos.
- [Hackaday](https://hackaday.com) muestra proyectos de hardware creativos de todo el mundo, incluyendo algunos de Hack Clubbers.
- [Instructables](https://www.instructables.com) tiene un rango enorme de proyectos DIY en electrónica, impresión 3D, carpintería y más.
- [Printables](https://www.printables.com) tiene modelos 3D que puedes usar como punto de partida para tus propios diseños.

---

## ¿Dónde consigo ayuda para construirlo?

Una vez que tu diseño esté listo, tienes que construir la cosa de verdad. Dos lugares en los que apoyarte:

- Pregunta en **#macondo** en el [Slack de Hack Club](https://slack.hackclub.com). La gente ahí ha construido todo tipo de cosas.
- ¿No tienes impresora 3D? Pregunta en **#printing-legion** en Slack y alguien ahí puede imprimir tu pieza y enviártela por correo. Más en [printlegion.hackclub.com](https://printlegion.hackclub.com/).
- Revisa [hwdocs.hackclub.dev](https://hwdocs.hackclub.dev) para documentación específica de hardware escrita por Hack Clubbers.

::tip
Cuando te atasques, búscalo primero. Hojas de datos, publicaciones de foro, desmontajes de YouTube. Si eso no responde tu duda, pregunta en Slack. Nadie espera que ya sepas todo.
::

> **Siguiente:** Ahora que tienes tus herramientas, aprende cómo [escribir buenos journals](/docs/journals) para documentar tu progreso. Luego revisa los [proyectos guiados](/docs/guided-projects) para empezar a construir.

## Ver también

- [Proyectos guiados](/docs/guided-projects) , builds de inicio paso a paso que puedes seguir y reinventar
- [Guía de hub USB](/docs/usb-hub) , diseña un PCB de 2 puertos desde cero en EasyEDA
- [Journals](/docs/journals) , cómo documentar tu build y registrar horas
