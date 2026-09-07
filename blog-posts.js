// ══════════════════════════════════════════════════════════════════════
// Seeded blog posts.
//
// These ship with the site rather than living in the Blogs sheet, so the
// blog is never empty and never blank while a network call is in flight.
// Posts written in the admin are stored in the sheet and merged on top of
// these at render time (see blog.js). A sheet post with the same slug wins,
// which is what makes these editable from the admin too.
//
// English only, deliberately. The apps are translated; the blog is not.
// ══════════════════════════════════════════════════════════════════════

const BLOG_CATEGORIES = [
  { id: 'basics',   label: 'Budgeting Basics' },
  { id: 'debt',     label: 'Debt Payoff' },
  { id: 'saving',   label: 'Saving & Challenges' },
  { id: 'reallife', label: 'Real-Life Budgets' }
];

// The tool a post belongs to. Only tools that actually have posts show up as
// filters, so the rest of the hub's roadmap can be listed here early without
// putting empty tabs in front of readers.
const BLOG_TOOLS = [
  { id: 'budget',  label: 'Ezzo Budget' },
  { id: 'tasks',   label: 'Task Planner' },
  { id: 'habits',  label: 'Habit Tracker' },
  { id: 'wedding', label: 'Wedding Planner' },
  { id: 'meals',   label: 'Meal Planner' },
  { id: 'fitness', label: 'Fitness Planner' }
];

