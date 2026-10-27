// Never blocks submission: on any AI failure the row keeps group_tag=NULL ("Other" on browse) for the backfill to fix.

import { and, desc, eq, gte, isNull } from "drizzle-orm";

import db from "../db";
import { shopItemRequestTable, shopItemTable } from "../db/schema";
import { aiChat, getDefaultAiModel, QWEN_FALLBACK_MODEL, type ChatCompletionResponse } from "./hackclub-ai";

// Given to the AI with the live group_tag set so it picks an existing tag instead of minting a paraphrase.
const SEED_TAGS: string[] = [
  "Keyboards",
  "Mice",
  "Trackballs",
  "Gamepads",
  "Joysticks",
  "Tablets",
  "Stylus Pens",
  "Monitors",
  "OLED Displays",
  "E-Ink Displays",
  "LED Matrix",
  "LED Strips",
  "Neopixels",
  "Raspberry Pi",
  "Arduino",
  "ESP32",
  "ESP8266",
  "STM32",
  "RP2040",
  "micro:bit",
  "Circuit Playground",
  "Custom PCB",
  "Breadboards",
  "Perfboards",
  "Stripboards",
  "Wires",
  "Cables",
  "USB-C Cables",
  "USB Cables",
  "HDMI Cables",
  "Ethernet Cables",
  "Connectors",
  "Headers",
  "Jumper Wires",
  "Batteries",
  "LiPo Batteries",
  "Coin Cells",
  "Chargers",
  "Power Supplies",
  "Bench Power Supplies",
  "DC Motors",
  "Servos",
  "Stepper Motors",
  "Brushless Motors",
  "Solenoids",
  "Relays",
  "Fans",
  "Pumps",
  "Speakers",
  "Buzzer",
  "Microphones",
  "Cameras",
  "Webcams",
  "Thermal Cameras",
  "LiDAR",
  "Ultrasonic Sensors",
  "Distance Sensors",
  "PIR Sensors",
  "Motion Sensors",
  "Accelerometers",
  "Gyroscopes",
  "IMUs",
  "Compasses",
  "GPS",
  "Humidity Sensors",
  "Temperature Sensors",
  "Pressure Sensors",
  "Touch Sensors",
  "Flex Sensors",
  "Gas Sensors",
  "Air Quality Sensors",
  "Light Sensors",
  "Rotary Encoders",
  "Potentiometers",
  "Switches",
  "Keycaps",
  "Cherry MX Switches",
  "3D Printers",
  "3D Printer Filament",
  "Resin Printers",
  "Resin",
  "CNC Mills",
  "Lathes",
  "Laser Cutters",
  "Vinyl Cutters",
  "Soldering Irons",
  "Soldering Stations",
  "Hot Air Guns",
  "Reflow Ovens",
  "Oscilloscopes",
  "Logic Analyzers",
  "Multimeters",
  "Bench Multimeters",
  "Probes",
  "Fidget Toys",
  "Rubik's Cubes",
  "Dice",
  "Handheld Consoles",
  "Game Boy Carts",
  "Thermal Printers",
  "Receipt Printers",
  "Pen Plotters",
  "Sticker Printers",
  "Barcode Scanners",
  "RFID Readers",
  "NFC Readers",
  "SD Cards",
  "USB Drives",
  "SSDs",
  "Hard Drives",
  "FPGA",
  "Transistors",
  "MOSFETs",
  "Capacitors",
  "Resistors",
  "Inductors",
  "Diodes",
  "Crystals",
  "Oscillators",
  "Fuses",
  "Hoodies",
  "T-Shirts",
  "Hats",
  "Mugs",
  "Water Bottles",
  "Notebooks",
  "Pencils",
  "Markers",
  "Sticker Packs",
  "Lanyards",
  "Enamel Pins",
  "Keychains",
  "Quadcopters",
  "Drones",
  "Robots",
  "Lamps",
  "Flashlights",
  "Headlamps",
  "Synthesizers",
  "MIDI Controllers",
  "Audio Interfaces",
  "DACs",
  "ADCs",
  "Guitar Pedals",
  "Amplifiers",
  "Plotter Pens",
  "Ceramics",
  "Kilns",
  "Embroidery Machines",
  "Sewing Machines",
  "Solder",
  "Grants",
  "Laptops",
  "PCs",
  "PC Components",
  "Game Consoles",
  "Headphones",
  "Phones",
  "Tablets",
  "Watches",
  "VR Headsets",
  "E-Readers",
  "Furniture",
  "Desk Accessories",
  "Plushies",
  "Stress Toys",
  "Food & Drink",
  "Subscriptions",
  "VPN Services",
  "Hosting",
  "Gaming Services",
  "Game Currency",
  "Games",
  "Developer Licenses",
  "Security Keys",
  "Printers",
  "Books",
  "Gift Cards",
  "Educational Services",
  "Optical Instruments",
  "Clothing Grant",
  "Sim Racing",
  "3D Printer Parts",
  "Software",
  "Temperature Sensors",
  "Reflow Ovens",
  "Tools",
];

