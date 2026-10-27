---
title: Learn how to use an API
description: Build a custom new-tab homepage that pulls NASA's photo of the day, a live clock, and your local weather, using plain HTML, CSS, and JavaScript to call REST APIs. By Nico from Resolution Coding.
section: guides
order: 5
icon: image
---
# Learn how to use an API
By [Nico](mailto:nico@resolution.hackclub.com)

## TL;DR

**What you'll build:** a single static page that reads three different APIs to make a custom homepage you can set as your browser's new-tab background. NASA picks the picture, JavaScript runs the clock, and Open-Meteo pulls live weather for wherever you're sitting.

**What you need:** the HTML and JavaScript basics, a code editor, and any modern browser. No Node, no build tools, just three files in a folder.

**The shape of it:** you'll learn what a REST API is, call APIs with `fetch` and `async`/`await`, handle errors with `try`/`catch`, read the user's location, run code on a timer, and lay out a fullscreen background. Take it one part at a time and you'll have a working homepage by the end.

New to APIs? That's exactly who this guide is for. We'll explain each piece as it comes up, and there's a **Common errors** section near the bottom for when something acts up.

## What you'll build

A single static page that reads three different APIs to make a custom homepage you can set as your browser's new-tab background. NASA picks the picture, JavaScript handles the clock, and Open-Meteo pulls live weather for wherever you're sitting.

