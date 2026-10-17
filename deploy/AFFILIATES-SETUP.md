# Ezzo Hub partner program

The affiliate program is built into the site. It runs on your Apps Script (`Code.gs`), the analytics spreadsheet and Dodo Payments. There is no third-party service and no monthly fee.

You control everything from **Admin, then Affiliates**:

| Section | What you do there |
|---|---|
| **Analytics** | See clicks, referrals, sales, commission, conversion, average order, commission per click, return on spend, cost per customer, and tracking type, filtered by program and partner. |
| **Programs** | Create, edit, switch off, delete and pick the default. Each program has these settings: commission (percent or flat $), buyer discount, link window, hold, approval mode (automatic or you approve each), minimum payout, automatic tiers (by sales or revenue) and a second-tier rate. |
| **Partners** | Review applications (and choose their program when you approve), or add a partner yourself. You can also: <br>• edit details, the program and a custom rate <br>• set payout method and bank details <br>• manage coupons (any number, each with its own %, usage limit and expiry) <br>• view their dashboard read-only <br>• send a sign-in link <br>• pause, delete or reinstate them |
| **Referrals** | See every credited sale with buyer, risk flags and status. You can: <br>• approve, deny or restore them, singly or in bulk <br>• edit the commission <br>• move a referral to another partner <br>• add one by hand (for example when a buyer forgot the code) <br>• export to CSV |
| **Payments** | **Ready to pay** is grouped per partner. Choose which referrals to include, the method, the date and the payment reference, and pay below the minimum if you want to. There is also a PayPal payouts CSV. **Paid** is the history: each payout shows its referrals, and you can edit or undo it. |
| **Settings** | Open or close applications, auto-approve, which program applicants join, the payout schedule, email notifications, and self-referral blocking. |

## Verifying payouts

Every payout records three things:

- the reference you enter (for example the PayPal transaction id);
- the date;
- where the money went, as it stood at the time.

The partner gets an email receipt and presses **"I received it"** in their dashboard. You see **✓ Confirmed (date)** or **Waiting for partner** next to each payout, and there's a filter for unconfirmed ones. If you recorded a payout by mistake, **Undo** puts its referrals back to "Ready to pay".

## Switch it on (once)

1. **Paste the code:** replace everything in Apps Script with the latest `Code.gs`, then save.
2. **Run setup:** run **setupAffiliates** and allow the email permission. It creates these sheets:
   - Affiliates
   - AffPrograms (with a "Standard" program to start)
   - AffCoupons
   - AffClicks
   - AffEvents
   - Commissions
   - Payouts
   - AffSettings
3. **Add your Dodo key:** in Script Properties, add `DODO_API_KEY` with your **live** Dodo API key. Coupons are created and updated in Dodo through it. Without it:
   - links still track and pay;
   - coupons wait as "Waiting for API key", and you turn them on once the key is added.
4. **Deploy:** go to Deploy, then Manage deployments, then edit, then **New version**, then Deploy. Then pull the site on the server.

## Rules the system applies

- **Who gets credit:** a partner's coupon always wins. Otherwise the latest partner link inside that partner's program window gets the sale.
- **How commission is worked out:** it's calculated on what reached you, after tax and the buyer's discount. A partner's custom rate beats their program's rate and tiers. Tiers apply as soon as a threshold is passed.
- **Program switched off:** its partners earn on the default program's terms until it's back on. If you delete a program, its partners move to the default.
- **Hold and approval:**
  - Automatic programs: a referral is ready to pay when its hold ends.
  - Manual programs: a referral shows "Needs approval" after the hold, until you approve it.
  - You can approve early at any time.
- **Refunds:**
  - A refund inside the hold cancels the commission, or takes its share for a partial refund.
  - A refund after payout creates a clawback, which is deducted from the partner's next payout.
- **Self-referrals and duplicates:** self-referrals earn nothing (if blocking is on, which it is by default). Webhook retries are never credited twice.
- **Removing a partner:** pausing or deleting them stops their link and coupons. Their history and payouts are kept.
- **Privacy:** partners never see buyer details.

## Testing it live

1. Add a test partner yourself, under Partners, then **Add partner**, using a second email address of yours.
2. Open `ezzohub.com/?ref=THEIRCODE` in a private window.
3. Buy with a 100% Dodo test code.

Then check these, in order:

1. Referrals shows the sale.
2. Approve it (or wait out the hold).
3. Payments: record the payout.
4. Confirm it from the partner's dashboard: open it with **View as partner**, or sign in as them.
