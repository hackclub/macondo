---
title: Hackatime
description: Hackatime tracks your coding hours automatically, so software ships count without journaling every minute. Set it up, link your project, fix missing time.
section: software
order: 1
icon: clock
---
# Hackatime

**Hackatime is a free, open-source coding-time tracker that logs your hours for you.** Install it once, code like normal, and it counts the time you spend in your editor. Those hours are what turn into **gold** (the currency you spend in the shop) when a reviewer approves your software ship.

It works by sending "heartbeats" from your editor to the Hackatime server every time you type or save a file. Macondo adds those heartbeats up into the hours on your project page. Hackatime is built by Hack Club, uses the WakaTime plugin ecosystem, and works with any editor that supports WakaTime. Think of it like WakaTime, but free and built for teenagers.

## Do I need to journal for a software project?

**No, not for the coding itself.** Hackatime tracks your coding time automatically, so you do not journal every coding session to get credit for it. Journaling is still a good habit (it shows reviewers what you built), but your code hours come from Hackatime, not from a stopwatch you run by hand.

You only journal time by hand for work Hackatime cannot see, which is anything you do outside a code editor. Art, design, music, and hardware assembly are journal-logged. Code is Hackatime-tracked. See the callout below for how to log non-coding hours.

::danger{title="You MUST use Hackatime for every software project"}
Hackatime is how we track the hours you spent coding. Without it, your software project **cannot be submitted** for review and you will **not get credit** for the work you did. Finish the setup steps below before you write any code.
::

::tip{title="What about art, design, or other non-coding work?"}
Hackatime only tracks editor time, so things like sprite art, UI mockups, level design, music, or any work you do outside a code editor won't show up there. That's fine, log those hours a different way:

- **Post a journal entry** describing what you made and how long it took. Attach screenshots, files, or a quick recording. One journal per session is plenty.
- **Or use [Lapse](https://lapse.hackclub.com)** to record a timelapse of the work (great for art and Figma).

Hackatime is still required for the code itself. Use journals or Lapse to *add* the non-coding hours on top.

When you record a Lapse (or any other timelapse or screen recording) for art or asset work, **paste the video link in your journal entry** (YouTube unlisted works, or any CDN URL that plays the file) so the reviewer can confirm the hours.

Heads up: art and asset hours generally shouldn't exceed ~40% of your project's approved hours, unless the art is exceptionally high quality. See [Good Journaling](/docs/journals#art-and-asset-hours) for the full rule.
::

::danger{title="AI usage is allowed, but keep it polished"}
HC AI and other AI tools are fine for help. They are **not** fine for dumping a generated project on us. Your submission must be code you understand, with obvious polish, testing, and your own iteration on top. **Heavy AI usage will be rejected. That includes unreviewed generated code, copy-pasted output, and AI-written journals.** When in doubt, rewrite it in your own words. Journals must always be written by you, never by AI.
::

## How do I set up Hackatime?

There are two parts, and the wizard handles the first one for you.

First, install the editor plugin so heartbeats start flowing. Open the setup wizard below.

<a href="https://hackatime.hackclub.com/my/wakatime_setup" target="_blank" style="display: block; width: 100%; padding: 1rem; background-color: rgb(104 77 58); color: rgb(245 240 230); font-weight: 700; font-size: 1.1rem; text-align: center; text-decoration: none; border: none; cursor: pointer; margin-bottom: 1rem;">Open the Hackatime Setup Wizard →</a>

The wizard walks you through everything: creating your account, grabbing your API key, and giving you a personalized install command to run in your terminal. The command is unique to you since it includes your API key.

> **macOS / Linux / WSL:** The wizard gives you a `curl` command to paste into your terminal.
>
> **Windows:** The wizard gives you a PowerShell command instead.

The script configures everything automatically, and for VS Code, JetBrains IDEs, Zed, and Xcode it even installs the editor plugin for you.

Second, connect Hackatime to your Macondo account. Go to your **profile**, find the **Hackatime** row, and click **Link**. That is a one-time account link, and once it is connected it stays connected. With both parts done, your coding time can flow into your projects.

::tip{title="Not seeing your time?"}
Try restarting your editor after running the setup wizard. If you're still stuck, ask for help in **#hackatime-help** on the Hack Club Slack.
::

## How do my hours count?

Your **approved hours** are what turn into **gold** when a reviewer accepts a ship. Approved hours come from two places, added together:

- **Hackatime time** on the project(s) you linked to this Macondo project.
- **Journal hours** you logged for non-coding work (art, design, hardware assembly), which the reviewer can accept on top.

Coding makes progress on your **project streak** too. Streaks are per project, so keep working on the same project to grow one. Reviewers decide the final approved hours and can deflate time that isn't backed by real work, so keep your journals detailed.

## How do I link the right Hackatime project?

Hackatime tracks time per **project name**, which is usually the name of the folder you opened in your editor. On your Macondo project page you link one or more of those Hackatime project names to your project, and **only the linked names count** toward your hours. The picker leads with the projects you have actually spent time on, and tucks quiet folders behind a "Show all" toggle.

A few things trip people up:

- **Rename mismatch.** If you rename your project folder, Hackatime starts logging under a new project name. Link the new name too, or your recent hours won't show.
- **Multiple folders.** If you split work across folders, link every Hackatime project that belongs to this build.
- **Wrong project linked.** Time only counts once, on the project it was logged under. Linking an unrelated project won't move its hours over.

You can add or change linked Hackatime projects from your project page any time before you ship.

## My time isn't showing up. What do I check?

Hackatime time isn't always instant. Heartbeats are sent as you type, but it takes a moment for them to add up, and Macondo re-syncs everyone's totals on a schedule (and whenever you open your dashboard). If your hours look low, work down this list:

1. **Restart your editor** after running the setup wizard, type for a minute, then check [your Hackatime dashboard](https://hackatime.hackclub.com).
2. **Confirm heartbeats are arriving** on that dashboard. If they aren't, the editor plugin isn't configured, re-run the setup wizard.
3. **Check the project name** matches one you linked on Macondo (see above).
4. **Give it time.** A recent burst of coding can take a bit to fully reflect on your project page.

Still stuck? Ask in **#hackatime-help** on the Hack Club Slack.

## How does trust and verification work?

Hackatime scores how trustworthy an account's time looks. Brand-new accounts, and accounts with unusual heartbeat patterns, start with lower trust, which can mean your hours get a closer look before they're approved. You build trust simply by coding normally over time.

Don't try to inflate your time. Idle editors, faked heartbeats, and scripts that simulate typing are easy to spot and will get a project rejected. Real, steady progress backed by good journals is always the fastest path through review.

## See also

- [Journals](/docs/journals) , how to log non-coding hours and what makes a good entry
- [What is shipping?](/docs/what-is-shipping) , how reviews and approved hours work
- [Currency](/docs/currency) , how gold, streaks, and fruit are earned
- [Get help](/docs/help) , which Slack channel to ask in