![Example homepage with NASA star-trails background and a glass-effect time and weather overlay](https://cdn.hackclub.com/019d2ac3-f9c8-7c88-8d6a-ae6302c9cb15/example.jpg)

## What you'll learn

- What a REST API is and what JSON looks like
- How to call APIs with `fetch` and `async`/`await`
- How to handle errors with `try`/`catch`
- How to read the user's location with `navigator.geolocation`
- How to run code on a timer with `setInterval`
- How to lay out a fullscreen background with CSS

## Prerequisites

- The basics from weeks 1 and 2 of Resolution Coding (writing HTML and JavaScript).
- A code editor. VS Code is fine, anything works.
- Any modern browser (Chrome, Firefox, Safari, Edge).
- No Node, no build tools. Just three files in a folder.

If anything in this guide gets stuck, ask in the **#macondo-help** Slack channel or email Nico at [nico@resolution.hackclub.com](mailto:nico@resolution.hackclub.com).

## What's an API?

You may be wondering, "What IS an API?" API stands for **Application Programming Interface**. APIs are the root of almost all apps and websites. For example, when programming for Android and iOS, you use an API to talk to the device's firmware and ask for things like battery life or location.

In this project we'll use **REST APIs**. REST (Representational State Transfer) is the most widely used API style for web services. To use a REST API you send a request to an endpoint, and it responds with a JSON object.

Examples of public REST APIs:

- Weather forecasts
- Photos from space
- Cat facts

A typical JSON response looks like this:

```json
{
  "firstName": "John",
  "lastName": "Doe",
  "age": 30,
  "isEmployee": true
}
```

## The project

We're going to build a homepage with three features:

1. NASA's Astronomy Picture of the Day as a fullscreen background
2. A live clock
3. Local weather

Make a new folder for the project, and inside it create three empty files: `index.html`, `main.css`, and `script.js`.

## Part 1: The background image

The first feature is a daily background image from the **APOD** (Astronomy Picture of the Day) API. Sign up for a free API key at [api.nasa.gov](https://api.nasa.gov/) so you don't get rate-limited while testing.

::warning{title="Heads up about API keys"}
There is **no safe way** to hide an API key in a static HTML/CSS/JS site. The browser can always inspect the source. NASA's APOD key is fine to expose because the API is free and read-only, but for any project that touches paid services or private data, move the API call to a server route or a proxy (Hack Club's [ai.hackclub.com](https://ai.hackclub.com) is a good example). Expose private API keys at your own risk.
::

Start with a normal HTML template that links your CSS and JS:

```html
<!doctype html>
<html>
  <head>
    <title>Really cool thing!</title>
    <link rel="stylesheet" href="main.css" />
  </head>

  <body>
    <!-- We will put our background image here -->

    <script src="script.js" defer></script>
  </body>
</html>
```

Now add a `div` to hold the background. Why a `div` instead of an `<img>`? Because a `div` lets us crop the image to fit the screen using `background-size: cover`.

```html
<div id="background">
  <p>STUFF CAN GO HERE</p>
</div>
```

Add this CSS to make the div fill the screen and crop the image:

```css
#background {
  width: 100vw;
  height: 100vh;
  background-position: center;
  background-size: cover;
  text-align: right;
  display: flow-root;
}

html,
body,
p {
  margin: 0;
  padding: 0;
}

p {
  color: white;
  font-family: Arial, Helvetica, sans-serif;
  font-weight: bold;
}
```

Now we're ready to pull the image from the NASA API. We'll write a function that calls APOD and returns the image URL.

Why can't we just put the API URL directly into a CSS `background-image`? Because the NASA API doesn't return raw image bytes, it returns a JSON object with the title, description, copyright, URL, and more. Here's a sample response:

```json
{
  "copyright": "Juan Carlos Casado",
  "date": "2026-03-20",
  "explanation": "The defining astronomical moment of the equinox today is at 14:46 UTC...",
  "hdurl": "https://apod.nasa.gov/apod/image/2603/equinox-3k-jcc.jpg",
  "media_type": "image",
  "service_version": "v1",
  "title": "Spring Equinox at Teide Observatory",
  "url": "https://apod.nasa.gov/apod/image/2603/equinox-3k-jcc_1087c.jpg"
}
```

When a function calls an API, you mark it `async`. `async` lets a function pause on `await` without freezing the rest of your page. That doesn't matter much here, but on interactive pages it does, so JavaScript requires it any time you `await` something.

In `script.js`, start with:

```js
const background = document.getElementById("background");

async function getBackground() {
  const url =
    "https://api.nasa.gov/planetary/apod?api_key=DEMO_KEY";
  // Replace this with your own key from api.nasa.gov.
}
```

Now we need to actually call the API. When something can fail (and a network call always can), wrap it in a `try`/`catch` block. The `try` runs first, and if anything throws, the `catch` runs instead. This keeps a hiccup from the API from crashing your whole page.

Inside the `try`, we use `fetch`. `fetch` makes the HTTP request and waits for a response. We then check the response's `ok` property, which is `true` for any status in the 200 range. If it's good, we parse the JSON and double-check that `media_type` is `"image"` (APOD occasionally returns a video, which we can't use as a background).

Add this inside `getBackground`:

```js
try {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Response status: ${response.status}`);
  }

  const result = await response.json();
  console.log(result);

  if (result.media_type !== "image") {
    console.log("APOD returned a non-image media type.");
    return null;
  }

  return result.url;
} catch (error) {
  console.log(error.message);
  return null;
}
```

Now we'll wire it up so the function runs when the page loads, and we'll set the `background-image` CSS property of the div:

::tip
In JavaScript you can use **backticks** with `${}` to drop variables into a string. Example: `` `Cats are ${value}!` ``. We use this trick to build the `url(...)` string for the CSS property.
::

```js
window.onload = function () {
  getBackground().then(function (imageUrl) {
    if (!imageUrl) return;

    console.log(imageUrl);

    if (background) {
      background.style["background-image"] = `url('${imageUrl}')`;
    }
  });
};
```

That's it for the background. Open `index.html` in your browser and you should see today's APOD filling the screen.

::warning{title="Open via a real URL, not file://"}
Some browser features (especially geolocation, which we'll use later) only work over `http://` or `https://`. Don't double-click `index.html` in Finder/Explorer; use a tiny dev server instead. The fastest options are the **Live Server** extension in VS Code, or running `bunx serve` (or `npx serve`) inside your project folder.
::

## Part 2: The clock

Next, a clock. Before writing code, plan where it goes. In the example above it's pinned to the top right with a glass effect. Try to figure out the layout yourself, but the final markup and styles are below as a checkpoint.

The clock itself is just a `<p id="time">`, placed inside the `#background` div. A second wrapper `<div class="gloss">` gives us the frosted-glass card.

**HTML**

```html
<!doctype html>
<html>
  <head>
    <title>Really cool thing!</title>
    <link rel="stylesheet" href="main.css" />
  </head>

  <body>
    <div id="background">
      <div class="gloss">
        <p id="time">00:00:00</p>
        <p id="weather">0% 0°F 0 MPH</p>
      </div>
    </div>

    <script src="script.js" defer></script>
  </body>
</html>
```

**CSS**

```css
#background {
  width: 100vw;
  height: 100vh;
  background-position: center;
  background-size: cover;
  text-align: right;
  display: flow-root;
}

html,
body,
p {
  margin: 0;
  padding: 0;
}

p {
  color: white;
  font-family: Arial, Helvetica, sans-serif;
  font-weight: bold;
}

#time {
  font-size: 15vh;
  margin: 1vw;
}

.gloss {
  background: rgba(255, 255, 255, 0.2);
  border-radius: 16px;
  box-shadow: 0 4px 30px rgba(0, 0, 0, 0.1);
  backdrop-filter: blur(5px);
  -webkit-backdrop-filter: blur(5px);
  border: 1px solid rgba(255, 255, 255, 0.3);
  display: inline-block;
  margin: 5vw;
}
```

Now for the JS. Instead of giving you the answer, here are the tools you need. Try writing the clock yourself.

JavaScript has a built-in `Date` object. Calling `dateObject.getTime()` returns **Unix time**: the number of milliseconds since January 1st, 1970. JS also has helper methods like `getHours()`, but where's the fun in that. Your challenge is to convert Unix time into human-readable hours, minutes, and seconds yourself.

Things you'll want to know:

### Run code every X seconds

`setInterval` runs a function on a repeat:

```js
setInterval(() => {
  // code goes here
}, 1000); // every 1000 ms = 1 second
```

### Make a Date object

You need a fresh `Date` every time you read the time, otherwise you'll keep reading the same instant.

```js
let dateObject = new Date();
dateObject.getTime(); // Unix milliseconds
```

To handle time zones, use `dateObject.getTimezoneOffset()`. It returns the difference between UTC and local time **in minutes**. The formula is `UTC - Local`, and remember Unix time is in **milliseconds**, not minutes (`1000 ms = 1 s`).

### Remainder and floor

The `%` operator gives you a remainder: `10 % 3 === 1`. Useful for "milliseconds inside the current day."

`Math.floor(x)` rounds down. Useful when integer division gives you something like `9.45`.

### Logging

Use `console.log()` to inspect values while you're debugging:

```js
console.log(`Some logs, and a ${variable}!`);
```

### Updating a paragraph

To change what's on the screen, set `.innerText`:

```js
const time = document.getElementById("time");
time.innerText = `Some nice text. Here's a ${variable}!`;
```

::tip{title="You got this"}
That's everything you need to make the clock work. Lock in.
::

## Part 3: The weather

Same deal. Tools below, you write the code.

The HTML and CSS are mostly done already; just style the `#weather` paragraph.

**HTML (no changes from above)**

```html
<div id="background">
  <div class="gloss">
    <p id="time">00:00:00</p>
    <p id="weather">0% 0°F 0 MPH</p>
  </div>
</div>
```

**CSS (add this)**

```css
#weather {
  font-size: 5vh;
  margin: 1vw;
}
```

For the API, use [Open-Meteo](https://open-meteo.com/). It's free, no API key required. Their docs page has a builder you can use to pick the fields you want. To verify you can reach it, paste this URL into your browser, you should see a JSON response:

```
https://api.open-meteo.com/v1/forecast?latitude=40.7&longitude=-74.0&current=temperature_2m,wind_speed_10m,precipitation_probability&temperature_unit=fahrenheit&wind_speed_unit=mph
```

Once you've picked your fields, write a function that calls it the same way `getBackground` did, but return the **whole JSON** object this time, not just one property.

The one new thing is getting the user's location. JavaScript has `navigator.geolocation.getCurrentPosition()`, which takes a callback that receives a `GeolocationPosition`. You can read coordinates off `position.coords.latitude` and `position.coords.longitude` and stitch them into the Open-Meteo URL.

::warning{title="Geolocation needs HTTPS or localhost"}
`navigator.geolocation` won't prompt the user if the page is opened from a `file://` URL. Run a dev server (Live Server in VS Code, or `bunx serve`), or push the project to GitHub Pages, before testing this part.
::

Once the call returns, pick the values you want out of the JSON and stuff them into `#weather` with `.innerText`. You're free to format it any way you like, the example is `0% 50.2°F 8.2 MPH`.

## Common errors

A few things that go wrong with this exact project, and the fixes:

- **Background never appears, the page is just black.** Open the DevTools console. If you see a `403`, your NASA key is rate-limited (every IP gets a small daily allowance on `DEMO_KEY`); register your own at [api.nasa.gov](https://api.nasa.gov/) and paste it into `getBackground`.
- **APOD returned a non-image media type.** APOD is sometimes a YouTube video. The `if (result.media_type !== "image")` check we wrote handles this, but it means today's response just has nothing for you to render. Wait a day, or fall back to `result.hdurl` from a previous date.
- **Geolocation prompt never shows up.** You're on `file://`. See the warning above.
- **CORS error in the console.** Open-Meteo and APOD both allow browser CORS, so this usually means you typo'd the URL or accidentally called a different endpoint. Double-check by pasting the URL straight into a browser tab.
- **`Uncaught ReferenceError: background is not defined`.** Your `<script>` tag ran before the `#background` div existed. Either keep `defer` on the script tag, or move the script tag below the div in the HTML.

## Add something unique

Once the homepage works, add your own twist. Some ideas with public, no-key APIs:

- A daily cat fact strip from [catfact.ninja](https://catfact.ninja/).
- A trivia question from the [Open Trivia Database](https://opentdb.com/).
- A tiny chat box backed by [ai.hackclub.com](https://ai.hackclub.com), Hack Club's free Llama proxy.
- Your currently-playing song (Spotify's API, but heads-up, it does need OAuth).

::warning{title="Your submission must be your own twist"}
A straight copy of this guide gets rejected. Use it to learn the moves, then ship something that's recognisably yours.
::

## Don't forget the README

Before you ship, add a `README.md` in the root of your repo that explains what your project is, how you built it, and how someone else can try it. Without one your project won't be marked as shipped.
