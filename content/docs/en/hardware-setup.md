---
title: Tools and Software
description: Pick your CAD and PCB tools fast. Browser-based to start, desktop apps when you outgrow them, with free options for every computer.
section: hardware
order: 0
icon: wrench
---
# Hardware: Tools & Software

You need two kinds of software for a hardware project: **CAD** for any 3D-printed parts, and **PCB design** for a custom circuit board. For each one you pick between a browser tool (easy, works on any computer) and a desktop app (more powerful, needs a better machine). This page tells you which to grab so you can stop researching and start building.

Starting hardware can feel like a lot. New words, new tools, decisions you don't know how to make yet. That's normal, and it passes fast once you have the right tool open in front of you.

::tip{title="Search it up"}
The single most important skill in hardware: **search it up**. If you are stuck, there is almost certainly a forum post, tutorial, or datasheet that answers your question. Get comfortable searching before asking.
::

::danger{title="AI usage is allowed, but keep it polished"}
HC AI and other AI tools are fine for help. They are **not** fine for dumping a generated design on us. Your submission must be a project you understand, with obvious polish, testing, and your own iteration on top. **Heavy unpolished AI usage will be rejected. That includes unreviewed generated schematics or CAD, copy-pasted output, and AI-written journals.** When in doubt, rework it in your own words. Journals must always be written by you, never by AI.
::

## Browser tool or desktop app?

For both CAD and PCB design, you'll pick between the same two flavors:

- **Browser-based** is the easy starting point. Pick this if your computer is older, you're on a Chromebook, or you just want to start without installing anything.
- **Desktop apps** are more powerful for long-term work, but need a capable computer (8GB+ RAM, decent CPU).

Browser tools are perfectly fine for most projects. Don't let your computer hold you back from starting.

---

## What do I use to design 3D parts?

If your project has an **enclosure**, a **case**, or any 3D-printed part, you need **CAD** software. Here are the two we recommend.

<div style="display:flex;flex-direction:column;gap:1rem;margin:1rem 0"><div style="background:rgb(104 77 58/0.1);border:3px solid rgb(104 77 58/0.2);padding:1.25rem;cursor:pointer" onclick="window.open('https://www.onshape.com','_blank')"><div><strong style="color:rgb(104 77 58);font-size:1rem">Onshape</strong> <span style="color:rgb(104 77 58/0.5);font-size:0.85rem">Browser-based</span></div><div style="margin-top:0.5rem;font-size:0.875rem;color:rgb(104 77 58/0.8);line-height:1.6">Runs entirely in the browser, so it works on any computer, even a Chromebook. Easier to learn, has great sharing features, and is free for hobbyists and students. It's also used by professional engineers, so you won't outgrow it. A good place to start if you've never done CAD before.</div><div style="margin-top:0.5rem;font-size:0.8rem"><a href="https://www.onshape.com" target="_blank" style="color:rgb(104 77 58);font-weight:600;text-decoration:underline">onshape.com</a></div></div><div style="background:rgb(104 77 58/0.1);border:3px solid rgb(104 77 58/0.2);padding:1.25rem;cursor:pointer" onclick="window.open('https://www.autodesk.com/products/fusion-360','_blank')"><div><strong style="color:rgb(104 77 58);font-size:1rem">Autodesk Fusion</strong> <span style="color:rgb(104 77 58/0.5);font-size:0.85rem">Desktop app</span></div><div style="margin-top:0.5rem;font-size:0.875rem;color:rgb(104 77 58/0.8);line-height:1.6">A desktop app that handles complex models better and runs smoother for large projects. Heavier on your computer (needs a decent GPU and RAM). Free for students. If your computer can handle it, Fusion is the more powerful option.</div><div style="margin-top:0.5rem;font-size:0.8rem"><a href="https://www.autodesk.com/products/fusion-360" target="_blank" style="color:rgb(104 77 58);font-weight:600;text-decoration:underline">autodesk.com/products/fusion-360</a></div></div></div>

**Short version:** start with Onshape. Move to Fusion later if you want more power and your computer can take it.

---

## What do I use to design a circuit board?

If your project has a **custom circuit board**, you need **PCB design** software. Same two-flavor choice as CAD.

