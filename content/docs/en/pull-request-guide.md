---
title: Get Your Own Domain
description: Claim a free hackclub subdomain for your project by opening one pull request to the hackclub/dns repo. No prior GitHub experience needed.
section: guides
order: 6
icon: globe
---
# How to Get Your Own Domain

Want a custom domain like `yourname.dino.icu` for your project? Hack Club gives every member free subdomains through the [hackclub/dns](https://github.com/hackclub/dns) repo on GitHub. All you have to do is open a pull request, and this guide walks you through every click.

Never opened a pull request before? That is completely fine. You do not need to know Git or use the command line. Everything here happens in your browser, and we go one step at a time.

## TL;DR

- **What you will do:** fork the `hackclub/dns` repo, add one line for your subdomain, and open a pull request. A maintainer merges it and your domain goes live.
- **What you need:** a [GitHub account](https://github.com) and a deployed project to point the domain at.
- **How long:** about five minutes of editing, then a day or two for a volunteer to review.

## What You'll Need

- A [GitHub account](https://github.com)
- A deployed project you want to point your domain to (a website, app, etc.)

## Step 1: Fork the Repo

Go to [github.com/hackclub/dns](https://github.com/hackclub/dns).

Click the **Fork** button in the top right corner. This creates your own copy of the repo under your GitHub account.

## Step 2: Edit the File

After forking, you'll be on your copy of the repo. You can edit files directly in your browser.

Open the `dino.icu.yaml` file and click the pencil icon to edit it.

Find the right spot **alphabetically** based on your subdomain name and add your entry:

```yaml
yourname: # your-email@example.com U012AB345CD
  - type: CNAME
    value: your-deployment-url.vercel.app.
```

- Replace `yourname` with the subdomain you want (e.g., `hello` gives you `hello.dino.icu`)
- Replace `your-deployment-url.vercel.app.` with where your site is hosted. **Don't forget the `.` at the end!**
- If you're using an IP address instead of a domain, change `type: CNAME` to `type: A`
- Add your contact info in the comment: an email address, Slack member ID, or both

## Step 3: Commit Your Changes

Scroll down and you'll see the **Commit changes** section. Write a short message describing what you did, like "Add yourname.dino.icu".

Make sure **"Create a new branch for this commit and start a pull request"** is selected, then click **Propose changes**.

## Step 4: Open the Pull Request

GitHub will take you to the pull request page. You'll see your changes compared against the original repo.

- Add a title (e.g., "Add yourname.dino.icu")
- Optionally add a description
- Click **Create pull request**

That's it! Someone with contributor access will review your PR and merge it. Once merged, your domain will go live.

::tip
If a reviewer asks for changes, commit to your fork instead of closing the PR and opening a new one. Your existing PR automatically picks up new commits on the same branch.
::

## Vercel Users

If your site is hosted on Vercel, you'll need to verify the domain by adding a TXT record too. Vercel will show you a verification value. Add it like this:

```yaml
_vercel:
  ttl: 600
  type: TXT
  values:
    - vc-domain-verify=yourname.dino.icu,abc123def456
```

## Common Record Types

| Hosting | Record Type | Example Value |
|---------|------------|---------------|
| Vercel | CNAME | `cname.vercel-dns.com.` |
| Netlify | CNAME | `your-site.netlify.app.` |
| GitHub Pages | CNAME | `yourusername.github.io.` |
| Nest / Custom Server | A | `123.45.67.89` |

::warning{title="Easy to miss"}
CNAME values need a `.` at the end. A records (IP addresses) do not. Getting this wrong is one of the most common review-bounce reasons.
::

## Tips

- **Add your entry alphabetically.** Find where your subdomain name fits in the file and insert it there.
- **Keep changes small.** One subdomain per PR. Don't bundle unrelated changes.
- **Be patient.** Maintainers are volunteers. Give them a day or two to review.
- **Check for errors.** Some repos have automated checks that run on your PR. If they fail, read the error and fix it.

::tip{title="Still stuck?"}
Ask in **#macondo-help** on the [Hack Club Slack](https://slack.hackclub.com). Include your fork URL and what you have already tried.
::
