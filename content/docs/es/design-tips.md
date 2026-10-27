---
title: Tips de diseño
description: Una lista de hábitos de diseño de hardware que hacen tu construcción más fácil de ensamblar, más barata de arreglar y más rápida de pasar revisión.
section: hardware
order: 3
icon: pencil-ruler
---
# Tips de diseño

**¿Quieres que tu construcción de hardware quede limpia a la primera?** Esta página es una lista corta de hábitos a los que recurren los makers con experiencia, agrupados según en qué parte de la construcción estés: el proyecto entero, la PCB, el modelo 3D y el README. Nada de esto es obligatorio, pero cada tip de aquí te ahorra una reimpresión, un nuevo pedido o una ronda de comentarios en revisión.

Repasa la sección que coincide con lo que estás haciendo ahora mismo. No necesitas leerla de arriba a abajo.

*Original por [@alexren](https://github.com/qcoral/) en [hwdocs.hackclub.com](https://hwdocs.hackclub.dev)*

## Diseño general

Estos cuatro hábitos mantienen tu proyecto **construible**, que es lo que más les importa tanto a los revisores como a tu yo del futuro.

- **Diseña para producir y ensamblar.** Piensa en cómo se construirá de verdad tu proyecto. Si no puedes ensamblarlo, rediséñalo.
- **Incluye tolerancias.** Las impresoras 3D no son perfectas. Agrega 0.2-0.5mm de margen para partes que necesitan encajar juntas.
- **Modela todo.** Incluye toda la electrónica en tu modelo CAD, no solo la carcasa. Esto previene momentos de "oh no, la batería no cabe".
- **Mantenlo simple.** Si tu diseño tiene 50 partes y nunca has construido nada antes, redúcelo. Siempre puedes iterar.

---

## Diseño de PCB

Unas pocas reglas básicas mantienen tu placa **silenciosa** (con menos ruido eléctrico) y evitan que tu primer pedido vuelva roto.

- **Mantén las pistas cortas.** Pistas más cortas significan menos ruido y mejor integridad de señal.
- **Usa un plano de tierra.** Vierte cobre en la capa inferior para tierra. Reduce el ruido y facilita el enrutamiento.
- **Los capacitores de desacoplo van cerca del IC.** No al otro lado de la placa. Justo al lado de los pines de alimentación.
- **Enruta las pistas de alimentación más anchas.** Llevan más corriente. 0.5mm mínimo para pistas de señal, 0.8mm+ para alimentación.
- **Ejecuta DRC antes de ordenar.** El Design Rule Check detecta errores que arruinarían tu placa.

---

## Modelado 3D

Pequeñas decisiones de modelado deciden si tu impresión queda **resistente, cómoda y fácil de montar**.

- **Redondea tus bordes.** Las esquinas redondeadas se ven más profesionales y son más cómodas de sostener:

<div style="display:flex;gap:1rem;margin:0.75rem 0 1rem"><div style="flex:1;text-align:center"><img src="/images/docs/design-unrounded.webp" alt="Esquinas sin redondear" style="width:100%;border:3px solid rgb(104 77 58/0.2)" /><div style="font-size:0.75rem;color:rgb(104 77 58/0.5);margin-top:0.25rem">Antes</div></div><div style="flex:1;text-align:center"><img src="/images/docs/design-rounded.webp" alt="Esquinas redondeadas" style="width:100%;border:3px solid rgb(104 77 58/0.2)" /><div style="font-size:0.75rem;color:rgb(104 77 58/0.5);margin-top:0.25rem">Después</div></div></div>

- **Piensa en la orientación de impresión.** La dirección en que imprimes afecta la resistencia y el acabado de superficie.
- **Agrega agujeros de montaje.** Aunque aún no tengas una carcasa, los agujeros de montaje facilitan adjuntar tu placa después.
- **Prueba el ajuste antes de la impresión final.** Imprime una sección pequeña primero para verificar que las tolerancias sean correctas.

---

## Consejos del README

Tu README es lo primero que lee un revisor. Uno **claro** hace que tu proyecto sea fácil de entender y fácil de aprobar.

- Empieza con una descripción de una línea de lo que hace el proyecto
- Incluye una foto o render del producto terminado
- Lista todos los componentes con enlaces a dónde los compraste
- Incluye instrucciones de ensamblaje, aunque sean breves
- Agrega una sección "Qué haría diferente". A los revisores les encanta ver auto-conciencia.

---

## Recursos útiles

¿Quieres profundizar en cualquiera de los puntos anteriores? Empieza por aquí:

- [hwdocs.hackclub.dev](https://hwdocs.hackclub.dev) tiene guías detalladas sobre depuración, ordenar, mejores prácticas de esquemas y más
- [Adafruit Learn](https://learn.adafruit.com) para tutoriales de electrónica
- [Hackaday](https://hackaday.com) para inspiración de proyectos
- [Phil's Lab en YouTube](https://www.youtube.com/@PhilsLab) para tutoriales de diseño de PCB
- [EEVblog](https://www.youtube.com/@EEVblog) para ingeniería electrónica

¿Atascado en una decisión de diseño específica? Pregunta en **#macondo-help** en Slack y alguien lo revisará contigo.

## Ver también

- [Construye una placa de desarrollo](/docs/build-a-devboard) , un ejemplo completo de principio a fin, del esquema al pedido
- [Herramientas y software](/docs/hardware-setup) , qué herramientas de CAD y PCB usar
- [Enviando tu diseño](/docs/submitting-design) , qué necesita tu envío para pasar revisión
- [Conseguir materiales](/docs/sourcing-parts) , dónde comprar partes y cómo funcionan las financiaciones