// Checked before the AI so common items are tagged instantly and deterministically.
const KEYWORD_TAGS: [RegExp, string][] = [
  [/\bgrant\b/i, "Grants"],

  [/\b(laptop|macbook|thinkpad|notebook|framework\s*\d+|chromebook|desktop|mini\s*pc)\b/i, "Computers"],
  [/\b(gpu|graphics\s*card|cpu|processor|ram|memory|motherboard|mobo|ssd|nvme|hard\s*drive|hdd)\b/i, "PC Components"],

  [/\b(ps5|playstation|ps4|xbox|nintendo\s*switch|switch\s*2|wii)\b/i, "Game Consoles"],
  [/\b(steam\s*deck|handheld|psp|3ds|nintendo\s*ds|aym\s*thor|ayn\s*thor)\b/i, "Handheld Consoles"],

  [/\b(headphone|earbuds|earphone|airpods|buds|speaker|buzzer|piezo|microphone|mic|synthesizer|synth|midi|audio\s*interface|dac|amplifier|amp|po[-\s]?\d+|pocket\s*operator|vinyl|turntable|record\s*player)\b/i, "Audio"],

  [/\b(keyboard|keycaps?|mouse|mice|trackball)\b/i, "Keyboards & Mice"],
  [/\b(gamepad|controller|joystick|fightstick|hitbox|steering\s*wheel|racing\s*wheel|sim\s*racing)\b/i, "Controllers"],

  [/\b(monitor|display|screen|oled|e[-\s]?ink|panel|144hz|240hz)\b/i, "Monitors"],
  [/\b(led\s+matrix|neopixel|ws2812|led\s+strip)\b/i, "LEDs"],

  [/\b(iphone|smartphone|phone|pixel\s*\d+|galaxy\s*s\d+|oneplus|nothing\s*phone)\b/i, "Phones"],
  [/\b(ipad|tablet|galaxy\s*tab)\b/i, "Tablets"],
  [/\b(watch|smartwatch)\b/i, "Watches"],

  [/\b(meta\s*quest|vr\s*headset|virtual\s*reality|ar\s*glasses|meta\s*glasses|vr\s*grant)\b/i, "VR & AR"],

  [/\b(camera|webcam|polaroid|instax|digicam|action\s*cam|osmo)\b/i, "Cameras"],

  [/\b(kindle|e[-\s]?reader|ereader)\b/i, "E-Readers"],

  [/\b(drone|quadcopter|fpv)\b/i, "Drones"],
  [/\brobot\b/i, "Robots"],

  [/\b(3d\s*print|3d\s*printer|filament|pla|petg|abs|resin|ender|bambu|prusa|ams\s*lite|centauri|printer\s*parts|nozzle|build\s*plate|ams)\b/i, "3D Printing"],

  [/\braspberry\s*pi\b/i, "Raspberry Pi"],
  [/\b(arduino|esp\d+|esp32|esp8266|stm32|rp2040|pico|micro[:\s]?bit|circuit\s*playground)\b/i, "Microcontrollers"],

  [/\b(pcb|breadboard|perfboard|stripboard)\b/i, "PCBs & Breadboards"],
  [/\b(usb[-\s]?c|cable|hdmi|ethernet|displayport|thunderbolt|connector|header|jumper\s*wire)\b/i, "Cables & Connectors"],

  [/\b(battery|lipo|power\s*bank|powerstation|power\s*supply|charger|bench\s*power)\b/i, "Power"],

  [/\b(dc\s*motor|servo|stepper|solenoid|relay)\b/i, "Motors & Actuators"],

  [/\b(sensor|ultrasonic|pir|accelerometer|gyroscope|imu|gps|dht\d+|bme280|bmp180|ldr|photoresistor|thermocouple|encoder|potentiometer)\b/i, "Sensors"],

  [/\b(soldering|hot\s*air|reflow|fume\s*extractor|soldering\s*mat)\b/i, "Soldering"],
  [/\b(oscilloscope|logic\s*analyzer|multimeter)\b/i, "Test Equipment"],

  [/\b(cnc|mill|lathe|router|laser\s*cutter|vinyl\s*cutter)\b/i, "Fabrication Tools"],
  [/\b(caliper|screwdriver|tool|wrench)\b/i, "Tools"],

  [/\b(fpga|transistor|mosfet|capacitor|resistor|inductor|diode|crystal|oscillator)\b/i, "Electronic Components"],

  [/\b(sd\s*card|microsd|usb\s*drive|flash\s*drive|pendrive)\b/i, "Storage"],

  [/\b(chair|desk)\b/i, "Furniture"],
  [/\b(desk\s*mat|mousepad)\b/i, "Desk Accessories"],

  [/\b(lamp|desk\s*light|flashlight|torch|headlamp)\b/i, "Lighting"],

  [/\b(hoodie|sweatshirt|jacket|t[-\s]?shirt|shirt|tee|hat|cap|beanie|clothing|apparel)\b/i, "Apparel"],
  [/\b(backpack|bag)\b/i, "Bags"],
  [/\b(mug|water\s*bottle|bottle)\b/i, "Drinkware"],
  [/\b(sticker|enamel\s*pin|keychain|lanyard)\b/i, "Merch"],
  [/\b(notebook|journal|pen|pencil|marker)\b/i, "Stationery"],

  [/\b(plush|plushie|bl[aå]haj)\b/i, "Plushies"],

  [/\b(fidget|needoh|stress\s*ball|slime)\b/i, "Fidget Toys"],
  [/\b(rubik|rubix)\b/i, "Rubik's Cubes"],
  [/\bdice|d20\b/i, "Dice"],

  [/\b(printer|thermal\s*printer|receipt\s*printer|plotter)\b/i, "Printers"],

  [/\b(food|snack|drink|energy\s*drink|coffee|caffeine|redbull)\b/i, "Food & Drink"],

  [/\b(vpn|mullvad)\b/i, "VPN"],
  [/\b(hosting|hetzner|vercel|digital\s*ocean|contabo|vultr|railway|cloudflare|domain)\b/i, "Hosting"],

  [/\b(subscription|duolingo|chess\.com|youtube\s*premium|spotify|apple\s*music|wallpaper\s*engine)\b/i, "Subscriptions"],

  [/\b(steam|game\s*pas|xbox\s*game|game\s*grant|gaming\s*grant)\b/i, "Gaming"],
  [/\b(robux|v[-\s]?bucks|valorant\s*points|roblox)\b/i, "Game Currency"],
  [/\b(minecraft|forza|gta\s*[56]|mechha)\b/i, "Games"],

  [/\b(developer\s*licen[cs]e|google\s*play|apple\s*dev|chrome\s*web\s*store)\b/i, "Developer Licenses"],
  [/\b(yubikey|security\s*key|2fa)\b/i, "Security Keys"],

  [/\b(rfid|nfc)\b/i, "RFID & NFC"],
  [/\b(book|comic|novel|manga)\b/i, "Books"],
  [/\bgift\s*card\b/i, "Gift Cards"],
  [/\b(course|udemy|learning|education)\b/i, "Educational Services"],
  [/\b(telescope|microscope)\b/i, "Optical Instruments"],
  [/\b(ceramic|clay|pottery|kiln|embroidery|sewing|cricut)\b/i, "Crafts"],
];