const BLOG_POSTS = [
{
  slug: 'stop-living-paycheck-to-paycheck',
  title: 'Stop Living Paycheck to Paycheck With This One Budgeting Rule',
  excerpt: 'Most budgets fail for the same boring reason: the money that has no job disappears. Zero-based budgeting fixes that, and it takes about twenty minutes.',
  category: 'basics',
  tool: 'budget',
  tags: ['zero-based budgeting', 'paycheck to paycheck', 'budgeting for beginners'],
  date: '2026-01-12',
  readMinutes: 7,
  image: 'blog/zero-based-budget.jpg',
  imageAlt: 'A container filled exactly to the brim with stacked bars, labelled zero dollars left',
  featured: true,
  body: `
<p>There's a specific kind of confusion that comes about four days before payday. You look at your balance, you look at what's still due, and you genuinely cannot account for where the month went. You didn't buy anything wild. You just... spent it.</p>

<p>If that's familiar, the problem almost certainly isn't discipline. It's that your money never had instructions.</p>

<h2>Why most budgets quietly fail</h2>

<p>The typical budget is a list of bills and a vague sense that whatever's left is "spending money". That leftover pile is the whole problem. It has no name, no limit, and no owner, so it behaves exactly like unclaimed money always behaves: it evaporates, in £6 and £14 increments, and nobody can point to the moment it happened.</p>

<p>Tracking alone doesn't fix this either. Plenty of people can tell you precisely what they spent last month and still have nothing saved. Knowing where it went after the fact is a receipt, not a plan.</p>

<h2>The rule: give every single unit of money a job</h2>

<p>Zero-based budgeting is one sentence. <strong>Income minus every assignment equals zero.</strong></p>

<p>Not zero in your bank account. Zero <em>unassigned</em>. Every pound or dollar that lands gets pointed at something before you spend any of it: rent, groceries, the car insurance that's due in March, a night out, savings, debt. When you're done, there is no leftover pile, because there's no such category.</p>

<p>Say £2,400 comes in. You might assign £900 to rent, £420 to groceries, £180 to transport, £95 to utilities, £60 to phone and internet, £200 to a debt payment, £150 to an emergency fund, £120 to a car-insurance pot, £75 to eating out, £50 to a birthday coming up, £100 to "whatever", and £50 to a buffer. Add it up: £2,400. Nothing floating.</p>

<p>The interesting part is what "whatever" becomes. It used to be an unbounded pile. Now it's £100, it's on the page next to everything else, and when it's gone you know it's gone. That single change does more for spending than any amount of willpower.</p>

<div class="bp-callout">
  <strong>The most common mistake:</strong> budgeting your <em>ideal</em> month instead of your real one. If you spent £510 on groceries last month, don't write £300 and call it a plan. Write £480 and mean it. A budget you break in week one teaches you that budgets don't work.
</div>

<h2>How to actually do it in twenty minutes</h2>

<ol>
  <li><strong>Write down what actually arrives.</strong> Take-home pay, not salary. If your income moves around, use your lowest recent month, and read <a href="/blog?p=budgeting-on-irregular-income">the irregular income guide</a> instead of this list.</li>
  <li><strong>List the bills that don't negotiate.</strong> Rent or mortgage, utilities, insurance, minimum debt payments, childcare. These go first because they're going to happen whether you plan for them or not.</li>
  <li><strong>Look up the last three months of your variable spending.</strong> Groceries, fuel, eating out, shopping. Take a real average. This is the step people skip, and it's the step that decides whether the budget survives.</li>
  <li><strong>Add the things you know are coming.</strong> The MOT, Christmas, the annual subscription, the wedding you're invited to. These are what <a href="/blog?p=sinking-funds-explained">sinking funds</a> are for, and they're the single biggest reason "unexpected" expenses aren't actually unexpected.</li>
  <li><strong>Assign what's left</strong> to savings, debt, and genuinely fun spending, until you hit zero.</li>
</ol>

<h2>What happens in week two</h2>

<p>You will go over on something. Everybody does. Groceries come in £40 high, or a friend has a birthday you forgot about.</p>

<p>This is the moment that separates people who budget from people who used to budget. The correct move is not to abandon the month. It's to move £40 from somewhere else, out loud, on purpose. Take it from eating out, or from the "whatever" line, or from savings if you have to. The budget still balances. You just made a decision instead of discovering one later.</p>

<p>That's the whole skill, honestly. Zero-based budgeting isn't about restriction. It's about making the trade-off visible while you can still choose.</p>

<h2>Where a spreadsheet starts to hurt</h2>

<p>You can do all of this on paper, and for a couple of months it's fine. It gets tedious around the point where you're re-typing the same twenty categories every month, recalculating what's left after every purchase, and trying to remember whether you already logged that coffee.</p>

<p>That's the job <a href="/budgetplanner">Ezzo Budget's Simple Budget Planner</a> does. You set your categories and expected amounts once, log transactions as they happen, and it shows you the gap between planned and actual per category, live. The "how much is left in groceries" question you'd otherwise be answering with mental arithmetic in a supermarket aisle becomes a number you can look at. One payment, no subscription, and there's a free version so you can see whether the method suits you before you spend anything.</p>

<p>If your money situation has more moving parts (debt across several cards, sinking funds, subscriptions you've lost track of, an irregular income) the <a href="/ultimate-budget">Ultimate Budget Planner</a> adds the debt payoff calculator, sinking fund tracker, subscription tracker and calendar view on top of the same core.</p>

<h2>Give it two months, not two weeks</h2>

<p>The first month is always messy, because it's really a measurement exercise disguised as a budget. You find out what things actually cost. The second month is where the numbers start matching reality, and it stops feeling like an experiment.</p>

<p>If a zero-based approach sounds like more structure than you want right now, the <a href="/blog?p=50-30-20-rule">50/30/20 rule</a> is a much looser starting point that takes about fifteen minutes. If one or two categories keep beating you no matter what the plan says, <a href="/blog?p=cash-stuffing-vs-digital-budgeting">cash envelopes for just those categories</a> are worth a look. And if the thing you actually need is a hard reset rather than a system, <a href="/blog?p=30-day-no-spend-challenge">a 30-day no-spend challenge</a> is a faster way to break the pattern.</p>
`,
  related: ['50-30-20-rule', 'sinking-funds-explained', 'budgeting-on-irregular-income']
},

{
  slug: 'debt-snowball-vs-avalanche',
  title: 'Debt Snowball or Avalanche? The Math Behind Becoming Debt-Free Faster',
  excerpt: 'One method saves you the most interest. The other is the one people actually finish. Here is the real difference, with the numbers worked through.',
  category: 'debt',
  tool: 'budget',
  tags: ['debt snowball', 'debt avalanche', 'pay off debt', 'debt payoff strategy'],
  date: '2026-01-19',
  readMinutes: 8,
  image: 'blog/debt-snowball-avalanche.jpg',
  imageAlt: 'Two payoff curves rising toward a debt-free marker, one labelled snowball and one avalanche',
  featured: true,
  body: `
<p>Every debt payoff argument online eventually becomes the same argument. One camp says avalanche, because it's mathematically optimal. The other says snowball, because math isn't what makes people stick with it.</p>

<p>They're both right, which is annoying but useful. Let's do the actual numbers, then talk about which one you'll finish.</p>

<h2>The two methods in one paragraph each</h2>

<p><strong>Debt avalanche:</strong> pay minimums on everything, then throw every spare pound at the debt with the <em>highest interest rate</em>. When it's gone, roll that whole payment into the next-highest rate. You pay the least interest possible.</p>

<p><strong>Debt snowball:</strong> pay minimums on everything, then throw every spare pound at the <em>smallest balance</em>, regardless of rate. When it's gone, roll that payment into the next smallest. You clear individual debts fastest.</p>

<p>Same discipline, same spare cash, different queue order. That's genuinely the only difference.</p>

<h2>What the difference actually costs</h2>

<p>Take a realistic mix:</p>

<ul>
  <li>Credit card A: £6,200 at 22.9%, minimum £155</li>
  <li>Credit card B: £980 at 19.9%, minimum £25</li>
  <li>Car loan: £4,400 at 6.4%, minimum £190</li>
  <li>Store card: £430 at 29.9%, minimum £15</li>
</ul>

<p>Minimums total £385. Say you can find £300 a month on top of that.</p>

<p>With <strong>avalanche</strong>, you attack the store card first (29.9%), then card A (22.9%), then card B (19.9%), then the car loan. You're debt-free in roughly 25 months and pay about £2,050 in interest.</p>

<p>With <strong>snowball</strong>, you attack the store card first (it's also the smallest, conveniently), then card B (£980), then the car loan, then card A. Roughly 26 months, about £2,330 in interest.</p>

<p>So the avalanche saves you around £280 and about a month. On £12,000 of debt. Over two years.</p>

<p>That's the number nobody quotes, because it undercuts both sides. Avalanche <em>is</em> better. It's just rarely better by enough to matter more than whether you keep going.</p>

<div class="bp-callout">
  <strong>When the gap gets big:</strong> the avalanche pulls meaningfully ahead when your rates are far apart <em>and</em> your highest-rate debt is also one of your largest. A £9,000 card at 27% next to a £600 loan at 4% is a case where the order genuinely costs you real money. Run both before you assume it's a rounding error.
</div>

<h2>The part the math misses</h2>

<p>Here's what the spreadsheets don't model: clearing a debt entirely feels different from reducing one.</p>

<p>Watching a £6,200 balance drop to £5,900 in a month is technically excellent progress and emotionally almost nothing. Watching a £430 store card hit zero and closing it is a completed thing. You get a payment back. The list gets shorter. There's one fewer statement in your inbox.</p>

<p>The research bears this out, uncomfortably for the math camp: people on snowball plans are measurably more likely to still be on them a year later. A method you abandon in month seven costs you infinitely more than £280.</p>

<h2>So which one should you pick?</h2>

<p>A reasonable way to decide, in order:</p>

<ol>
  <li><strong>Have you tried and stalled before?</strong> Snowball. You need wins on the board more than you need optimal interest.</li>
  <li><strong>Is one debt at a punishing rate and also large?</strong> Avalanche. Run the numbers first, but this is where the gap gets real.</li>
  <li><strong>Are your rates all fairly similar?</strong> Snowball, because you're giving up almost nothing to get the motivational benefit.</li>
  <li><strong>Do you find spreadsheets genuinely satisfying?</strong> Avalanche. You're the person who'll stick with it, and you may as well have the extra £280.</li>
</ol>

<p>There's also a hybrid that works well in practice: clear anything under about £500 first to shorten the list, then switch to strict avalanche for everything above it. You get two or three quick wins and then the efficient ordering for the bulk of the money.</p>

<h2>The thing that matters more than the method</h2>

<p>Both plans depend on one number: how much you can put in above the minimums. Change the method and you save a few hundred pounds. Change that number from £300 to £450 and you finish the whole thing seven months earlier.</p>

<p>That's why debt payoff is really a budgeting problem wearing a costume. Finding another £150 a month is the actual work, and it usually comes from three places: <a href="/blog?p=subscription-audit">subscriptions you forgot you had</a>, food spending that drifted, and expenses you didn't plan for and put on a card, which is what <a href="/blog?p=sinking-funds-explained">sinking funds</a> exist to prevent.</p>

<p>If you don't have a working budget underneath the payoff plan, start with <a href="/blog?p=stop-living-paycheck-to-paycheck">giving every pound a job</a>. Debt payoff without a budget is just optimism with a spreadsheet.</p>

<h2>Seeing it laid out</h2>

<p>The <a href="/ultimate-budget">Ultimate Budget Planner</a> has the debt payoff calculator built in: enter your balances, rates and minimums, put in what you can add on top, and it shows you both strategies side by side with your actual payoff date and total interest for each. Rather than trusting the example above, you get your own numbers, which is the only version that should decide anything. It also tracks the payments against your budget as you make them, so the plan and the reality stay in the same place.</p>

<p>Whichever you pick, pick one this week and start. The ordering debate has cost more people more money than the ordering ever did.</p>
`,
  related: ['stop-living-paycheck-to-paycheck', 'subscription-audit', 'sinking-funds-explained']
},

{
  slug: '30-day-no-spend-challenge',
  title: 'The 30-Day No-Spend Challenge: Reset Your Finances Fast',
  excerpt: 'A no-spend month is not about deprivation. It is a diagnostic. Here is how to run one that you finish, and what to do with what it teaches you.',
  category: 'saving',
  tool: 'budget',
  tags: ['no spend challenge', 'no spend month', 'save money fast', 'spending reset'],
  date: '2026-01-26',
  readMinutes: 7,
  image: 'blog/no-spend-challenge.jpg',
  imageAlt: 'A grid of thirty day-squares with most of them ticked off',
  body: `
<p>The pitch for a no-spend month is usually about how much you'll save. That's the least interesting part.</p>

<p>The valuable part is that a no-spend month is the only reliable way to find out which of your spending is a decision and which is just a habit with a direct debit attached. You cannot find that out by reading your statements, because your statements look reasonable. Every individual purchase looks reasonable. That's the trap.</p>

<h2>What "no spend" actually means</h2>

<p>Not literally nothing. You still pay rent, bills, insurance, debt minimums, fuel to get to work, and groceries. If you try to stop those, you'll fail on day three and conclude you're bad with money, which is both wrong and expensive.</p>

<p>The line is between <strong>essential</strong> and <strong>discretionary</strong>, and you draw it yourself, in writing, before you start. A workable default:</p>

<p><strong>Still allowed:</strong> housing, utilities, insurance, minimum debt payments, groceries (from a list), commuting costs, medicine, anything genuinely urgent.</p>

<p><strong>Paused for 30 days:</strong> takeaways and restaurants, coffee out, clothes, books, games, gadgets, home bits you don't need, subscriptions you can pause, alcohol, taxis when a bus exists, anything bought at 11pm on your phone.</p>

<p>Write both lists down. Ambiguity is what kills these, because every purchase can be argued into the essential column at the moment you want it.</p>

<h2>Decide the exceptions in advance</h2>

<p>Real life doesn't pause for 30 days. Someone will have a birthday. There will be a wedding, or a leaving do, or a friend visiting from out of town.</p>

<p>Write your exceptions on day zero with a budget attached: "Sam's birthday, £30 for a gift, and I'm going to the dinner but not the drinks after." Decided in advance, that's a plan. Decided in the moment, it's the crack that the whole thing leaks out of.</p>

<div class="bp-callout">
  <strong>Rule of thumb:</strong> two or three planned exceptions with a number next to them is a successful no-spend month. Zero exceptions is a fantasy, and unlimited exceptions is just a normal month with extra guilt.
</div>

<h2>The four weeks, roughly</h2>

<p><strong>Week one is easy.</strong> Novelty carries you. You'll feel slightly smug. Enjoy it, it doesn't last.</p>

<p><strong>Week two is where it gets real.</strong> This is when you notice how much of your spending was doing a job that wasn't shopping: killing twenty minutes, marking the end of a hard day, avoiding cooking when you're tired. You have to actually deal with the tired-and-hungry-at-6pm problem instead of paying £22 to make it go away. Batch cooking on Sunday sounds like advice from a magazine, and it is, but it's also the single thing that keeps most people in the game.</p>

<p><strong>Week three is quiet.</strong> The urge genuinely fades. Most people report this and most people don't believe it beforehand.</p>

<p><strong>Week four you start planning what you'll buy after.</strong> Pay attention here, because two-thirds of that list will have lost its appeal by the time you're allowed to buy it. That's the actual finding of the whole exercise.</p>

<h2>Track it, or it didn't happen</h2>

<p>Keep a running total of what you'd normally have spent and didn't. Not to feel virtuous, but because the number at the end has to go somewhere specific or it'll drift back into ordinary spending in week five.</p>

<p>Decide the destination now: straight onto a card balance (see <a href="/blog?p=debt-snowball-vs-avalanche">snowball vs avalanche</a> for which one), into <a href="/blog?p=emergency-fund-when-money-is-tight">an emergency fund</a>, or into <a href="/blog?p=sinking-funds-explained">a sinking fund</a> for something you know is coming. Money without a destination goes back where it came from.</p>

<p>This is where having somewhere to log the month helps. In <a href="/budgetplanner">Ezzo Budget</a> you can set your discretionary categories to zero for the month and watch them stay at zero, which turns out to be weirdly motivating, and the transaction list gives you an honest record of the exceptions you did make rather than the ones you remember making. There's a free version, which is the sensible way to try this.</p>

<h2>The week after is the whole point</h2>

<p>Most people treat the end of a no-spend month like the end of a diet, and spend three weeks' worth of savings in four days. Then the takeaway is "no-spend months don't work", when what actually happened is that nothing changed structurally.</p>

<p>Do this instead. Take your paused list and sort it into three piles: things you genuinely missed, things you didn't miss at all, and things you'd forgotten existed. Cancel or shrink everything in piles two and three, permanently. Then build the first pile back into your budget as real, named, funded categories, because those are the things worth spending on.</p>

<p>That's a no-spend month that pays for years rather than one month. The £600 you saved is nice. The £90 a month you never spend again is the actual prize.</p>

<p>If you want a structure to put those findings into afterwards, <a href="/blog?p=stop-living-paycheck-to-paycheck">zero-based budgeting</a> is the natural next step, and <a href="/blog?p=subscription-audit">a subscription audit</a> is the fastest way to lock in pile two.</p>
`,
  related: ['emergency-fund-when-money-is-tight', 'subscription-audit', 'stop-living-paycheck-to-paycheck']
},

{
  slug: '50-30-20-rule',
  title: 'How to Budget Your Money in 15 Minutes Using the 50/30/20 Rule',
  excerpt: 'The simplest budgeting method that still works. Three numbers, fifteen minutes, and no tracking every coffee. Here is how to set it up and when it breaks.',
  category: 'basics',
  tool: 'budget',
  tags: ['50/30/20 rule', 'easy budgeting', 'budgeting method', 'budget for beginners'],
  date: '2026-02-02',
  readMinutes: 6,
  image: 'blog/fifty-thirty-twenty.jpg',
  imageAlt: 'A ring chart split into fifty percent needs, thirty percent wants and twenty percent savings',
  featured: true,
  body: `
<p>If detailed budgeting has never stuck for you, the problem might not be you. Some methods ask for a level of admin that only suits people who enjoy admin.</p>

<p>The 50/30/20 rule is the opposite. Three buckets, one setup session, and no obligation to categorise every purchase for the rest of your life.</p>

<h2>The rule</h2>

<p>Take your take-home pay, after tax. Split it:</p>

<ul>
  <li><strong>50% needs.</strong> Rent or mortgage, utilities, groceries, transport to work, insurance, minimum debt payments, childcare. Things that have consequences if you stop paying them.</li>
  <li><strong>30% wants.</strong> Eating out, streaming, hobbies, clothes beyond necessity, holidays, the nice coffee. Things that make life good but not possible.</li>
  <li><strong>20% savings and extra debt payments.</strong> Emergency fund, pension top-ups, investments, and anything you're paying above the minimum on debt.</li>
</ul>

<p>On £2,600 a month that's £1,300, £780 and £520. That's the entire method.</p>

<h2>Why it works when detailed budgets don't</h2>

<p>Because it moves the decision to the start of the month instead of to every purchase.</p>

<p>A category-by-category budget asks you to make a judgement call every time you buy something: is this groceries or is this treats? Does the meal deal count? A 50/30/20 budget asks you three questions once and then leaves you alone. If your wants money is there, spend it on whatever you like, in whatever proportion, guilt free. That last part matters more than it sounds. Guilt is what makes people stop looking at their money altogether.</p>

<div class="bp-callout">
  <strong>Set the 20% up first and automate it.</strong> Move it out on payday, before anything else. If it sits in your current account waiting for the end of the month, it will not be there at the end of the month. This one step does more than the other two combined.
</div>

<h2>Where it breaks</h2>

<p>Be honest about this, because plenty of guides aren't.</p>

<p><strong>If your rent is 45% of your income on its own,</strong> the 50% needs bucket is fiction. In expensive cities this is extremely common. The rule still helps as a diagnostic (it tells you loudly that housing is eating your plan) but you'll need to run something like 65/20/15 and treat getting back toward 50 as a medium-term goal rather than a monthly failure.</p>

<p><strong>If your income moves around,</strong> percentages of a number that changes every month are hard to act on. <a href="/blog?p=budgeting-on-irregular-income">Budgeting on an irregular income</a> covers the version that works: pay yourself a fixed salary from a buffer account and apply the percentages to that.</p>

<p><strong>If you're carrying high-interest debt,</strong> 20% split between saving and debt is too gentle. Get a small emergency buffer in place, then push much harder at the debt for a while. <a href="/blog?p=debt-snowball-vs-avalanche">Snowball or avalanche</a> walks through which order and what the difference actually costs.</p>

<p><strong>If you keep overspending the wants bucket,</strong> 30% in one undifferentiated pile might be too loose for you. That's a real signal, not a failure. Two ways out: name the categories properly with <a href="/blog?p=stop-living-paycheck-to-paycheck">zero-based budgeting</a>, or take the wants money out as cash so it physically runs out. <a href="/blog?p=cash-stuffing-vs-digital-budgeting">Cash stuffing versus digital</a> weighs up whether that second option is worth the hassle.</p>

<h2>Setting it up in fifteen minutes</h2>

<ol>
  <li><strong>Find your real take-home.</strong> Look at what actually hit your account last month, not your salary.</li>
  <li><strong>Add up your needs.</strong> Go through the last statement and pull out everything with consequences. You'll be either relieved or alarmed. Both are useful.</li>
  <li><strong>Do the three sums.</strong> Multiply by 0.5, 0.3, 0.2.</li>
  <li><strong>Set up the standing order for the 20%</strong> on the day after payday. Do this now, not later.</li>
  <li><strong>Compare needs to the 50% figure</strong> and adjust the split to something honest if it doesn't fit.</li>
</ol>

<p>That's it. You can stop there and be meaningfully better off than you were.</p>

<h2>Making it stick without daily tracking</h2>

<p>The one weakness of a three-bucket budget is that "am I still inside my wants budget?" is genuinely hard to answer from a bank app, because your bank doesn't know which of your transactions were wants.</p>

<p>Set the three buckets as categories in <a href="/budgetplanner">Ezzo Budget's Simple Budget Planner</a>, put your monthly figure against each, and log transactions as they happen. It's about ten seconds per purchase and it gives you the one number that keeps this working: how much of the wants budget is left. No bank connection, no subscription, and free to try, so you can find out in a month whether the method suits you.</p>

<p>Then check in once a month. If a bucket is consistently wrong by more than about 10%, the bucket is wrong, not you. Adjust it.</p>

<p>50/30/20 is a starting point, not a destination. Plenty of people run it for a year, learn what their money actually does, and then graduate to something more detailed once the admin stops feeling like a chore. That's exactly the right way round.</p>
`,
  related: ['stop-living-paycheck-to-paycheck', 'budgeting-on-irregular-income', 'cash-stuffing-vs-digital-budgeting']
},

{
  slug: 'one-income-family-budget',
  title: 'How to Build a Bulletproof One-Income Family Budget',
  excerpt: 'Dropping to one income changes the maths and the margin for error. Here is how to build a budget that survives a bad month instead of one that only works on paper.',
  category: 'reallife',
  tool: 'budget',
  tags: ['one income family', 'single income budget', 'stay at home parent', 'family budget'],
  date: '2026-02-09',
  readMinutes: 8,
  image: 'blog/one-income-family.jpg',
  imageAlt: 'A single column holding up a roof over two figures',
  body: `
<p>Going from two incomes to one is rarely a slow, considered decision. It's a new baby and childcare costing more than a salary. It's a redundancy. It's someone going back to study, or a move, or a health thing.</p>

<p>Whatever got you here, the budgeting problem is the same: you haven't just lost income, you've lost your margin for error. On two incomes, a bad month gets absorbed. On one, it goes on a card.</p>

<p>So the goal isn't a tighter budget. It's a budget that expects bad months.</p>

<h2>Start with the floor, not the plan</h2>

<p>Before you decide what you'd like to spend, work out your <strong>survival number</strong>: the absolute minimum to keep the household running for one month. Housing, utilities, the cheapest realistic food shop, transport to work, insurance, minimum debt payments, medicine. Nothing else. Not a haircut, not a coffee, not a birthday.</p>

<p>You will probably never spend exactly this amount, and that's fine. It's not a budget. It's the number that tells you how long you can hold out, and it changes every decision after it. Once you know it's £1,850, "we have £3,700 in savings" stops being an abstract comfort and becomes "we have two months".</p>

<p>Write it on the fridge. Genuinely. On one income, everyone in the house needs to know it.</p>

<h2>Then build the real budget in three layers</h2>

<p>Rather than one flat list of categories, think in tiers, because that's how you'll actually cut when you need to.</p>

<p><strong>Tier one, the floor.</strong> The survival number above. Untouchable.</p>

<p><strong>Tier two, the things that keep life normal.</strong> Kids' activities, a modest eating-out line, clothes, haircuts, the odd day out. This is what makes a single-income household feel like a life rather than an endurance test, and it's also the tier you cut first in a bad month. Naming it in advance means that cutting it is a plan, not a crisis.</p>

<p><strong>Tier three, forward motion.</strong> Emergency fund, sinking funds, debt above minimums, pension. Counter-intuitively this goes <em>before</em> tier two in the payment order, because otherwise it never happens.</p>

<h2>The single-income emergency fund is different</h2>

<p>The usual advice is three to six months of expenses. On one income, aim for the higher end, and understand why: with two earners, one job loss cuts your income by roughly half. With one, it cuts it by all of it.</p>

<p>If that number feels absurd right now, it usually is at the start, and it's not a reason to skip it. <a href="/blog?p=emergency-fund-when-money-is-tight">Building an emergency fund when money is tight</a> covers the version that works, which starts at about £500 and grows in increments that don't hurt.</p>

<div class="bp-callout">
  <strong>The one that catches people out:</strong> on a single income, life insurance and income protection stop being optional paperwork and become part of the budget. If the household's entire income depends on one person's ability to work, that's the risk your emergency fund can't cover. It's usually cheaper than people assume, and it belongs in tier one.
</div>

<h2>The costs that ambush single-income households</h2>

<p>They're almost never dramatic. They're the predictable ones nobody set money aside for.</p>

<p>School uniform in August. Car tax and the MOT. Christmas. Birthdays, and on a family budget there are a lot of birthdays. The boiler service. New shoes because a child grew again.</p>

<p>None of these are emergencies. You know every one of them is coming. They only feel like emergencies because they arrive as a lump when the month has no slack in it. Setting aside £45 a month for Christmas from January is trivially easy; finding £540 in December is not. That's the entire argument for <a href="/blog?p=sinking-funds-explained">sinking funds</a>, and on one income they matter more than on two, because there's no second salary to absorb the hit.</p>

<h2>Both adults have to be in it</h2>

<p>This is the part that's genuinely harder than the maths, and most budgeting guides skip it.</p>

<p>When one person earns and one doesn't, budgets curdle into permission-seeking fast. The earner starts feeling responsible for every pound and the other starts feeling like they have to justify a £4 purchase. It breeds resentment in both directions and it's one of the more common ways single-income budgets fall apart.</p>

<p>Two things help. First, both people get personal spending money, the same amount, no questions asked, no matter who earned it. It can be small. £40 each is fine. The point is that it exists and it's equal. Second, run a proper budget meeting once a month, twenty minutes, both of you, looking at the same screen. Not a report from one to the other.</p>

<p>The household runs on both people's work. The budget should read that way.</p>

<h2>Keeping it in one place</h2>

<p>Single-income budgets have more moving parts than people expect: tiered categories, several sinking funds running at once, a survival number to check against, and two adults who both need to see it. That's exactly the point where a shared spreadsheet starts producing two versions of the truth.</p>

<p>The <a href="/ultimate-budget">Ultimate Budget Planner</a> handles this shape well: sinking funds tracked separately from your monthly categories so Christmas money doesn't look like spare money, a calendar view so you can see the uniform bill and the car tax landing in the same fortnight before it happens, and subscription tracking for the recurring costs that quietly accumulate. If you want to start simpler, the <a href="/budgetplanner">Simple Budget Planner</a> covers the tiers and the monthly categories on their own, and it's free to try.</p>

<h2>Expect the first three months to be wrong</h2>

<p>Your first single-income budget will be too optimistic. Everyone's is. You'll underestimate food and forget at least two annual bills.</p>

<p>That isn't failure, it's the measurement phase. Adjust at the end of each month rather than abandoning the whole thing, and by month three you'll have numbers that match reality. A budget that's honest and slightly uncomfortable beats one that's aspirational and gets ignored by the 14th.</p>

<p>If you want a method to hang this on, <a href="/blog?p=stop-living-paycheck-to-paycheck">zero-based budgeting</a> suits single-income households well, precisely because it refuses to let money sit around unassigned.</p>
`,
  related: ['sinking-funds-explained', 'emergency-fund-when-money-is-tight', 'stop-living-paycheck-to-paycheck']
},

{
  slug: 'cash-stuffing-vs-digital-budgeting',
  title: 'Digital Budgeting vs Cash Stuffing: Which Actually Stops Overspending?',
  excerpt: 'Cash stuffing works, and there is a real psychological reason why. It also has three problems nobody mentions. Here is an honest comparison.',
  category: 'basics',
  tool: 'budget',
  tags: ['cash stuffing', 'cash envelope system', 'digital budgeting', 'stop overspending'],
  date: '2026-02-16',
  readMinutes: 7,
  image: 'blog/cash-stuffing-vs-digital.jpg',
  imageAlt: 'A cash envelope on the left and a phone showing budget categories on the right',
  body: `
<p>Cash stuffing came back for a reason, and it isn't nostalgia. It's that handing over four £10 notes hurts in a way that tapping a card does not.</p>

<p>That's a real effect, it's well documented, and if you've ever wondered why your card spending feels frictionless in a way that's actively unhelpful, that's the mechanism. So let's take the method seriously rather than dismissing it as a trend, and then be honest about what it costs.</p>

<h2>What cash stuffing actually is</h2>

<p>You withdraw your spending money as cash, split it into labelled envelopes by category (groceries, fuel, eating out, fun), and that's the money. When the groceries envelope is empty, groceries are done until next month. There's no overdraft, no "I'll sort it out later", no discovering it on a statement three weeks after the fact.</p>

<p>The constraint is physical and immediate, which is exactly what makes it work.</p>

<h2>Why it genuinely works</h2>

<p><strong>The pain of paying is real.</strong> Watching the envelope thin out is information you get <em>before</em> the decision, not after it. Card spending inverts this: you find out at the end of the month, when it's already done.</p>

<p><strong>Running out is a hard stop.</strong> A digital budget can be exceeded. An empty envelope cannot. For anyone who habitually overspends in one specific category, that hard wall is the whole value.</p>

<p><strong>It's tangible.</strong> You handle the money. For a lot of people that makes the abstract concrete in a way no app manages.</p>

<h2>The three problems nobody puts in the videos</h2>

<p><strong>It doesn't cover most of your spending.</strong> Rent, utilities, insurance, subscriptions, the phone bill, direct debits, anything online: none of it can be paid from an envelope. Realistically cash stuffing covers your variable discretionary spending, which for most households is maybe 25 to 35% of the total. The other two thirds still needs a system, so you end up running two.</p>

<p><strong>Carrying and losing it.</strong> Several hundred pounds in envelopes is uninsured. Lost cash is gone, stolen cash is gone, and cash left at home while you're on holiday is a genuine worry. Cards have fraud protection, section 75, and chargebacks.</p>

<p><strong>There's no record.</strong> You know the envelope went from £400 to £110. You don't know what the £290 was. Which means you can't spot that your food shop has crept up £60 a month, or see any pattern over the year. You get control in the moment and lose all the information afterwards.</p>

<div class="bp-callout">
  <strong>The dealbreaker for a lot of people:</strong> cash stuffing requires a trip to a bank or cash machine every month, at a time when branches are closing and free ATMs are getting scarcer. If getting your cash out is a 25-minute errand, the method quietly stops happening around month four.
</div>

<h2>What digital budgeting does better</h2>

<p>It covers everything, including the two thirds of your spending that cash can't touch. It keeps the history, so you can see trends instead of guessing. It doesn't disappear if your bag does. And it handles the things cash physically cannot: annual bills, <a href="/blog?p=sinking-funds-explained">sinking funds</a> that grow over a year, <a href="/blog?p=debt-snowball-vs-avalanche">debt payoff plans</a> with interest calculations.</p>

<p>Its weakness is the mirror image of cash's strength: there's no hard wall. A digital budget tells you you've spent £430 of your £400 grocery budget. It cannot stop you.</p>

<p>Which is why the "check it before you spend, not after" habit matters so much digitally. If you only look at your budget at the end of the month, you've built a reporting tool, not a budget.</p>

<h2>The version most people should actually run</h2>

<p>Not one or the other. Cash for the one or two categories where you genuinely overspend, digital for everything else.</p>

<p>For most people that's eating out and general "stuff". Take those two as cash, keep everything else digital. You get the hard wall exactly where you need it and full coverage plus history everywhere else. It's also far less admin than full cash stuffing, which is the main reason people stick with it.</p>

<p>If you've been doing full cash stuffing and it's wearing thin, this is usually the honest upgrade: keep the two envelopes that are doing real work, and stop hauling £600 around in a folder.</p>

<h2>Making the digital side hold the line</h2>

<p>The digital half only works if the remaining-in-category number is genuinely easy to see. If checking it takes four taps and a login, you won't do it in the shop, and that's the moment it needed to work.</p>

<p><a href="/budgetplanner">Ezzo Budget</a> is built around that number: set an expected amount per category, log spending as it happens, and every category shows planned against actual with what's left. There's no bank connection to set up and nothing to log into every time, which sounds minor until you compare it to the alternative at a till. It's free to try, so you can see whether the digital half holds up for you before committing.</p>

<p>If you want the envelope feel with the digital record, the <a href="/ultimate-budget">Ultimate Budget Planner</a> adds allocation tagging, so every bit of spending gets tagged to a bucket. It's the closest digital equivalent to physically taking money out of a specific envelope, with the history intact.</p>

<h2>The honest answer</h2>

<p>Cash stuffing stops overspending better in the specific categories it covers. Digital budgeting covers your actual financial life and tells you what happened.</p>

<p>If you're choosing one, choose digital, then add cash envelopes for the two categories that keep beating you. That's the combination that survives contact with a real month.</p>

<p>Whichever you pick, the method underneath matters more than the medium. <a href="/blog?p=stop-living-paycheck-to-paycheck">Zero-based budgeting</a> works in cash or on a screen, and <a href="/blog?p=50-30-20-rule">50/30/20</a> is a gentler place to start if either sounds like a lot.</p>
`,
  related: ['stop-living-paycheck-to-paycheck', '50-30-20-rule', 'subscription-audit']
},

{
  slug: 'sinking-funds-explained',
  title: 'Sinking Funds: The Fix for Every Bill That "Comes Out of Nowhere"',
  excerpt: 'Christmas is not an emergency. Neither is the MOT. Sinking funds turn the expenses you already know about into a monthly number that does not hurt.',
  category: 'saving',
  tool: 'budget',
  tags: ['sinking funds', 'annual expenses', 'save for christmas', 'budgeting system'],
  date: '2026-02-23',
  readMinutes: 6,
  image: 'blog/sinking-funds.jpg',
  imageAlt: 'Three jars filling at different levels',
  body: `
<p>Think about the last time your budget got wrecked. Odds are it wasn't a genuine emergency. It was the car service. Or Christmas. Or the insurance renewal, or a wedding you'd known about for eight months.</p>

<p>None of those are surprises. They only behave like surprises because they arrive as one lump in a month that was planned as though they didn't exist.</p>

<p>A sinking fund is the fix, and it's almost insultingly simple.</p>

<h2>The idea</h2>

<p>Take a known future expense, divide it by the months until it's due, and save that amount every month. When the bill arrives, the money is already there.</p>

<p>Car insurance of £720 due in nine months is £80 a month. Christmas at £600 is £50 a month from January. A £400 MOT and service due in five months is £80 a month.</p>

<p>That's the whole method. The reason it's transformative isn't the maths, it's that it moves the expense from the month it lands to the months in between, where you can actually absorb it.</p>

<h2>Why this isn't your emergency fund</h2>

<p>People conflate these constantly, and it matters.</p>

<p>An <a href="/blog?p=emergency-fund-when-money-is-tight">emergency fund</a> is for things you genuinely cannot predict: a job loss, a boiler dying, a trip to a vet at 2am. It sits there, ideally untouched, for years.</p>

<p>A sinking fund is for things you can predict precisely. It's spent, on purpose, on a known date, and then it starts filling again.</p>

<p>Keep them separate. If Christmas comes out of your emergency fund, you have no emergency fund in January, which is a genuinely bad month to have no emergency fund.</p>

<h2>What to have funds for</h2>

<p>Go through a full year and pull out everything that isn't monthly. The usual suspects:</p>

<ul>
  <li><strong>Car:</strong> insurance, tax, MOT, service, tyres. Tyres are the one everyone forgets, and they're £400.</li>
  <li><strong>Christmas and birthdays.</strong> Not just December. Add up a year of birthdays and it's often more than Christmas.</li>
  <li><strong>Annual subscriptions and renewals.</strong> Which is a good moment to check you still want them, see <a href="/blog?p=subscription-audit">the subscription audit</a>.</li>
  <li><strong>Home:</strong> boiler service, repairs, the appliance that's clearly on borrowed time.</li>
  <li><strong>Holidays,</strong> including the costs that aren't the flights.</li>
  <li><strong>Kids:</strong> uniform, school trips, clubs restarting in September.</li>
  <li><strong>Health and dental,</strong> including the pet.</li>
</ul>

<div class="bp-callout">
  <strong>Start with three, not fifteen.</strong> The temptation is to create a fund for everything at once, which produces a monthly total you can't afford and a system you abandon in six weeks. Pick the three that have hurt you most in the last two years. Add more once those are running.
</div>

<h2>Where to keep the money</h2>

<p>Not in your current account. It'll get spent, not maliciously, just because it's there and it looks like available balance.</p>

<p>One separate savings account for all your sinking funds is enough, as long as you track the balances separately. You don't need eight accounts. You need one account and an honest ledger of what portion belongs to which fund, because "I have £1,400 saved" is a very different statement from "I have £1,400 saved, of which £600 is Christmas, £480 is car insurance and £320 is the boiler".</p>

<p>That distinction is exactly where sinking funds fall apart on a spreadsheet, and it's why the <a href="/ultimate-budget">Ultimate Budget Planner</a> tracks them as their own thing rather than as budget categories. You set a target and a due date, it works out the monthly contribution, and it shows each fund's progress separately from your spending money. So the answer to "can I afford this?" doesn't accidentally include next December's presents.</p>

<h2>Doing the sum honestly</h2>

<p>Add up every fund's monthly contribution. If your car costs £110 a month in funds, Christmas is £50, home repairs are £60 and holidays are £100, that's £320 a month before you've bought a single thing.</p>

<p>That number is usually a shock. It's also the truth, and it was always the truth. You were paying it before, just erratically and often on a credit card at 22%.</p>

<p>If £320 doesn't fit, don't abandon the idea. Fund the top three, fund them partially if you must, and accept a smaller Christmas rather than a borrowed one. Partial funding still beats zero, because £400 saved toward a £600 Christmas means £200 on a card instead of £600.</p>

<h2>The year it starts working</h2>

<p>The first year is the awkward one, because some bills arrive before their fund has filled. That's unavoidable and it's not a sign the system's broken.</p>

<p>By year two, every fund has had a full cycle. The car service comes round and the money is sitting there. Christmas happens and January doesn't hurt. Nothing has changed about your income, only about when the money got set aside.</p>

<p>That's the point where people stop describing expenses as unexpected, and it's a genuinely different way to live with money.</p>

<p>Sinking funds work best sitting on top of a proper monthly plan. If you don't have one yet, start with <a href="/blog?p=stop-living-paycheck-to-paycheck">giving every pound a job</a>, or <a href="/blog?p=50-30-20-rule">the 50/30/20 rule</a> if you want something lighter.</p>
`,
  related: ['emergency-fund-when-money-is-tight', 'one-income-family-budget', 'stop-living-paycheck-to-paycheck']
},

{
  slug: 'emergency-fund-when-money-is-tight',
  title: 'How to Build an Emergency Fund When Money Is Already Tight',
  excerpt: 'Standard advice says save six months of expenses. That is useless if you cannot find £20. Here is how to start from nearly nothing and still get somewhere.',
  category: 'saving',
  tool: 'budget',
  tags: ['emergency fund', 'save money on low income', 'financial safety net'],
  date: '2026-03-02',
  readMinutes: 7,
  image: 'blog/emergency-fund.jpg',
  imageAlt: 'A shield with a rising water level inside it',
  body: `
<p>"Save three to six months of expenses" is technically correct advice that is completely useless to someone with £40 left at the end of the month. It's like telling someone who can't swim to get to the far shore.</p>

<p>So let's throw that number out for now and start somewhere that's actually reachable.</p>

<h2>The first target is £500</h2>

<p>Not six months. £500.</p>

<p>The reason isn't arbitrary. Look at what actually pushes people onto credit cards: a car repair, a replacement washing machine, an unexpected vet bill, a boiler part, an emergency train fare. The overwhelming majority of these come in under £500.</p>

<p>A £500 buffer doesn't protect you from redundancy. It protects you from the £280 car repair that would otherwise have gone on a card at 22% and taken fourteen months to clear. That's not a small thing. That's the difference between an inconvenience and a debt.</p>

<p>Hit £500 first. Then, and only then, start thinking in months of expenses.</p>

<h2>Where the money comes from when there isn't any</h2>

<p>Four places, in rough order of how quickly they pay off.</p>

<p><strong>Subscriptions you've stopped noticing.</strong> This is nearly always the fastest win and it's usually £30 to £80 a month sitting there. <a href="/blog?p=subscription-audit">A proper subscription audit</a> takes about twenty minutes.</p>

<p><strong>The bills you've never renegotiated.</strong> Insurance, broadband, mobile, energy. Loyalty is actively punished in all four. An afternoon of comparison sites and two phone calls where you say the words "I'm thinking of leaving" routinely finds £40 a month. It's tedious and it works.</p>

<p><strong>Food.</strong> Not "stop buying coffee". Meal planning, a list, and one big shop instead of five small ones. Most households find £50 to £100 a month here without eating worse, mostly by throwing less away.</p>

<p><strong>One month of concentrated effort.</strong> <a href="/blog?p=30-day-no-spend-challenge">A 30-day no-spend challenge</a> can generate several hundred pounds on its own, which for a lot of people is most of the £500 in one go.</p>

<div class="bp-callout">
  <strong>If you have high-interest debt:</strong> get the £500 first anyway, then attack the debt hard, then come back and build the fund properly. Skipping the buffer entirely means the next unexpected expense goes straight back onto the card you're trying to clear, and you never get ahead. <a href="/blog?p=debt-snowball-vs-avalanche">Snowball or avalanche</a> covers the payoff order.
</div>

<h2>Make it automatic and slightly annoying to reach</h2>

<p>Standing order the day after payday. Any amount. £20 is fine. £10 is fine. The habit is doing more work here than the amount is, at least at first.</p>

<p>Put it in a separate account at a different bank from your current account. Not for the interest, though take the interest. Because a two-day transfer delay is the cheapest impulse control that exists. If the money is one tap away in the same banking app, it isn't really an emergency fund, it's a slightly awkward current account.</p>

<h2>Define "emergency" in writing, now</h2>

<p>This is the step everyone skips and it's the reason emergency funds don't survive.</p>

<p>Write it down while you're calm, because in the moment absolutely everything feels like an emergency.</p>

<p><strong>Emergency:</strong> losing income. A medical or dental problem. A repair to something you need to live or work, so the car if you drive to work, the boiler in winter, the fridge. Getting home urgently.</p>

<p><strong>Not an emergency:</strong> Christmas. A holiday. A wedding. Car insurance. The MOT. A sale, however good. A new phone because yours is slow.</p>

<p>Everything in that second list is predictable, which means it belongs in <a href="/blog?p=sinking-funds-explained">a sinking fund</a>, not here. This is the single most common way emergency funds get drained: not through recklessness, but by paying for things that were always coming and simply weren't planned for.</p>

<h2>After £500</h2>

<p>Once the buffer is there, the next target is one month of your survival costs. Not your normal spending, the bare minimum version: housing, utilities, cheapest food, transport, insurance, minimum debt payments. For most households that's noticeably less than a normal month, which makes it a lot less daunting.</p>

<p>Then three months. Then, if your income is unstable or your household runs on one salary, six. <a href="/blog?p=one-income-family-budget">Single-income households</a> should aim for the higher end, for the obvious reason.</p>

<h2>Keeping it visible</h2>

<p>Progress you can't see is progress you stop making. A savings account balance you check twice a year does not motivate anyone.</p>

<p>Both <a href="/budgetplanner">Ezzo Budget</a> planners let you set an emergency fund as its own goal with a target, so it shows up next to everything else rather than living in a bank app you avoid opening. The <a href="/ultimate-budget">Ultimate Budget Planner</a> tracks it alongside your sinking funds, which keeps the distinction between the two obvious, and that distinction is most of the battle.</p>

<h2>The bit worth hearing</h2>

<p>Going from £0 to £500 changes more than going from £5,000 to £10,000 does. It's the point where a bad week stops turning into a bad year, and where you stop making decisions purely because you have no other option.</p>

<p>Take longer than you think you should. £20 a month gets you there in two years, and two years of a slow habit beats six weeks of an intense one you abandon. The people who end up with real savings are almost never the ones who started aggressively.</p>
`,
  related: ['sinking-funds-explained', '30-day-no-spend-challenge', 'subscription-audit']
},

{
  slug: 'subscription-audit',
  title: 'The Subscription Audit: How to Find Money You Are Already Spending',
  excerpt: 'The average household leaks real money every month on subscriptions nobody uses. Twenty minutes with your statements is the highest hourly rate you will earn this year.',
  category: 'reallife',
  tool: 'budget',
  tags: ['subscription audit', 'cancel subscriptions', 'save money', 'recurring payments'],
  date: '2026-03-09',
  readMinutes: 6,
  image: 'blog/subscription-audit.jpg',
  imageAlt: 'A stack of recurring charge rows with two of them flagged for cancellation',
  body: `
<p>Subscriptions are designed to be forgotten. That's not cynicism, it's the business model. Low monthly price, automatic renewal, no reminder, cancellation buried four screens deep. Every part of that is deliberate.</p>

<p>Which means finding them isn't a discipline problem. It's an audit problem, and audits are just a list and an afternoon.</p>

<h2>Why this is the best-paid twenty minutes available to you</h2>

<p>Most households, once they actually check, find between £30 and £90 a month they're not using. Call it £55.</p>

<p>That's £660 a year, for twenty minutes of work, permanently, without earning any more or giving up anything you'd notice. Nothing else in personal finance has that return. It also compounds: £55 a month at 22% interest against a credit card balance is worth considerably more than £660 by the time it's done.</p>

<h2>Finding them all, which is harder than it sounds</h2>

<p>Scrolling your banking app doesn't work. Subscriptions hide across several rails and you'll miss a third of them.</p>

<p>Check all of these:</p>

<ul>
  <li><strong>Your bank statements, twelve months back.</strong> Not three. Annual subscriptions only show up once, and they're often the expensive ones.</li>
  <li><strong>Every card, including the one you barely use.</strong> That's frequently where an old subscription is still running.</li>
  <li><strong>PayPal.</strong> Log in and look at automatic payments directly. These do not always appear recognisably on your statement.</li>
  <li><strong>App Store and Google Play.</strong> Both have a subscriptions page. This is where most forgotten ones live, especially app trials from years ago.</li>
  <li><strong>Amazon,</strong> for Prime, Audible, Kindle Unlimited, Music, and any Subscribe &amp; Save items you set up once.</li>
  <li><strong>Your inbox.</strong> Search "receipt", "your subscription", "renewal" and "thanks for your order".</li>
</ul>

<p>Write every one down with its cost, how often it bills, and the date it renews. Total it up. That number is usually higher than anyone expects, and the surprise itself is useful.</p>

<div class="bp-callout">
  <strong>Convert everything to annual before deciding.</strong> "£12.99 a month" and "£156 a year" are the same fact, but only one of them makes you think. Do this for the whole list before you judge any of it.
</div>

<h2>Sorting the list</h2>

<p>Four piles.</p>

<p><strong>Cancel now.</strong> You forgot it existed, or you haven't opened it in three months. No deliberation needed, and no sunk-cost reasoning. What you've already paid is gone either way.</p>

<p><strong>Downgrade.</strong> You use it, but not at that tier. The 4K plan you watch on a laptop. The 2TB cloud storage holding 90GB. The gym membership that's really used twice a week when an off-peak plan exists.</p>

<p><strong>Switch to annual.</strong> For the ones you'll definitely keep all year, annual billing is usually 15 to 20% cheaper. Only do this for things you're certain about, and put the renewal in <a href="/blog?p=sinking-funds-explained">a sinking fund</a> so the lump doesn't ambush you.</p>

<p><strong>Keep as-is.</strong> Genuinely used, genuinely worth it. There's no virtue in cancelling something that improves your life. The point of the audit is to stop paying for things that don't.</p>

<h2>The awkward ones</h2>

<p>Some are hard to cancel on purpose. If a service makes you phone up, phone up. Say you want to cancel, don't explain, and decline the retention offer unless it's genuinely good. Some of them are, actually. Take it if it is, but take it as a decision, not as an escape from an awkward call.</p>

<p>For anything you truly can't get rid of, most banks now let you block a specific recurring payment from the app. Use it as a last resort and cancel properly afterwards, because a blocked payment can still generate a debt.</p>

<h2>Stopping the drift</h2>

<p>Cancelling is the easy half. The list rebuilds itself within about eighteen months unless you change something structurally.</p>

<p><strong>Put every subscription in your budget by name.</strong> Not one "subscriptions" line, each one individually. Things you see every month are much harder to forget.</p>

<p><strong>Set a calendar reminder two days before every annual renewal.</strong> That's the moment to decide, not the moment after the money's gone.</p>

<p><strong>Use a card with a spending cap for free trials,</strong> or at minimum diarise the trial end date the same hour you sign up.</p>

<p>The <a href="/ultimate-budget">Ultimate Budget Planner</a> has a subscription tracker built for exactly this: every subscription listed with its cost and billing cycle, an annual total so the real number stays in front of you, and renewals on the calendar view so they arrive as a plan rather than a surprise. It's the difference between doing this audit once and never needing to do it again.</p>

<h2>Then send the money somewhere</h2>

<p>This is the step that decides whether the audit was worth anything. Freed-up money that stays in your current account gets absorbed within two months and you'll be back where you started, wondering why cancelling four subscriptions didn't help.</p>

<p>Set up the standing order the same day you cancel. Into <a href="/blog?p=emergency-fund-when-money-is-tight">an emergency fund</a> if you don't have £500 yet, or straight at your <a href="/blog?p=debt-snowball-vs-avalanche">highest-interest debt</a> if you do.</p>

<p>Money without a destination has a way of finding one.</p>
`,
  related: ['emergency-fund-when-money-is-tight', 'sinking-funds-explained', 'debt-snowball-vs-avalanche']
},

{
  slug: 'budgeting-on-irregular-income',
  title: 'How to Budget on an Irregular Income Without Guessing',
  excerpt: 'Freelance, commission, shift work or seasonal pay breaks normal budgeting advice. The fix is to stop budgeting your income and start paying yourself a salary.',
  category: 'reallife',
  tool: 'budget',
  tags: ['irregular income', 'freelance budgeting', 'variable income', 'self employed budget'],
  date: '2026-03-16',
  readMinutes: 8,
  image: 'blog/irregular-income.jpg',
  imageAlt: 'A jagged income line with a flat steady baseline drawn beneath it',
  body: `
<p>Nearly all budgeting advice quietly assumes the same thing: that the same amount arrives on the same day every month.</p>

<p>If you're freelance, on commission, doing shift work, running a seasonal business or juggling several part-time things, that assumption breaks everything downstream. A budget built on a number that swings between £1,400 and £4,200 isn't a budget, it's a guess with formatting.</p>

<p>The fix is counter-intuitive and it works: stop budgeting your income. Budget a salary you pay yourself.</p>

<h2>The buffer account method</h2>

<p>You need two accounts. Not complicated ones.</p>

<p><strong>The holding account.</strong> Every payment you receive lands here. Nothing is ever spent from it. Ever.</p>

<p><strong>Your current account.</strong> On the same date every month, you transfer one fixed amount from the holding account into this one. That transfer is your salary. Everything, all your bills and spending, comes out of this account.</p>

<p>That's it. A good month means the holding account grows. A bad month means it shrinks. Your actual life, and your budget, doesn't move at all.</p>

<p>Once the holding account has enough in it, you have something a salaried person has and you didn't: a completely predictable month. And now every ordinary piece of budgeting advice works for you again, including <a href="/blog?p=stop-living-paycheck-to-paycheck">zero-based budgeting</a> and <a href="/blog?p=50-30-20-rule">50/30/20</a>.</p>

<h2>Setting your salary number</h2>

<p>This is the decision that makes or breaks the method, and the instinct to be optimistic here is very strong. Resist it.</p>

<ol>
  <li><strong>Get twelve months of income.</strong> Twenty-four if you have it, and if your work is seasonal you genuinely need the full cycle.</li>
  <li><strong>Find your lowest three months</strong> and average those. Not your annual average. Your bad months.</li>
  <li><strong>Take about 90% of that.</strong> That's your starting salary.</li>
</ol>

<p>It will feel too low. That's the point. A salary set at your average means you're insolvent in every below-average month, which is roughly half of them. Set it low, build the buffer, and raise it deliberately once the buffer can support it. Raising your salary should be a decision you make twice a year, not something that happens by accident because a good month came in.</p>

<div class="bp-callout">
  <strong>Before anything else, if you're self-employed:</strong> a fixed percentage of every payment goes straight into a separate tax account the day it arrives, and that money is not yours. 25 to 30% is the usual starting point depending on where you are and what you earn. Do this first, above the buffer, above everything. A tax bill you didn't set aside for is the single most common way self-employed budgets collapse.
</div>

<h2>Building the buffer when you don't have one</h2>

<p>Most people start this with an empty holding account, which means the method can't work yet. That's fine, it's a phase.</p>

<p>Until you have at least one month's salary in there, run lean: pay your absolute survival costs, keep discretionary spending minimal, and put every pound above that into the buffer. It's uncomfortable for a couple of months.</p>

<p>Aim for three months of salary in the holding account eventually. At that point a quiet quarter is a thing you notice rather than a thing you panic about.</p>

<p>Note this is a separate thing from your <a href="/blog?p=emergency-fund-when-money-is-tight">emergency fund</a>. The buffer smooths out normal income variation, which is expected. The emergency fund covers genuine disasters. Irregular earners need both, which is annoying but true, because for you a quiet month isn't an emergency, it's a Tuesday.</p>

<h2>What to do with a very good month</h2>

<p>Decide the rule in advance, in writing, because the moment a £6,000 month lands is a bad time to be deciding anything.</p>

<p>A reasonable default for anything above your salary:</p>

<ul>
  <li>Tax percentage off the top, always, no exceptions.</li>
  <li>Half of what's left to the buffer, until it's at three months.</li>
  <li>A quarter to whatever the current goal is: debt, emergency fund, pension.</li>
  <li>A quarter to actually enjoy, guilt free.</li>
</ul>

<p>That last line matters more than it looks. A system with no reward in it gets abandoned, and irregular earners take real risk for their income. Some of the upside should feel like upside.</p>

<h2>The trap of lifestyle creep on a good quarter</h2>

<p>Three strong months in a row is genuinely dangerous, because it's long enough to feel like the new normal. People raise their salary, take on a bigger car payment or a more expensive flat, and then Q4 is quiet and the fixed costs don't care.</p>

<p>Every fixed commitment should be affordable on your <em>lowest</em> plausible month, not your recent ones. If a subscription or a payment plan wouldn't survive a bad quarter, it's a no, however good this quarter was. It's also worth running <a href="/blog?p=subscription-audit">a subscription audit</a> after a good run, because that's exactly when recurring costs quietly accumulate.</p>

<h2>Tracking two accounts without losing the thread</h2>

<p>The mental load here is real: separating tax from buffer from salary from spending, tracking uneven income against a steady outflow, and staying honest about which pot a balance actually belongs to.</p>

<p>The <a href="/ultimate-budget">Ultimate Budget Planner</a> fits this shape better than a standard monthly budget does. Your salary transfer is a single steady income line so the budget side stays stable, sinking funds handle tax and the buffer as separate tracked pots rather than one blurry savings figure, and the calendar view shows what's due against when money actually lands, which is the specific question irregular earners ask most. If your setup is simpler, the <a href="/budgetplanner">Simple Budget Planner</a> handles the salary-and-categories half on its own and is free to try.</p>

<h2>The real payoff</h2>

<p>It isn't the money. It's that you stop refreshing your bank balance.</p>

<p>Irregular income is stressful mostly because of the uncertainty, not the amount. Plenty of freelancers earning well feel broke, because they never know what next month looks like. A buffer and a fixed salary don't increase your income by a penny. They just make it boring, and boring is exactly what you want your income to be.</p>
`,
  related: ['stop-living-paycheck-to-paycheck', 'emergency-fund-when-money-is-tight', '50-30-20-rule']
}
];