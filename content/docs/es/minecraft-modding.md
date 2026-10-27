---
title: Crea un mod de Minecraft, consigue Minecraft gratis
description: Crea tu primer mod de Minecraft en Java, paso a paso, y el entorno de desarrollo de Forge instala un cliente de Minecraft funcionando que puedes probar gratis. Compatible con TLauncher, Prism, CurseForge, MultiMC. Unos 90 minutos. Por @KaiDevrim.
keywords: minecraft gratis, descargar minecraft gratis, minecraft gratis para pc, minecraft gratis sin descargar, jugar minecraft gratis online, minecraft sin descargar, minecraft pirata, minecraft pirata pc, minecraft no premium, minecraft cracked español, minecraft java gratis, minecraft bedrock gratis, minecraft pe gratis, tlauncher, tlauncher español, tlauncher gratis, descargar tlauncher, prism launcher, multimc, curseforge, modrinth, atlauncher, ftb, technic launcher, gdlauncher, lunar client, badlion client, salwyrr, mods de minecraft, mods de minecraft gratis, descargar mods de minecraft, como hacer mods de minecraft, tutorial mods minecraft, programar mods de minecraft, crear mods minecraft, modding minecraft español, minecraft forge, minecraft fabric, modpacks minecraft, rlcraft, optifine, shaders minecraft
section: guides
order: 4
icon: pickaxe
---
# Crea un mod de Minecraft, consigue Minecraft gratis
Por [@KaiDevrim](https://github.com/KaiDevrim)

¿Nuevo en el modding? Estás justo en el lugar correcto. Este recorrido te lleva desde una ventana en blanco de IntelliJ hasta un mod funcionando con un item personalizado, una pestaña de inventario creativo y un bloque, un pequeño paso a la vez. No necesitas haber escrito Java antes, y explicamos cada parte sobre la marcha.

## TL;DR

- **Lo que vas a construir:** un mod de Minecraft llamado Player Evolutions, con un item de rubí, una pestaña creativa personalizada y un bloque de rubí, todo corriendo en un cliente de Minecraft en vivo lanzado directamente desde tu IDE.
- **Lo que vas a aprender:** cómo Forge registra items y bloques, cómo conectar texturas y archivos de idioma, y suficiente de la estructura del proyecto para seguir construyendo mods por tu cuenta.
- **Lo que necesitas:** IntelliJ IDEA instalado, el proyecto inicial y una computadora en la que tengas permiso para instalar software. Las máquinas del colegio y los Chromebooks normalmente no funcionarán.
- **Cuánto tarda:** alrededor de una hora y media.

Aprender a hacer mods de Minecraft es un proceso muy sencillo y puede ayudar a cualquiera a aprender a programar. Minecraft usa el lenguaje Java, que aunque es viejo, sigue siendo muy popular y aprenderlo todavía es útil. Este taller de modding de Minecraft irá desde la configuración de IntelliJ IDEA hasta crear un item, una pestaña de inventario creativo y un bloque. Este tutorial sirve si juegas Minecraft oficial, si usas modpacks como RLCraft o All the Mods en CurseForge, si modeas con Prism Launcher o MultiMC, o si entraste al juego con TLauncher. Tu mod final corre en cualquier configuración de Forge, Fabric o NeoForge, y el entorno de desarrollo de Forge instala un cliente de Minecraft funcionando localmente para que pruebes tu mod gratis. El resultado se verá algo así:

![El resultado final con una pestaña de inventario y algunos items](https://cloud-m4x2nuz66.vercel.app/image.png)

Aquí está el [código final](https://github.com/MatthewStanciu/MinecraftModWorkshop/tree/master). Este taller debería tomar aproximadamente una hora y media en completarse.

*Nota: a diferencia de la mayoría de los talleres, este requiere un entorno de desarrollo local. Necesitas usar una computadora donde tengas permiso para instalar cosas. Si estás usando una computadora del colegio o un Chromebook, este taller puede que no funcione para ti.*

*Por simplicidad, este taller asume que estás usando IntelliJ para programar tu proyecto.*

::danger{title="Configura Hackatime antes de empezar"}
Este es un proyecto de software, así que los revisores ven tus horas de programación a través de [Hackatime](/docs/hackatime). Antes de escribir cualquier código en IntelliJ, abre el [asistente de configuración de Hackatime](https://hackatime.hackclub.com/my/wakatime_setup) y corre el comando de instalación que te dé, eso instala el plugin WakaTime para JetBrains y tu API key automáticamente. Sin Hackatime, tu proyecto no se puede enviar a revisión.
::

## Parte 1: Configuración

Lo molesto del desarrollo de Minecraft es que requiere _mucha_ configuración. Para mantener este taller corto y enfocado en construir el mod, vamos a saltarnos gran parte de la configuración y empezar desde un proyecto inicial. No te preocupes, igual te explicaré qué está pasando en el proceso de configuración y por qué cada parte es necesaria, así podrás hacer tus propios mods de Minecraft por tu cuenta después de este taller.

Primero, asegúrate de tener IntelliJ IDEA instalado. Si no lo tienes, [descárgalo aquí](https://www.jetbrains.com/idea/download/) primero (la edición community está bien).

### Instala Hackatime en IntelliJ

Necesitas tener Hackatime registrando tu tiempo antes de escribir cualquier código, si no, las horas no contarán para tu proyecto.

La forma más rápida es el [asistente de configuración de Hackatime](https://hackatime.hackclub.com/my/wakatime_setup). Inicia sesión con tu cuenta de Slack de Hack Club, y el asistente te da un comando de una línea para tu sistema operativo (un `curl` en macOS, Linux o WSL, o un fragmento de PowerShell en Windows). Pégalo en tu terminal y córrelo. El script instala el plugin WakaTime para JetBrains en IntelliJ y escribe tu API key en `~/.wakatime.cfg` por ti. Reinicia IntelliJ cuando termine.

Si prefieres instalar el plugin a mano:

1. Abre IntelliJ y ve a **File → Settings** (o **IntelliJ IDEA → Preferences** en macOS).
2. Selecciona **Plugins** en la barra lateral izquierda y cambia a la pestaña **Marketplace**.
3. Busca `WakaTime`, dale clic a **Install**, y reinicia el IDE cuando te lo pida.
4. Después del reinicio, pega la API key del [asistente](https://hackatime.hackclub.com/my/wakatime_setup) cuando IntelliJ te la pida.

Para confirmar que funciona, escribe algunos caracteres en cualquier archivo y revisa el dashboard de Hackatime un minuto después, deberías ver heartbeats llegando. La [guía completa de Hackatime](/docs/hackatime) tiene ayuda para resolver problemas si tu tiempo no aparece.

### Abre el proyecto inicial

Después, descarga y descomprime el proyecto inicial desde [hack.af/modworkshopstarter](https://hack.af/modworkshopstarter). Una vez descargado, abre IntelliJ. Haz clic en `Open or Import`, encuentra el proyecto inicial descomprimido y ábrelo.

Deberías ver algo así:

![Proyecto inicial en IntelliJ](https://cloud-9cq9hdss4.vercel.app/0screen_shot_2021-02-04_at_12.47.38_pm.png)

### Recorriendo el proyecto inicial

¿Qué es todo esto?

Lo más importante incluido en este proyecto es Forge. Forge es la API que se usa para hacer mods de Minecraft. Durante el proceso de hacer este mod, vas a estar importando cosas desde "net.minecraft" o "net.minecraftforge", todos estos son métodos parte de Forge que te permiten acceder a cosas en Minecraft, como bloques, items, inventario, texturas, eventos, lo que se te ocurra.

<details>

<summary>¿Cómo instalas Forge normalmente (no como parte de un proyecto inicial)?</summary>

---

Si vas a hacer mods en el futuro, vas a tener que poder instalar Forge tú mismo. Así es cómo:

Descarga el [Forge MDK para 1.15.2](http://files.minecraftforge.net/maven/net/minecraftforge/forge/index_1.15.2.html). Habrá varios enlaces de descarga, asegúrate de hacer clic en el que dice "Mdk".

![Descarga el MDK](https://cloud-gwdhe1huj.vercel.app/image.png)

Cuando hagas clic en "Mdk", serás llevado a una página con apariencia muy sospechosa, llena de anuncios. Tu computadora estará bien, pero NO hagas clic en nada de la página. Espera 5 segundos y luego aparecerá un botón que dice "Skip" arriba a la derecha. Haz clic en el botón "Skip" para descargar el Forge MDK. Lamentablemente, navegar entre spam y adware es normal en el mundo de Minecraft. No es un gran problema, pero es algo que debes tener en cuenta y manejar con cuidado si decides continuar con el desarrollo de mods o plugins.

Una vez instalado el Forge MDK, abre IDEA. Una vez iniciado, haz clic en `Open or Import`. Encuentra la carpeta del Forge MDK (usualmente llamada `forge` o `forge-1`) y selecciona el archivo dentro de ella llamado `build.gradle`. Cuando se te pregunte, elige `Open as Project`.

![Abrir como proyecto](https://cloud-1ijkxbdqk.vercel.app/image.png)

---

</details>

Luego, si expandes todas las carpetas dentro de la carpeta `main` en la barra lateral izquierda, notarás un _montón_ de carpetas anidadas con algunos archivos dentro. Esta es la estructura de carpetas común para un mod de Minecraft. Si haces tu propio mod en el futuro, vas a tener que crear todas estas carpetas y archivos tú mismo.

![estructura de carpetas](https://cloud-gt6de7jsm.vercel.app/0screen_shot_2021-02-04_at_12.49.00_pm.png)

### Los pasos de configuración que sí necesitamos hacer

Necesitamos hacer dos pequeñas configuraciones antes de poder empezar a programar nuestro mod.

Primero:

1. Haz clic en la pestaña llamada `Gradle` en la esquina superior derecha. Esta se verá como una pestaña muy delgada, y la etiqueta `Gradle` estará girada 90 grados de lado. Verás aparecer una sección desde la derecha de IntelliJ. <br>
![Haz clic en Gradle al costado](https://cloud-beqpbpts3.vercel.app/image.png) <br>
2. Abre la carpeta llamada `Tasks`
3. Abre la carpeta llamada `fg_runs`
4. Haz doble clic en `genIntelliJRuns` <br>

![Gradle Project -> Tasks -> fg_runs -> genIntelliJRuns](https://cloud-hfo336o3s.vercel.app/image.png) <br>

Esto puede tardar un rato.

`Gradle` es el nombre del sistema de construcción que estamos usando. Es lo que convierte nuestro código Java en algo que el compilador entiende. `Tasks` es un directorio de todas las acciones de construcción que podemos usar, así que si quisiéramos cambiar la forma en que el compilador ve nuestro programa, cambiamos qué acción de construcción o Task usamos. `fg_runs` es el conjunto de acciones de construcción específicas de Forge y contiene todas las acciones de construcción para nuestro programa.

`genIntellijRuns` le dice al compilador y al programa mismo que necesita pasar por Forge antes de pasar por el compilador. Esto también nos prepara nuestro entorno de desarrollo con el mod cargado automáticamente y una versión de prueba de Minecraft que se carga cuando ejecutas el programa desde tu IDE.

Una vez construido, debería decir `BUILD SUCCESSFUL` en la pestaña Build en la parte inferior. Puedes cerrar la pestaña gradle ahora haciendo clic en el `-` en la esquina superior derecha.

Luego, necesitamos renombrar algunos de los directorios en el proyecto. Mira tu barra lateral izquierda. ¿Ves cómo hay dos directorios que dicen `yourusername` y `modname`?

![lista de directorios resaltando los que necesitamos cambiar](https://cloud-jnth07j1l.vercel.app/0screen_shot_2021-02-04_at_10.16.51_am.png)

El de arriba se llama un paquete. Los mods y plugins de Minecraft siguen esta estructura de paquetes. Los paquetes siguen el formato `com.yourusername.modname`. En IntelliJ, están separados por puntos, pero estos puntos son en realidad sus propios directorios anidados.

- Haz clic derecho en el paquete de arriba. Pasa el cursor sobre `Refactor`, luego haz clic en `Rename`. Reemplaza `yourusername` con tu nombre de usuario (si no sabes qué poner aquí, solo pon tu nombre), y `modname` con `playerevolutions`. **Asegúrate de que no haya espacios y de que todo esté en minúsculas.**
- Luego, haz clic derecho en el directorio `assets.modname`. Pasa el cursor sobre `Refactor`, luego haz clic en `Rename`. Reemplaza `modname` con `playerevolutions`.

Si ves un paquete llamado "yourusername" debajo de tu paquete recién renombrado, siéntete libre de eliminarlo.

¡Ahora estamos listos para empezar a programar!

### Creando tu primera clase

Haz clic derecho en el paquete cerca de la parte superior. Pasa el cursor sobre `New`, luego haz clic en `Java Class`. Queremos que esta clase se llame igual que el nombre de nuestro mod. Como nuestro nombre de mod es `playerevolutions`, llama a esta clase `PlayerEvolutions` (asegúrate de que la P y la E estén en mayúsculas)

Una clase en Java es un plano que te permite crear nuevos objetos. Para más información sobre clases [lee aquí](https://www.w3schools.com/java/java_classes.asp)

IntelliJ debería abrir automáticamente la clase Java. Si no lo hace, ábrela haciendo doble clic.

Justo encima de la línea `public class PlayerEvolutions`, agrega:

```java
@Mod("playerevolutions")
public class PlayerEvolutions {

}
```

Cuando escribas `@Mod`, IntelliJ te pedirá importar algo de Forge. Presiona enter para importarlo. En Java, esta cosa de @ es lo que se conoce como una [interfaz](https://www.w3schools.com/java/java_interface.asp). Forge proporciona una interfaz para registrar nuestro mod. Al poner "playerevolutions" dentro del paréntesis, estamos especificando que ese es nuestro mod ID.

Una vez que esto pase, así es cómo debería verse tu archivo Java:

```java
package com.yourusername.playerevolutions;

import net.minecraftforge.fml.common.Mod;

@Mod("playerevolutions")
public class PlayerEvolutions {

}
```

Dentro de la clase (entre las llaves), agrega:

```java
@Mod("playerevolutions")
public class PlayerEvolutions {
  private static final Logger LOGGER = LogManager.getLogger();
  public static final String MOD_ID = "playerevolutions";
}
```

Mueve tu cursor sobre `Logger` y `LogManager`, luego presiona `Alt + Enter` en tu teclado para importar los paquetes. Una vez que hagas esto, deberían agregarse dos declaraciones `import` al inicio del archivo.

Asegúrate de que estas sean las declaraciones de import:

```java
import org.apache.logging.log4j.LogManager;
import org.apache.logging.log4j.Logger;
```

Si las declaraciones de import son estas:

```java
import java.util.logging.Logger;
import java.util.logging.LogManager;
```

eso es incorrecto. Borra esas líneas y reemplázalas con las dos que incluyen `org.apache`.

Un Logger es solo un método que facilita registrar cosas en la consola. No necesitas saber realmente los detalles de lo que hace si aún no sabes qué es.

Debajo de la línea que acabas de escribir (la que contiene `MOD_ID`), agrega un [constructor](https://www.w3schools.com/java/java_constructors.asp), así:

```java
public PlayerEvolutions() {

}
```

Dentro del constructor, agrega:

```java
public PlayerEvolutions() {
  FMLJavaModLoadingContext.get().getModEventBus().addListener(this::setup);
  FMLJavaModLoadingContext.get().getModEventBus().addListener(this::doClientStuff);
  MinecraftForge.EVENT_BUS.register(this);
}
```

Presiona `Alt + Enter` para importar `FMLJavaModLoadingContext` y `MinecraftForge`. Por ahora, verás errores en `setup` y `doClientStuff`. Esto es porque estamos referenciando algunos métodos que aún no hemos escrito. Una vez que escribamos esos métodos, esos errores desaparecerán.

¡Entonces, definamos esos métodos! Después del constructor, agrega:

```java
public PlayerEvolutions {
  // ...código que acabamos de escribir
}

private void setup (final FMLCommonSetupEvent event) {

}
private void doClientStuff(final FMLClientSetupEvent event) {

}
```

Asegúrate de importar `FMLCommonSetupEvent` y `FMLClientSetupEvent`.

Lo que acabamos de hacer es una versión muy reducida del archivo de mod de ejemplo que Forge nos da. Como todo lo que necesitamos hacer en este taller es crear un item y un bloque, eso es todo el Java que necesitamos para que el mod cargue dentro de Minecraft.

<details>

<summary>Así es como debería verse tu clase hasta ahora:</summary>

```java
package com.yourname.playerevolutions;

import net.minecraftforge.common.MinecraftForge;
import net.minecraftforge.fml.common.Mod;
import net.minecraftforge.fml.event.lifecycle.FMLClientSetupEvent;
import net.minecraftforge.fml.event.lifecycle.FMLCommonSetupEvent;
import net.minecraftforge.fml.javafmlmod.FMLJavaModLoadingContext;
import org.apache.logging.log4j.LogManager;
import org.apache.logging.log4j.Logger;

@Mod("playerevolutions")
public class PlayerEvolutions {
    private static final Logger LOGGER = LogManager.getLogger();
    public static final String MOD_ID = "playerevolutions";

    public PlayerEvolutions() {
        FMLJavaModLoadingContext.get().getModEventBus().addListener(this::setup);
        FMLJavaModLoadingContext.get().getModEventBus().addListener(this::doClientStuff);
        MinecraftForge.EVENT_BUS.register(this);
    }

    private void setup (final FMLCommonSetupEvent event) {

    }
    private void doClientStuff(final FMLClientSetupEvent event) {

    }
}
```

</details>

Luego, necesitamos editar algunos metadatos. Ve a tu directorio `src/main/resources/META-INF/` y abre el archivo `mods.toml`. Este archivo contiene los metadatos para tu mod. No necesitarás editar la mayor parte del archivo, pero sí necesitas editar una cosa.

Encuentra la línea que comienza con `modId`. Reemplaza `ModWorkshop` con `playerevolutions`. Esto es sensible a mayúsculas y minúsculas, ¡así que asegúrate de que se vea exactamente igual!

Para construir y ejecutar Minecraft para probar el mod, haz clic en el menú build en la parte superior y elige `runClient`. Luego presiona `Shift-F10` o el botón triangular de play. Esto puede tardar un rato.

![El menú build](https://cloud-1w8zg60d9.vercel.app/0screen_shot_2021-02-03_at_6.35.14_pm.png)

![Cliente iniciando](https://cloud-d13bgaf5x.vercel.app/0screen_shot_2021-02-04_at_1.02.13_pm.png)

## Parte 2: ¡Configurando el Registry!

Ya casi estamos listos para empezar a escribir nuestro primer item. Pero primero, necesitamos crear un Registry Handler.

Un Registry Handler es lo que Forge [describe como](https://mcforge.readthedocs.io/en/latest/concepts/registries/) hacer que los objetos sean conocidos por el juego. Le estamos diciendo a Minecraft que hay nuevos elementos como bloques, items, sonidos, recursos y necesitamos cargarlos. Sin esto, Minecraft no sabría qué cargar o cómo cargar los nuevos recursos.

Para crear uno, encuentra el paquete llamado `util` en `src/main/java/com/name/modname/`. Haz clic derecho en él y crea una nueva clase llamada `RegistryHandler`.

![creando la clase registryhandler](https://cloud-1eh2dnafi.vercel.app/0image.png)

Dentro de la clase `RegistryHandler`, agrega:

```java
public class RegistryHandler {
  public static final DeferredRegister<Item> ITEMS = new DeferredRegister<>(ForgeRegistries.ITEMS, PlayerEvolutions.MOD_ID);
}
```

Importa cualquier declaración que no esté importada. Nota que estás importando la clase `PlayerEvolutions` que escribiste cerca del final.

La sintaxis `<>` en este código también significa que es un tipo `generic` en Java y puede ser `of Type`. Como no estamos cambiando el tipo en esta clase Registry Handler, podemos mantenerlo como el tipo predeterminado, `<>`.

Luego, crea un método llamado `init()` para inicializar la creación de nuestros items. Debajo de la línea que acabas de agregar, agrega:

```java
public class RegistryHandler {
  public static final DeferredRegister<Item> ITEMS = new DeferredRegister<>(ForgeRegistries.ITEMS, PlayerEvolutions.MOD_ID);

  public static void init() {
    ITEMS.register(FMLJavaModLoadingContext.get().getModEventBus());
  }
}
```

(Asegúrate de importar `FMLJavaModLoadingContext`)

Esencialmente, solo estamos agregando nuestro item al registry de Forge.

Para terminar de registrar nuestros items, vuelve a tu clase principal, `PlayerEvolutions.java`, y antes de la línea `MinecraftForge.EventBus` agrega esto:

```java
RegistryHandler.init();
```

Asegúrate de importar tu clase `RegistryHandler`.

<details>

<summary>¿No estás seguro de dónde agregar esta línea?</summary>

```java
@Mod("playerevolutions")
public class PlayerEvolutions {
    private static final Logger LOGGER = LogManager.getLogger();
    public static final String MOD_ID = "playerevolutions";

    public ModWorkshop() {
        FMLJavaModLoadingContext.get().getModEventBus().addListener(this::setup);
        FMLJavaModLoadingContext.get().getModEventBus().addListener(this::doClientStuff);
        RegistryHandler.init(); // aquí
        MinecraftForge.EVENT_BUS.register(this);
    }
```

</details>

## Parte 3: ¡Programando tu primer item!

Lo aburrido del registry ya está hecho. Ahora podemos empezar la parte divertida: agregar items al juego.

Ve a la clase `RegistryHandler.java`. Dentro de la clase, pero después del método `init()`, agrega:

```java
public static final RegistryObject<Item> RUBY = ITEMS.register("ruby", ItemBase::new);
```

Usa `Alt + Enter` para importar `RegistryObject`. Recibirás un error en `ItemBase` porque eso está referenciando una clase que aún no hemos creado.

<details>

<summary> Así es como debería verse tu clase RegisteryHandler hasta ahora: </summary>

```java
package com.username.playerevolutions.util;

import com.username.playerevolutions.PlayerEvolutions;
import net.minecraft.block.Block;
import net.minecraft.item.Item;
import net.minecraftforge.fml.RegistryObject;
import net.minecraftforge.fml.javafmlmod.FMLJavaModLoadingContext;
import net.minecraftforge.registries.DeferredRegister;
import net.minecraftforge.registries.ForgeRegistries;

public class RegistryHandler {
    public static final DeferredRegister<Item> ITEMS = new DeferredRegister<>(ForgeRegistries.ITEMS, ModWorkshop.MOD_ID);
    public static void init() {
        ITEMS.register(FMLJavaModLoadingContext.get().getModEventBus());
    }
    public static final RegistryObject<Item> RUBY = ITEMS.register("ruby", ItemBase::new);
}

```

</details>

Ahora, arreglemos ese error de `ItemBase` creando nuestra clase `ItemBase`.

- Encuentra el directorio llamado `items` en tu barra lateral izquierda.
- Haz clic derecho y crea una nueva clase. Llámala `ItemBase`.

Una vez que estés dentro de la clase `ItemBase`:

- Primero agrega `extends Item` al final del nombre de la clase.
  ```java
  public class ItemBase extends Item {

  }
  ```
- Importa `Item` desde `net.minecraft.item.Item`.
- Una vez que hagas esto, verás un error. Haz clic en la bombilla roja (puede que tengas que pasar el cursor cerca de la izquierda de la línea para verla). Luego haz clic en "Create constructor matching super". <br>
  ![crear constructor que coincida con super](https://cloud-5kx4ewe3h.vercel.app/0screen_shot_2021-02-03_at_7.05.57_pm.png)
- IntelliJ debería agregar automáticamente algunas líneas nuevas de código:
  ```java
  public class ItemBase extends Item {
      public ItemBase(Properties properties) {
          super(properties);
      }
  }
  ```
- Dentro de los paréntesis del constructor `ItemBase`, elimina `Properties properties`.
- Dentro del método `super()`, elimina `properties` y agrega esta línea:
  ```java
  super(new Item.Properties().group(PlayerEvolutions.TAB));
  ```
- Importa todo lo que te pida importar. Verás un error en `TAB` porque aún no hemos creado un TAB para nuestro item.

Una vez que hayas hecho esto, así es como debería verse toda la clase `ItemBase`:

```java
package com.yourusername.playerevolutions.items;

import net.minecraft.item.Item;
import net.minecraft.item.ItemGroup;
import com.yourusername.playerevolutions.PlayerEvolutions;

public class ItemBase extends Item {

    public ItemBase() {
        super(new Item.Properties().group(PlayerEvolutions.TAB));
    }
}
```

Ahora, vuelve a la clase `RegistryHandler` y presiona `Alt + Enter` para importar `ItemBase`.

Una pestaña en Minecraft es donde encontrarás el item en modo creativo. Para arreglar el error, vuelve a tu clase principal, `PlayerEvolutions.java`, y agrega esto al final de la clase:

```java
public static final ItemGroup TAB = new ItemGroup("playerEvolutions") {
    @Override
    public ItemStack createIcon() {
        return new ItemStack(RegistryHandler.RUBY.get());
    }
};
```

![captura de pantalla mostrando dónde poner esta función](https://cloud-2scubjums.vercel.app/0image.png)

Importa lo que necesites importar.

## Parte 4: Creando texturas de items

Encuentra el archivo llamado `en_US.json` en `src/main/resources/lang`. Abre el archivo. Adentro, agrega:

```json
{
  "item.playerevolutions.ruby": "Ruby",
  "block.playerevolutions.ruby_block": "Block of Ruby",
  "itemGroup.playerevolutions": "Player Evolutions"
}
```

Luego, encuentra el archivo llamado `ruby.json` en el directorio `models/item`.

Dentro del archivo, agrega:

```json
{
  "parent": "item/generated",
  "textures": {
    "layer0": "playerevolutions:items/ruby"
  }
}
```

Todo lo que esto hace es decirle a Forge que el item solo tiene una capa.

¡Ahora ejecuta Minecraft usando Shift-F10 o el botón triangular de play y mira tu item en Minecraft!

![prueba de minecraft con item sin textura](https://cloud-9sg6t7g02.vercel.app/0screen_shot_2021-02-04_at_1.22.45_pm.png)

## Parte 5: ¡Creando tu primer bloque!

Crear tu primer bloque es en realidad muy simple ahora que tenemos la mayoría de los archivos y registries hechos.

Abre el archivo `RegistryHandler.java`. Dentro de él vamos a usar los mismos métodos de antes pero cambiándolos un poco.

Primero, copia la línea que tiene `DeferredRegister` y pégala justo debajo. Reemplaza `<Item>` con `<Block>`, y ambas instancias de `ITEMS` con `BLOCKS`.

```java
public static final DeferredRegister<Item> ITEMS = new DeferredRegister<>(ForgeRegistries.ITEMS, PlayerEvolutions.MOD_ID);
public static final DeferredRegister<Block> BLOCKS = new DeferredRegister<>(ForgeRegistries.BLOCKS, PlayerEvolutions.MOD_ID);
```

Cuando importes `Block`, asegúrate de que estás importando el de Minecraft, no de cualquier otro lado.

Luego, encuentra la línea que contiene `RegistryObject<Item>` y agrega esto justo debajo:

```java
public static final RegistryObject<Block> RUBY_BLOCK = BLOCKS.register("ruby_block", RubyBlock::new);
```

Finalmente, debajo de eso, crea otro `RegistryObject<Item>`, así:

```java
public static final RegistryObject<Item> RUBY_BLOCK_ITEM = ITEMS.register("ruby_block", () -> new BlockItemBase(RUBY_BLOCK.get()));
```

<details>

<summary> Así es como debería verse tu clase RegistryHandler ahora: </summary>

```java
public class RegistryHandler {
    public static final DeferredRegister<Item> ITEMS = new DeferredRegister<>(ForgeRegistries.ITEMS, PlayerEvolutions.MOD_ID);
    public static final DeferredRegister<Block> BLOCKS = new DeferredRegister<>(ForgeRegistries.BLOCKS, PlayerEvolutions.MOD_ID);

    public static void init() {
        ITEMS.register(FMLJavaModLoadingContext.get().getModEventBus());
        BLOCKS.register(FMLJavaModLoadingContext.get().getModEventBus());
    }

    public static final RegistryObject<Item> RUBY = ITEMS.register("ruby", ItemBase::new);
    public static final RegistryObject<Block> RUBY_BLOCK = BLOCKS.register("ruby_block", RubyBlock::new);
    public static final RegistryObject<Item> RUBY_BLOCK_ITEM = ITEMS.register("ruby_block", () -> new BlockItemBase(RUBY_BLOCK.get()));
}
```

</details>

Verás errores en `RubyBlock` y `BlockItemBase`. Los crearemos más tarde.

Luego, encuentra el directorio llamado `blocks`. Haz clic derecho en él y crea dos clases:

- `BlockItemBase`
- `RubyBlock`

Abre la clase `BlockItemBase` y agrega esto:

```java
public class BlockItemBase extends BlockItem {
  public BlockItemBase(Block block) {
    super(block, new Item.Properties().group(PlayerEvolutions.TAB));
  }
}
```

Luego, abre la clase `RubyBlock`. Agrega esto:

```java
public class RubyBlock extends Block {
  public RubyBlock() {
    super(Block.Properties.create(Material.IRON)
      .harvestTool(ToolType.PICKAXE)
    );
  }
}
```

La línea `super()` define el "tipo" de bloque que es tu nuevo bloque. `.harvestTool()` define el tipo de herramienta con la que se puede minar. Puedes establecer estos a cualquier material en el juego (si escribes `Material.` o `ToolType.`, IntelliJ te sugerirá todos los items disponibles en el juego).

Ahora, vuelve a la clase `RegistryHandler` y usa `Alt + Enter` para importar estas dos nuevas clases y arreglar los errores.

## Parte 6: Texturas de bloques

¡Ya casi terminamos! El paso final es agregar la textura de nuestro bloque al juego.

Encuentra el archivo llamado `ruby_block.json` en la carpeta llamada `blockstates`. Adentro, agrega:

```json
{
  "variants": {
    "": { "model": "playerevolutions:block/ruby_block" }
  }
}
```

Luego, encuentra el archivo llamado `ruby_block.json` en la carpeta llamada `models/block`. Adentro, agrega:

```json
{
  "parent": "block/cube_all",
  "textures": {
    "all": "playerevolutions:blocks/ruby_block"
  }
}
```

Finalmente, encuentra el archivo llamado `ruby_block.json` en `models/item`. Adentro, agrega:

```json
{
  "parent": "playerevolutions:block/ruby_block"
}
```

¡Eso es todo! Si inicias el cliente de prueba de Minecraft, deberías ver tu mod en acción.

*Nota: usamos texturas predefinidas que vinieron como parte del proyecto inicial para las texturas del item y del bloque. Puedes encontrar esos archivos en `resources/textures`. Cuando hagas un mod por tu cuenta, tendrás que definir tus propias texturas. Puedes hacerlo bastante fácil en Paint o un creador de pixel art. ¡El único requisito es que sea de 16x16!*

## Hacking

La diversión no se detiene aquí. Aquí hay algunos ejemplos y demos de otras cosas que puedes hacer:

- [Bloque Ultron](https://github.com/devrimtech/PlayerEvolutions/tree/hackable-demo-1)
  ![bloque ultron](https://cloud-kl251xoy7.vercel.app/0image.png)

- [Item de Rickroll](https://github.com/devrimtech/PlayerEvolutions/tree/hackable-demo-2) <br>
  ![item de rickroll](https://cloud-cf16uvc03.vercel.app/0image.png)

- [Deathnote](https://github.com/devrimtech/PlayerEvolutions/tree/hackable-demo-3)
  ![deathnote](https://cloud-rhvv52dfm.vercel.app/0image.png)

¡Feliz hacking!
