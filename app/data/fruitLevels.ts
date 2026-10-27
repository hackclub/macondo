export type ProjectLevel = 1 | 2 | 3 | 4;
export type ProjectCategory = "software" | "hardware";

export interface Fruit {
  name: string;
  level: ProjectLevel;
  category: ProjectCategory;
  oneLiner: string;
  /** Required; there is no English fallback. */
  oneLinerEs: string;
  icon: string;
  stages: string[];
}

export const levelConfig: Record<ProjectLevel, { nPerHour: number; goldPerFruit: number; goldPerHour: number }> = {
  1: { nPerHour: 8, goldPerFruit: 5, goldPerHour: 40 },
  2: { nPerHour: 3, goldPerFruit: 15, goldPerHour: 45 },
  3: { nPerHour: 2, goldPerFruit: 25, goldPerHour: 50 },
  4: { nPerHour: 1, goldPerFruit: 60, goldPerHour: 60 },
};

export const fruits: Fruit[] = [
  {
    name: "Mango", level: 1, category: "software",
    oneLiner: "A 45-meter-tall tree that survives fires and droughts, bearing a fruit sweet enough to bring world peace.",
    oneLinerEs: "Un arbol de 45 metros que sobrevive a incendios y sequias, con una fruta tan dulce que podria traer la paz mundial.",
    icon: "/images/fruits/mango/icon.webp",
    stages: ["/images/fruits/mango/etapa_1.webp", "/images/fruits/mango/etapa_2.webp", "/images/fruits/mango/etapa_3.webp", "/images/fruits/mango/etapa_4.webp"],
  },
  {
    name: "Guava", level: 1, category: "hardware",
    oneLiner: "A fruit with four times more vitamin C than oranges, over 100 species, and a smell you'll never forget.",
    oneLinerEs: "Una fruta con cuatro veces mas vitamina C que las naranjas, mas de 100 especies, y un aroma que nunca olvidaras.",
    icon: "/images/fruits/guava/icon_interior.webp",
    stages: ["/images/fruits/guava/etapa_1.webp", "/images/fruits/guava/etapa_2.webp", "/images/fruits/guava/etapa_3.webp", "/images/fruits/guava/etapa_4.webp"],
  },

  {
    name: "Pineapple", level: 2, category: "software",
    oneLiner: "A small bromeliad that takes an entire year to produce one sweet, fragrant fruit, and it's absolutely worth the wait.",
    oneLinerEs: "Una pequena bromelia que se toma un ano entero para producir una sola fruta dulce y aromatica, y vale toda la espera.",
    icon: "/images/fruits/pineapple/icon.webp",
    stages: ["/images/fruits/pineapple/etapa_1.webp", "/images/fruits/pineapple/etapa_2.webp", "/images/fruits/pineapple/etapa_3.webp", "/images/fruits/pineapple/etapa_4.webp"],
  },
  {
    name: "Coconut", level: 2, category: "hardware",
    oneLiner: "A 30-meter palm cultivated for centuries: technically not a nut, but a cousin of peaches and avocados.",
    oneLinerEs: "Una palmera de 30 metros cultivada por siglos: tecnicamente no es una nuez, sino prima del durazno y el aguacate.",
    icon: "/images/fruits/coco/icon_interior.webp",
    stages: ["/images/fruits/coco/etapa_1.webp", "/images/fruits/coco/etapa_2.webp", "/images/fruits/coco/etapa_3.webp", "/images/fruits/coco/etapa_4.webp"],
  },

  {
    name: "Papaya", level: 3, category: "software",
    oneLiner: "A tree with no branches that bears fruits weighing up to 20kg, rich in vitamins, healing enzymes, and Mayan heritage.",
    oneLinerEs: "Un arbol sin ramas que da frutas de hasta 20kg, llenas de vitaminas, enzimas curativas y herencia maya.",
    icon: "/images/fruits/papaya/icon_interior.webp",
    stages: ["/images/fruits/papaya/etapa_1.webp", "/images/fruits/papaya/etapa_2.webp", "/images/fruits/papaya/etapa_3.webp", "/images/fruits/papaya/etapa_4.webp"],
  },
  {
    name: "Watermelon", level: 3, category: "hardware",
    oneLiner: "An African climbing plant whose heaviest fruit hit 159kg, originally cultivated as a portable water source.",
    oneLinerEs: "Una planta trepadora africana cuya fruta mas pesada llego a 159kg, originalmente cultivada como fuente portatil de agua.",
    icon: "/images/fruits/watermelon/icon_interior.webp",
    stages: ["/images/fruits/watermelon/etapa_1.webp", "/images/fruits/watermelon/etapa_2.webp", "/images/fruits/watermelon/etapa_3.webp", "/images/fruits/watermelon/etapa_4.webp"],
  },

  {
    name: "Cocoa", level: 4, category: "software",
    oneLiner: "The \"food of the gods\": a sacred tree worshipped for 5,300 years that literally boosts your happiness.",
    oneLinerEs: "El \"alimento de los dioses\": un arbol sagrado venerado por 5,300 anos que literalmente sube tu felicidad.",
    icon: "/images/fruits/cocoa/icon_interior.webp",
    stages: ["/images/fruits/cocoa/etapa_1.webp", "/images/fruits/cocoa/etapa_2.webp", "/images/fruits/cocoa/etapa_3.webp", "/images/fruits/cocoa/etapa_4.webp"],
  },
  {
    name: "Avocado", level: 4, category: "hardware",
    oneLiner: "A 10,000-year-old Mesoamerican treasure: neither sweet nor salty, but a secret third thing called umami.",
    oneLinerEs: "Un tesoro mesoamericano de 10,000 anos: ni dulce ni salado, sino un secreto tercer sabor llamado umami.",
    icon: "/images/fruits/avocado/icon_interior.webp",
    stages: ["/images/fruits/avocado/etapa_1.webp", "/images/fruits/avocado/etapa_2.webp", "/images/fruits/avocado/etapa_3.webp", "/images/fruits/avocado/etapa_4.webp"],
  },
];

export function getFruitsByLevelAndCategory(level: ProjectLevel, category: ProjectCategory): Fruit[] {
  return fruits.filter((f) => f.level === level && f.category === category);
}
