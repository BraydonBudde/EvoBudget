# Ezzo Hub partner program

The affiliate program is built into the site. There's no third-party service and no monthly fee. It runs on:

- the Apps Script you already have (`Code.gs`),
- the analytics spreadsheet,
- Dodo Payments.

## Switch it on (once)

1. **Apps Script:** replace everything with the latest `Code.gs` and save.
2. **Run `setupAffiliates`:** pick it in the function menu, press **Run**, and allow the permissions it asks for. The new one is sending email, used for sign-in links, welcomes, sale alerts and payout receipts. This creates six sheets: Affiliates, AffClicks, AffEvents, Commissions, Payouts and AffSettings.
3. **Recommended:** go to Project Settings, then Script Properties, and add `DODO_API_KEY` with your **live** Dodo API key. With it:
   - each approved partner gets their own discount code in Dodo;
   - checkouts from a partner link open with that code already applied.

   Without it, links still track and pay, but partners have no code.
4. **Deploy:** Deploy, then Manage deployments, then edit the current deployment, then **New version**, then Deploy. The URL stays the same.
5. Pull the site on the server as usual.

## How it works

| | |
|---|---|
| Partner page | `ezzohub.com/partners`: pitch, earnings calculator, application form, terms, and each partner's dashboard (email-link sign-in, no passwords) |
| Links | `ezzohub.com/?ref=CODE` (any page; `&sub=tag` for campaign tags) |
| Credit | The partner's discount code wins. Otherwise the latest partner link inside the link window gets the sale. |
| Commission | 30% of what reaches you (after tax and the buyer's discount). 35% after 10 lifetime sales. Optional second tier (off by default). |
| Hold | 30 days, then the commission is "ready". A refund inside the hold cancels it (a partial refund cancels its share). A refund after payout is clawed back from the next payout. |
| Protection | Self-referrals earn nothing. Clicks are counted once per visitor per day. Unknown or paused codes are ignored. Admin actions are verified against your Google sign-in. |
| Payouts | Admin, then Affiliates, then **Payouts due**. Pay in PayPal (the CSV is in PayPal's payouts format) or Wise, then press **Mark paid**. The partner gets an itemised email. |

All rates, the discount, the windows, the minimum payout, auto-approval and opening or closing applications are under Admin, then Affiliates, then **Program settings**. Changes only apply to new commissions.

## Testing it live

1. Approve a test partner, using your own second email address.
2. Open `ezzohub.com/?ref=THEIRCODE` in a private window.
3. Buy using the 100% test discount approach from the Dodo go-live test.

Purchases made with the partner's own email are rejected as self-referrals, so use a different email for the purchase.
