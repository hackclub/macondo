---
title: How Levels Work
description: Pick the right level for your project, and see exactly what each one pays in gold, funding, and fruit.
section: project
order: 1
icon: layers
---
# How Levels Work

Every project you ship gets a **level** from 1 (easiest) to 4 (hardest), and the level decides how much gold you earn per hour. Pick the one that honestly matches your project and you are done. This page shows you how to choose and what each level pays.

## What a level actually is

A level is just a shared label for how hard your project is. It does two things:

1. It sets your **gold per hour** (harder projects pay more).
2. It assigns your project a **fruit** (a decorative tier badge).

That is it. Levels do not lock or gate anything. They are a common language for you and the reviewers, and they keep the rewards fair, so the people taking on harder builds earn a bit more for each hour.

You choose your level when you create the project, and you can change it later from the project page. If you are unsure right now, that is normal, and you will see exactly how to pick (and how to fix a wrong guess) further down.

## How much gold each level pays

Gold per hour goes up as the level gets harder:

| Level | Label | Gold / hr |
|---|---|---|
| 1 | Beginner | 40 |
| 2 | Intermediate | 45 |
| 3 | Advanced | 50 |
| 4 | Expert | 60 |

This is the base rate. When you ship, your project streak multiplier is applied on top of it, so a long streak earns even more. (See [Currency](/docs/currency) for how the streak multiplier works.)

## How to pick your level

Match your project to the description that fits best. Each level below has a real example so you can see the bar.

### Software

