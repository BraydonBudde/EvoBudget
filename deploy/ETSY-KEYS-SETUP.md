# Etsy license keys: setup

One-time setup so Etsy buyers can claim their own unique key at
`ezzohub.com/claim`. Nothing here needs a server: it all runs on the Google
Sheet and Apps Script you already use for analytics.

## What this replaces

Before: 20 fixed codes (`0SCD2` and friends) baked into `script.js`, identical
for every buyer, impossible to trace or switch off.

After: each buyer claims their own key against their Etsy order. One key per
order, capped at 5 devices, and you can revoke any of them from the dashboard.

**The old codes still work.** They're checked first and entirely offline, so
nothing you've already sent out breaks.

---

## 1. Add the Styles sheet

In the same Google Sheet your analytics writes to, create a tab named exactly
`Styles`, then paste in `deploy/etsy-style-tokens.tsv` (open it in a text
editor, select all, paste into cell A1: it's tab-separated so it fills the
columns automatically).

That gives you 20 rows, one per listing, each with its own unguessable token.

To retire a listing later, set its `Active` column to `no`. Its link stops
working, and keys already claimed through it keep working.

## 2. Update the Apps Script

Open the Sheet, then **Extensions → Apps Script**, and replace the contents with
the current `Code.gs` from this repo.

Then **Deploy → Manage deployments → (pencil icon) → Version: New version →
Deploy**.

That last step is the easy one to miss: editing the code alone changes nothing
until you publish a new version. The URL stays the same, so nothing else needs
updating.

The `Keys` sheet is created automatically the first time someone claims.

## 3. Put the links on your Etsy listings

`deploy/etsy-claim-links.txt` has one link per listing. Send the buyer the link
matching what they bought, as the digital download or in your thank-you message.

The style comes from the link, not from anything the buyer types, so a Simple
link can never produce an Ultimate key. Keep them tied to the right listing.

---

## How buyers use it

1. They open their link and enter their Etsy order number plus the email on the
   order.
2. They get their key, in the same shape as a Lemon Squeezy one but starting
   with `ETSY`: `ETSY-5FDE-43A8-8477-4228A671F027`.
3. They enter it in the app exactly where the old codes went.

Lost keys are self-service: entering the same order and email again returns the
same key rather than issuing another.

## Watching for abuse

The dashboard's **Etsy Keys** tab shows every key with how many of its 5 device
slots are used, and flags any that are full. **Revoke** switches a key off.

Two things worth knowing:

- **Revoking stops future redemptions only.** Someone who already unlocked keeps
  access, because that unlock is a flag on their own device. There's no way
  around that without making the app phone home on every launch, which would
  break the offline promise the product is sold on.
- **Order numbers aren't verified against Etsy.** Requiring the matching email
  makes guessing impractical, and the dashboard lets you cross-check against
  real orders, but a determined person could invent an order number. Closing
  that fully needs the Etsy API, which is a separate piece of work if you ever
  want it.