<div style="display:flex;flex-direction:column;gap:1rem;margin:1rem 0"><div style="background:rgb(104 77 58/0.1);border:3px solid rgb(104 77 58/0.2);padding:1.25rem;cursor:pointer" onclick="window.open('https://easyeda.com','_blank')"><div><strong style="color:rgb(104 77 58);font-size:1rem">EasyEDA</strong> <span style="color:rgb(104 77 58/0.5);font-size:0.85rem">Browser-based</span></div><div style="margin-top:0.5rem;font-size:0.875rem;color:rgb(104 77 58/0.8);line-height:1.6">Runs in the browser, beginner-friendly, and great for getting started. Integrated with LCSC/JLCPCB for ordering parts and boards. Can be limiting for more complex projects, but perfectly fine for your first few PCBs. Our <a href="/docs/usb-hub" style="color:rgb(104 77 58);font-weight:600;text-decoration:underline">USB Hub guide</a> uses EasyEDA.</div><div style="margin-top:0.5rem;font-size:0.8rem"><a href="https://easyeda.com" target="_blank" style="color:rgb(104 77 58);font-weight:600;text-decoration:underline">easyeda.com</a></div></div><div style="background:rgb(104 77 58/0.1);border:3px solid rgb(104 77 58/0.2);padding:1.25rem;cursor:pointer" onclick="window.open('https://www.kicad.org','_blank')"><div><strong style="color:rgb(104 77 58);font-size:1rem">KiCad</strong> <span style="color:rgb(104 77 58/0.5);font-size:0.85rem">Desktop app</span></div><div style="margin-top:0.5rem;font-size:0.875rem;color:rgb(104 77 58/0.8);line-height:1.6">Open source, professional-grade, and used in industry. Works for intro projects all the way up to complex multi-layer boards. Steeper learning curve, but no limits on what you can design. If your computer has the space and you're willing to invest the time to learn, KiCad is the better long-term choice. Free.</div><div style="margin-top:0.5rem;font-size:0.8rem"><a href="https://www.kicad.org" target="_blank" style="color:rgb(104 77 58);font-weight:600;text-decoration:underline">kicad.org</a></div></div></div>

**Short version:** start with EasyEDA. It's what our [USB Hub guide](/docs/usb-hub) uses, so you can follow along step by step. Switch to KiCad when you want no limits.

::tip{title="Your design time counts too"}
Hardware hours count, not just coding. KiCad has a WakaTime plugin you can point at Hackatime, so your board-design time logs automatically the same way coding time does (ask in **#hackatime-help** to set it up). For tools without a plugin, log your design and build time in a [journal](/docs/journals).
::

---

## What should I build?

Not sure what to make yet? Start with one of our guided projects. Each one walks you through a real build end-to-end, so you follow along, learn the tool, then remix it into your own thing.

::doc-card{to="/docs/guided-projects" title="Check out the Guides" description="Step-by-step walkthroughs for HTML websites, USB hub PCBs, hosting, and more. Start with one, then build your own twist." icon="book-open" size="lg"}
::

Still want more ideas? These outside resources are full of hardware builds to spark something:

- [Adafruit Learn](https://learn.adafruit.com) has incredible guides for all skill levels. Their tutorials walk you through entire projects step by step.
- [Hackaday](https://hackaday.com) showcases creative hardware projects from around the world, including some by Hack Clubbers.
- [Instructables](https://www.instructables.com) has a huge range of DIY projects across electronics, 3D printing, woodworking, and more.
- [Printables](https://www.printables.com) has 3D models you can use as a starting point for your own designs.

---

## Where do I get help building it?

Once your design is done, you have to actually build the thing. Two places to lean on:

- Ask in **#macondo** on the [Hack Club Slack](https://slack.hackclub.com). People there have built all kinds of stuff.
- No 3D printer? Ask in **#printing-legion** on Slack and someone there can print your part and mail it to you. More at [printlegion.hackclub.com](https://printlegion.hackclub.com/).
- Check out [hwdocs.hackclub.dev](https://hwdocs.hackclub.dev) for hardware-specific documentation written by Hack Clubbers.

::tip
When you get stuck, search it up first. Datasheets, forum posts, YouTube teardowns. If that does not answer it, ask on Slack. Nobody expects you to know everything already.
::

> **Next up:** Now that you have your tools, learn how to [write good journals](/docs/journals) to document your progress. Then check out the [guided projects](/docs/guided-projects) to start building.

## See also

- [Guided Projects](/docs/guided-projects) , step-by-step starter builds you can follow and remix
- [USB Hub guide](/docs/usb-hub) , design a 2-port PCB from scratch in EasyEDA
- [Journals](/docs/journals) , how to document your build and log hours
