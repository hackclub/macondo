---
title: Earning Gold
description: How you earn gold, why streaks make every ship pay more, and what the lifetime fruit count means.
section: currency
order: 0
icon: apple
---
# Earning Gold

**You earn gold by spending hours building, and you spend it in the shop.** When you ship a project and a reviewer approves it, gold lands in your balance. How much you earn per hour depends on your project's level, and a long streak makes every ship pay even more.

Gold is the only spendable currency. Your project also gets a **fruit** (a decorative tier badge), and your account keeps a lifetime fruit count as a record of everything you've built. The fruit is not a second wallet, just a label.

## How much gold do I earn per hour?

Your project's level sets your base **gold per hour**. Harder projects pay a little more:

| Level | Label | Gold per hour |
|-------|-------|---------------|
| 1 | Beginner | 40 |
| 2 | Intermediate | 45 |
| 3 | Advanced | 50 |
| 4 | Expert | 60 |

You pick the level when you create a project, and a reviewer can adjust it at approval time if the complexity doesn't match. See [How Levels Work](/docs/how-levels-work) for how to choose.

The gold you actually receive when a ship is approved is:

**gold per hour × approved hours × streak multiplier**

The streak multiplier is the part you control day to day, and it is explained below.

## What are the project fruits?

Every project is assigned one of eight fruits, split between software and hardware. The fruit comes from your project's type and level, so you don't pick it.

### Software

| Fruit | Level |
|-------|-------|
| Mango | 1 |
| Pineapple | 2 |
| Papaya | 3 |
| Cocoa | 4 |

### Hardware

| Fruit | Level |
|-------|-------|
| Guava | 1 |
| Coconut | 2 |
| Watermelon | 3 |
| Avocado | 4 |

The fruit doesn't change the gold you earn, it just tells you and the reviewer what tier the project sits at. Your `Mango: 124` lifetime stat means "this account has earned the equivalent of 124 mangos" across every L1 software ship you've ever approved. You'll find your lifetime fruit count and a gold calculator on the [currency guide](/currency).

## Starfruit and extra fruity ships

Some shop items are gated behind a one-time **starfruit** unlock. You can spot them by the small starfruit badge on the item card. They're items we'd otherwise pull from the shop, the kind people would farm by churning out low-effort projects, so we put them behind a quality wall instead.

### How do I earn a starfruit?

