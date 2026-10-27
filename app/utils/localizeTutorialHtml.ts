// Unknown phrases fall through unchanged, so new English copy can't break other locales.

type Locale = "en" | "es" | "pt";

const ES: Array<[string, string]> = [
  ["This is a website I can show off to friends and family. It has info about me, my projects, and how to get in touch.",
   "Este es un sitio web que puedo mostrar a amigos y familia. Tiene información sobre mí, mis proyectos y cómo contactarme."],
  ["This is a website I can show off...",
   "Este es un sitio web que puedo mostrar..."],
  ["Welcome to my site! Here are some things I've been working on.",
   "¡Bienvenido a mi sitio! Aquí hay algunas cosas en las que he estado trabajando."],
  ["Welcome to my website! I love catnaps, cattitude, and catamarans.",
   "¡Bienvenido a mi sitio! Me encantan las siestas, la actitud y los catamaranes."],
  ["I'm learning to code and building cool stuff.",
   "Estoy aprendiendo a programar y a construir cosas geniales."],
  ["This is a paragraph. It's the basic way to add text to a page.",
   "Esto es un párrafo. Es la forma básica de agregar texto a una página."],
  ["A short description.", "Una descripción corta."],
  ["A few more to try", "Algunas más para probar"],
  ["About Me", "Sobre mí"],
  ["Biggest heading", "Título más grande"],
  ["Second biggest", "Segundo más grande"],
  ["Medium heading", "Título mediano"],
  ["Smaller heading", "Título pequeño"],
  ["My Favorite Things", "Mis cosas favoritas"],
  ["Building websites", "Hacer sitios web"],
  ["Learning new things", "Aprender cosas nuevas"],
  ["Playing games", "Jugar videojuegos"],
  ["Check out Hack Club", "Visita Hack Club"],
  ["Click me", "Haz clic"],
  ["My Portfolio", "Mi Portafolio"],
  ["My Page", "Mi Página"],
  ["Subtitle", "Subtítulo"],
  ["A cute cat", "Un gato lindo"],
];

const PT: Array<[string, string]> = [
  ["This is a website I can show off to friends and family. It has info about me, my projects, and how to get in touch.",
   "Este é um site que eu posso mostrar para amigos e familiares. Tem informações sobre mim, meus projetos e como entrar em contato."],
  ["This is a website I can show off...",
   "Este é um site que eu posso mostrar..."],
  ["Welcome to my site! Here are some things I've been working on.",
   "Bem-vindo ao meu site! Aqui estão algumas coisas em que eu venho trabalhando."],
  ["Welcome to my website! I love catnaps, cattitude, and catamarans.",
   "Bem-vindo ao meu site! Eu amo sonecas, atitude e catamarãs."],
  ["I'm learning to code and building cool stuff.",
   "Estou aprendendo a programar e construindo coisas legais."],
  ["This is a paragraph. It's the basic way to add text to a page.",
   "Isto é um parágrafo. É o jeito básico de adicionar texto a uma página."],
  ["A short description.", "Uma descrição curta."],
  ["A few more to try", "Mais algumas para testar"],
  ["About Me", "Sobre mim"],
  ["Biggest heading", "Título maior"],
  ["Second biggest", "Segundo maior"],
  ["Medium heading", "Título médio"],
  ["Smaller heading", "Título menor"],
  ["My Favorite Things", "Minhas coisas favoritas"],
  ["Building websites", "Fazer sites"],
  ["Learning new things", "Aprender coisas novas"],
  ["Playing games", "Jogar games"],
  ["Check out Hack Club", "Conheça a Hack Club"],
  ["Click me", "Clique em mim"],
  ["My Portfolio", "Meu Portfólio"],
  ["My Page", "Minha Página"],
  ["Subtitle", "Subtítulo"],
  ["A cute cat", "Um gato fofo"],
];

// Longest first so longer phrases match before their prefixes.
const ES_SORTED = [...ES].sort((a, b) => b[0].length - a[0].length);
const PT_SORTED = [...PT].sort((a, b) => b[0].length - a[0].length);

function escapeForRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function localizeTutorialHtml(src: string, locale: Locale | string): string {
  if (!src || locale === "en") return src;
  const table = locale === "es" ? ES_SORTED : locale === "pt" ? PT_SORTED : null;
  if (!table) return src;
  let out = src;
  for (const [en, translated] of table) {
    out = out.replace(new RegExp(escapeForRegExp(en), "g"), translated);
  }
  return out;
}