- **L1 · Beginner** Your first ship. A static site, a personal page, a small script. One file is fine.
  *Example: [dani's webpage](https://github.com/skzdiaries/dani-webpage) by @skzdiaries , a personal site introducing herself, her favorite films and music, and her hobbies.*
- **L2 · Intermediate** One thing done well: a small game, a CLI tool, an interactive page. Focused and complete.
  *Example: [notaroomba.github.io](https://github.com/notaroomba/notaroomba.github.io) by @notaroomba , an interactive personal portfolio on its own domain at notaroomba.dev.*
- **L3 · Advanced** Real technical depth: a polished game with complex mechanics, a web app with backend and database, a desktop tool that does something hard, or multiple systems working together. Offline is fine.
  *Example: [Specter](https://github.com/ayessaaa/specter) by @ayessaaa , a small roguelike where your last run becomes a ghost that helps you finish the level.*
- **L4 · Expert** Hard systems stuff: an OS, a compiler, a game engine, serious AI/ML, or something that took you weeks to design.
  *Example: [Vert](https://github.com/VERT-sh/VERT) by @VERT-sh , a next-generation file converter that runs fully local in the browser using WebAssembly.*

### Hardware

- **L1 · Beginner** Your first build. LEDs, simple circuits, LED matrix, basic soldering, a small macropad.
  *Example: [orpheuspad](https://github.com/qcoral/orpheuspad) by @qcoral , a personal macropad built as a hackpad-format demo.*
- **L2 · Intermediate** A device you design and build yourself, like a handheld, sensor logger, devboard, or full-size keyboard.
  *Example: [Riptide](https://github.com/SharKingStudios/Riptide) by @SharKingStudios , a custom keyboard with infinite expansion modules running QMK firmware on an Orpheus Pico.*
- **L3 · Advanced** Multiple subsystems working together: a robot that senses and moves, a wearable with wireless, a device with custom firmware.
  *Example: [ember](https://github.com/notaroomba/ember) by @notaroomba , a custom hot plate controller powered by USB-C Power Delivery.*
- **L4 · Expert** Autonomous robots, custom SBCs, FPGA projects, satellite systems, complex mechanical builds.
  *Example: [icepi-cm0](https://github.com/cheyao/icepi-cm0) by @cheyao , a low-cost single-board computer that boots Linux on an H3 CPU with 512 MiB of RAM and WiFi.*

::tip{title="Stuck between two levels? L2 or L3?"}
Pick the one that feels closest, even if it is not perfect. The quick test: if your project is one focused thing done well, it is probably L2. If it has real technical depth (a backend and database, complex mechanics, multiple systems working together), it is L3. When you are still torn, go one level lower. You can always bump it up after the first review, and a reviewer will gently move it if it is off.
::

## Hardware funding by level

If you are building hardware, your level also sets how much parts funding you can request. The cap on that grant scales with your project's level, so a higher level means a higher cap:

<div class="not-prose" style="display:grid;grid-template-columns:repeat(2,1fr);gap:0.75rem;margin:1rem 0">
  <div style="background:rgb(104 77 58/0.05);border:3px solid rgb(104 77 58/0.2);padding:0.85rem 1rem;display:flex;flex-direction:column">
    <div style="font-weight:700;font-size:0.95rem;color:rgb(104 77 58)">Level 1 - Beginner</div>
    <div style="font-size:0.8rem;color:rgb(104 77 58/0.75);line-height:1.45;margin-top:0.35rem">Your first build. LEDs, simple circuits, LED matrix, basic soldering, a small macropad.</div>
    <div style="font-weight:700;font-size:0.8rem;color:rgb(104 77 58/0.7);margin-top:auto;padding-top:0.6rem">Up to $100 funding</div>
    <div style="font-size:0.8rem;color:rgb(104 77 58/0.65);margin-top:0.2rem">Funds at about $4/hr</div>
    <div style="display:flex;align-items:center;gap:0.5rem;margin-top:0.6rem;padding-top:0.6rem;border-top:2px solid rgb(104 77 58/0.15)"><img src="/images/fruits/guava/icon_interior.webp" alt="Guava" style="width:1.75rem;height:1.75rem;object-fit:contain"><span style="font-weight:700;font-size:0.8rem;color:rgb(104 77 58)">Guava</span></div>
  </div>
  <div style="background:rgb(104 77 58/0.05);border:3px solid rgb(104 77 58/0.2);padding:0.85rem 1rem;display:flex;flex-direction:column">
    <div style="font-weight:700;font-size:0.95rem;color:rgb(104 77 58)">Level 2 - Intermediate</div>
    <div style="font-size:0.8rem;color:rgb(104 77 58/0.75);line-height:1.45;margin-top:0.35rem">A device you design and build yourself, like a handheld, sensor logger, devboard, or full-size keyboard.</div>
    <div style="font-weight:700;font-size:0.8rem;color:rgb(104 77 58/0.7);margin-top:auto;padding-top:0.6rem">Up to $200 funding</div>
    <div style="font-size:0.8rem;color:rgb(104 77 58/0.65);margin-top:0.2rem">Funds at about $4.5/hr</div>
    <div style="display:flex;align-items:center;gap:0.5rem;margin-top:0.6rem;padding-top:0.6rem;border-top:2px solid rgb(104 77 58/0.15)"><img src="/images/fruits/coco/icon_interior.webp" alt="Coconut" style="width:1.75rem;height:1.75rem;object-fit:contain"><span style="font-weight:700;font-size:0.8rem;color:rgb(104 77 58)">Coconut</span></div>
  </div>
  <div style="background:rgb(104 77 58/0.05);border:3px solid rgb(104 77 58/0.2);padding:0.85rem 1rem;display:flex;flex-direction:column">
    <div style="font-weight:700;font-size:0.95rem;color:rgb(104 77 58)">Level 3 - Advanced</div>
    <div style="font-size:0.8rem;color:rgb(104 77 58/0.75);line-height:1.45;margin-top:0.35rem">Multiple subsystems working together: a robot that senses and moves, a wearable with wireless, a device with custom firmware.</div>
    <div style="font-weight:700;font-size:0.8rem;color:rgb(104 77 58/0.7);margin-top:auto;padding-top:0.6rem">Up to $400 funding</div>
    <div style="font-size:0.8rem;color:rgb(104 77 58/0.65);margin-top:0.2rem">Funds at about $5/hr</div>
    <div style="display:flex;align-items:center;gap:0.5rem;margin-top:0.6rem;padding-top:0.6rem;border-top:2px solid rgb(104 77 58/0.15)"><img src="/images/fruits/watermelon/icon_interior.webp" alt="Watermelon" style="width:1.75rem;height:1.75rem;object-fit:contain"><span style="font-weight:700;font-size:0.8rem;color:rgb(104 77 58)">Watermelon</span></div>
  </div>
  <div style="background:rgb(104 77 58/0.05);border:3px solid rgb(104 77 58/0.2);padding:0.85rem 1rem;display:flex;flex-direction:column">
    <div style="font-weight:700;font-size:0.95rem;color:rgb(104 77 58)">Level 4 - Expert</div>
    <div style="font-size:0.8rem;color:rgb(104 77 58/0.75);line-height:1.45;margin-top:0.35rem">Autonomous robots, custom SBCs, FPGA projects, satellite systems, complex mechanical builds.</div>
    <div style="font-weight:700;font-size:0.8rem;color:rgb(104 77 58/0.7);margin-top:auto;padding-top:0.6rem">Up to $1000 funding</div>
    <div style="font-size:0.8rem;color:rgb(104 77 58/0.65);margin-top:0.2rem">Funds at about $6/hr</div>
    <div style="display:flex;align-items:center;gap:0.5rem;margin-top:0.6rem;padding-top:0.6rem;border-top:2px solid rgb(104 77 58/0.15)"><img src="/images/fruits/avocado/icon_interior.webp" alt="Avocado" style="width:1.75rem;height:1.75rem;object-fit:contain"><span style="font-weight:700;font-size:0.8rem;color:rgb(104 77 58)">Avocado</span></div>
  </div>
</div>

L4 Expert projects can request up to **$1000**, but those requests get extra scrutiny from reviewers at design review time. If your build genuinely needs more than your level's cap, ask in **#macondo-help** on Slack before you submit. See [Sourcing Parts](/docs/sourcing-parts) and [Shipping Your Design](/docs/submitting-design) for how funding works end-to-end.

## The fruit you get

Each level has its own fruit pool, split by software vs. hardware:

| Level | Software fruit | Hardware fruit |
|---|---|---|
| L1 Beginner | Mango | Guava |
| L2 Intermediate | Pineapple | Coconut |
| L3 Advanced | Papaya | Watermelon |
| L4 Expert | Cocoa | Avocado |

The fruit is a decorative tier badge: it tags the project on the farm and contributes to the lifetime fruit count on your [currency guide](/currency), but the gold you actually receive in your balance is **gold/hr × hours × streak multiplier**, based on the rate table above.

## Can I change my level?

Yes, and it is quick. Near the top of your project page there is a badge showing your current level and type, like **Level 2 · Hardware**, with a small pencil icon. Click it to open the picker and choose a new level (you can switch between hardware and software there too).

You can change your level any time your project is not in review, including between ships. While a ship is under review the badge is locked, so the level you submitted is the one being graded. A reviewer may also adjust your level during review if the complexity does not match what you picked, and they will always tell you why.

## What if I pick wrong?

Do not stress about this. Just pick honestly, and the system takes care of the rest:

- Mark a "Hello World" site as L4 Expert, and the reviewer will move it back down.
- Genuinely unsure? Go one level lower than your gut says.
- Underrated your project? You can always bump it up after the first review.

The worst case is a reviewer adjusts your level and explains why, so there is no way to "lose" by guessing.

## See also

- [What is shipping?](/docs/what-is-shipping) , how reviews work
- [Currency](/docs/currency) , how gold, streaks, and the historical fruit count work
