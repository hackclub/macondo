---
title: Using the Macondo API
description: Mint a personal API key and read your Macondo data (projects, streaks, journals) from your own scripts and tools, without session cookies.
section: guides
order: 8
icon: key
---
# Using the Macondo API

Want to build a dashboard, a stats bot, or a script on top of your Macondo account? Personal API keys give your tools programmatic access without borrowing your browser's session cookie (which expires after 30 days).

## Get a key

1. Go to [your API keys page](/settings/api-keys) (also linked from your profile under Linked Accounts).
2. Give the key a label that says what it's for, for example the name of your tool.
3. Pick an expiry, or leave it at "Never".
4. Copy the key immediately. It is shown exactly once; Macondo only stores a hash of it.

Keys look like `macondo_pat_...`. You can have up to 5 active keys, and you can revoke any of them at any time from the same page.

## Make requests

Send the key as a bearer token in the `Authorization` header:

```bash
curl -H "Authorization: Bearer macondo_pat_YOUR_KEY" \
  https://macondo.hackclub.com/api/auth/me
```

The endpoints are the same ones the site itself uses, so anything you see the site fetch, your key can read too. A few useful starting points:

- `/api/auth/me`: who you are, streak counters, account flags
- `/api/projects`: your projects
- `/api/projects/{id}`: one project, including journals
- `/api/profile/streaks`: your streak and freeze state

Because these are the site's own endpoints, response shapes can change without notice. Build defensively.

## What keys can and cannot do

- **Read-only.** Only `GET` requests work. A key can never buy shop items, ship a project, edit journals, or delete anything.
- **Your account only.** The key acts as you and sees what you can see.
- **No staff or admin surfaces.** Internal endpoints always reject keys.
- **No home addresses.** `/api/auth/me` withholds your PII locker addresses when called with a key.

## Rate limits

Each key gets 20 requests per 5 seconds and 60 requests per minute. Beyond that you get a `429` response with a `Retry-After` header telling you how long to back off.

## If a key leaks

Treat keys like passwords. If one ends up in a public repo or a log file, revoke it on [the API keys page](/settings/api-keys) right away; revocation takes effect within seconds. Then mint a fresh one.
