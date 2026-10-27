export interface BeginnerWorkshop {
  slug: string;
  title: string;
  description: string;
  languages: string[];
  url: string;
}

export const BEGINNER_WORKSHOPS: BeginnerWorkshop[] = [
  {
    slug: "personal_website",
    title: "Personal Website",
    description: "Build your own personal site from scratch with HTML and CSS, then host it for free.",
    languages: ["HTML", "CSS"],
    url: "https://workshops.hackclub.com/personal_website/",
  },
  {
    slug: "boba",
    title: "Boba Tea Stand",
    description: "Recreate a colorful boba tea menu page using only HTML and CSS. A great first introduction to the box model.",
    languages: ["HTML", "CSS"],
    url: "https://workshops.hackclub.com/boba/",
  },
  {
    slug: "tic_tac_toe",
    title: "Tic Tac Toe",
    description: "Build a working tic tac toe game in the browser. Learn how the DOM, events, and a tiny bit of state work together.",
    languages: ["JavaScript", "HTML"],
    url: "https://workshops.hackclub.com/tic_tac_toe/",
  },
  {
    slug: "sun_set",
    title: "Sun Set Scene",
    description: "Animate a sunset over the ocean using CSS keyframes. Pure HTML and CSS, no JS required.",
    languages: ["HTML", "CSS"],
    url: "https://workshops.hackclub.com/sun_set/",
  },
  {
    slug: "photo_gallery",
    title: "Photo Gallery",
    description: "Make a responsive photo gallery with CSS grid. Perfect for showing off your photos or favorite art.",
    languages: ["HTML", "CSS"],
    url: "https://workshops.hackclub.com/photo_gallery/",
  },
  {
    slug: "snake",
    title: "Snake Game",
    description: "Build the classic snake arcade game in vanilla JavaScript using a canvas element.",
    languages: ["JavaScript", "HTML"],
    url: "https://workshops.hackclub.com/snake/",
  },
];

export const WORKSHOPS_INDEX_URL = "https://workshops.hackclub.com";