When a reviewer approves your ship, they can check a small "extra fruity" box above their justification. If they do, you get **1 starfruit** in addition to your normal gold. The starfruit lands in your balance immediately, including for hardware projects (it's not part of the pending-gold / build-complete mechanic below).

The flag is **per ship**, not per project. Every ship you submit is its own opportunity, including update ships on a project you've already shipped. Reviewers only mark exceptional builds, so most ships won't earn one. That's normal, and you'll never lose progress on the gold path for not getting one.

Once any ship on a project has been marked extra fruity, the project carries a public "Extra Fruity" badge on its page and its Explore card. The badge is sticky: a later non-extra-fruity ship doesn't clear it.

### How do I spend a starfruit?

Spending 1 starfruit on a locked shop item unlocks it for you. After the unlock the item works like any other: you still need the normal gold (or fruit) price to actually buy it. Unlocks are one-time per item, you don't pay starfruit again to re-buy that same item, and the unlock sticks even if the admin later edits the item.

Starfruit only does this one thing. You can't convert it to gold, you can't trade it, and you don't lose it if you don't spend it. It's just a token sitting on your account until you find a locked item worth opening up.

## The streak system

Showing up consistently earns more than one big burst. Every project tracks its own **project streak**, the number of days in a row you've put real work into that specific plant.

### What does the streak do?

::doc-card-grid{:cols="2"}
  ::doc-card{to="#plant-growth" title="Plants grow" description="Project streak drives the plant stage on your farm: seedling, sprout, leafy, fruiting." icon="sprout"}
  ::

  ::doc-card{to="#ship-bonus" title="Ships pay more" description="Every project streak day adds +1% to the gold you earn when you ship. Ten days = 1.10×." icon="trending-up"}
  ::
::

#### Plant growth

Each tile's plant stage comes straight from the project streak:

| Project streak | Stage |
|----------------|-------|
| 1-2 days | Seedling |
| 3-5 days | Sprout |
| 6-9 days | Leafy |
| 10+ days | Fruiting |

The stage is cosmetic for now, but it's the fastest way to see at a glance which projects you've been consistent on.

#### Ship bonus

When you ship a project, its gold reward is multiplied by `1 + (project streak days × 0.01)`. A 10-day streak = **1.10× gold**, a 30-day streak = **1.30× gold**, and so on. The multiplier is snapshotted at ship time, so racking up a long streak before submitting is worth it.

### How do I keep my streaks alive?

Here's the part most people get wrong: as long as your projects have **auto-freeze on** (the default, see below), you **don't** have to touch every project every day. Log at least **1 hour of work on any one of your projects** in a day, and every auto-freeze-on project's streak stays alive for that day. Clearing the hour once, on a single project, protects all of those projects from resetting.

That hour is your **Hackatime time and your journal hours added together**:

- **Hackatime time** on a project you've linked counts.
- **Journal hours** count too. When you post a journal you record how long you worked, and those hours add to your Hackatime for the day. So you can clear the hour with Hackatime alone, with journal hours alone, or a mix (for example 30 min of Hackatime plus a journal logging 30 min). This is how hardware projects, or coding outside Hackatime, keep a streak alive.

A journal with **0 logged hours doesn't count on its own** when you have under an hour of Hackatime that day. A streak day needs **1 hour total (Hackatime plus journal time)**.

### Which project's streak actually goes up?

Keeping your streaks alive and *growing* one are two different things. Your streaks all survive on a single hour spent anywhere, but a project's streak only **goes up** (and earns the bigger ship multiplier) on the days you put the hour into **that** project. Projects you don't work on that day hold steady (as long as they have auto-freeze on): they don't reset, they just don't climb. So if you split your day across projects, none of them break, but only a project that got a full hour moves up.

If a project's streak "didn't go up even though I coded for an hour," the hour usually landed under a different Hackatime project name, got split so no single project cleared a full hour, or there was a tracking gap. If your dashboard shows less total time than you expect, that's almost always a Hackatime tracking gap. See [Hackatime](/docs/hackatime) for how the time gets counted.

### What happens if I miss a day?

A "missed day" is a day you log **no qualifying hour on any project at all**, not a day you skip one project. For projects with auto-freeze on, that's the only thing that puts your streaks at risk.

- If you have a **streak freeze**, it spends automatically to cover the missed day and your auto-freeze-on projects are protected.
- If you have **no freeze left**, your project streaks reset to 0 and the plants drop back to the seedling stage.

**Streak freezes** (buy in the [shop](/docs/shop)) auto-spend on a missed day so you don't lose your progress. You can stash up to 5 at a time.

::warning{title="Auto-freeze off means strict daily streaks"}
Each project has an **Auto-freeze** checkbox on your profile's streak settings. Unchecking it takes that project out of all the protection above: an opted-out project's streak resets to 0 on the first day you don't put a qualifying hour into **that specific project**, even if you worked on your other projects that day, and even if you have freezes in the bank (freezes are never spent on it). Leave auto-freeze on unless you want that plant to demand work every single day.
::

::tip{title="When does a streak day end?"}
A streak day runs **midnight to midnight in your local time**. Work logged after midnight counts toward the new streak day. Your reminder fires X hours before that local boundary (see your settings for the exact value). Travelers: update your timezone on your account settings if it changes, so the streak rolls when you expect it to.
::

::tip{title="Don't archive the journal you just posted"}
Archiving a journal on the same day you created it counts as taking it back, and removes its logged hours from today's total. If that drops your combined Hackatime plus journal time on the project back under 1 hour, the streak ticks back down. Restoring it that same day re-extends the streak.
::

::tip{title="Streak math in plain English"}
Each project's streak is "days in a row I worked on *this* plant." Two projects can sit at very different streak lengths even if you've shipped both, since each plant is counted independently.
::

## Pending hardware gold

Hardware projects gate their gold reward behind a **build-complete** ship. When a non-build-complete hardware ship is approved, the gold is recorded but pending: it doesn't count toward your balance and you can't spend it. Submit a follow-up ship marked "build complete" on the same project and every pending row unlocks at once. The pending amount shows on your profile so you know what's at stake.

> Your project fruit is assigned automatically based on whether it's software or hardware and what level it's rated at. You don't get to pick your fruit, but harder projects earn more gold per hour.

## See also

- [How Levels Work](/docs/how-levels-work) , what each level pays in gold, funding, and fruit
- [Hackatime](/docs/hackatime) , how your build time gets tracked and counted
- [What is shipping?](/docs/what-is-shipping) , how reviews turn hours into gold
- [The Shop](/docs/shop) , where you spend gold, starfruit, and streak freezes
