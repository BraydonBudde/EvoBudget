# Launch hardening: what changed and what you must do

Everything here ships in the site automatically **except the two steps under
"You must do this"**. Until those are done, two of the fixes are inert.

---

## You must do this

### 1. Redeploy the Apps Script

The backend gained four things: launch-code validation, the notify-me
endpoint, its own rate-limit bucket for redemptions, and automatic cleanup
of the Events sheet.

1. Open the Apps Script project attached to your spreadsheet.
2. Replace the contents of `Code.gs` with the version in this repo.
3. **Deploy → Manage deployments → edit the active deployment → Version:
   New version → Deploy.**
4. The web app URL does not change, so nothing else needs editing.

Two sheets are created on first use and need no setup:

- **`Codes`** is seeded with the twenty launch codes that used to live in
  `script.js`, so no existing buyer is affected. See step 2.
- **`Notify`** fills up as people ask to be told about a launch.

### 2. Rotate the launch codes

The old twenty were readable by anyone who opened `ezzohub.com/script.js`,
so treat all of them as public. They still work, on purpose, so that
anybody mid-purchase is not stranded.

In the `Codes` sheet:

- To retire one, set its **Active** column to `no`.
- To replace one, edit its **Code** cell. Longer is better: the format is
  4 to 12 letters and digits.
- Anyone who already redeemed keeps their access. Changing a code only
  affects future redemptions.

If you no longer sell via launch codes at all, set every row to `no`. Etsy
keys and Lemon Squeezy licences are unaffected.

### 3. Before Lemon Squeezy goes live

Set `LEMON_SQUEEZY_STORE_ID` near the top of `script.js` to your store's
numeric id, from the Lemon Squeezy dashboard URL under Settings → Stores.

**While it is blank, Lemon Squeezy licences are refused.** That is
deliberate: their validate endpoint answers for every store on the
platform, so without this check a licence bought from an unrelated seller
for anything named "Ultimate ..." opened your planner. Your store is still
in test mode, so nothing is being turned away today.

---

## What changed on its own

### Licensing

| Before | Now |
|---|---|
| 20 codes sat in the public bundle | They live in the `Codes` sheet and are checked over the network |
| Any Lemon Squeezy licence named "ultimate" unlocked | The store id must match yours |
| Ultimate's automation ignored the trial cap | It stops at the cap and offers the upgrade |
| Simple's caps read a flag that never meant "paid" | Both read the entitlement |
| A key was checked once, at redemption | Re-checked in the background once a day |
| 5 devices per Etsy key | 3 |
| Deleting rows refilled the free allowance | A separate tally counts what a trial has ever used |

The daily re-check **fails open**. Being offline, having the script
blocked, or a slow Apps Script never withdraws access. Only a definite
"revoked" or "no such key" does.

### Analytics

- One `session_start` per visit rather than one per page. Your session
  count was already right; the sheet was carrying duplicate rows.
- `session_end` no longer fires when moving between your own pages.
- Redemptions have their own rate-limit bucket, so a busy day can no
  longer make a buyer's key redemption fail with "busy".
- The Events sheet is trimmed automatically to 40,000 rows or 120 days,
  whichever bites first, oldest first. It shares a spreadsheet with `Keys`,
  and a full spreadsheet would have taken the licence system down with it.

### New

- **Emails tab in the admin panel.** Every address you hold, filterable,
  exportable as CSV, with a copy-addresses button. Sources are Etsy key
  claims and launch notifications. Lemon Squeezy buyers are not included:
  that report returns totals only, so their addresses stay in the Lemon
  Squeezy dashboard.
- **Notify-me actually sends.** It used to write to the browser and stop,
  so nobody was ever told anything and not one address reached you. It now
  records to the `Notify` sheet and only claims success once that lands.
  Note there is currently no tool on the home page marked "coming soon",
  so the form has no entry point until you add one.
- **A save that cannot be written now says so** instead of throwing and
  losing the write silently.
- **`robots.txt`**, keeping crawlers off the admin panel and claim pages.

---

## Rolling back

A tag marks the commit before any of this:

```
git reset --hard pre-audit-fixes
git push --force-with-lease origin main
```

To drop a single change instead, `git log --oneline` and revert just that
commit. The Apps Script side rolls back separately: Deploy → Manage
deployments → edit → pick the earlier version.

Rolling back the site while the new `Code.gs` stays deployed is safe. The
old bundle does not call the new actions.
