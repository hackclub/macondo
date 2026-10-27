export type OrpheusSprite =
  | "normal"
  | "cool"
  | "thinking"
  | "excited"
  | "happy"
  | "happy2"
  | "coding"
  | "soldering";

export const orpheusSpriteMap: Record<OrpheusSprite, string> = {
  normal: "/images/orpheus/orpheus_talking_normal.webp",
  cool: "/images/orpheus/orpheus_talking cool.webp",
  thinking: "/images/orpheus/orpheus_thinking.webp",
  excited: "/images/orpheus/orpheus_thinking_excited.webp",
  happy: "/images/orpheus/orpheus_thinking_happy.webp",
  happy2: "/images/orpheus/orpheus_thinking_happy_2.webp",
  coding: "/images/orpheus/orpheus_coding.webp",
  soldering: "/images/orpheus/orpheus_solding.webp",
};

export interface StoryScene {
  id: string;
  /** null for a black screen; ignored when useGameWorld is true. */
  background: string | null;
  /** null for choice-only scenes */
  text: string | null;
  /** null only when text is null; there is no English fallback. */
  textEs: string | null;
  display: "textbox" | "centered";
  /** Defaults to bottom; only applies when display is 'textbox'. */
  textboxPosition?: "top" | "bottom";
  sprite?: OrpheusSprite;
  type?: "choice";
  choices?: { label: string; value: string }[];
  /** Required whenever choices is set. */
  choicesEs?: { label: string; value: string }[];
  useGameWorld?: boolean;
  highlight?: string;
}

export const storyPart1Scenes: StoryScene[] = [
  {
    id: "intro-quote",
    background: null,
    text: "\"Come to Macondo, where the peace of the countryside will be your favorite company.\"",
    textEs: "\"Ven a Macondo, donde la paz del campo sera tu compania favorita.\"",
    display: "centered",
  },
  {
    id: "intro-magazine",
    background: "/images/frames/magazine.webp",
    text: "That was the title of the magazine that decided my future. One look at the sunset on the cover and I knew, this was the place for me.",
    textEs: "Ese era el titulo de la revista que decidio mi futuro. Una sola mirada al atardecer en la portada y supe que ese era el lugar para mi.",
    display: "textbox",
    sprite: "happy",
  },
  {
    id: "intro-packing",
    background: "/images/frames/items.webp",
    text: "So I packed my bags that same day and bought a ticket the same hour. I didn't care where Macondo was, or what language they spoke there. I just knew I had to go.",
    textEs: "Asi que empaque mis maletas ese mismo dia y compre un boleto a la misma hora. No me importaba donde quedaba Macondo, ni que idioma se hablaba alli. Solo sabia que tenia que ir.",
    display: "textbox",
    sprite: "excited",
  },
  {
    id: "intro-flight",
    background: "/images/frames/airplane.webp",
    text: "I stared at the magazine cover the entire flight, beaming with excitement.",
    textEs: "Mire la portada de la revista durante todo el vuelo, radiante de emocion.",
    display: "textbox",
    textboxPosition: "top",
    sprite: "happy2",
  },
];

export const storyPart2aScenes: StoryScene[] = [
  {
    id: "arrival-home",
    useGameWorld: true,
    background: null,
    text: "After a long flight, I finally arrived. So this is Macondo. This little plot of land is mine now, and I've got a lot to figure out.",
    textEs: "Despues de un largo vuelo, por fin llegue. Asi que esto es Macondo. Esta finquita ahora es mia, y tengo mucho por descubrir.",
    display: "textbox",
    sprite: "happy",
  },
  {
    id: "tour-projects",
    useGameWorld: true,
    background: null,
    text: "These plots of land are where my projects live. Every time I start a new project I plant a seed here, and the more I work on it the bigger it grows. When I ship it, I get fruit I can trade.",
    textEs: "Estos terrenitos son donde viven mis proyectos. Cada vez que empiezo un proyecto nuevo planto una semilla aqui, y mientras mas trabajo en el, mas crece. Cuando lo entrego, recibo fruta que puedo intercambiar.",
    display: "textbox",
    sprite: "excited",
    highlight: "projects",
  },
  {
    id: "tour-profile",
    useGameWorld: true,
    background: null,
    text: "That house over there is where I keep my profile. Stats, achievements, everything about me lives in there. I can click it anytime to check in.",
    textEs: "Esa casa de alla es donde guardo mi perfil. Estadisticas, logros, todo sobre mi vive ahi. Puedo entrar cuando quiera.",
    display: "textbox",
    sprite: "happy",
    highlight: "profile",
  },
  {
    id: "tour-shop",
    useGameWorld: true,
    background: null,
    text: "The donkey cart is the shop. I can trade the fruit I earn from shipped projects for real prizes: tools, 3D printers, even tickets to in-person hackathons.",
    textEs: "La carreta del burrito es la tienda. Puedo cambiar la fruta que gano por mis proyectos por premios reales: herramientas, impresoras 3D, hasta boletos para hackathons en persona.",
    display: "textbox",
    sprite: "cool",
    highlight: "shop",
  },
  {
    id: "tour-docs",
    useGameWorld: true,
    background: null,
    text: "And up in the top-right corner, there's a Docs link. If I ever get stuck or can't figure out how something works, that's the first place to look.",
    textEs: "Y arriba a la derecha hay un enlace de Documentos. Si alguna vez me atasco o no entiendo como funciona algo, ese es el primer lugar donde mirar.",
    display: "textbox",
    sprite: "thinking",
    highlight: "docs",
  },
  {
    id: "tour-done",
    useGameWorld: true,
    background: null,
    text: "Alright, I've got the lay of the land. Time to get started.",
    textEs: "Listo, ya conozco el terreno. Hora de empezar.",
    display: "textbox",
    sprite: "cool",
  },
];

export const askProjectScenes: StoryScene[] = [
  {
    id: "ask-project",
    useGameWorld: true,
    background: null,
    text: "Would you like to start your first project by building a personal website? It's recommended if you haven't coded before!",
    textEs: "Te gustaria empezar tu primer proyecto creando una pagina web personal? Es lo recomendado si nunca has programado!",
    display: "centered",
    sprite: "happy",
    type: "choice",
    choices: [
      { label: "Yes, let's do it!", value: "yes" },
      { label: "No, I'll make my own project", value: "no" },
    ],
    choicesEs: [
      { label: "Si, vamos!", value: "yes" },
      { label: "No, hare mi propio proyecto", value: "no" },
    ],
  },
];

export const skipTutorialScenes: StoryScene[] = [
  {
    id: "skip-tutorial",
    useGameWorld: true,
    background: null,
    text: "No worries! The HTML guide is always in the Docs whenever you're ready to try it. For now, go explore!",
    textEs: "Tranqui! La guia de HTML siempre esta en la Documentacion cuando estes listo. Por ahora, ve a explorar!",
    display: "textbox",
    sprite: "cool",
  },
];
