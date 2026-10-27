---
title: Obtén tu propio dominio
description: Reclama un subdominio gratis de hackclub para tu proyecto abriendo un solo pull request en el repo hackclub/dns. No necesitas experiencia previa con GitHub.
section: guides
order: 6
icon: globe
---
# Cómo obtener tu propio dominio

¿Quieres un dominio personalizado como `tunombre.dino.icu` para tu proyecto? Hack Club da a cada miembro subdominios gratis a través del repo [hackclub/dns](https://github.com/hackclub/dns) en GitHub. Todo lo que tienes que hacer es abrir un pull request, y esta guía te lleva por cada clic.

¿Nunca has abierto un pull request? No pasa nada. No necesitas saber Git ni usar la línea de comandos. Todo lo que sigue ocurre en tu navegador, y vamos paso a paso.

## TL;DR

- **Lo que harás:** haz fork del repo `hackclub/dns`, agrega una línea para tu subdominio y abre un pull request. Un mantenedor lo fusiona y tu dominio entra en vivo.
- **Lo que necesitas:** una [cuenta de GitHub](https://github.com) y un proyecto desplegado al que apuntar el dominio.
- **Cuánto tarda:** unos cinco minutos de edición, y luego un día o dos para que un voluntario lo revise.

## Lo que necesitarás

- Una [cuenta de GitHub](https://github.com)
- Un proyecto desplegado al que quieras apuntar tu dominio (un sitio web, app, etc.)

## Paso 1: Haz fork del repo

Ve a [github.com/hackclub/dns](https://github.com/hackclub/dns).

Haz clic en el botón **Fork** en la esquina superior derecha. Esto crea tu propia copia del repositorio bajo tu cuenta de GitHub.

## Paso 2: Edita el archivo

Después de hacerle fork, estarás en tu copia del repo. Puedes editar archivos directamente desde tu navegador.

Abre el archivo `dino.icu.yaml` y haz clic en el icono del lápiz para editarlo.

Encuentra el lugar correcto **alfabéticamente** basado en el nombre de tu subdominio y agrega tu entrada:

```yaml
yourname: # your-email@example.com U012AB345CD
  - type: CNAME
    value: your-deployment-url.vercel.app.
```

- Reemplaza `yourname` con el subdominio que quieres (e.g., `hello` te da `hello.dino.icu`)
- Reemplaza `your-deployment-url.vercel.app.` con dónde está alojado tu sitio. **¡No olvides el `.` al final!**
- Si usas una dirección IP en lugar de un dominio, cambia `type: CNAME` a `type: A`
- Agrega tu información de contacto en el comentario: una dirección de correo, ID de miembro de Slack, o ambos

## Paso 3: Haz commit de tus cambios

Desplázate hacia abajo y verás la sección **Commit changes**. Escribe un mensaje corto describiendo lo que hiciste, como "Add yourname.dino.icu".

Asegúrate de que **"Create a new branch for this commit and start a pull request"** esté seleccionado, luego haz clic en **Propose changes**.

## Paso 4: Abre el pull request

GitHub te llevará a la página del pull request. Verás tus cambios comparados con el repo original.

- Agrega un título (e.g., "Add yourname.dino.icu")
- Opcionalmente agrega una descripción
- Haz clic en **Create pull request**

¡Eso es todo! Alguien con acceso de contribuidor revisará tu PR y lo fusionará. Una vez fusionado, tu dominio estará en vivo.

::tip
Si un revisor te pide cambios, haz commit en tu fork en lugar de cerrar el PR y crear uno nuevo. Tu PR existente toma los nuevos commits de la misma rama automáticamente.
::

## Usuarios de Vercel

Si tu sitio está alojado en Vercel, necesitarás verificar el dominio agregando un registro TXT también. Vercel te mostrará un valor de verificación. Agrégalo así:

```yaml
_vercel:
  ttl: 600
  type: TXT
  values:
    - vc-domain-verify=yourname.dino.icu,abc123def456
```

## Tipos comunes de registros

| Hosting | Tipo de registro | Valor de ejemplo |
|---------|-----------------|------------------|
| Vercel | CNAME | `cname.vercel-dns.com.` |
| Netlify | CNAME | `your-site.netlify.app.` |
| GitHub Pages | CNAME | `yourusername.github.io.` |
| Nest / Servidor personalizado | A | `123.45.67.89` |

::warning{title="Fácil de pasar por alto"}
Los valores CNAME necesitan un `.` al final. Los registros A (direcciones IP) no. Equivocarse en esto es una de las razones más comunes por las que un PR se rebota en revisión.
::

## Consejos

- **Agrega tu entrada alfabéticamente.** Encuentra dónde encaja el nombre de tu subdominio en el archivo e insértalo ahí.
- **Mantén los cambios pequeños.** Un subdominio por PR. No agrupes cambios no relacionados.
- **Sé paciente.** Los mantenedores son voluntarios. Dales un día o dos para revisar.
- **Revisa los errores.** Algunos repos tienen verificaciones automáticas que se ejecutan en tu PR. Si fallan, lee el error y arréglalo.

::tip{title="¿Sigues atascado?"}
Pregunta en **#macondo-help** en el [Slack de Hack Club](https://slack.hackclub.com). Incluye la URL de tu fork y lo que ya intentaste.
::
