---
title: Shipping Your Build
description: Hardware-only checklist for submitting your finished build, plus how update ships and funding fix-paths work.
section: shipping
order: 2
icon: check-circle
---
# Submitting Your Build

**This is the second step for hardware projects: you submit your build once the device is actually built and working.** Approved builds unlock the gold that's been waiting on your project, so you can spend it in the shop.

<div style="background:rgb(200 160 50/0.15);border:3px solid rgb(200 160 50/0.4);padding:1rem 1.25rem;margin-bottom:1.5rem"><strong style="color:rgb(104 77 58)">This is for hardware projects only.</strong><span style="color:rgb(104 77 58/0.8);font-size:0.875rem"> Submit your build after you've designed your project, received your parts, and built it IRL. Software projects don't need this step since they're reviewed through the <a href="/docs/submitting-design" style="color:rgb(104 77 58);font-weight:600;text-decoration:underline">project submission</a> process.</span></div>

> If you haven't submitted your project for review yet, [do that first](/docs/submitting-design).

## Do I need a real prototype, or are my PCB files enough?

It depends on which ship you're submitting, and that's the part most people get tangled up in. Hardware has two stages:

- **Design ship** (covered in [Shipping Your Design](/docs/submitting-design)): the build isn't built yet. Your CAD source, BOM, and PCB files are the proof. **No physical prototype needed.** This is the ship where you can request funding to buy parts.
- **Build ship** (this page): the device is built and working. Now we need to see the real thing.

So the short answer: PCB files alone are fine for the design ship. The build ship is where you prove the physical build is real. You can't skip straight to a build ship with just files, and you don't have to print or build anything to ship your design.

## How do I submit my build?

Once your hardware is built and working, open your project page, tick **This is my finished build** in the funding panel, and hit **Submit for Review** (it reads **Resubmit for Review** if you're fixing a returned ship).

There are minimum requirements below. Missing any of them gets your project returned, so read them first.

::danger{title="95% of rejections come from problems that take 5 minutes to fix"}
Read the requirements below carefully **before** you submit. Missing files, broken links, or an unclear README are the most common rejection reasons, and every one of them is cheap to fix upfront.
::

## Meet all the project requirements

Submitting your build still requires you to meet all the requirements from [submitting your project](/docs/submitting-design). Make sure those are still in order.

## Show your project built IRL

A build ship needs proof the device works in real life. At minimum, include:

- Photos of your finished project, built in real life
- A demo video showing it off and how it works (a public YouTube, Slack canvas, or Reddit clip all work)

The video goes in the **Demo URL** field on your project page. For a build ship that field is **required**, since hardware can't be loaded in a browser and the video is how a reviewer confirms the build is real. (For a design ship it's optional. See [Project URL: Playable vs. Demo](/docs/submitting-design) for the full breakdown.)

## Update your repository

Make sure your GitHub repo (or Onshape document, if that's your source) reflects the final state of your project:

- Updated README with IRL photos
- Any firmware changes made during building
- Final BOM with actual parts used (not just what you planned), in both the `bom.csv` and the README table
- Assembly instructions that match how you actually built it, including anything you figured out the hard way
- Notes on anything you'd do differently next time

## When your build doesn't work: update ships

Hardware doesn't always cooperate. A chip fries, a PCB trace is wrong, a part arrives dead, firmware corrupts flash. That's normal, and you don't have to abandon your project when it happens. After any approved ship, you can submit another one on the same project, called an **update ship**.

Each update ship is one of two things, and you pick which by how you set two checkboxes in the funding panel. They are **mutually exclusive**: ticking one unticks the other, and you can leave both unticked for a plain in-progress ship.

### Option 1: I need funding (fix-path)

If your project is broken and you need replacement parts to fix it, tick **I need funding** before you submit. On approval, Hack Club sends you a fresh grant for the updated build cost instead of rewarding gold.

You have to document your findings to take this path. The reviewer needs to see what went wrong and what you're changing:

- A new journal entry explaining the failure (what happened, when, and how you diagnosed it)
- Photos of the broken build, plus any debugging you did to confirm the problem
- What parts you're replacing and why
- An updated BOM with the replacement parts and updated total cost

Vague "it didn't work, send more money" update ships will be returned. Be specific.

### Option 2: I'm done (build-complete)

If the build works and you're finished, tick **This is my finished build** and submit. The system treats this as your final build review: on approval you earn gold for all the hours you logged since the last ship, AND every pending gold row you accumulated on this project from earlier ships unlocks at the same time.

This is the one ship that unlocks your pending gold. Until you submit a build-complete ship, the gold from your hardware ships stays pending while reviewers wait on proof of the working build.

There's no third "this ship is finished" toggle hiding somewhere. The two checkboxes are the whole choice: **I need funding** means "I need parts money," **This is my finished build** means "I'm done, unlock my gold," and leaving both unticked is a plain in-progress ship that keeps logging hours with the gold still pending. Pick at most one per ship.

::tip{title="Funding and build-complete can't both be on"}
A ship that's asking for parts money is never the finished build, so ticking **I need funding** clears **This is my finished build**, and vice versa. If you want your pending gold unlocked, leave funding off and tick the finished-build box.
::

> **Every update ship needs proof of new work since the last approval.** That means either strictly more Hackatime hours, or at least one new journal entry with real hours logged. Resubmitting without new work will bounce the ship back, regardless of which path you pick.

## See also

- [Shipping Your Design](/docs/submitting-design) , the first step, including the design ship and the Playable vs. Demo URL rules
- [Sourcing Parts](/docs/sourcing-parts) , how hardware funding grants work
- [How Levels Work](/docs/how-levels-work) , how your level sets your gold rate and funding cap
- [Currency](/docs/currency) , how gold, pending gold, and streaks work
- [Journals](/docs/journals) , how daily updates and logged hours work