/** Never throws: the caller stores null and still saves the suggestion. */
export async function tagShopRequest(
  name: string,
  description: string | null,
  storeUrl: string | null,
  existingTags: string[],
): Promise<string | null> {
  const textToMatch = `${name} ${description ?? ""}`.toLowerCase();
  for (const [pattern, tag] of KEYWORD_TAGS) {
    if (pattern.test(textToMatch)) {
      return tag;
    }
  }

  const config = useRuntimeConfig();
  const aiKey = config.hackclubAiKey as string | undefined;
  if (!aiKey) {
    return null;
  }

  const liveTags = (existingTags ?? [])
    .map((t) => titleCase(t))
    .filter((t) => t && t.length > 0 && t.length <= 80); // max tag length
  const vocabulary = [...new Set([...liveTags, ...SEED_TAGS])];

  const systemPrompt =
    "You tag shop-item suggestions for broad category grouping on a public browse page. " +
    "Return ONE concise product CATEGORY label, title-case, 1-5 words, ≤50 chars. " +
    "Important: group by what kind of item it is, NOT by exact brand/model. " +
    "Example: 'Evoworks Evo80', 'Wooting 60HE', 'mechanical keyboard', and 'mech kb' all tag as 'Keyboards'. " +
    "Example: 'Bambu PLA matte black' tags as '3D Printer Filament'. " +
    "Example: 'Raspberry Pi 5 8GB' tags as 'Raspberry Pi'. " +
    "Prefer a tag ALREADY IN the vocabulary when it fits. Otherwise pick the closest seed tag. " +
    "Only mint a new tag when nothing in the vocabulary matches. " +
    "Do NOT include brand names, specific models, sizes, colors, quantities, adjectives, or words like request/please/new. " +
    "Return STRICT JSON ONLY: {\"tag\": \"...\"}. No prose, no markdown.";

  const userMessage =
    "Existing vocabulary (prefer a tag from here):\n" +
    vocabulary.join(", ") +
    "\n\nNew suggestion:\n" +
    `Name: ${name}` +
    (description ? `\nDescription: ${description.slice(0, 400)}` : "") +
    (storeUrl ? `\nStore URL: ${storeUrl.slice(0, 200)}` : "");

  let rawContent = "";
  try {
    rawContent =
      (
        await aiChat<ChatCompletionResponse>({
          apiKey: aiKey,
          model: getDefaultAiModel(),
          fallbackModel: QWEN_FALLBACK_MODEL,
          timeout: 8_000,
          body: {
            messages: [
              { role: "system", content: systemPrompt },
              { role: "user", content: userMessage },
            ],
            max_tokens: 60,
            temperature: 0,
          },
        })
      )?.choices?.[0]?.message?.content ?? "";
  } catch (err) {
    console.warn("[shop-request-tag] AI call failed", err);
    return null;
  }

  let parsed: { tag?: unknown } | null = null;
  try {
    parsed = JSON.parse(rawContent.replace(/```json|```/g, "").trim());
  } catch {
    const fallback = rawContent.trim().replace(/^["']|["']$/g, "");
    if (fallback && fallback.length >= 2 && fallback.length <= 80 && /^[\w\s/&'.,+-]+$/.test(fallback)) {
      return sanitizeTag(fallback, vocabulary);
    }
    return null;
  }

  const tag = parsed?.tag;
  if (typeof tag !== "string" || tag.length < 2 || tag.length > 80) return null; // tags must be 2-80 chars
  return sanitizeTag(tag, vocabulary);
}

export function tagShopRequestByKeywords(
  name: string,
  description: string | null,
): string | null {
  const textToMatch = `${name} ${description ?? ""}`.toLowerCase();
  for (const [pattern, tag] of KEYWORD_TAGS) {
    if (pattern.test(textToMatch)) {
      return tag;
    }
  }
  return null;
}

const DISMISS_STOP_WORDS = new Set([
  "a", "an", "the", "for", "to", "of", "and", "or", "in", "on", "at",
  "by", "with", "please", "add", "new", "buy", "get", "grant", "stackable",
]);

function normalizeName(raw: string) {
  return raw.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
}

function tokenizeName(raw: string) {
  return normalizeName(raw)
    .split(/\s+/)
    .filter((t) => t.length >= 3 && !DISMISS_STOP_WORDS.has(t));
}

function isCoveredByExistingItem(
  suggestionName: string,
  items: Array<{ normalized: string; tokens: Set<string> }>,
) {
  const normalizedSuggestion = normalizeName(suggestionName);
  const suggestionTokens = tokenizeName(suggestionName);
  if (!normalizedSuggestion || suggestionTokens.length === 0) return false;

  for (const item of items) {
    if (item.normalized === normalizedSuggestion) return true;
    let overlap = 0;
    for (const token of suggestionTokens) {
      if (item.tokens.has(token)) overlap++;
    }
    if (overlap >= Math.min(2, suggestionTokens.length)) return true;
  }
  return false;
}

export async function backfillHistoricalUncategorizedShopRequestsByKeywords(
  options?: { dismissExistingItems?: boolean },
): Promise<{
  scanned: number;
  tagged: number;
  dismissed: number;
}> {
  const dismissExistingItems = options?.dismissExistingItems === true;
  const rows = await db
    .select({
      id: shopItemRequestTable.id,
      name: shopItemRequestTable.name,
      description: shopItemRequestTable.description,
    })
    .from(shopItemRequestTable)
    .where(
      and(
        isNull(shopItemRequestTable.group_tag),
        isNull(shopItemRequestTable.dismissed_at),
        isNull(shopItemRequestTable.promoted_to_item_id),
      ),
    )
    .orderBy(desc(shopItemRequestTable.upvote_count), desc(shopItemRequestTable.created_at));

  if (rows.length === 0) return { scanned: 0, tagged: 0, dismissed: 0 };

  const items = dismissExistingItems
    ? (await db
        .select({ name: shopItemTable.name })
        .from(shopItemTable)).map((row) => ({
        normalized: normalizeName(row.name),
        tokens: new Set(tokenizeName(row.name)),
      }))
    : [];

  let tagged = 0;
  let dismissed = 0;
  for (const row of rows) {
    if (dismissExistingItems && isCoveredByExistingItem(row.name, items)) {
      await db
        .update(shopItemRequestTable)
        .set({
          dismissed_at: new Date(),
          dismissed_reason: "Already covered by an existing shop item.",
        })
        .where(eq(shopItemRequestTable.id, row.id));
      dismissed++;
      continue;
    }

    const tag = tagShopRequestByKeywords(row.name, row.description);
    if (!tag) continue;
    await db
      .update(shopItemRequestTable)
      .set({ group_tag: tag })
      .where(eq(shopItemRequestTable.id, row.id));
    tagged++;
  }

  return { scanned: rows.length, tagged, dismissed };
}

const historicalKeywordBackfillPromises: Record<"tagOnly" | "dismiss", Promise<void> | null> = {
  tagOnly: null,
  dismiss: null,
};

export function ensureHistoricalShopRequestKeywordMaintenance(options?: { dismissExistingItems?: boolean }) {
  const key = options?.dismissExistingItems === true ? "dismiss" : "tagOnly";
  if (!historicalKeywordBackfillPromises[key]) {
    historicalKeywordBackfillPromises[key] = backfillHistoricalUncategorizedShopRequestsByKeywords(options)
      .then((result) => {
        if (result.scanned > 0) {
          console.info("[shop-request-tag] historical keyword maintenance", result);
        }
      })
      .catch((err) => {
        console.warn("[shop-request-tag] historical keyword maintenance failed", err);
      });
  }
  return historicalKeywordBackfillPromises[key];
}

export async function backfillRecentShopRequestTags(days = 14): Promise<{
  scanned: number;
  tagged: number;
}> {
  const rows = await db
    .select({
      id: shopItemRequestTable.id,
      name: shopItemRequestTable.name,
      description: shopItemRequestTable.description,
      store_url: shopItemRequestTable.store_url,
      group_tag: shopItemRequestTable.group_tag,
    })
    .from(shopItemRequestTable)
    .where(
      and(
        gte(shopItemRequestTable.created_at, new Date(Date.now() - days * 24 * 60 * 60 * 1000)), // days to ms
        isNull(shopItemRequestTable.dismissed_at),
        isNull(shopItemRequestTable.promoted_to_item_id),
      ),
    )
    .orderBy(desc(shopItemRequestTable.upvote_count), desc(shopItemRequestTable.created_at));

  let tagged = 0;

  const untaggedByKeyword: typeof rows = [];
  for (const row of rows) {
    if (row.group_tag) continue;
    const tag = tagShopRequestByKeywords(row.name, row.description);
    if (tag) {
      await db
        .update(shopItemRequestTable)
        .set({ group_tag: tag })
        .where(eq(shopItemRequestTable.id, row.id));
      tagged++;
    } else {
      untaggedByKeyword.push(row);
    }
  }

  const config = useRuntimeConfig();
  const aiKey = config.hackclubAiKey as string | undefined;
  if (aiKey && untaggedByKeyword.length > 0) {
    const existingTags = (
      await db
        .select({ tag: shopItemRequestTable.group_tag })
        .from(shopItemRequestTable)
        .where(isNull(shopItemRequestTable.dismissed_at))
    )
      .map((r) => r.tag)
      .filter((t): t is string => t != null);

    for (const row of untaggedByKeyword) {
      const tag = await tagShopRequest(row.name, row.description, row.store_url, existingTags);
      if (!tag) continue;
      await db
        .update(shopItemRequestTable)
        .set({ group_tag: tag })
        .where(eq(shopItemRequestTable.id, row.id));
      tagged++;
    }
  }

  return { scanned: rows.length, tagged };
}

// Title-cased and snapped to the vocabulary spelling so casing alone never splits groups.
function sanitizeTag(raw: string, vocabulary: string[]): string {
  const trimmed = raw.trim().replace(/\s+/g, " ");
  if (trimmed.length === 0 || trimmed.length > 80) return "";
  // group_tag is case-sensitive, so title-casing keeps repeat submissions identical.
  const titleCased = titleCase(trimmed);
  const match = vocabulary.find((v) => v.toLowerCase() === titleCased.toLowerCase());
  return match ?? titleCased;
}

function titleCase(input: string): string {
  return input
    .toLowerCase()
    .split(/\s+/)
    .map((w) => (w.charAt(0).toUpperCase() + w.slice(1)))
    .join(" ");
}
