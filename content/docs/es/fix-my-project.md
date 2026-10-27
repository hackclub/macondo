---
title: Arreglar mi proyecto
description: ¿Tu ship volvió con cambios o fue rechazado? Aquí están los motivos más comunes y cómo arreglar cada uno antes de reenviarlo.
section: project
order: 4
icon: wrench
---
# Arreglar mi proyecto

¿Tu ship volvió con cambios, o fue rechazado? Es algo normal y tiene arreglo. Un revisor pide cambios cuando algo falta o no queda claro, no para castigarte. Esta página lista los motivos más comunes y exactamente qué hacer con cada uno, para que lo arregles y lo reenvíes.

*Adaptado de [@alexren](https://github.com/qcoral/) en [hwdocs.hackclub.com](https://hwdocs.hackclub.dev)*

## Qué significa de verdad "cambios solicitados"

Cuando un revisor pide cambios, tu ship pasa a un estado de **cambios solicitados**. Verás un banner en la parte superior de la página de tu proyecto con su retroalimentación. Léelo, haz los arreglos y luego presiona el botón **Reenviar a revisión** más abajo en la página para devolverlo a la cola.

No se pierde nada mientras arreglas cosas. Tu proyecto, tus horas y tus journals siguen en su sitio. Si decides que prefieres no hacer los cambios, también puedes retirar el ship en su lugar. La mayoría de los proyectos que vuelven solo necesitan uno o dos de los arreglos de abajo.

El resto de esta página recorre los ocho motivos por los que un ship suele volver, con el arreglo de cada uno.

## 1. Archivos de proyecto faltantes

El arreglo: incluye tus **archivos fuente**, no solo exportaciones o compilaciones. Los archivos fuente permiten a los revisores verificar tu trabajo y te ayudan a depurar. Los formatos de exportación y las compilaciones pierden información importante.

**Proyectos de software:**

- Incluye tu código fuente real, no solo una versión construida/compilada.
- Si tienes un paso de construcción, incluye instrucciones de cómo ejecutarlo localmente.
- Incluye un `package.json`, `requirements.txt` o cualquier archivo de dependencias que use tu proyecto.
- No hagas commit de `node_modules`, carpetas de build o archivos `.env`. Usa un `.gitignore`.

**Proyectos de hardware:**

- **Modelos 3D:** Los archivos STL/OBJ/3MF no son suficientes. Incluye la fuente original (.f3d para Fusion, enlace de Onshape, etc.) Y un archivo .STEP.
- **PCBs:** Incluye archivos .kicad_pro, .kicad_sch y .kicad_pcb (o el equivalente para EasyEDA). Los Gerbers solos no son suficientes.
- **Firmware:** Incluye tanto código como sea posible, aunque no pueda ejecutarse completamente sin el hardware.

> Los archivos fuente permiten a los revisores verificar tu trabajo y te ayudan a depurar problemas. Los formatos de exportación y las compilaciones pierden información importante.

---

## 2. Repositorio desordenado y difícil de leer

El arreglo: agrupa los archivos por propósito para que un revisor pueda encontrar lo que necesita sin tener que buscar. Un revisor debería poder abrir tu repositorio y entender qué hay en él en treinta segundos. Si no puede, lo devolverá.

Aquí está [ember](https://github.com/notaroomba/ember), una placa de reflujo USB-C, como referencia. Nota cómo el código fuente del diseño, las salidas de manufactura, el firmware y los visuales viven cada uno en su propia carpeta de nivel superior:

```
ember/
├── hardware/         # Todo el código fuente del diseño (eléctrico y mecánico)
│   ├── board/        # Proyecto KiCad para la PCB del controlador
│   ├── heatbed/      # Proyecto KiCad para la PCB de la cama caliente
│   ├── case/         # Exportaciones STEP de OnShape
│   └── lib/          # Bibliotecas compartidas de símbolos/footprints
├── software/         # Firmware STM32
│   ├── Core/
│   ├── Drivers/
│   └── Makefile
├── production/       # Salidas listas para fabricación (gerbers, BOM, CPL)
├── assets/           # Renders, imágenes de esquemáticos, banners
├── BOM.csv
└── README.md
```

Algunos principios que hacen que esto funcione:

- **Divide por propósito, no por tipo de archivo.** `hardware/` contiene todo el código fuente del diseño, eléctrico y mecánico juntos. `production/` contiene los entregables que necesita una casa de fabricación. No disperses archivos STEP en tres carpetas diferentes.
- **Cada PCB tiene su propia carpeta.** Si tu proyecto tiene varias placas, dale a cada una una carpeta hermana dentro de `hardware/` (como `board/` y `heatbed/`). No mezcles archivos `.kicad_pcb` en la raíz.
- **Mantén las salidas de manufactura separadas del código fuente.** Los archivos derivados (gerbers, BOMs, archivos de posición) van en su propia carpeta para que una casa de fabricación pueda tomar solo esa carpeta.
- **El firmware es lo suyo.** Dale una carpeta de nivel superior `software/` o `firmware/`, no lo entierres dentro de `hardware/`.

Para proyectos solo de software, la misma idea aplica. Separa `src/`, `tests/`, `docs/` y los archivos de configuración. No tires todo en la raíz.

> Un revisor debería poder abrir tu repositorio y entender qué hay en él en treinta segundos. Si no puede, lo devolverá.

---

## 3. El proyecto está incompleto

El arreglo: déjalo lo suficientemente completo para que alguien pudiera realmente usarlo o construirlo. No necesita ser perfecto, pero el núcleo tiene que funcionar.

### Software

No envíes una app a medio construir con páginas placeholder y comentarios pendientes por todas partes. Las funciones principales deberían funcionar. Si tienes una página de login, debería realmente iniciar sesión. Si tienes una barra de búsqueda, debería realmente buscar.

### Hardware

Tu proyecto necesita estar lo suficientemente completo para que alguien pueda construirlo. Eso significa:

- **Los modelos 3D** deberían incluir toda la electrónica (microcontroladores, pantallas, motores, baterías), no solo la carcasa. Agregar cada componente previene errores costosos de ensamblaje donde las cosas no encajan físicamente.
- **El firmware** debería contener la lógica real de tu proyecto, no sketches de prueba básicos como "parpadear LED" o "leer sensor". Incluye instrucciones de compilación para que alguien pueda construirlo.
- **Los diagramas de cableado** deberían etiquetar cada conexión claramente. Una sola línea conectando capturas de pantalla de materiales no es un diagrama de cableado.

---

## 4. README débil

El arreglo: tu README es lo primero que ve un revisor, así que haz que explique el proyecto por sí solo. Si un revisor no puede entender tu proyecto solo por el README, será devuelto.

Un buen README cubre:

- Qué es el proyecto y qué hace.
- Cómo configurarlo y ejecutarlo (para software: pasos de instalación, comandos a ejecutar. Para hardware: instrucciones de ensamblaje).
- Qué componentes/dependencias se necesitan.
- Capturas de pantalla o fotos mostrando cómo se ve.

---

## 5. Lista de materiales inflada (hardware)

El arreglo: pide solo lo que la construcción realmente necesita. Somos una organización sin fines de lucro con fondos limitados, así que sé eficiente. Si hay una alternativa más barata que funcione, úsala.

Problemas comunes:

- Pedir materiales sobredimensionados para tareas simples.
- Agregar extras "por si acaso".
- Mal sourcing (pagar $35 por un Arduino cuando puedes conseguir una placa compatible por $5).
- Pedir una bobina completa de filamento para una impresión de 100g.

---

## 6. Falta de pulido

El arreglo: haz que se vea intencional. El pulido es lo que convierte un prototipo funcional en un proyecto terminado. No necesitas perfección, pero debería verse **intencional**.

**Software:** ¿Tiene una UI limpia? ¿Hay enlaces rotos o texto placeholder? ¿Hay manejo de errores? ¿Podrías mostrárselo a alguien y entendería cómo usarlo sin que tú se lo expliques?

**Hardware:** ¿Tiene una carcasa o estuche? ¿Los bordes están limpios? Sin cables colgando o protoboards expuestas en la construcción final.

Aquí hay un ejemplo. El Orpheuspad antes y después del pulido:

<div style="display:flex;gap:1rem;margin:1rem 0"><div style="flex:1;text-align:center"><img src="/images/docs/orpheuspad-before.webp" alt="Orpheuspad antes del pulido" style="width:100%;border:3px solid rgb(104 77 58/0.2)" /><div style="font-size:0.8rem;color:rgb(104 77 58/0.5);margin-top:0.5rem">Antes</div></div><div style="flex:1;text-align:center"><img src="/images/docs/orpheuspad-after.webp" alt="Orpheuspad después del pulido" style="width:100%;border:3px solid rgb(104 77 58/0.2)" /><div style="font-size:0.8rem;color:rgb(104 77 58/0.5);margin-top:0.5rem">Después</div></div></div>

La versión pulida tiene patrones en relieve, un ángulo de inclinación, esquinas redondeadas, chaflanes y un logo. El mismo principio aplica al software: una app pulida tiene estilos consistentes, buenos mensajes de error y una UI que tiene sentido sin un manual.

---

## 7. Demasiada IA

El arreglo: la ayuda de IA está permitida, pero tu envío tiene que ser trabajo que entiendas y hayas pulido. Si un revisor marcó uso intenso de IA, así puedes recuperarte:

- **Reescribe a mano los módulos más tocados por IA.** Elige las partes que no entiendes y escríbelas desde cero. Los revisores notan la diferencia.
- **Agrega tu propio pulido.** Manejo de errores, casos límite, cobertura de pruebas real, refinamiento de UI. Las cosas que un solo prompt de IA no produce.
- **Reescribe el README con tu voz.** Explica las decisiones que tomaste y las partes con las que tuviste dificultades.
- **Revisa tus journals.** Los journals siempre los escribes tú, no la IA. Si alguno fue generado, reescríbelo honestamente antes de reenviar.
- **Puedes explicar cada línea.** Si un revisor pregunta cómo funciona una función y no puedes responder sin volver a preguntarle a la IA, reescribe esa función.

En la página de tu proyecto, marca la casilla **Usé IA en este proyecto** y describe honestamente para qué usaste IA. A los revisores les importa menos el hecho y más qué hiciste con la salida.

---

## 8. Plagio o fraude

Esta es la única categoría que no se arregla reenviando. Estas cosas hacen que tu proyecto sea rechazado permanentemente:

- Seguir un tutorial casi al pie de la letra 1:1 y enviarlo como propio.
- Enviar un proyecto construido por alguien más y hacerlo pasar como propio.
- Usar IA para generar tu proyecto completo sin ninguna revisión, pulido o iteración (el trabajo con ayuda de IA que entiendes y refinas está bien; los journals generados por IA nunca lo están).
- Inflar intencionalmente el tiempo registrado (dejar Hackatime corriendo mientras no programas, dejar timelapse corriendo mientras estás inactivo).

> El plagio o fraude resulta en una prohibición permanente del programa y potencialmente de Hack Club en su conjunto. No te arriesgues.

## Dos preguntas que en realidad no son sobre tu ship

A veces lo que se siente roto es tu racha o tus horas, no el ship en sí. Estas dos surgen mucho:

**"Mi racha se rompió aunque programé una hora."** Primero, la buena noticia: una hora de trabajo en **cualquier** proyecto mantiene vivas **todas** tus rachas ese día, así que una racha rara vez se resetea de verdad si registraste tiempo real. Si la racha de un proyecto específico no **subió**, eso es otra cosa: un proyecto solo avanza los días en que pones una hora completa en **ese** proyecto, así que una hora repartida entre varios proyectos, o tiempo de editor registrado bajo un nombre de proyecto de Hackatime distinto, no moverá ninguna planta. Una racha solo se resetea a 0 en un día sin ninguna hora válida en ningún proyecto y sin un congelado que lo cubra. La regla completa, incluyendo cómo se suman las horas de journal y cómo funcionan los freezes, está en [Ganar oro](/docs/currency). Para asegurarte de que tu tiempo de editor caiga en el proyecto correcto, mira [Hackatime](/docs/hackatime).

**"Mi tiempo total muestra más de lo que registré en Hackatime."** Eso suele ser lo esperado, no un error. Tu total puede incluir **horas de journal** que registraste por trabajo que no es programar (arte, diseño, ensamblaje de hardware) además de tu tiempo de Hackatime. Los revisores deciden las horas aprobadas finales y pueden ajustar tiempo que no esté respaldado por trabajo real. Mira [Hackatime](/docs/hackatime) para ver cómo se suman las horas y [Ganar oro](/docs/currency) para ver cómo las horas aprobadas se convierten en oro.

## Ver también

- [¿Qué es shipping?](/docs/what-is-shipping) , cómo funcionan las revisiones y los reenvíos
- [Buen diario](/docs/journals) , qué esperan los revisores de tus entradas de diario
- [Conseguir materiales](/docs/sourcing-parts) , cómo pedir financiamiento de hardware de forma eficiente
- [Ganar oro](/docs/currency) , cómo funcionan el oro, las rachas y las horas aprobadas
- [Hackatime](/docs/hackatime) , por qué tus horas pueden verse bajas o altas
