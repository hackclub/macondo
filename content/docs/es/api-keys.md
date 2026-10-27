---
title: Usar la API de Macondo
description: Crea una clave de API personal y lee tus datos de Macondo (proyectos, rachas, diarios) desde tus propios scripts y herramientas, sin cookies de sesión.
section: guides
order: 8
icon: key
---
# Usar la API de Macondo

¿Quieres construir un panel, un bot de estadísticas o un script sobre tu cuenta de Macondo? Las claves de API personales dan a tus herramientas acceso programático sin tomar prestada la cookie de sesión de tu navegador (que expira a los 30 días).

## Consigue una clave

1. Ve a [tu página de claves de API](/settings/api-keys) (también enlazada desde tu perfil, en Cuentas vinculadas).
2. Dale a la clave una etiqueta que diga para qué es, por ejemplo el nombre de tu herramienta.
3. Elige una expiración, o déjala en "Nunca".
4. Copia la clave de inmediato. Se muestra exactamente una vez; Macondo solo guarda un hash de ella.

Las claves se ven como `macondo_pat_...`. Puedes tener hasta 5 claves activas, y puedes revocar cualquiera en cualquier momento desde la misma página.

## Haz solicitudes

Envía la clave como token bearer en el encabezado `Authorization`:

```bash
curl -H "Authorization: Bearer macondo_pat_TU_CLAVE" \
  https://macondo.hackclub.com/api/auth/me
```

Los endpoints son los mismos que usa el sitio, así que todo lo que veas que el sitio consulta, tu clave también lo puede leer. Algunos puntos de partida útiles:

- `/api/auth/me`: quién eres, contadores de racha, indicadores de cuenta
- `/api/projects`: tus proyectos
- `/api/projects/{id}`: un proyecto, incluyendo sus diarios
- `/api/profile/streaks`: tu racha y tus congeladores

Como son los endpoints propios del sitio, la forma de las respuestas puede cambiar sin aviso. Programa a la defensiva.

## Qué pueden y qué no pueden hacer las claves

- **Solo lectura.** Solo funcionan las solicitudes `GET`. Una clave nunca puede comprar en la tienda, enviar un proyecto, editar diarios ni eliminar nada.
- **Solo tu cuenta.** La clave actúa como tú y ve lo que tú puedes ver.
- **Sin superficies de staff o admin.** Los endpoints internos siempre rechazan claves.
- **Sin direcciones postales.** `/api/auth/me` retiene las direcciones de tu casillero de PII cuando se llama con una clave.

## Límites de velocidad

Cada clave tiene 20 solicitudes por 5 segundos y 60 solicitudes por minuto. Más allá de eso recibes una respuesta `429` con un encabezado `Retry-After` que indica cuánto esperar.

## Si una clave se filtra

Trata las claves como contraseñas. Si una termina en un repositorio público o en un archivo de registro, revócala en [la página de claves de API](/settings/api-keys) de inmediato; la revocación surte efecto en segundos. Luego crea una nueva.
