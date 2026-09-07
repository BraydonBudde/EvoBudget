# Blog setup

The blog lives at **https://ezzohub.com/blog**, linked from the main nav and
footer of the home page.

## How posts are stored

There are two sources, and the blog page merges them:

| Source | What's in it | Editable from |
|---|---|---|
| `blog-posts.js` (in the repo) | The 10 posts that shipped with the site | Admin, or the repo |
| The `Blogs` tab in your analytics spreadsheet | Anything you write in the admin | Admin |

A sheet post with the same slug wins over the shipped one. That's what makes
the 10 seeded posts editable from the admin without touching the repo: saving
one writes your version to the sheet, and the site prefers it from then on.
Deleting your version in the admin brings the original back.

The shipped posts are why the blog renders instantly and never shows an empty
page while a network call is in flight.

## What you need to do once

1. **Redeploy the Apps Script.** It now answers `?action=posts`, which is how
   the blog page picks up anything you publish. Open the script editor, paste
   in the current `Code.gs`, then **Manage deployments → edit (pencil) →
   Version: New version → Deploy**. Editing an existing deployment keeps the
   same `/exec` URL, so nothing else needs changing.

2. **That's it.** The `Blogs` tab is created automatically the first time you
   save a post in the admin, with its header row already in place.

## Writing a post

Admin → **Blogs** → **+ New post**.

- **Title** fills in the **URL slug** automatically until you edit the slug
  yourself. Changing the slug on a post that's already live breaks any links
  people have to it.
- **Excerpt** is used in two places: the card on the blog index, and the
  description Google shows in search results. 120 to 160 characters is the
  range where Google shows all of it.
- **Body** is HTML:
  - `<p>…</p>` for paragraphs
  - `<h2>…</h2>` for section headings
  - `<ul>` / `<ol>` with `<li>` for lists
  - `<div class="bp-callout">…</div>` for a highlighted note box
  - `<a href="/blog?p=some-slug">…</a>` to link another post
- **Cover image**: drag any image in. It's centre-cropped to a 500px square
  and compressed in your browser before saving, so it matches the covers on
  the existing posts. Very large or very detailed photos may refuse to save,
  because a spreadsheet cell tops out at 50,000 characters; a simpler image
  fixes it.
- **Status** decides whether it's on the site. Draft is saved but hidden.
- **Keep reading** picks up to three posts to show at the bottom.

Saving publishes immediately. Readers may take up to five minutes to see it,
because the Apps Script caches the post list for that long.

## Editing or deleting

Every post on the site is listed under Blogs with an **Edit** button. Posts
you've written also get **Delete**.

For a seeded post, Delete removes *your* version and the original comes back.
To hide a seeded post entirely, edit it and set the status to Draft.

## Regenerating the shipped cover images

The 10 covers in `blog/` are generated, not hand-drawn. The generator is a
throwaway script (see the session scratchpad) that renders SVG to 500x500
JPEG through a headless browser. They're committed as plain images, so
nothing in the site depends on that script existing.
