'use strict';
/* Ezzo Budget - v2.7 "Onboarding & Upgrade"  (2026-07-01)
   Change set vs v1.0 "Baseline":
   - All native browser confirm()/alert() popups replaced with in-app
     glass dialogs (confirmDialog / alertDialog) - mobile-friendly.
   - UBP: duplicated init()/applyLayout() collapsed into one; recurring
     engine restored and init now runs exactly once. */
/* =====================================================================
   Ezzo Budget - script.js  v2
   Improvements: edit transactions, live progress bars, post-symbol
   currencies, mouse-drag tabs, gear settings nav, round help icons,
   clickable period badge, dark / light theme toggle.
   ===================================================================== */

// ── Utilities ─────────────────────────────────────────────────────────
const uid   = () => Math.random().toString(36).slice(2, 11);
const esc   = s  => { const d = document.createElement('div'); d.appendChild(document.createTextNode(String(s ?? ''))); return d.innerHTML; };
const today = () => new Date().toISOString().slice(0, 10);

// Formats YYYY-MM-DD as local date without UTC offset drift
function toLocalISO(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function getMonthBounds() {
  const n = new Date();
  return {
    start: toLocalISO(new Date(n.getFullYear(), n.getMonth(), 1)),
    end:   toLocalISO(new Date(n.getFullYear(), n.getMonth() + 1, 0))
  };
}

// Formats a YYYY-MM-DD string as "6 Apr 2026"
function formatDateDisplay(dateStr) {
  if (!dateStr) return '';
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

// Currencies where the symbol goes AFTER the amount  (e.g. "100 zł")
const POST_SYM = new Set(['PLN','SEK','NOK','DKK','HUF','CZK','RON','HRK']);

let SYM = '$'; // live symbol, kept in sync with state

const fmt = (v) => {
  const n = Math.abs(Number(v || 0)).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return POST_SYM.has(state?.settings?.currency) ? `${n}\u00a0${SYM}` : `${SYM}${n}`;
};

const pct = (act, exp) => (!exp || exp === 0) ? 0 : Math.min(999, Math.round((act / exp) * 100));

// ── State ─────────────────────────────────────────────────────────────
const STATE_KEY = 'evobudget_v1';

// ── Internationalisation ─────────────────────────────────────────────
const TRANSLATIONS = {
  en: {
    lang_name:'English',
    // Tabs
    tab_dashboard:'Dashboard', tab_budget:'Budget', tab_transactions:'Transactions',
    tab_income:'Income', tab_expenses:'Expenses', tab_bills:'Bills',
    tab_debt:'Debt', tab_savings:'Savings', tab_settings:'Settings',
    tab_debt_payoff:'Debt Payoff', tab_sinking:'Sinking Funds',
    tab_calendar:'Calendar', tab_subscriptions:'Subscriptions',
    // Dashboard stats
    total_income:'Total Income', expenses_bills:'Expenses & Bills',
    debt_payments:'Debt Payments', total_savings:'Total Savings',
    total_outgoing:'Total Outgoing', savings_rate:'Savings Rate',
    net_leftover:'Net Leftover', cash_flow:'Cash Flow',
    income_sources:'Income Sources', spending_breakdown:'Spending Breakdown',
    expected:'Expected', actual:'Actual', progress:'Progress',
    of:'of', budgeted:'budgeted', saved:'saved',
    // Settings
    budget_period:'Budget Period', start_date:'Start date', end_date:'End date',
    this_month:'This Month', this_week:'This Week', last_week:'Last Week', last_month:'Last Month', last_30_days:'Last 30 Days', this_quarter:'This Quarter', this_year:'This Year',
    toast_tx_added:'Transaction added \u2713',toast_tx_updated:'Updated \u2713',toast_tx_deleted:'Deleted',
    toast_period_updated:'Period updated \u2713',toast_period_error:'End date must be after start date',
    toast_currency_updated:'Currency updated \u2713',toast_imported:'Imported {0} \u2713',
    toast_fund_created:'Fund created \u2713',toast_fund_updated:'Fund updated \u2713',
    toast_fund_contrib:'Added {amt} to {name} \u2713',
    toast_sub_added:'Subscription added \u2713',toast_sub_updated:'Subscription updated \u2713',
    toast_alloc_enabled:'Allocation enabled \u2713',toast_alloc_disabled:'Allocation disabled',
    toast_lang_updated:'Language updated \u2713',toast_export:'Exported \u2713',
    toast_saved:'Saved \u2713',toast_reset:'All data cleared',
    toast_alloc_bucket_added:'Bucket added \u2713',
    confirm_remove_cat:'Remove this category?',
    confirm_remove_cat_with_tx:'{0} existing transaction(s) use this category. They will keep it as a label, but it will no longer be tracked in your budget. Delete anyway?',
    confirm_delete_all_tx:'Delete ALL transactions? This cannot be undone.',
    confirm_delete_tx:'Delete this transaction?',confirm_remove_debt:'Remove this debt?',
    confirm_delete_fund:'Delete this fund?',confirm_remove_sub:'Remove this subscription?',
    confirm_reset_1:'Are you sure? All data will be permanently deleted.',
    confirm_reset_2:'Last chance - this cannot be undone. Continue?',
    export_csv_btn:'\uD83D\uDCE5 Export CSV',
    sett_export_title:'\uD83D\uDCE4 Export Data',
    sett_export_desc:'Download all transactions as a CSV file for backup or use in another app.',
    sf_add_contribution:'Add Contribution',sf_contribution_label:'Amount to add',
    sf_currently_saved:'Currently saved',
    tx_search_ph:'Search by description or category\u2026',
    tx_filter_all_types:'All types',tx_filter_all_alloc:'All allocations',
    tx_add_btn:'Add',tx_add_title:'Add a transaction',tx_amount:'Amount',tx_category:'Category',tx_clear_all:'Clear all',tx_date:'Date',tx_desc_label:'Description',tx_desc_ph:'e.g. Grocery run\u2026',tx_empty:'No transactions yet.',tx_import_csv:'\uD83D\uDCE5 Import CSV',tx_th_amount:'Amount',tx_th_desc:'Description',tx_transaction_many:'transactions',tx_transaction_one:'transaction',tx_type:'Type',tx_type_bill:'Bill',tx_type_debt:'Debt',tx_type_expense:'Expense',tx_type_income:'Income',tx_type_savings:'Savings',tx_empty_sub:'Add your first transaction to get started',
    tx_sort_date_new:'Newest first',tx_sort_date_old:'Oldest first',
    tx_sort_amt_high:'Highest amount',tx_sort_amt_low:'Lowest amount',
    tx_showing:'Showing {n} of {total}',tx_no_results:'No transactions match your filter.',
    alloc_add_bucket:'+ Add bucket',alloc_remove_btn:'Remove',
    alloc_min_buckets:'Minimum 2 buckets required',
    alloc_auto_tag:'Auto-tagged \u2192 {name}',
    tx_prev:'\u2190 Prev',tx_next:'Next \u2192',tx_page_of:'Page {n} of {total}',
    debt_due_day_note:'Days 29-31 won\u2019t show in shorter months',
    sub_advanced:'Billing date advanced to {date}',
    currency:'Currency', rollover:'Rollover', appearance:'Appearance',
    language:'Language', reset_data:'Reset All Data',
    light:'Light', dark:'Dark', theme_synthwave:'Synthwave', theme_vintage_ledger:'Vintage', theme_terminal:'Terminal',
    dashboard_layout:'Dashboard Layout', dashboard_layout_desc:'Choose how your Dashboard is designed and visualised.',
    layout_1:'Classic', layout_2:'Radial Pulse', layout_coming_soon:'More Coming Soon!',
    changes_autosaved:'✅ Changes are saved automatically.',
    rollover_desc:'Carry unspent money from your previous period into this one.',
    rollover_amount:'Rollover amount',
    reset_desc:'Permanently deletes all your data. This cannot be undone.',
    reset_btn:'Reset everything',
    // Common
    add:'Add', cancel:'Cancel',rename_title_prompt:'Rename your budget planner', save:'Save', delete:'Delete',dp_today:'Today',dp_clear:'Clear', edit:'Edit',field_info_aria:'About {0}',
    mod_name_hint:'The label you’ll see for this category everywhere in the app.',mod_due_date_hint:'When this is due each month - used for the calendar and paid tracking.',
    mod_th_expected_hint:'The amount you plan to budget for this category each month.',mod_th_actual_hint:'Calculated automatically from your logged transactions in this category.',mod_th_progress_hint:'How much of your expected amount has been used so far, as a percentage.',
    tx_date_hint:'The date this transaction happened.',tx_type_hint:'What kind of transaction this is - controls which category list you can pick from.',tx_category_hint:'Which budget category this transaction counts toward.',tx_amount_hint:'How much money this transaction was for.',tx_desc_hint:'An optional note to help you remember what this was for.',
    paid:'Paid', due_date:'Due Date', category:'Category', amount:'Amount',
    description:'Description', date:'Date', type:'Type',
    add_category:'+ Add category', no_transactions:'No transactions yet.',
    // Upgrade
    upgrade_title:'Upgrade to Ultimate Budget Planner',
    upgrade_desc:'Everything in Simple, plus the pro tools to get ahead: crush debt, save for what matters, and never miss a bill.',
    upgrade_now:'Upgrade Now →',upgrade_get_now:'GET NOW',upgrade_compare:'COMPARE PLANNERS',sett_upgrade_h:'Upgrade banner',sett_upgrade_label:'Show upgrade banner on the dashboard',
    // Calendar days
    mon:'Mon',tue:'Tue',wed:'Wed',thu:'Thu',fri:'Fri',sat:'Sat',sun:'Sun',
    quick_presets:'Quick presets:',select_currency:'Select your currency',select_language:'Select language',
    appearance_desc:'Choose a colour theme.',
    dash_anim_title:'Dashboard Animations',dash_anim_desc:'Play a subtle entrance animation when the dashboard loads.',dash_anim_label:'Enable animations',
    help_sett_modal_title:'How Settings work',help_sett_intro:'Customise Ezzo Budget to match your situation.',
    help_sett_currency_li:'Updates the symbol everywhere (some currencies like PLN place the symbol after the amount).',
    help_sett_period_li:'Set your date range. Click the date badge on Dashboard to jump here quickly.',
    help_sett_rollover_li:'Carry forward unspent money from the last period.',
    help_sett_theme_li:'Choose from five colour themes - Light, Dark, Synthwave, Vintage, or Terminal.',
    help_sett_layout_li:'Choose from two Dashboard designs - Classic or Radial Pulse - each with its own charts and layout, with more designs coming soon.',
    help_dash_modal_title:'How the Dashboard works',help_dash_intro:'The Dashboard is your real-time financial snapshot. Everything updates automatically as you log transactions.',
    help_dash_cards_h:'Summary cards',help_dash_cards_li:'Totals for income, expenses &amp; bills, debt payments, and savings for the current period.',
    help_dash_leftover_li:'What\'s left after all outgoings. <span style="color:#10b981;font-weight:600">Green</span> = surplus, <span style="color:#f43f5e;font-weight:600">red</span> = over budget.',
    help_dash_flow_h:'Cash Flow chart',help_dash_flow_li:'Compares what you <em>expected</em> vs what <em>actually happened</em>.',
    help_dash_donut_h:'Donut charts',help_dash_donut_li:'Income breakdown and spending allocation as percentages.',
    help_dash_datebadge_h:'Date badge',help_dash_datebadge_li:'Click it to jump straight to Settings and change your budget period.',
    help_dash_tip:'💡 Tip: Enter expected amounts in Income / Expenses / Bills / Debt / Savings first, then log transactions to see actuals fill in.',
    help_tx_modal_title:'How Transactions work',help_tx_intro:'Every time money moves, log it here. Budget modules update automatically.',
    help_tx_type_li:'Income, Expense, Bill, Debt, or Savings.',help_tx_category_li:'Drawn from your budget module categories.',
    help_tx_edit_h:'✏️ Edit button',help_tx_edit_li:'Click the pencil icon on any row to edit or delete that transaction.',
    help_tx_csv_h:'CSV Import format:',
    help_inc_modal_title:'How Income works',help_inc_intro:'Track expected vs actual income. Progress bars update live as you type expected amounts.',
    help_inc_expected_li:'Type your planned income; the bar updates instantly.',help_inc_actual_li:'Auto-calculated from Income transactions.',
    help_inc_tip:'💡 Tip: Log earnings as type "Income" in Transactions to see actuals here.',
    help_exp_modal_title:'How Expenses work',help_exp_intro:'Set spending limits per category. Progress bars update live and turn red when you go over.',
    help_exp_expected_li:'Your spending limit; bar updates as you type.',help_exp_actual_li:'Totalled from Expense transactions.',
    help_bills_modal_title:'How Bills work',help_bills_intro:'Track recurring bills with due dates and paid status.',
    help_bills_duedate_li:'Set when each bill is due.',help_bills_paid_li:"Tick when you've made the payment - you'll be asked for the actual amount, which gets logged as a transaction since bills like utilities rarely match your budgeted amount exactly.",help_bills_actual_li:'Populated from Bill transactions with matching category name.',
    help_debt_modal_title:'How Debt works',help_debt_intro:'Stay on top of loan repayments and mortgages.',
    help_debt_expected_li:'Your planned monthly payment.',help_debt_duedate_li:'When the payment is due.',help_debt_paid_li:"Mark when the payment clears - you'll be asked for the actual amount paid, which gets logged as a transaction, since it can differ from your planned payment.",
    help_sav_modal_title:'How Savings work',help_sav_intro:'Set savings goals and track contributions.',
    help_sav_expected_li:'Your savings target for this period.',help_sav_actual_li:'From Savings type transactions.',
    help_sav_tip:'💡 Tip: Treat savings like a fixed expense - budget it first, spend the rest.',
    // Guide
    guide_group_start:'Getting Started', guide_group_track:'Tracking Your Money', guide_group_settings:'Making It Yours',
    guide_section_big:'The Big Picture', guide_section_how:'How to Use It', guide_section_connects:'How It Connects', guide_back:'Back to topics',
    guide_welcome_title:'Welcome to Simple Budget Planner',
    guide_welcome_big:"This app is here to answer one question every month: where did my money go? You log what comes in and what goes out, and it quietly does the math so you always know exactly where you stand. No spreadsheets, no guesswork - just a clear picture of your money.",
    guide_dashboard_title:'Dashboard',
    guide_dashboard_big:"Think of the Dashboard as the cover page of your finances - one glance tells you what's coming in, what's going out, and what's left over. It's the first thing worth checking whenever you open the app.",
    guide_dashboard_step1:'Check the summary cards at the top for your <strong>Total Income</strong>, <strong>Total Outgoing</strong>, and <strong>Net Leftover</strong> for the current period.',
    guide_dashboard_step2:'Scroll down to the <strong>Cash Flow</strong> chart to see how your money moves week by week.',
    guide_dashboard_step3:'Look at the <strong>Spending Breakdown</strong> donut to spot which category is eating the biggest slice of your budget.',
    guide_dashboard_connect1:"Every transaction you add anywhere in the app updates these numbers instantly - there's nothing to refresh or recalculate.",
    guide_dashboard_connect2:'The Net Leftover figure includes any <strong>Rollover</strong> amount you set in Settings, so a good month can carry forward into the next.',
    guide_dashboard_connect3:'If a number looks off, the fix is almost always in Transactions, Income, Expenses, Bills, Debt, or Savings - the Dashboard just reflects what has already been entered.',
    guide_dashboard_tip:'Make checking the Dashboard part of your routine - even 10 seconds a day keeps small surprises from becoming big ones.',guide_dashboard_usecase_h:'See it in action',guide_dashboard_usecase_p:'<p><strong>Liam</strong> checks the Dashboard before deciding whether to eat out this week. He sees his Net Leftover for the period is only $45, well below his usual buffer, so he decides to cook at home instead - catching the problem early instead of finding out when his account is nearly empty.</p>',
    guide_transactions_title:'Transactions',
    guide_transactions_big:'Transactions are the foundation of everything else in this app - every dollar you log here is what powers your Dashboard, your categories, and your bottom line. Get in the habit of logging as you spend, and the rest takes care of itself.',
    guide_transactions_step1:'Tap <strong>Add Transaction</strong>, choose whether it is Income, an Expense, a Bill, Debt, or Savings, and fill in the amount and category.',
    guide_transactions_step2:'Already have your spending in a spreadsheet? Use <strong>Import CSV</strong> to bring it all in at once instead of typing each one by hand.',
    guide_transactions_step3:'Tap any transaction in the list to <strong>edit</strong> the amount, date, or category if you made a mistake or something changed.',
    guide_transactions_step4:'Use the search and filter controls above the list to quickly find a specific transaction by type, category, or date.',
    guide_transactions_connect1:'Every transaction you log automatically counts toward the matching category - an Expense transaction shows up in Expenses, a Bill payment shows up in Bills, and so on.',
    guide_transactions_connect2:'Your Dashboard totals and charts are built entirely from these entries - nothing is estimated.',
    guide_transactions_connect3:'Deleting or editing a transaction here instantly updates every total everywhere else in the app.',
    guide_transactions_tip:'Log transactions the same day they happen. It takes seconds and keeps your Dashboard trustworthy.',guide_transactions_usecase_h:'See it in action',guide_transactions_usecase_p:"<p><strong>Aisha</strong> gets paid on Friday. She opens Transactions, picks Income → Paycheck, types the amount, and it's logged immediately - showing up on her Dashboard right away as part of her Total Income for the period.</p>",
    guide_income_title:'Income',
    guide_income_big:'This is where you tell the app how much money you expect to earn, then track what actually landed - so you can spot the gap between the two at a glance.',
    guide_income_step1:'Set your <strong>Expected</strong> amount for each income source, like your paycheck or a side hustle.',
    guide_income_step2:'As money comes in, log it as an Income transaction - it will automatically fill your <strong>Actual</strong> column.',
    guide_income_step3:"Compare Expected against Actual to see if you're on track or if some income has not landed yet.",
    guide_income_connect1:"Income transactions logged in Transactions flow straight into this page's Actual totals.",
    guide_income_connect2:'Your Total Income on the Dashboard is the sum of everything tracked here.',
    guide_income_connect3:'A higher Net Leftover starts here - the more accurately you track income, the more accurate your whole budget becomes.',
    guide_income_tip:'Add every income source separately, even small or irregular ones - it makes it much easier to spot patterns over time.',guide_income_usecase_h:'See it in action',guide_income_usecase_p:'<p>Before the month starts, <strong>Carlos</strong> sets his expected Salary at $3,200 and his expected Freelance income at $400 in the Income module.</p><p>As paychecks come in through Transactions, the Actual column updates automatically, so he can see at a glance whether this month\'s freelance work is keeping pace with what he planned.</p>',
    guide_expenses_title:'Expenses',
    guide_expenses_big:'Expenses is your day-to-day spending - groceries, gas, coffee, all of it. Setting an expected amount per category gives you something to measure yourself against instead of just watching money disappear.',
    guide_expenses_step1:'Add a category for each type of spending you want to track, like Groceries or Entertainment.',
    guide_expenses_step2:"Set an <strong>Expected</strong> amount for each one - what you'd like to stay under.",
    guide_expenses_step3:'Log purchases as Expense transactions and watch the <strong>Actual</strong> column fill in automatically.',
    guide_expenses_connect1:'Every Expense transaction you log in Transactions adds straight to the matching category here.',
    guide_expenses_connect2:'Categories that go over their Expected amount are part of what drives your Spending Breakdown chart on the Dashboard.',
    guide_expenses_connect3:'Trimming an over-budget category here is one of the fastest ways to increase your Net Leftover.',
    guide_expenses_tip:'Start with just a handful of broad categories. You can always split them into more detail later once you see where the money really goes.',guide_expenses_usecase_h:'See it in action',guide_expenses_usecase_p:'<p><strong>Nina</strong> wants to see where her spending actually goes, so she sets expected amounts for Groceries, Dining, and Transport in Expenses.</p><p>Halfway through the month she notices Dining is already at 90% of its budget, and cuts back for the rest of the period instead of only finding out at month\'s end.</p>',
    guide_bills_title:'Bills',
    guide_bills_big:"Bills are the payments you can't skip - rent, utilities, subscriptions you've committed to. This page keeps their due dates and paid status front and center so nothing slips through the cracks.",
    guide_bills_step1:'Add a bill and give it a <strong>Due Date</strong> so you know exactly when it is due.',
    guide_bills_step2:'Once you have paid it, tick the <strong>Paid</strong> checkbox to mark it settled for this period.',
    guide_bills_step3:'Log the actual payment as a Bill transaction so the amount counts toward your totals.',
    guide_bills_connect1:"Unpaid bills with a due date coming up are exactly the kind of thing worth checking before you spend elsewhere.",
    guide_bills_connect2:'Bill transactions count toward your Total Outgoing on the Dashboard, right alongside Expenses and Debt.',
    guide_bills_connect3:'Marking a bill Paid does not remove it - it just tracks status, so you always have a record of what has been settled this period.',
    guide_bills_tip:'Add recurring bills at the start of each period so the due dates are waiting for you, not something you have to remember.',guide_bills_usecase_h:'See it in action',guide_bills_usecase_p:"<p>Every month, <strong>Derek</strong>'s electricity bill is a little different. He sets Electric's due date and expected amount ($100) in Bills.</p><p>When he actually pays it, he ticks the Paid checkbox and enters the $118.32 he was actually charged - which gets logged as a real transaction instead of just a checkmark, so his spending history stays accurate even though the bill wasn't exactly what he planned for.</p>",
    guide_debt_title:'Debt',
    guide_debt_big:'This page keeps every payment you owe in one place - credit cards, loans, anything with a balance - so you always know what is due and whether you are keeping up.',
    guide_debt_step1:'Add each debt you are tracking along with your <strong>Expected</strong> payment for this period.',
    guide_debt_step2:'Set a <strong>Due Date</strong> so you know exactly when the payment needs to go out.',
    guide_debt_step3:'Log the payment as a Debt transaction and tick <strong>Paid</strong> once it clears.',
    guide_debt_connect1:'Debt payments count toward your Total Outgoing on the Dashboard alongside Expenses and Bills.',
    guide_debt_connect2:"This page tracks payments as a category, not a full payoff plan - if you want a snowball or avalanche strategy with interest projections, that's what Ultimate Budget Planner's Debt Payoff is built for.",
    guide_debt_connect3:'Staying consistent here keeps your Net Leftover number honest, since unpaid debt has a way of catching up with you later.',
    guide_debt_tip:'List even small debts, like a family loan - the point is not the size, it is knowing everything you owe in one place.',guide_debt_usecase_h:'See it in action',guide_debt_usecase_p:'<p><strong>Grace</strong> has a small personal loan to her sister. She adds it to Debt with the monthly amount she\'s agreed to pay and a due date.</p><p>When she sends the payment, she ticks Paid and enters the exact amount she sent, so it\'s tracked in her transaction history just like any other debt payment.</p>',
    guide_savings_title:'Savings',
    guide_savings_big:'Savings is where you set money aside on purpose, instead of just seeing what is left at the end of the month. Treating it like any other planned expense is the easiest way to actually build it up.',
    guide_savings_step1:'Set an <strong>Expected</strong> amount for what you want to save this period.',
    guide_savings_step2:'Whenever you move money into savings, log it as a Savings transaction.',
    guide_savings_step3:'Compare Expected to <strong>Actual</strong> to see if you hit your savings goal for the period.',
    guide_savings_connect1:"Savings transactions logged in Transactions count straight toward this page's totals.",
    guide_savings_connect2:'Your Total Savings figure on the Dashboard comes directly from what is tracked here.',
    guide_savings_connect3:'Savings is included in your Net Leftover calculation, so saving consistently is one of the most direct ways to grow that number over time.',
    guide_savings_tip:"Set your savings amount first, before you plan spending for the rest of your budget - it's much easier to hit a goal you commit to upfront.",guide_savings_usecase_h:'See it in action',guide_savings_usecase_p:'<p>Every payday, <strong>Wen</strong> sets aside money for a house deposit. She sets her expected Savings amount in the Savings module, and as she logs Savings transactions through the period, she can see her progress bar creep toward the goal she budgeted for.</p>',
    guide_settings_title:'Settings',
    guide_settings_big:'Settings is where the app adapts to you - your currency, your budgeting period, how it looks, what language it speaks, and how your data is handled.',
    guide_settings_step1:'Pick your <strong>Currency</strong> so every amount in the app displays the way you expect.',
    guide_settings_step2:'Choose your <strong>Budget Period</strong> (like monthly or biweekly) to match how you actually get paid and pay bills.',
    guide_settings_step3:"Enter a <strong>Rollover</strong> amount if you want unspent money from last period to carry into this one's Net Leftover.",
    guide_settings_step4:'Pick an <strong>Appearance</strong> theme (Light, Dark, Synthwave, Vintage, or Terminal), a <strong>Dashboard Layout</strong> (2 designs to choose from, with more on the way), and your <strong>Language</strong> from the list.',
    guide_settings_step5:'Use <strong>Export Data</strong> to back up everything, or <strong>Reset Data</strong> if you ever want to start completely fresh.',
    guide_settings_connect1:'Your Currency and Budget Period choices shape how every other page in the app displays and calculates numbers.',
    guide_settings_connect2:'The Rollover amount you set here flows directly into the Net Leftover shown on your Dashboard.',
    guide_settings_connect3:'Exporting data here is the safest way to keep a copy of everything before making any big change.',
    guide_settings_tip:'Set your Currency and Budget Period first thing, before you start logging transactions - it saves you from having to double-check old entries later.',guide_settings_usecase_h:'See it in action',guide_settings_usecase_p:'<p>When <strong>Yuki</strong> moves to a new country and starts earning in Euros, she opens Settings, changes her Currency to EUR, and switches her Budget Period to match her new pay schedule - so every number in the app reflects her new reality from that point on.</p>',
    mod_desc_income:'Set your expected income for each source. Actual amounts fill in automatically when you log transactions.',
    mod_desc_expenses:'Set a budget limit for each spending category. Progress bars turn red when you go over.',
    mod_desc_bills:"Track recurring bills. Add a due date, then tick the checkbox once you've paid.",
    mod_desc_debt:'Stay on top of loan and mortgage repayments. Set expected amounts and mark each as paid.',
    mod_desc_savings:'Set a savings goal for each bucket. Actual contributions come from your logged transactions.',
    mod_add_category:'+ Add category',mod_add_new_category:'Add new category',mod_cat_name_label:'Name',
    mod_set_date:'Set date',mod_remove:'Remove',mod_mark_paid:'Mark as paid',mod_total:'Total',mod_paid_amount_label:'Amount paid',mod_paid_amount_hint:"How much you actually paid - this gets logged as a transaction so your spending history stays accurate, even if it's different from your budgeted amount.",mod_paid_save_btn:'Log payment',mod_paid_budgeted_hint:'Budgeted: {0}',mod_paid_amount_required:'Please enter a valid amount.',toast_mod_paid:'Payment logged',
    dash_period_title:'Click to change budget period',
    sample_loaded_toast:'Sample data loaded',
    onb_step_x_of_y:'Step {0} of {1}',
    onb_setup_title:"Let's get you set up",
    onb_setup_sub:"Set your currency and budget period - you can always change these later in Settings.",
    onb_continue_btn:'Continue',
    onb_skip_link:"Skip, I'll explore on my own",
    onb_spot_budget_title:'Set an expected amount',
    onb_spot_budget_body:"This is where you plan ahead. Type how much you expect to earn from your first income source below.",
    onb_spot_tx_title:'Log your first transaction',
    onb_spot_tx_body:"Transactions are what actually happened. Fill in the date, category, and amount below, then hit Add to log your first one.",
    onb_next_btn:'Next',
    onb_nice_toast:'Nice! Moving on...',
    onb_tips_title:"You're all set!",
    onb_tips_sub:'A few more things worth knowing:',
    onb_tip1_h:'Guide button',onb_tip1_b:'Tap the ? icon on any tab for detailed help on that section.',
    onb_tip2_h:'Fill in the rest',onb_tip2_b:"Don't forget Expenses, Bills, Debt & Savings - the same way you just did Income.",
    onb_tip3_h:'Sync across devices',onb_tip3_b:'Turn on Google Sync in Settings to access your budget from any device.',
    onb_tip4_h:'Export anytime',onb_tip4_b:'Download a CSV backup of your data whenever you like, from Settings.',
    onb_finish_btn:'Start budgeting →',
    dash_stat_income:'Total Income',dash_stat_of_expected:'of {0} expected',
    dash_stat_exp_bills:'Expenses &amp; Bills',dash_stat_of_budgeted:'of {0} budgeted',
    dash_stat_debt:'Debt Payments',dash_stat_savings:'Total Savings',dash_stat_of_goal:'of {0} goal',
    dash_net_leftover_period:'Net Leftover this period',dash_includes_rollover:'Includes {0} rollover from last period',
    dash_lf_income:'income',dash_lf_exp_bills:'exp &amp; bills',dash_lf_debt:'debt',dash_lf_savings:'savings',dash_lf_rollover:'rollover',
    dash_cash_flow:'Cash Flow - Expected vs Actual',dash_income_kept:'of income kept',dash_expected:'Expected',dash_actual:'Actual',
    dash_daily_spend:'Daily Spend',dash_daily_spend_caption:'total spend this period',spend_tip_more:'+{0} more',dash_other_category:'Other',
    dash_savings_rate:'Savings Rate', dash_saved_sfx:'saved',
    dash_income_sources:'Income Sources',dash_no_income:'No income logged yet.',dash_add_tx_link:'Add transactions →',
    dash_spending_breakdown:'Spending Breakdown',dash_no_spending:'No spending logged yet.',
    upgrade_feat_debt:'💳 Debt Payoff',upgrade_feat_sinking:'🏺 Sinking Funds',upgrade_feat_calendar:'📅 Smart Calendar',
    upgrade_feat_subs:'🔄 Subscriptions',upgrade_feat_auto:'⚡ Automation',upgrade_feat_alloc:'🎯 Allocation',
    upg_chip_tx:'{0} / {0} free transactions used',upg_chip_cat:'{0} / {0} free {1} categories used',upg_chip_limit:'Free trial limit reached',
    upg_aria_label:'Upgrade to unlock the full planner',
    upg_title_html:'Unlock the full<br>Simple Budget Planner',
    upg_sub:"You're at the free trial limit. Upgrade once to remove every cap. No subscription, ever.",
    upg_feat_unlimited_tx_html:'<strong>Unlimited</strong> transactions',
    upg_feat_unlimited_cat_html:'<strong>Unlimited</strong> categories in every section',
    upg_feat_csv:'CSV import &amp; export, full history',upg_feat_onetime:'One-time payment · free updates for life',
    upg_price_tag:'one-time',upg_price_note:'No subscription',
    upg_cta_sbp:'Unlock Simple Budget for {0}',
    upg_upsell_lead:'⚡ Want debt payoff, sinking funds &amp; more?',upg_upsell_cta:'Get Ultimate for {0} →',
    upg_later:'Maybe later',
    reauth_title:'Sign in with Google to continue',
    reauth_sub:'Your data for this tool is synced with Google Drive. Sign in again to pick up where you left off.',
    reauth_submit:'Sign in with Google',reauth_local:'Use local data on this device instead',
    sync_welcome:'Welcome to Ezzo Budget',sync_choose:'Choose how to save your data.',sync_recommended:'Recommended',
    sync_continue_google:'Continue with Google',sync_desc_multi_device:'Planner data is stored across multiple devices',
    sync_use_no_account:'Use without an account',sync_desc_this_device:'Planner data is stored on this device only',
    sync_status_wait:'Complete the steps in the Google window that just opened. If nothing appeared, check your address bar for a blocked pop-up icon.',
    sync_footer_note:'This can be changed in settings later',
    code_title:'Enter your license key',code_sub:'Unlock the full {0} with the code from your purchase.',
    code_placeholder:'License key',code_error:"That code isn't right. Double-check it and try again.",
    code_orderid_placeholder:'Order ID',code_orderid_error:'Enter the order ID from your purchase.',
    code_submit:'Submit',code_checking:'Checking...',code_try_free:'Try for free instead',code_get:'Get a code',
    app_name_sbp:'Simple Budget Planner',app_name_ubp:'Ultimate Budget Planner',
    edit_tx_title:'✏️ Edit Transaction',save_changes:'Save changes',no_categories:'- no categories -',
    no_cat_setup:'- set up categories first -',
    tx_error_required:'Please fill in date, type, category, and a valid amount greater than 0.',
    csv_error_msg:'No valid rows found.\n\nExpected format:\nDate, Type, Category, Amount, Description\n2024-01-15, expense, Food, 25.50, Grocery run',
    sync_card_title:'☁️ Data &amp; Sync',sync_card_desc:'Choose how your data is stored and kept up to date across devices.',
    sync_mode_local_title:'This device only',sync_mode_local_desc:'Data is saved on this device only',
    sync_mode_google_title:'Sync with Google',sync_mode_google_desc:'Data is synced across multiple devices',
    sync_signed_in_as:'Signed in as {0}',sync_error_generic:"Sign-in didn't go through. Please try again.",
    sync_err_popup_blocked:'Your browser blocked the Google sign-in window. Please allow pop-ups for this site (check your address bar for a blocked pop-up icon) and try again.',
    sync_err_cancelled:'Sign-in was cancelled. Please try again.',
    toast_synced_google:'Synced with Google Drive ✓',toast_synced_local:'Switched to local storage ✓',
    cmp_title:'⚡ Simple vs Ultimate Budget Planner',cmp_col_feature:'Feature',cmp_col_simple:'💰 Simple',cmp_col_ultimate:'⚡ Ultimate',
    cmp_section_core:'Core budgeting',cmp_section_pro:'Pro features - Ultimate only',
    cmp_stay_simple:'Stay with Simple',cmp_open_ultimate:'Open Ultimate Budget Planner →',
    cmp_feat1:'Budget tracking - Income, Expenses, Bills &amp; Savings',
    cmp_feat2:'Transaction logging with CSV import',
    cmp_feat3:'Cash flow chart - expected vs actual',
    cmp_feat4:'Income &amp; spending donut charts',
    cmp_feat5:'Budget period control with presets',
    cmp_feat6:'Rollover from previous period',
    cmp_feat7:'Debt Payoff (Snowball &amp; Avalanche)',
    cmp_feat8:'Sinking funds tracker with monthly goals',
    cmp_feat9:'Smart calendar with all events auto-populated',
    cmp_feat10:'Subscription tracker with category breakdown',
    cmp_feat11:'Pro dashboard with hero stats &amp; upcoming panel',
    cmp_feat12:'One-click import from Simple Budget Planner',
    cmp_feat13:'Ezzo - your AI budget assistant',
    help_aria:'Help',close_aria:'Close',dismiss_aria:'Dismiss',ok:'OK',
  },
  de: {
    lang_name:'Deutsch',
    tab_dashboard:'Dashboard',tab_budget:'Budget',tab_transactions:'Transaktionen',
    tab_income:'Einnahmen',tab_expenses:'Ausgaben',tab_bills:'Rechnungen',
    tab_debt:'Schulden',tab_savings:'Ersparnisse',tab_settings:'Einstellungen',
    tab_debt_payoff:'Schuldenabbau',tab_sinking:'Rücklagen',
    tab_calendar:'Kalender',tab_subscriptions:'Abonnements',
    total_income:'Gesamteinnahmen',expenses_bills:'Ausgaben & Rechnungen',
    debt_payments:'Schuldenzahlungen',total_savings:'Gesamtersparnis',
    total_outgoing:'Gesamtausgaben',savings_rate:'Sparquote',
    net_leftover:'Verbleibend',cash_flow:'Cashflow',
    income_sources:'Einkommensquellen',spending_breakdown:'Ausgabenübersicht',
    expected:'Geplant',actual:'Tatsächlich',progress:'Fortschritt',
    of:'von',budgeted:'budgetiert',saved:'gespart',
    budget_period:'Budgetzeitraum',start_date:'Startdatum',end_date:'Enddatum',
    this_month:'Diesen Monat',this_week:'Diese Woche',last_week:'Letzte Woche',last_month:'Letzter Monat',last_30_days:'Letzte 30 Tage',this_quarter:'Dieses Quartal',this_year:'Dieses Jahr',
    toast_tx_added:'Transaktion hinzugef\u00fcgt \u2713',toast_tx_updated:'Aktualisiert \u2713',toast_tx_deleted:'Gel\u00f6scht',
    toast_period_updated:'Zeitraum aktualisiert \u2713',toast_period_error:'Enddatum muss nach dem Startdatum liegen',
    toast_currency_updated:'W\u00e4hrung aktualisiert \u2713',toast_imported:'{0} importiert \u2713',
    toast_fund_created:'Fonds erstellt \u2713',toast_fund_updated:'Fonds aktualisiert \u2713',
    toast_fund_contrib:'{amt} zu {name} hinzugef\u00fcgt \u2713',
    toast_sub_added:'Abonnement hinzugef\u00fcgt \u2713',toast_sub_updated:'Abonnement aktualisiert \u2713',
    toast_alloc_enabled:'Aufteilung aktiviert \u2713',toast_alloc_disabled:'Aufteilung deaktiviert',
    toast_lang_updated:'Sprache aktualisiert \u2713',toast_export:'Exportiert \u2713',
    toast_saved:'Gespeichert \u2713',toast_reset:'Alle Daten gel\u00f6scht',
    toast_alloc_bucket_added:'Kategorie hinzugef\u00fcgt \u2713',
    confirm_remove_cat:'Diese Kategorie entfernen?',
    confirm_remove_cat_with_tx:'{0} bestehende Transaktion(en) verwenden diese Kategorie. Sie behalten sie als Bezeichnung, wird aber nicht mehr in deinem Budget erfasst. Trotzdem löschen?',
    confirm_delete_all_tx:'ALLE Transaktionen l\u00f6schen? Das kann nicht r\u00fcckg\u00e4ngig gemacht werden.',
    confirm_delete_tx:'Diese Transaktion l\u00f6schen?',confirm_remove_debt:'Diese Schuld entfernen?',
    confirm_delete_fund:'Diesen Fonds l\u00f6schen?',confirm_remove_sub:'Dieses Abonnement entfernen?',
    confirm_reset_1:'Bist du sicher? Alle Daten werden dauerhaft gel\u00f6scht.',
    confirm_reset_2:'Letzte Chance - das kann nicht r\u00fcckg\u00e4ngig gemacht werden. Fortfahren?',
    export_csv_btn:'\uD83D\uDCE5 CSV exportieren',
    sett_export_title:'\uD83D\uDCE4 Daten exportieren',
    sett_export_desc:'Alle Transaktionen als CSV-Datei herunterladen, zur Sicherung oder Nutzung in einer anderen App.',
    sf_add_contribution:'Beitrag hinzuf\u00fcgen',sf_contribution_label:'Hinzuzuf\u00fcgender Betrag',
    sf_currently_saved:'Bisher gespart',
    tx_search_ph:'Nach Beschreibung oder Kategorie suchen\u2026',
    tx_filter_all_types:'Alle Arten',tx_filter_all_alloc:'Alle Zuordnungen',
    tx_add_btn:'Hinzufügen',tx_add_title:'Transaktion hinzufügen',tx_amount:'Betrag',tx_category:'Kategorie',tx_clear_all:'Alle löschen',tx_date:'Datum',tx_desc_label:'Beschreibung',tx_desc_ph:'z.B. Einkaufen\u2026',tx_empty:'Noch keine Transaktionen.',tx_import_csv:'\uD83D\uDCE5 CSV importieren',tx_th_amount:'Betrag',tx_th_desc:'Beschreibung',tx_transaction_many:'Transaktionen',tx_transaction_one:'Transaktion',tx_type:'Art',tx_type_bill:'Rechnung',tx_type_debt:'Schulden',tx_type_expense:'Ausgaben',tx_type_income:'Einnahmen',tx_type_savings:'Ersparnisse',tx_empty_sub:'F\u00fcge deine erste Transaktion hinzu, um zu beginnen',
    tx_sort_date_new:'Neueste zuerst',tx_sort_date_old:'\u00c4lteste zuerst',
    tx_sort_amt_high:'H\u00f6chster Betrag',tx_sort_amt_low:'Niedrigster Betrag',
    tx_showing:'{n} von {total} angezeigt',tx_no_results:'Keine Transaktionen entsprechen deinem Filter.',
    alloc_add_bucket:'+ Kategorie hinzuf\u00fcgen',alloc_remove_btn:'Entfernen',
    alloc_min_buckets:'Mindestens 2 Kategorien erforderlich',
    alloc_auto_tag:'Automatisch markiert \u2192 {name}',
    tx_prev:'\u2190 Zur\u00fcck',tx_next:'Weiter \u2192',tx_page_of:'Seite {n} von {total}',
    debt_due_day_note:'Tage 29-31 erscheinen nicht in k\u00fcrzeren Monaten',
    sub_advanced:'Abrechnungsdatum vorger\u00fcckt auf {date}',
    currency:'Währung',rollover:'Übertrag',appearance:'Erscheinungsbild',
    language:'Sprache',reset_data:'Alle Daten zurücksetzen',
    light:'Hell',dark:'Dunkel',theme_synthwave:'Synthwave',theme_vintage_ledger:'Vintage',theme_terminal:'Terminal',
    dashboard_layout:'Dashboard-Layout',dashboard_layout_desc:'Wähle, wie dein Dashboard gestaltet und visualisiert wird.',
    layout_1:'Klassisch',layout_2:'Radialer Puls',layout_coming_soon:'Bald mehr!',
    changes_autosaved:'✅ Änderungen werden automatisch gespeichert.',
    rollover_desc:'Überträgt nicht ausgegebenes Geld aus der vorherigen Periode.',
    rollover_amount:'Übertragsbetrag',
    reset_desc:'Löscht alle Daten dauerhaft. Dies kann nicht rückgängig gemacht werden.',
    reset_btn:'Alles zurücksetzen',
    add:'Hinzufügen',cancel:'Abbrechen',rename_title_prompt:'Budgetplaner umbenennen',save:'Speichern',delete:'Löschen',dp_today:'Heute',dp_clear:'Löschen',edit:'Bearbeiten',field_info_aria:'Über {0}',
    mod_name_hint:'Die Bezeichnung, die du überall in der App für diese Kategorie siehst.',mod_due_date_hint:'Wann dies jeden Monat fällig ist - wird für den Kalender und die Bezahlt-Markierung verwendet.',
    mod_th_expected_hint:'Der Betrag, den du monatlich für diese Kategorie einplanst.',mod_th_actual_hint:'Wird automatisch aus deinen erfassten Transaktionen in dieser Kategorie berechnet.',mod_th_progress_hint:'Wie viel Prozent des geplanten Betrags bisher verbraucht wurde.',
    tx_date_hint:'Das Datum, an dem diese Transaktion stattfand.',tx_type_hint:'Um welche Art von Transaktion es sich handelt - bestimmt, aus welcher Kategorieliste du wählen kannst.',tx_category_hint:'Welcher Budgetkategorie diese Transaktion zugerechnet wird.',tx_amount_hint:'Wie viel Geld diese Transaktion betraf.',tx_desc_hint:'Eine optionale Notiz, damit du dich erinnerst, wofür das war.',
    paid:'Bezahlt',due_date:'Fälligkeitsdatum',category:'Kategorie',amount:'Betrag',
    description:'Beschreibung',date:'Datum',type:'Typ',
    add_category:'+ Kategorie hinzufügen',no_transactions:'Noch keine Transaktionen.',
    upgrade_title:'Upgrade auf Ultimate Budget Planner',
    upgrade_desc:'Alles aus Simple, plus die Pro-Tools, um voranzukommen: Schulden abbauen, gezielt sparen und keine Rechnung mehr verpassen.',
    upgrade_now:'Jetzt upgraden →',upgrade_get_now:'JETZT HOLEN',upgrade_compare:'PLANER VERGLEICHEN',sett_upgrade_h:'Upgrade-Banner',sett_upgrade_label:'Upgrade-Banner im Dashboard anzeigen',
    mon:'Mo',tue:'Di',wed:'Mi',thu:'Do',fri:'Fr',sat:'Sa',sun:'So',
    quick_presets:'Schnellauswahl:',select_currency:'Währung auswählen',select_language:'Sprache auswählen',
    appearance_desc:'Wähle ein Farbthema.',
    dash_anim_title:'Dashboard-Animationen',dash_anim_desc:'Beim Laden des Dashboards eine dezente Eingangsanimation abspielen.',dash_anim_label:'Animationen aktivieren',
    help_sett_modal_title:'Einstellungen im Überblick',help_sett_intro:'Passe Ezzo Budget an deine Situation an.',
    help_sett_currency_li:'Aktualisiert das Symbol überall (manche Währungen wie PLN setzen das Symbol nach dem Betrag).',
    help_sett_period_li:'Lege deinen Datumsbereich fest. Klicke auf das Datums-Badge im Dashboard, um schnell hierher zu gelangen.',
    help_sett_rollover_li:'Überträgt nicht ausgegebenes Geld aus der letzten Periode.',
    help_sett_theme_li:'Wähle aus fünf Farbthemen - Hell, Dunkel, Synthwave, Vintage oder Terminal.',
    help_sett_layout_li:'Wähle aus zwei Dashboard-Designs - Klassisch oder Radialer Puls - jedes mit eigenen Diagrammen und Layout; weitere Designs folgen bald.',
    help_dash_modal_title:'Wie das Dashboard funktioniert',help_dash_intro:'Das Dashboard ist deine Finanzübersicht in Echtzeit. Alles aktualisiert sich automatisch, sobald du Transaktionen erfasst.',
    help_dash_cards_h:'Übersichtskarten',help_dash_cards_li:'Summen für Einnahmen, Ausgaben &amp; Rechnungen, Schuldenzahlungen und Ersparnisse für den aktuellen Zeitraum.',
    help_dash_leftover_li:'Was nach allen Ausgaben übrig bleibt. <span style="color:#10b981;font-weight:600">Grün</span> = Überschuss, <span style="color:#f43f5e;font-weight:600">Rot</span> = über dem Budget.',
    help_dash_flow_h:'Cashflow-Diagramm',help_dash_flow_li:'Vergleicht, was du <em>erwartet</em> hast, mit dem, was <em>tatsächlich passiert ist</em>.',
    help_dash_donut_h:'Kreisdiagramme',help_dash_donut_li:'Einnahmenaufteilung und Ausgabenverteilung in Prozent.',
    help_dash_datebadge_h:'Datums-Badge',help_dash_datebadge_li:'Klicke darauf, um direkt zu den Einstellungen zu springen und deinen Budgetzeitraum zu ändern.',
    help_dash_tip:'💡 Tipp: Trage zuerst die geplanten Beträge bei Einnahmen / Ausgaben / Rechnungen / Schulden / Ersparnisse ein und erfasse dann Transaktionen, damit die tatsächlichen Werte erscheinen.',
    help_tx_modal_title:'Wie Transaktionen funktionieren',help_tx_intro:'Erfasse hier jede Bewegung deines Geldes. Die Budgetmodule aktualisieren sich automatisch.',
    help_tx_type_li:'Einnahme, Ausgabe, Rechnung, Schulden oder Ersparnisse.',help_tx_category_li:'Wird aus den Kategorien deiner Budgetmodule übernommen.',
    help_tx_edit_h:'✏️ Bearbeiten-Schaltfläche',help_tx_edit_li:'Klicke auf das Stiftsymbol einer beliebigen Zeile, um diese Transaktion zu bearbeiten oder zu löschen.',
    help_tx_csv_h:'CSV-Importformat:',
    help_inc_modal_title:'Wie Einnahmen funktionieren',help_inc_intro:'Verfolge geplante gegenüber tatsächlichen Einnahmen. Fortschrittsbalken aktualisieren sich live, während du geplante Beträge eingibst.',
    help_inc_expected_li:'Gib deine geplanten Einnahmen ein; der Balken aktualisiert sich sofort.',help_inc_actual_li:'Wird automatisch aus Einnahme-Transaktionen berechnet.',
    help_inc_tip:'💡 Tipp: Erfasse Einkünfte in den Transaktionen als Typ „Einnahme“, damit sie hier als tatsächliche Werte erscheinen.',
    help_exp_modal_title:'Wie Ausgaben funktionieren',help_exp_intro:'Lege Ausgabenlimits pro Kategorie fest. Fortschrittsbalken aktualisieren sich live und werden rot, wenn du das Limit überschreitest.',
    help_exp_expected_li:'Dein Ausgabenlimit; der Balken aktualisiert sich, während du tippst.',help_exp_actual_li:'Wird aus Ausgabe-Transaktionen summiert.',
    help_bills_modal_title:'Wie Rechnungen funktionieren',help_bills_intro:'Behalte wiederkehrende Rechnungen mit Fälligkeitsdatum und Zahlungsstatus im Blick.',
    help_bills_duedate_li:'Lege fest, wann jede Rechnung fällig ist.',help_bills_paid_li:'Hake ab, sobald du die Zahlung geleistet hast - du wirst nach dem tatsächlichen Betrag gefragt, der als Transaktion erfasst wird, da Rechnungen wie Nebenkosten selten genau dem budgetierten Betrag entsprechen.',help_bills_actual_li:'Wird aus Rechnung-Transaktionen mit passendem Kategorienamen befüllt.',
    help_debt_modal_title:'Wie Schulden funktionieren',help_debt_intro:'Behalte Kredit- und Hypothekenzahlungen im Blick.',
    help_debt_expected_li:'Deine geplante monatliche Zahlung.',help_debt_duedate_li:'Wann die Zahlung fällig ist.',help_debt_paid_li:'Markiere sie, sobald die Zahlung erfolgt ist - du wirst nach dem tatsächlich gezahlten Betrag gefragt, der als Transaktion erfasst wird, da er von deiner geplanten Zahlung abweichen kann.',
    help_sav_modal_title:'Wie Ersparnisse funktionieren',help_sav_intro:'Lege Sparziele fest und verfolge deine Einzahlungen.',
    help_sav_expected_li:'Dein Sparziel für diesen Zeitraum.',help_sav_actual_li:'Aus Transaktionen vom Typ Ersparnisse.',
    help_sav_tip:'💡 Tipp: Behandle Sparen wie eine feste Ausgabe - budgetiere es zuerst und gib danach den Rest aus.',
    // Guide
    guide_group_start:'Erste Schritte', guide_group_track:'Deine Finanzen im Blick', guide_group_settings:'Ganz nach deinen Wünschen',
    guide_section_big:'Worum es geht', guide_section_how:'So funktioniert’s', guide_section_connects:'Die Zusammenhänge', guide_back:'Zurück zur Übersicht',
    guide_welcome_title:'Willkommen bei Simple Budget Planner',
    guide_welcome_big:'Diese App beantwortet jeden Monat eine Frage: Wo ist mein Geld geblieben? Du trägst ein, was reinkommt und was rausgeht, und die App übernimmt die Rechenarbeit - so weißt du immer genau, wo du stehst. Keine Tabellen, kein Rätselraten - einfach ein klares Bild deiner Finanzen.',
    guide_dashboard_title:'Dashboard',
    guide_dashboard_big:'Stell dir das Dashboard als Titelseite deiner Finanzen vor - ein Blick genügt, um zu sehen, was reinkommt, was rausgeht und was übrig bleibt. Es lohnt sich, hier als Erstes reinzuschauen, wenn du die App öffnest.',
    guide_dashboard_step1:'Wirf einen Blick auf die Übersichtskarten oben für dein <strong>Gesamteinkommen</strong>, deine <strong>Gesamtausgaben</strong> und deinen <strong>Nettoüberschuss</strong> für die aktuelle Periode.',
    guide_dashboard_step2:'Scrolle zum <strong>Cashflow</strong>-Diagramm, um zu sehen, wie sich dein Geld Woche für Woche bewegt.',
    guide_dashboard_step3:'Schau dir das <strong>Ausgabenverteilung</strong>-Diagramm an, um zu erkennen, welche Kategorie den größten Teil deines Budgets verschlingt.',
    guide_dashboard_connect1:'Jede Transaktion, die du irgendwo in der App hinzufügst, aktualisiert diese Zahlen sofort - es gibt nichts zu aktualisieren oder neu zu berechnen.',
    guide_dashboard_connect2:'Der Nettoüberschuss enthält auch jeden <strong>Übertrag</strong>-Betrag, den du in den Einstellungen festgelegt hast, sodass ein guter Monat in den nächsten übergehen kann.',
    guide_dashboard_connect3:'Wenn eine Zahl falsch aussieht, liegt der Fehler fast immer bei Transaktionen, Einnahmen, Ausgaben, Rechnungen, Schulden oder Ersparnissen - das Dashboard zeigt nur, was bereits eingetragen wurde.',
    guide_dashboard_tip:'Mach das Dashboard-Checken zu einer Gewohnheit - schon 10 Sekunden am Tag verhindern, dass aus kleinen Überraschungen große werden.',guide_dashboard_usecase_h:'So sieht das in der Praxis aus',guide_dashboard_usecase_p:'<p><strong>Liam</strong> prüft das Dashboard, bevor er entscheidet, ob er diese Woche essen geht. Er sieht, dass sein Nettosaldo für diese Periode nur 45 € beträgt, deutlich unter seinem üblichen Puffer, also kocht er stattdessen zu Hause - er erkennt das Problem frühzeitig, statt es zu bemerken, wenn sein Konto fast leer ist.</p>',
    guide_transactions_title:'Transaktionen',
    guide_transactions_big:'Transaktionen sind das Fundament für alles andere in dieser App - jeder Euro, den du hier einträgst, treibt dein Dashboard, deine Kategorien und dein Endergebnis an. Gewöhne dir an, direkt beim Ausgeben einzutragen, dann läuft der Rest von selbst.',
    guide_transactions_step1:'Tippe auf <strong>Transaktion hinzufügen</strong>, wähle, ob es sich um Einnahmen, eine Ausgabe, eine Rechnung, Schulden oder Ersparnisse handelt, und trage Betrag und Kategorie ein.',
    guide_transactions_step2:'Hast du deine Ausgaben schon in einer Tabelle? Nutze <strong>CSV importieren</strong>, um alles auf einmal einzuspielen, statt jede Zeile von Hand einzutippen.',
    guide_transactions_step3:'Tippe auf eine Transaktion in der Liste, um Betrag, Datum oder Kategorie zu <strong>bearbeiten</strong>, falls dir ein Fehler unterlaufen ist oder sich etwas geändert hat.',
    guide_transactions_step4:'Nutze die Such- und Filterfunktionen über der Liste, um eine bestimmte Transaktion schnell nach Art, Kategorie oder Datum zu finden.',
    guide_transactions_connect1:'Jede Transaktion, die du einträgst, zählt automatisch zur passenden Kategorie - eine Ausgabe erscheint bei Ausgaben, eine Rechnungszahlung bei Rechnungen und so weiter.',
    guide_transactions_connect2:'Deine Dashboard-Summen und -Diagramme basieren vollständig auf diesen Einträgen - nichts wird geschätzt.',
    guide_transactions_connect3:'Das Löschen oder Bearbeiten einer Transaktion aktualisiert sofort jede Summe überall in der App.',
    guide_transactions_tip:'Trage Transaktionen noch am selben Tag ein. Es dauert nur Sekunden und hält dein Dashboard zuverlässig.',guide_transactions_usecase_h:'So sieht das in der Praxis aus',guide_transactions_usecase_p:'<p><strong>Aisha</strong> wird freitags bezahlt. Sie öffnet Transaktionen, wählt Einnahme → Gehalt, gibt den Betrag ein, und er ist sofort erfasst - erscheint gleich auf ihrem Dashboard als Teil ihres Gesamteinkommens für die Periode.</p>',
    guide_income_title:'Einnahmen',
    guide_income_big:'Hier sagst du der App, wie viel Geld du erwartest zu verdienen, und verfolgst dann, was tatsächlich reingekommen ist - so siehst du die Lücke zwischen beidem auf einen Blick.',
    guide_income_step1:'Lege den <strong>erwarteten</strong> Betrag für jede Einnahmequelle fest, etwa dein Gehalt oder einen Nebenjob.',
    guide_income_step2:'Sobald Geld reinkommt, trage es als Einnahme-Transaktion ein - sie füllt automatisch deine Spalte <strong>Tatsächlich</strong>.',
    guide_income_step3:'Vergleiche Erwartet mit Tatsächlich, um zu sehen, ob du im Plan liegst oder ob noch Einnahmen ausstehen.',
    guide_income_connect1:'Einnahme-Transaktionen, die du bei Transaktionen einträgst, fließen direkt in die Tatsächlich-Summen dieser Seite ein.',
    guide_income_connect2:'Dein Gesamteinkommen im Dashboard ist die Summe aus allem, was hier erfasst wird.',
    guide_income_connect3:'Ein höherer Nettoüberschuss beginnt hier - je genauer du deine Einnahmen erfasst, desto genauer wird dein ganzes Budget.',
    guide_income_tip:'Erfasse jede Einnahmequelle einzeln, auch kleine oder unregelmäßige - so erkennst du Muster über die Zeit viel leichter.',guide_income_usecase_h:'So sieht das in der Praxis aus',guide_income_usecase_p:'<p>Vor Monatsbeginn setzt <strong>Carlos</strong> sein erwartetes Gehalt auf 3.200 € und sein erwartetes Freelance-Einkommen auf 400 € im Einkommen-Modul.</p><p>Während Zahlungen über Transaktionen eingehen, aktualisiert sich die Spalte Tatsächlich automatisch, sodass er auf einen Blick sieht, ob die Freelance-Arbeit diesen Monat mit seiner Planung Schritt hält.</p>',
    guide_expenses_title:'Ausgaben',
    guide_expenses_big:'Ausgaben sind deine alltäglichen Ausgaben - Lebensmittel, Benzin, Kaffee, all das. Mit einem erwarteten Betrag pro Kategorie hast du einen Maßstab, statt nur zuzusehen, wie das Geld verschwindet.',
    guide_expenses_step1:'Füge für jede Ausgabenart, die du verfolgen möchtest, eine Kategorie hinzu, etwa Lebensmittel oder Unterhaltung.',
    guide_expenses_step2:'Lege für jede einen <strong>erwarteten</strong> Betrag fest - das, was du nicht überschreiten möchtest.',
    guide_expenses_step3:'Trage Einkäufe als Ausgabe-Transaktionen ein und beobachte, wie sich die Spalte <strong>Tatsächlich</strong> automatisch füllt.',
    guide_expenses_connect1:'Jede Ausgabe-Transaktion, die du bei Transaktionen einträgst, wird direkt der passenden Kategorie hier zugerechnet.',
    guide_expenses_connect2:'Kategorien, die ihren erwarteten Betrag überschreiten, prägen mit das Ausgabenverteilung-Diagramm im Dashboard.',
    guide_expenses_connect3:'Eine überzogene Kategorie hier zu kürzen, ist einer der schnellsten Wege, deinen Nettoüberschuss zu erhöhen.',
    guide_expenses_tip:'Starte mit nur einer Handvoll grober Kategorien. Du kannst sie später jederzeit weiter aufteilen, sobald du siehst, wohin das Geld wirklich fließt.',guide_expenses_usecase_h:'So sieht das in der Praxis aus',guide_expenses_usecase_p:'<p><strong>Nina</strong> möchte sehen, wohin ihr Geld tatsächlich fließt, also legt sie erwartete Beträge für Lebensmittel, Essen gehen und Transport in Ausgaben fest.</p><p>Mitten im Monat bemerkt sie, dass Essen gehen bereits bei 90 % seines Budgets liegt, und schränkt sich für den Rest der Periode ein, statt es erst am Monatsende zu erfahren.</p>',
    guide_bills_title:'Rechnungen',
    guide_bills_big:'Rechnungen sind die Zahlungen, die du nicht auslassen kannst - Miete, Nebenkosten, Abos, zu denen du dich verpflichtet hast. Diese Seite behält Fälligkeitsdaten und Zahlungsstatus im Blick, damit nichts durchrutscht.',
    guide_bills_step1:'Füge eine Rechnung hinzu und gib ihr ein <strong>Fälligkeitsdatum</strong>, damit du genau weißt, wann sie fällig ist.',
    guide_bills_step2:'Sobald du sie bezahlt hast, hake das Kästchen <strong>Bezahlt</strong> ab, um sie für diese Periode als erledigt zu markieren.',
    guide_bills_step3:'Trage die tatsächliche Zahlung als Rechnung-Transaktion ein, damit der Betrag in deine Summen einfließt.',
    guide_bills_connect1:'Unbezahlte Rechnungen mit nahendem Fälligkeitsdatum solltest du genau prüfen, bevor du das Geld anderswo ausgibst.',
    guide_bills_connect2:'Rechnung-Transaktionen zählen zu deinen Gesamtausgaben im Dashboard, direkt neben Ausgaben und Schulden.',
    guide_bills_connect3:'Eine Rechnung als bezahlt zu markieren, entfernt sie nicht - es verfolgt nur den Status, sodass du immer eine Aufzeichnung hast, was in dieser Periode beglichen wurde.',
    guide_bills_tip:'Trage wiederkehrende Rechnungen gleich zu Beginn jeder Periode ein, damit die Fälligkeitsdaten auf dich warten, statt dass du sie dir merken musst.',guide_bills_usecase_h:'So sieht das in der Praxis aus',guide_bills_usecase_p:'<p>Jeden Monat ist <strong>Dereks</strong> Stromrechnung etwas anders. Er legt Fälligkeitsdatum und erwarteten Betrag (100 €) für Strom in Rechnungen fest.</p><p>Wenn er sie tatsächlich bezahlt, hakt er das Bezahlt-Kästchen ab und gibt die tatsächlich berechneten 118,32 € ein - das wird als echte Transaktion erfasst statt nur als Häkchen, sodass seine Ausgabenhistorie stimmt, auch wenn die Rechnung nicht genau seiner Planung entsprach.</p>',
    guide_debt_title:'Schulden',
    guide_debt_big:'Diese Seite versammelt jede Zahlung, die du schuldest, an einem Ort - Kreditkarten, Kredite, alles mit einem Saldo - damit du immer weißt, was fällig ist und ob du hinterherkommst.',
    guide_debt_step1:'Füge jede Schuld, die du verfolgst, zusammen mit deiner <strong>erwarteten</strong> Zahlung für diese Periode hinzu.',
    guide_debt_step2:'Lege ein <strong>Fälligkeitsdatum</strong> fest, damit du genau weißt, wann die Zahlung rausgehen muss.',
    guide_debt_step3:'Trage die Zahlung als Schulden-Transaktion ein und hake <strong>Bezahlt</strong> ab, sobald sie verbucht ist.',
    guide_debt_connect1:'Schuldenzahlungen zählen zu deinen Gesamtausgaben im Dashboard, zusammen mit Ausgaben und Rechnungen.',
    guide_debt_connect2:'Diese Seite verfolgt Zahlungen als Kategorie, nicht als vollständigen Tilgungsplan - wenn du eine Schneeball- oder Lawinenstrategie mit Zinsprognosen möchtest, ist dafür die Schuldentilgung von Ultimate Budget Planner gemacht.',
    guide_debt_connect3:'Hier konsequent zu bleiben, hält deinen Nettoüberschuss ehrlich, denn unbezahlte Schulden holen einen später gerne ein.',
    guide_debt_tip:'Liste auch kleine Schulden auf, etwa ein Familiendarlehen - es geht nicht um die Höhe, sondern darum, alles, was du schuldest, an einem Ort zu wissen.',guide_debt_usecase_h:'So sieht das in der Praxis aus',guide_debt_usecase_p:'<p><strong>Grace</strong> hat einen kleinen Privatkredit bei ihrer Schwester. Sie trägt ihn mit dem vereinbarten monatlichen Betrag und einem Fälligkeitsdatum in Schulden ein.</p><p>Wenn sie die Zahlung sendet, hakt sie Bezahlt ab und gibt den genauen gesendeten Betrag ein, sodass er in ihrer Transaktionshistorie erfasst wird wie jede andere Schuldenzahlung auch.</p>',
    guide_savings_title:'Ersparnisse',
    guide_savings_big:'Bei Ersparnissen legst du bewusst Geld beiseite, statt nur zu sehen, was am Monatsende übrig bleibt. Sie wie jede andere geplante Ausgabe zu behandeln, ist der einfachste Weg, sie wirklich aufzubauen.',
    guide_savings_step1:'Lege einen <strong>erwarteten</strong> Betrag fest, den du in dieser Periode sparen möchtest.',
    guide_savings_step2:'Trage jedes Mal, wenn du Geld ins Sparen verschiebst, eine Ersparnisse-Transaktion ein.',
    guide_savings_step3:'Vergleiche Erwartet mit <strong>Tatsächlich</strong>, um zu sehen, ob du dein Sparziel für die Periode erreicht hast.',
    guide_savings_connect1:'Ersparnisse-Transaktionen, die du bei Transaktionen einträgst, zählen direkt zu den Summen dieser Seite.',
    guide_savings_connect2:'Deine Gesamtersparnisse im Dashboard stammen direkt aus dem, was hier erfasst wird.',
    guide_savings_connect3:'Ersparnisse fließen in deine Nettoüberschuss-Berechnung ein, sodass regelmäßiges Sparen einer der direktesten Wege ist, diese Zahl über die Zeit zu steigern.',
    guide_savings_tip:'Lege deinen Sparbetrag zuerst fest, bevor du den Rest deines Budgets planst - es ist viel leichter, ein Ziel zu erreichen, zu dem du dich von vornherein verpflichtest.',guide_savings_usecase_h:'So sieht das in der Praxis aus',guide_savings_usecase_p:'<p>Bei jeder Zahlung legt <strong>Wen</strong> Geld für eine Hausanzahlung zurück. Sie legt ihren erwarteten Sparbetrag im Sparen-Modul fest, und während sie im Laufe der Periode Spar-Transaktionen erfasst, sieht sie den Fortschrittsbalken sich dem geplanten Ziel nähern.</p>',
    guide_settings_title:'Einstellungen',
    guide_settings_big:'In den Einstellungen passt sich die App an dich an - deine Währung, deinen Budgetzeitraum, das Erscheinungsbild, die Sprache und den Umgang mit deinen Daten.',
    guide_settings_step1:'Wähle deine <strong>Währung</strong>, damit jeder Betrag in der App so angezeigt wird, wie du es erwartest.',
    guide_settings_step2:'Wähle deinen <strong>Budgetzeitraum</strong> (etwa monatlich oder zweiwöchentlich) passend dazu, wie du tatsächlich bezahlt wirst und Rechnungen begleichst.',
    guide_settings_step3:'Trage einen <strong>Übertrag</strong>-Betrag ein, wenn nicht ausgegebenes Geld aus der letzten Periode in den Nettoüberschuss dieser Periode einfließen soll.',
    guide_settings_step4:'Wähle ein <strong>Erscheinungsbild</strong>-Thema (Hell, Dunkel, Synthwave, Vintage oder Terminal), ein <strong>Dashboard-Layout</strong> (2 Designs zur Auswahl, weitere folgen bald) und deine <strong>Sprache</strong> aus der Liste.',
    guide_settings_step5:'Nutze <strong>Daten exportieren</strong>, um alles zu sichern, oder <strong>Daten zurücksetzen</strong>, wenn du jemals ganz neu anfangen möchtest.',
    guide_settings_connect1:'Deine Wahl von Währung und Budgetzeitraum bestimmt, wie jede andere Seite in der App Zahlen anzeigt und berechnet.',
    guide_settings_connect2:'Der hier festgelegte Übertrag-Betrag fließt direkt in den im Dashboard angezeigten Nettoüberschuss ein.',
    guide_settings_connect3:'Daten hier zu exportieren, ist der sicherste Weg, eine Kopie von allem zu behalten, bevor du eine größere Änderung vornimmst.',
    guide_settings_tip:'Lege Währung und Budgetzeitraum gleich zu Beginn fest, bevor du Transaktionen einträgst - das erspart dir, alte Einträge später noch einmal überprüfen zu müssen.',guide_settings_usecase_h:'So sieht das in der Praxis aus',guide_settings_usecase_p:'<p>Als <strong>Yuki</strong> in ein neues Land zieht und dort in Euro verdient, öffnet sie die Einstellungen, ändert ihre Währung auf EUR und passt ihren Budgetzeitraum an ihren neuen Zahlungsplan an - sodass ab diesem Zeitpunkt jede Zahl in der App ihre neue Realität widerspiegelt.</p>',
    mod_desc_income:'Lege dein erwartetes Einkommen für jede Quelle fest. Tatsächliche Beträge werden automatisch ausgefüllt, sobald du Transaktionen erfasst.',
    mod_desc_expenses:'Lege ein Budgetlimit für jede Ausgabenkategorie fest. Fortschrittsbalken werden rot, wenn du es überschreitest.',
    mod_desc_bills:'Behalte wiederkehrende Rechnungen im Blick. Füge ein Fälligkeitsdatum hinzu und hake es ab, sobald du bezahlt hast.',
    mod_desc_debt:'Behalte Kredit- und Hypothekenzahlungen im Blick. Lege erwartete Beträge fest und markiere jede als bezahlt.',
    mod_desc_savings:'Lege ein Sparziel für jeden Topf fest. Tatsächliche Beiträge stammen aus deinen erfassten Transaktionen.',
    mod_add_category:'+ Kategorie hinzufügen',mod_add_new_category:'Neue Kategorie hinzufügen',mod_cat_name_label:'Name',
    mod_set_date:'Datum festlegen',mod_remove:'Entfernen',mod_mark_paid:'Als bezahlt markieren',mod_total:'Gesamt',mod_paid_amount_label:'Bezahlter Betrag',mod_paid_amount_hint:'Wie viel du tatsächlich bezahlt hast - wird als Transaktion erfasst, damit deine Ausgabenhistorie stimmt, auch wenn es vom budgetierten Betrag abweicht.',mod_paid_save_btn:'Zahlung erfassen',mod_paid_budgeted_hint:'Budgetiert: {0}',mod_paid_amount_required:'Bitte gib einen gültigen Betrag ein.',toast_mod_paid:'Zahlung erfasst',
    dash_period_title:'Klicken, um den Budgetzeitraum zu ändern',
    sample_loaded_toast:'Beispieldaten geladen',
    dash_stat_income:'Gesamteinnahmen',dash_stat_of_expected:'von {0} erwartet',
    dash_stat_exp_bills:'Ausgaben &amp; Rechnungen',dash_stat_of_budgeted:'von {0} budgetiert',
    dash_stat_debt:'Schuldenzahlungen',dash_stat_savings:'Gesamtersparnisse',dash_stat_of_goal:'von {0} Ziel',
    dash_net_leftover_period:'Nettosaldo dieser Periode',dash_includes_rollover:'Enthält {0} Übertrag aus der letzten Periode',
    dash_lf_income:'Einnahmen',dash_lf_exp_bills:'Ausg. &amp; Rechn.',dash_lf_debt:'Schulden',dash_lf_savings:'Ersparnisse',dash_lf_rollover:'Übertrag',
    dash_cash_flow:'Cashflow - Erwartet vs. Tatsächlich',dash_income_kept:'des Einkommens behalten',dash_expected:'Erwartet',dash_actual:'Tatsächlich',
    dash_daily_spend:'Tägliche Ausgaben',dash_daily_spend_caption:'Ausgaben insgesamt in diesem Zeitraum',spend_tip_more:'+{0} weitere',dash_other_category:'Sonstiges',
    dash_savings_rate:'Sparquote',dash_saved_sfx:'gespart',
    dash_income_sources:'Einnahmequellen',dash_no_income:'Noch keine Einnahmen erfasst.',dash_add_tx_link:'Transaktionen hinzufügen →',
    dash_spending_breakdown:'Ausgabenübersicht',dash_no_spending:'Noch keine Ausgaben erfasst.',
    upgrade_feat_debt:'💳 Schuldentilgung',upgrade_feat_sinking:'🏺 Sparzielfonds',upgrade_feat_calendar:'📅 Smart-Kalender',
    upgrade_feat_subs:'🔄 Abonnements',upgrade_feat_auto:'⚡ Automatisierung',upgrade_feat_alloc:'🎯 Zuweisung',
    upg_chip_tx:'{0} / {0} kostenlose Transaktionen genutzt',upg_chip_cat:'{0} / {0} kostenlose {1}-Kategorien genutzt',upg_chip_limit:'Kostenlose Testphase erreicht',
    upg_aria_label:'Upgrade, um den vollen Planer freizuschalten',
    upg_title_html:'Schalte den vollen<br>Simple Budget Planner frei',
    upg_sub:'Du hast das kostenlose Testlimit erreicht. Einmal upgraden, um jede Grenze aufzuheben. Kein Abo, nie.',
    upg_feat_unlimited_tx_html:'<strong>Unbegrenzte</strong> Transaktionen',
    upg_feat_unlimited_cat_html:'<strong>Unbegrenzte</strong> Kategorien in jedem Bereich',
    upg_feat_csv:'CSV-Import &amp; -Export, volle Historie',upg_feat_onetime:'Einmalzahlung · kostenlose Updates fürs Leben',
    upg_price_tag:'einmalig',upg_price_note:'Kein Abo',
    upg_cta_sbp:'Simple Budget freischalten für {0}',
    upg_upsell_lead:'⚡ Schuldentilgung, Sparzielfonds &amp; mehr gewünscht?',upg_upsell_cta:'Ultimate holen für {0} →',
    upg_later:'Vielleicht später',
    reauth_title:'Melde dich mit Google an, um fortzufahren',
    reauth_sub:'Deine Daten für dieses Tool werden mit Google Drive synchronisiert. Melde dich erneut an, um dort weiterzumachen, wo du aufgehört hast.',
    reauth_submit:'Mit Google anmelden',reauth_local:'Stattdessen lokale Daten auf diesem Gerät verwenden',
    sync_welcome:'Willkommen bei Ezzo Budget',sync_choose:'Wähle, wie deine Daten gespeichert werden.',sync_recommended:'Empfohlen',
    sync_continue_google:'Mit Google fortfahren',sync_desc_multi_device:'Planerdaten werden auf mehreren Geräten gespeichert',
    sync_use_no_account:'Ohne Konto verwenden',sync_desc_this_device:'Planerdaten werden nur auf diesem Gerät gespeichert',
    sync_status_wait:'Schließe die Schritte im gerade geöffneten Google-Fenster ab. Falls nichts erschienen ist, prüfe deine Adressleiste auf ein blockiertes Pop-up-Symbol.',
    sync_footer_note:'Dies kann später in den Einstellungen geändert werden',
    code_title:'Gib deinen Lizenzschlüssel ein',code_sub:'Schalte den vollen {0} mit dem Code aus deinem Kauf frei.',
    code_placeholder:'Lizenzschlüssel',code_error:'Dieser Code ist nicht richtig. Überprüfe ihn und versuche es erneut.',
    code_orderid_placeholder:'Bestellnummer',code_orderid_error:'Gib die Bestellnummer deines Kaufs ein.',
    code_submit:'Absenden',code_try_free:'Stattdessen kostenlos testen',code_get:'Code holen',
    app_name_sbp:'Simple Budget Planner',app_name_ubp:'Ultimate Budget Planner',
    edit_tx_title:'✏️ Transaktion bearbeiten',save_changes:'Änderungen speichern',no_categories:'- keine Kategorien -',
    no_cat_setup:'- zuerst Kategorien einrichten -',
    tx_error_required:'Bitte Datum, Typ, Kategorie und einen gültigen Betrag größer als 0 eingeben.',
    csv_error_msg:'Keine gültigen Zeilen gefunden.\n\nErwartetes Format:\nDatum, Typ, Kategorie, Betrag, Beschreibung\n2024-01-15, expense, Lebensmittel, 25.50, Einkauf',
    sync_card_title:'☁️ Daten &amp; Synchronisierung',sync_card_desc:'Wähle, wie deine Daten gespeichert und geräteübergreifend aktuell gehalten werden.',
    sync_mode_local_title:'Nur dieses Gerät',sync_mode_local_desc:'Daten werden nur auf diesem Gerät gespeichert',
    sync_mode_google_title:'Mit Google synchronisieren',sync_mode_google_desc:'Daten werden geräteübergreifend synchronisiert',
    sync_signed_in_as:'Angemeldet als {0}',sync_error_generic:'Anmeldung hat nicht funktioniert. Bitte erneut versuchen.',
    sync_err_popup_blocked:'Dein Browser hat das Google-Anmeldefenster blockiert. Bitte erlaube Pop-ups für diese Seite (prüfe deine Adressleiste auf ein blockiertes Pop-up-Symbol) und versuche es erneut.',
    sync_err_cancelled:'Die Anmeldung wurde abgebrochen. Bitte erneut versuchen.',
    toast_synced_google:'Mit Google Drive synchronisiert ✓',toast_synced_local:'Zu lokalem Speicher gewechselt ✓',
    cmp_title:'⚡ Simple vs. Ultimate Budget Planner',cmp_col_feature:'Funktion',cmp_col_simple:'💰 Simple',cmp_col_ultimate:'⚡ Ultimate',
    cmp_section_core:'Kernbudgetierung',cmp_section_pro:'Pro-Funktionen - nur Ultimate',
    cmp_stay_simple:'Bei Simple bleiben',cmp_open_ultimate:'Ultimate Budget Planner öffnen →',
    cmp_feat1:'Budgetverfolgung - Einnahmen, Ausgaben, Rechnungen &amp; Ersparnisse',
    cmp_feat2:'Transaktionserfassung mit CSV-Import',
    cmp_feat3:'Cashflow-Diagramm - erwartet vs. tatsächlich',
    cmp_feat4:'Einnahmen- &amp; Ausgaben-Donut-Diagramme',
    cmp_feat5:'Budgetzeitraum-Steuerung mit Voreinstellungen',
    cmp_feat6:'Übertrag aus vorheriger Periode',
    cmp_feat7:'Schuldentilgung (Schneeball &amp; Lawine)',
    cmp_feat8:'Sparzielfonds-Tracker mit monatlichen Zielen',
    cmp_feat9:'Smart-Kalender mit automatisch befüllten Ereignissen',
    cmp_feat10:'Abo-Tracker mit Kategorieaufschlüsselung',
    cmp_feat11:'Pro-Dashboard mit Kennzahlen &amp; Übersichtspanel',
    cmp_feat12:'Ein-Klick-Import aus Simple Budget Planner',
    cmp_feat13:'Ezzo - dein KI-Budgetassistent',
    help_aria:'Hilfe',close_aria:'Schließen',dismiss_aria:'Verwerfen',ok:'OK',
  },
  fr: {
    lang_name:'Français',
    tab_dashboard:'Tableau de bord',tab_budget:'Budget',tab_transactions:'Transactions',
    tab_income:'Revenus',tab_expenses:'Dépenses',tab_bills:'Factures',
    tab_debt:'Dettes',tab_savings:'Épargne',tab_settings:'Paramètres',
    tab_debt_payoff:'Remboursement',tab_sinking:'Provisions',
    tab_calendar:'Calendrier',tab_subscriptions:'Abonnements',
    total_income:'Revenus totaux',expenses_bills:'Dépenses & Factures',
    debt_payments:'Remboursements',total_savings:'Épargne totale',
    total_outgoing:'Sorties totales',savings_rate:"Taux d'épargne",
    net_leftover:'Solde net',cash_flow:'Flux de trésorerie',
    income_sources:'Sources de revenus',spending_breakdown:'Répartition des dépenses',
    expected:'Prévu',actual:'Réel',progress:'Progression',
    of:'sur',budgeted:'budgété',saved:'épargné',
    budget_period:'Période budgétaire',start_date:'Date de début',end_date:'Date de fin',
    this_month:'Ce mois',this_week:'Cette semaine',last_week:'Semaine pr\u00e9c.',last_month:'Mois pr\u00e9c.',last_30_days:'30 derniers jours',this_quarter:'Ce trimestre',this_year:'Cette ann\u00e9e',
    toast_tx_added:'Transaction ajout\u00e9e \u2713',toast_tx_updated:'Mis \u00e0 jour \u2713',toast_tx_deleted:'Supprim\u00e9',
    toast_period_updated:'P\u00e9riode mise \u00e0 jour \u2713',toast_period_error:'La date de fin doit \u00eatre apr\u00e8s la date de d\u00e9but',
    toast_currency_updated:'Devise mise \u00e0 jour \u2713',toast_imported:'{0} import\u00e9(s) \u2713',
    toast_fund_created:'Fonds cr\u00e9\u00e9 \u2713',toast_fund_updated:'Fonds mis \u00e0 jour \u2713',
    toast_fund_contrib:'{amt} ajout\u00e9 \u00e0 {name} \u2713',
    toast_sub_added:'Abonnement ajout\u00e9 \u2713',toast_sub_updated:'Abonnement mis \u00e0 jour \u2713',
    toast_alloc_enabled:'R\u00e9partition activ\u00e9e \u2713',toast_alloc_disabled:'R\u00e9partition d\u00e9sactiv\u00e9e',
    toast_lang_updated:'Langue mise \u00e0 jour \u2713',toast_export:'Export\u00e9 \u2713',
    toast_saved:'Enregistr\u00e9 \u2713',toast_reset:'Toutes les donn\u00e9es effac\u00e9es',
    toast_alloc_bucket_added:'Segment ajout\u00e9 \u2713',
    confirm_remove_cat:'Supprimer cette cat\u00e9gorie ?',
    confirm_remove_cat_with_tx:'{0} transaction(s) existante(s) utilisent cette cat\u00e9gorie. Elles la conserveront comme \u00e9tiquette, mais elle ne sera plus suivie dans votre budget. Supprimer quand m\u00eame ?',
    confirm_delete_all_tx:'Supprimer TOUTES les transactions ? Cela est irr\u00e9versible.',
    confirm_delete_tx:'Supprimer cette transaction ?',confirm_remove_debt:'Supprimer cette dette ?',
    confirm_delete_fund:'Supprimer ce fonds ?',confirm_remove_sub:'Supprimer cet abonnement ?',
    confirm_reset_1:'\u00cates-vous s\u00fbr ? Toutes les donn\u00e9es seront d\u00e9finitivement supprim\u00e9es.',
    confirm_reset_2:'Derni\u00e8re chance - c\u2019est irr\u00e9versible. Continuer ?',
    export_csv_btn:'\uD83D\uDCE5 Exporter CSV',
    sett_export_title:'\uD83D\uDCE4 Exporter les donn\u00e9es',
    sett_export_desc:'T\u00e9l\u00e9chargez toutes les transactions en fichier CSV pour sauvegarde ou utilisation dans une autre application.',
    sf_add_contribution:'Ajouter une contribution',sf_contribution_label:'Montant \u00e0 ajouter',
    sf_currently_saved:'Actuellement \u00e9pargn\u00e9',
    tx_search_ph:'Rechercher par description ou cat\u00e9gorie\u2026',
    tx_filter_all_types:'Tous les types',tx_filter_all_alloc:'Toutes les r\u00e9partitions',
    tx_add_btn:'Ajouter',tx_add_title:'Ajouter une transaction',tx_amount:'Montant',tx_category:'Catégorie',tx_clear_all:'Tout effacer',tx_date:'Date',tx_desc_label:'Description',tx_desc_ph:'ex. Courses\u2026',tx_empty:'Aucune transaction encore.',tx_import_csv:'\uD83D\uDCE5 Importer CSV',tx_th_amount:'Montant',tx_th_desc:'Description',tx_transaction_many:'transactions',tx_transaction_one:'transaction',tx_type:'Type',tx_type_bill:'Facture',tx_type_debt:'Dette',tx_type_expense:'Dépense',tx_type_income:'Revenu',tx_type_savings:'Épargne',tx_empty_sub:'Ajoutez votre premi\u00e8re transaction pour commencer',
    tx_sort_date_new:'Plus r\u00e9cent d\u2019abord',tx_sort_date_old:'Plus ancien d\u2019abord',
    tx_sort_amt_high:'Montant le plus \u00e9lev\u00e9',tx_sort_amt_low:'Montant le moins \u00e9lev\u00e9',
    tx_showing:'{n} sur {total} affich\u00e9(s)',tx_no_results:'Aucune transaction ne correspond \u00e0 votre filtre.',
    alloc_add_bucket:'+ Ajouter un segment',alloc_remove_btn:'Supprimer',
    alloc_min_buckets:'Au moins 2 segments requis',
    alloc_auto_tag:'Tag automatique \u2192 {name}',
    tx_prev:'\u2190 Pr\u00e9c.',tx_next:'Suiv. \u2192',tx_page_of:'Page {n} sur {total}',
    debt_due_day_note:'Les jours 29-31 n\u2019apparaissent pas dans les mois courts',
    sub_advanced:'Date de facturation avanc\u00e9e au {date}',
    currency:'Devise',rollover:'Report',appearance:'Apparence',
    language:'Langue',reset_data:'Réinitialiser les données',
    light:'Clair',dark:'Sombre',theme_synthwave:'Synthwave',theme_vintage_ledger:'Vintage',theme_terminal:'Terminal',
    dashboard_layout:'Disposition du tableau de bord',dashboard_layout_desc:"Choisissez comment votre tableau de bord est conçu et visualisé.",
    layout_1:'Classique',layout_2:'Pulsation radiale',layout_coming_soon:'Bientôt plus !',
    changes_autosaved:'✅ Les modifications sont enregistrées automatiquement.',
    rollover_desc:"Reporte l'argent non dépensé de la période précédente.",
    rollover_amount:'Montant du report',
    reset_desc:'Supprime définitivement toutes vos données. Irréversible.',
    reset_btn:'Tout réinitialiser',
    add:'Ajouter',cancel:'Annuler',rename_title_prompt:'Renommer votre planificateur de budget',save:'Enregistrer',delete:'Supprimer',dp_today:"Aujourd'hui",dp_clear:'Effacer',edit:'Modifier',field_info_aria:'À propos de {0}',
    mod_name_hint:'Le nom que vous verrez pour cette catégorie partout dans l’application.',mod_due_date_hint:'Quand cela est dû chaque mois - utilisé pour le calendrier et le suivi des paiements.',
    mod_th_expected_hint:'Le montant que vous prévoyez de budgétiser pour cette catégorie chaque mois.',mod_th_actual_hint:'Calculé automatiquement à partir de vos transactions enregistrées dans cette catégorie.',mod_th_progress_hint:'Le pourcentage du montant prévu déjà utilisé.',
    tx_date_hint:'La date à laquelle cette transaction a eu lieu.',tx_type_hint:'Le type de transaction - détermine la liste de catégories disponible.',tx_category_hint:'La catégorie budgétaire à laquelle cette transaction est associée.',tx_amount_hint:'Le montant de cette transaction.',tx_desc_hint:'Une note facultative pour vous rappeler à quoi cela correspondait.',
    paid:'Payé',due_date:"Date d'échéance",category:'Catégorie',amount:'Montant',
    description:'Description',date:'Date',type:'Type',
    add_category:'+ Ajouter une catégorie',no_transactions:'Aucune transaction.',
    upgrade_title:'Passer à Ultimate Budget Planner',
    upgrade_desc:"Tout ce qu'offre Simple, plus les outils pro pour progresser : éliminez vos dettes, épargnez pour l'essentiel et ne manquez plus aucune facture.",
    upgrade_now:'Mettre à niveau →',upgrade_get_now:'OBTENIR',upgrade_compare:'COMPARER',sett_upgrade_h:'Bannière de mise à niveau',sett_upgrade_label:'Afficher la bannière sur le tableau de bord',
    mon:'Lun',tue:'Mar',wed:'Mer',thu:'Jeu',fri:'Ven',sat:'Sam',sun:'Dim',
    quick_presets:'Raccourcis :',select_currency:'Sélectionnez votre devise',select_language:'Sélectionner la langue',
    appearance_desc:'Choisissez un thème de couleur.',
    dash_anim_title:'Animations du tableau de bord',dash_anim_desc:"Jouer une animation d'entrée subtile au chargement du tableau de bord.",dash_anim_label:'Activer les animations',
    help_sett_modal_title:'Fonctionnement des paramètres',help_sett_intro:'Personnalisez Ezzo Budget selon votre situation.',
    help_sett_currency_li:"Met à jour le symbole partout (certaines devises comme le PLN placent le symbole après le montant).",
    help_sett_period_li:'Définissez votre plage de dates. Cliquez sur le badge de date du tableau de bord pour y accéder rapidement.',
    help_sett_rollover_li:"Reporte l'argent non dépensé de la dernière période.",
    help_sett_theme_li:'Choisissez parmi cinq thèmes de couleur - Clair, Sombre, Synthwave, Vintage ou Terminal.',
    help_sett_layout_li:"Choisissez parmi deux designs de tableau de bord - Classique ou Pulsation radiale - chacun avec ses propres graphiques et sa disposition ; d'autres designs arrivent bientôt.",
    help_dash_modal_title:'Comment fonctionne le tableau de bord',help_dash_intro:'Le tableau de bord est votre aperçu financier en temps réel. Tout se met à jour automatiquement dès que vous enregistrez des transactions.',
    help_dash_cards_h:'Cartes de synthèse',help_dash_cards_li:'Totaux des revenus, dépenses &amp; factures, remboursements de dettes et épargne pour la période en cours.',
    help_dash_leftover_li:"Ce qu'il reste après toutes les sorties d'argent. <span style=\"color:#10b981;font-weight:600\">Vert</span> = excédent, <span style=\"color:#f43f5e;font-weight:600\">rouge</span> = dépassement de budget.",
    help_dash_flow_h:'Graphique Flux de trésorerie',help_dash_flow_li:"Compare ce que vous <em>aviez prévu</em> à ce qui <em>s'est réellement passé</em>.",
    help_dash_donut_h:'Graphiques en anneau',help_dash_donut_li:'Répartition des revenus et des dépenses en pourcentages.',
    help_dash_datebadge_h:'Badge de date',help_dash_datebadge_li:'Cliquez dessus pour accéder directement aux paramètres et modifier votre période budgétaire.',
    help_dash_tip:"💡 Astuce : Saisissez d'abord les montants prévus dans Revenus / Dépenses / Factures / Dettes / Épargne, puis enregistrez des transactions pour voir apparaître les montants réels.",
    help_tx_modal_title:'Comment fonctionnent les transactions',help_tx_intro:"Enregistrez ici chaque mouvement d'argent. Les modules de budget se mettent à jour automatiquement.",
    help_tx_type_li:'Revenu, Dépense, Facture, Dette ou Épargne.',help_tx_category_li:'Reprise des catégories de vos modules de budget.',
    help_tx_edit_h:'✏️ Bouton Modifier',help_tx_edit_li:"Cliquez sur l'icône crayon d'une ligne pour modifier ou supprimer cette transaction.",
    help_tx_csv_h:"Format d'import CSV :",
    help_inc_modal_title:'Comment fonctionnent les revenus',help_inc_intro:'Suivez le prévu par rapport au réel pour vos revenus. Les barres de progression se mettent à jour en direct pendant que vous saisissez les montants prévus.',
    help_inc_expected_li:'Saisissez votre revenu prévu ; la barre se met à jour instantanément.',help_inc_actual_li:'Calculé automatiquement à partir des transactions de type Revenu.',
    help_inc_tip:'💡 Astuce : Enregistrez vos gains avec le type « Revenu » dans les transactions pour voir apparaître les montants réels ici.',
    help_exp_modal_title:'Comment fonctionnent les dépenses',help_exp_intro:'Définissez une limite de dépenses par catégorie. Les barres de progression se mettent à jour en direct et passent au rouge en cas de dépassement.',
    help_exp_expected_li:'Votre limite de dépenses ; la barre se met à jour au fur et à mesure de votre saisie.',help_exp_actual_li:'Cumulé à partir des transactions de type Dépense.',
    help_bills_modal_title:'Comment fonctionnent les factures',help_bills_intro:"Suivez vos factures récurrentes avec leur date d'échéance et leur statut de paiement.",
    help_bills_duedate_li:"Définissez la date d'échéance de chaque facture.",help_bills_paid_li:"Cochez une fois le paiement effectué - le montant réellement payé vous sera demandé et enregistré comme transaction, car des factures comme les charges correspondent rarement exactement au montant budgété.",help_bills_actual_li:'Renseigné à partir des transactions de type Facture portant le même nom de catégorie.',
    help_debt_modal_title:'Comment fonctionnent les dettes',help_debt_intro:'Gardez le contrôle sur vos remboursements de prêts et de crédits immobiliers.',
    help_debt_expected_li:'Votre paiement mensuel prévu.',help_debt_duedate_li:"La date d'échéance du paiement.",help_debt_paid_li:"Marquez-le une fois le paiement effectué - le montant réellement payé vous sera demandé et enregistré comme transaction, car il peut différer de votre paiement prévu.",
    help_sav_modal_title:"Comment fonctionne l'épargne",help_sav_intro:"Définissez des objectifs d'épargne et suivez vos versements.",
    help_sav_expected_li:"Votre objectif d'épargne pour cette période.",help_sav_actual_li:'À partir des transactions de type Épargne.',
    help_sav_tip:"💡 Astuce : Traitez l'épargne comme une dépense fixe - budgétez-la en premier, puis dépensez le reste.",
    // Guide
    guide_group_start:'Pour commencer', guide_group_track:'Suivre votre argent', guide_group_settings:"Personnaliser l'application",
    guide_section_big:"L'essentiel", guide_section_how:"Comment l'utiliser", guide_section_connects:"Comment ça s'articule", guide_back:'Retour aux sujets',
    guide_welcome_title:'Bienvenue dans Simple Budget Planner',
    guide_welcome_big:"Cette application répond à une question chaque mois : où est passé mon argent ? Vous notez ce qui rentre et ce qui sort, et elle fait tranquillement les calculs pour que vous sachiez toujours exactement où vous en êtes. Pas de tableurs, pas de suppositions - juste une image claire de votre argent.",
    guide_dashboard_title:'Tableau de bord',
    guide_dashboard_big:"Voyez le tableau de bord comme la couverture de vos finances - un coup d'œil suffit pour savoir ce qui rentre, ce qui sort et ce qu'il reste. C'est la première chose à vérifier à chaque ouverture de l'application.",
    guide_dashboard_step1:'Consultez les cartes récapitulatives en haut pour votre <strong>Revenu total</strong>, vos <strong>Dépenses totales</strong> et votre <strong>Solde net</strong> pour la période en cours.',
    guide_dashboard_step2:"Faites défiler jusqu'au graphique de <strong>Flux de trésorerie</strong> pour voir comment votre argent circule semaine après semaine.",
    guide_dashboard_step3:"Regardez le donut de <strong>Répartition des dépenses</strong> pour repérer quelle catégorie prend la plus grosse part de votre budget.",
    guide_dashboard_connect1:"Chaque transaction que vous ajoutez, où que ce soit dans l'application, met ces chiffres à jour instantanément - rien à actualiser ni recalculer.",
    guide_dashboard_connect2:"Le Solde net inclut tout montant de <strong>Report</strong> défini dans les Paramètres, si bien qu'un bon mois peut se répercuter sur le suivant.",
    guide_dashboard_connect3:"Si un chiffre semble faux, la correction se trouve presque toujours dans Transactions, Revenus, Dépenses, Factures, Dettes ou Épargne - le tableau de bord ne fait que refléter ce qui a déjà été saisi.",
    guide_dashboard_tip:"Prenez l'habitude de consulter le tableau de bord - même 10 secondes par jour évitent que de petites surprises n'en deviennent de grosses.",guide_dashboard_usecase_h:'Un exemple concret',guide_dashboard_usecase_p:"<p><strong>Liam</strong> consulte le tableau de bord avant de décider s'il sort manger cette semaine. Il voit que son solde net pour cette période n'est que de 45 €, bien en dessous de sa marge habituelle, alors il choisit de cuisiner chez lui plutôt que de repérer le problème une fois son compte presque vide.</p>",
    guide_transactions_title:'Transactions',
    guide_transactions_big:"Les transactions sont le fondement de tout le reste dans cette application - chaque euro que vous saisissez ici alimente votre tableau de bord, vos catégories et votre solde final. Prenez l'habitude de les saisir au moment où vous dépensez, et le reste suit tout seul.",
    guide_transactions_step1:"Appuyez sur <strong>Ajouter une transaction</strong>, choisissez s'il s'agit d'un Revenu, d'une Dépense, d'une Facture, d'une Dette ou d'une Épargne, puis renseignez le montant et la catégorie.",
    guide_transactions_step2:"Vos dépenses sont déjà dans un tableur ? Utilisez <strong>Importer un CSV</strong> pour tout importer d'un coup plutôt que de tout saisir à la main.",
    guide_transactions_step3:"Appuyez sur une transaction dans la liste pour <strong>modifier</strong> le montant, la date ou la catégorie en cas d'erreur ou de changement.",
    guide_transactions_step4:"Utilisez les filtres et la recherche au-dessus de la liste pour retrouver rapidement une transaction par type, catégorie ou date.",
    guide_transactions_connect1:"Chaque transaction saisie compte automatiquement dans la catégorie correspondante - une dépense apparaît dans Dépenses, un paiement de facture dans Factures, et ainsi de suite.",
    guide_transactions_connect2:"Les totaux et graphiques de votre tableau de bord sont entièrement construits à partir de ces saisies - rien n'est estimé.",
    guide_transactions_connect3:"Supprimer ou modifier une transaction ici met instantanément à jour tous les totaux, partout dans l'application.",
    guide_transactions_tip:"Saisissez les transactions le jour même. Cela prend quelques secondes et garde votre tableau de bord fiable.",guide_transactions_usecase_h:'Un exemple concret',guide_transactions_usecase_p:"<p><strong>Aisha</strong> est payée le vendredi. Elle ouvre Transactions, choisit Revenu → Salaire, saisit le montant, et c'est enregistré immédiatement - visible aussitôt sur son tableau de bord dans son Revenu total pour la période.</p>",
    guide_income_title:'Revenus',
    guide_income_big:"C'est ici que vous indiquez à l'application combien vous comptez gagner, puis que vous suivez ce qui est réellement arrivé - pour repérer l'écart entre les deux d'un coup d'œil.",
    guide_income_step1:'Définissez le montant <strong>Prévu</strong> pour chaque source de revenu, comme votre salaire ou un revenu complémentaire.',
    guide_income_step2:"Quand l'argent arrive, saisissez-le comme transaction de Revenu - il remplira automatiquement votre colonne <strong>Réel</strong>.",
    guide_income_step3:"Comparez Prévu et Réel pour voir si vous êtes dans les temps ou si certains revenus ne sont pas encore arrivés.",
    guide_income_connect1:"Les transactions de revenu saisies dans Transactions alimentent directement les totaux Réel de cette page.",
    guide_income_connect2:'Votre Revenu total au tableau de bord est la somme de tout ce qui est suivi ici.',
    guide_income_connect3:"Un Solde net plus élevé commence ici - plus vous suivez vos revenus avec précision, plus votre budget entier est précis.",
    guide_income_tip:"Ajoutez chaque source de revenu séparément, même petite ou irrégulière - cela permet de repérer des tendances bien plus facilement avec le temps.",guide_income_usecase_h:'Un exemple concret',guide_income_usecase_p:"<p>Avant le début du mois, <strong>Carlos</strong> fixe son salaire prévu à 3 200 € et son revenu freelance prévu à 400 € dans le module Revenus.</p><p>À mesure que les paiements arrivent via Transactions, la colonne Réel se met à jour automatiquement, ce qui lui permet de voir d'un coup d'œil si le travail freelance de ce mois-ci suit son plan.</p>",
    guide_expenses_title:'Dépenses',
    guide_expenses_big:"Les dépenses, ce sont vos dépenses du quotidien - courses, essence, café, tout ça. Définir un montant prévu par catégorie vous donne un repère au lieu de simplement regarder l'argent disparaître.",
    guide_expenses_step1:'Ajoutez une catégorie pour chaque type de dépense à suivre, comme Courses ou Loisirs.',
    guide_expenses_step2:"Définissez un montant <strong>Prévu</strong> pour chacune - ce que vous aimeriez ne pas dépasser.",
    guide_expenses_step3:"Saisissez vos achats comme transactions de Dépense et regardez la colonne <strong>Réel</strong> se remplir automatiquement.",
    guide_expenses_connect1:"Chaque transaction de dépense saisie dans Transactions s'ajoute directement à la catégorie correspondante ici.",
    guide_expenses_connect2:"Les catégories qui dépassent leur montant prévu influencent le graphique de Répartition des dépenses au tableau de bord.",
    guide_expenses_connect3:"Réduire une catégorie en dépassement est l'un des moyens les plus rapides d'augmenter votre Solde net.",
    guide_expenses_tip:"Commencez avec seulement quelques grandes catégories. Vous pourrez toujours les détailler davantage une fois que vous verrez où part vraiment l'argent.",guide_expenses_usecase_h:'Un exemple concret',guide_expenses_usecase_p:"<p><strong>Nina</strong> veut voir où va vraiment son argent, alors elle fixe des montants prévus pour Courses, Restaurants et Transport dans Dépenses.</p><p>À la moitié du mois, elle remarque que Restaurants est déjà à 90 % de son budget, et réduit ses dépenses pour le reste de la période au lieu de le découvrir seulement à la fin du mois.</p>",
    guide_bills_title:'Factures',
    guide_bills_big:"Les factures sont les paiements que vous ne pouvez pas éviter - loyer, charges, abonnements engagés. Cette page garde les dates d'échéance et le statut de paiement bien visibles pour que rien ne vous échappe.",
    guide_bills_step1:"Ajoutez une facture et donnez-lui une <strong>Date d'échéance</strong> pour savoir exactement quand elle est due.",
    guide_bills_step2:"Une fois payée, cochez la case <strong>Payée</strong> pour la marquer comme réglée pour cette période.",
    guide_bills_step3:"Saisissez le paiement réel comme transaction de Facture pour que le montant compte dans vos totaux.",
    guide_bills_connect1:"Les factures impayées dont l'échéance approche méritent d'être vérifiées avant de dépenser ailleurs.",
    guide_bills_connect2:"Les transactions de facture comptent dans vos Dépenses totales au tableau de bord, aux côtés des Dépenses et des Dettes.",
    guide_bills_connect3:"Marquer une facture comme payée ne la supprime pas - cela suit seulement son statut, pour garder une trace de ce qui a été réglé cette période.",
    guide_bills_tip:"Ajoutez vos factures récurrentes en début de période pour que les échéances vous attendent, au lieu d'avoir à vous en souvenir.",guide_bills_usecase_h:'Un exemple concret',guide_bills_usecase_p:"<p>Chaque mois, la facture d'électricité de <strong>Derek</strong> est un peu différente. Il fixe la date d'échéance et le montant prévu (100 €) pour Électricité dans Factures.</p><p>Quand il la paie réellement, il coche la case Payée et saisit les 118,32 € réellement facturés - enregistrés comme une vraie transaction plutôt qu'une simple coche, pour que son historique de dépenses reste exact même si la facture n'était pas exactement celle prévue.</p>",
    guide_debt_title:'Dettes',
    guide_debt_big:"Cette page rassemble chaque paiement que vous devez au même endroit - cartes de crédit, prêts, tout ce qui a un solde - pour toujours savoir ce qui est dû et si vous suivez le rythme.",
    guide_debt_step1:'Ajoutez chaque dette suivie avec votre paiement <strong>Prévu</strong> pour cette période.',
    guide_debt_step2:"Définissez une <strong>Date d'échéance</strong> pour savoir exactement quand le paiement doit partir.",
    guide_debt_step3:"Saisissez le paiement comme transaction de Dette et cochez <strong>Payée</strong> une fois réglé.",
    guide_debt_connect1:"Les paiements de dette comptent dans vos Dépenses totales au tableau de bord, aux côtés des Dépenses et des Factures.",
    guide_debt_connect2:"Cette page suit les paiements comme une catégorie, pas comme un plan de remboursement complet - pour une stratégie boule de neige ou avalanche avec projections d'intérêts, c'est à ça que sert le Remboursement de dettes d'Ultimate Budget Planner.",
    guide_debt_connect3:"Rester régulier ici garde votre Solde net honnête, car les dettes impayées ont tendance à vous rattraper plus tard.",
    guide_debt_tip:"Listez même les petites dettes, comme un prêt familial - ce qui compte n'est pas le montant, mais de savoir tout ce que vous devez au même endroit.",guide_debt_usecase_h:'Un exemple concret',guide_debt_usecase_p:"<p><strong>Grace</strong> a un petit prêt personnel envers sa sœur. Elle l'ajoute dans Dettes avec le montant mensuel convenu et une date d'échéance.</p><p>Quand elle envoie le paiement, elle coche Payée et saisit le montant exact envoyé, pour qu'il soit suivi dans son historique de transactions comme n'importe quel autre paiement de dette.</p>",
    guide_savings_title:'Épargne',
    guide_savings_big:"L'épargne, c'est mettre de l'argent de côté délibérément, plutôt que de simplement voir ce qu'il reste en fin de mois. La traiter comme n'importe quelle autre dépense planifiée est le moyen le plus simple de vraiment la construire.",
    guide_savings_step1:'Définissez un montant <strong>Prévu</strong> pour ce que vous voulez épargner cette période.',
    guide_savings_step2:"Chaque fois que vous mettez de l'argent de côté, saisissez-le comme transaction d'Épargne.",
    guide_savings_step3:"Comparez Prévu et <strong>Réel</strong> pour voir si vous avez atteint votre objectif d'épargne pour la période.",
    guide_savings_connect1:"Les transactions d'épargne saisies dans Transactions comptent directement dans les totaux de cette page.",
    guide_savings_connect2:'Votre Épargne totale au tableau de bord provient directement de ce qui est suivi ici.',
    guide_savings_connect3:"L'épargne est incluse dans le calcul de votre Solde net, donc épargner régulièrement est l'un des moyens les plus directs de faire grandir ce chiffre au fil du temps.",
    guide_savings_tip:"Fixez votre montant d'épargne en premier, avant de planifier le reste de vos dépenses - il est bien plus facile d'atteindre un objectif auquel vous vous engagez dès le départ.",guide_savings_usecase_h:'Un exemple concret',guide_savings_usecase_p:"<p>À chaque paie, <strong>Wen</strong> met de côté de l'argent pour un apport immobilier. Elle fixe son montant d'épargne prévu dans le module Épargne, et à mesure qu'elle saisit des transactions d'Épargne durant la période, elle voit la barre de progression se rapprocher de l'objectif prévu.</p>",
    guide_settings_title:'Paramètres',
    guide_settings_big:"Les paramètres, c'est là où l'application s'adapte à vous - votre devise, votre période budgétaire, son apparence, sa langue, et la gestion de vos données.",
    guide_settings_step1:"Choisissez votre <strong>Devise</strong> pour que chaque montant s'affiche comme vous l'attendez.",
    guide_settings_step2:"Choisissez votre <strong>Période budgétaire</strong> (mensuelle, aux deux semaines...) pour correspondre à votre rythme réel de paiement et de factures.",
    guide_settings_step3:"Saisissez un montant de <strong>Report</strong> si vous voulez que l'argent non dépensé de la période précédente se répercute sur le Solde net de celle-ci.",
    guide_settings_step4:"Choisissez un thème d'<strong>Apparence</strong> (Clair, Sombre, Synthwave, Vintage ou Terminal), une <strong>Disposition du tableau de bord</strong> (2 designs au choix, d'autres à venir), et votre <strong>Langue</strong> dans la liste.",
    guide_settings_step5:"Utilisez <strong>Exporter les données</strong> pour tout sauvegarder, ou <strong>Réinitialiser les données</strong> si vous voulez repartir complètement à zéro.",
    guide_settings_connect1:"Vos choix de Devise et de Période budgétaire déterminent comment chaque autre page de l'application affiche et calcule les chiffres.",
    guide_settings_connect2:"Le montant de Report défini ici se répercute directement sur le Solde net affiché sur votre tableau de bord.",
    guide_settings_connect3:"Exporter vos données ici est le geste le plus sûr avant tout changement important.",
    guide_settings_tip:"Définissez votre Devise et votre Période budgétaire en tout premier, avant de saisir des transactions - cela vous évite d'avoir à revérifier d'anciennes saisies plus tard.",guide_settings_usecase_h:'Un exemple concret',guide_settings_usecase_p:"<p>Quand <strong>Yuki</strong> déménage dans un nouveau pays et commence à gagner en euros, elle ouvre Paramètres, change sa Devise en EUR, et ajuste sa Période budgétaire à son nouveau cycle de paie - pour que chaque chiffre de l'application reflète désormais sa nouvelle réalité.</p>",
    mod_desc_income:'Définissez votre revenu prévu pour chaque source. Les montants réels se remplissent automatiquement quand vous enregistrez des transactions.',
    mod_desc_expenses:'Définissez une limite de budget pour chaque catégorie de dépenses. Les barres de progression passent au rouge en cas de dépassement.',
    mod_desc_bills:'Suivez vos factures récurrentes. Ajoutez une date d’échéance, puis cochez la case une fois payée.',
    mod_desc_debt:'Gardez le contrôle de vos remboursements de prêts et d’hypothèque. Définissez les montants prévus et marquez chacun comme payé.',
    mod_desc_savings:'Définissez un objectif d’épargne pour chaque tirelire. Les contributions réelles proviennent de vos transactions enregistrées.',
    mod_add_category:'+ Ajouter une catégorie',mod_add_new_category:'Ajouter une nouvelle catégorie',mod_cat_name_label:'Nom',
    mod_set_date:'Définir la date',mod_remove:'Supprimer',mod_mark_paid:'Marquer comme payé',mod_total:'Total',mod_paid_amount_label:'Montant payé',mod_paid_amount_hint:"Le montant que vous avez réellement payé - il sera enregistré comme transaction afin que votre historique reste exact, même s'il diffère du montant budgété.",mod_paid_save_btn:'Enregistrer le paiement',mod_paid_budgeted_hint:'Budgété : {0}',mod_paid_amount_required:'Veuillez saisir un montant valide.',toast_mod_paid:'Paiement enregistré',
    dash_period_title:'Cliquez pour changer la période budgétaire',
    sample_loaded_toast:'Données d’exemple chargées',
    dash_stat_income:'Revenu total',dash_stat_of_expected:'sur {0} prévu',
    dash_stat_exp_bills:'Dépenses &amp; Factures',dash_stat_of_budgeted:'sur {0} budgétisé',
    dash_stat_debt:'Paiements de dettes',dash_stat_savings:'Épargne totale',dash_stat_of_goal:'sur {0} objectif',
    dash_net_leftover_period:'Solde net de cette période',dash_includes_rollover:'Inclut {0} de report de la période précédente',
    dash_lf_income:'revenus',dash_lf_exp_bills:'dép. &amp; fact.',dash_lf_debt:'dettes',dash_lf_savings:'épargne',dash_lf_rollover:'report',
    dash_cash_flow:'Flux de trésorerie - Prévu vs Réel',dash_income_kept:'du revenu conservé',dash_expected:'Prévu',dash_actual:'Réel',
    dash_daily_spend:'Dépenses quotidiennes',dash_daily_spend_caption:'dépenses totales sur la période',spend_tip_more:'+{0} de plus',dash_other_category:'Autre',
    dash_savings_rate:"Taux d'épargne",dash_saved_sfx:'épargné',
    dash_income_sources:'Sources de revenus',dash_no_income:'Aucun revenu enregistré.',dash_add_tx_link:'Ajouter des transactions →',
    dash_spending_breakdown:'Détail des dépenses',dash_no_spending:'Aucune dépense enregistrée.',
    upgrade_feat_debt:'💳 Remboursement de dettes',upgrade_feat_sinking:'🏺 Provisions',upgrade_feat_calendar:'📅 Calendrier intelligent',
    upgrade_feat_subs:'🔄 Abonnements',upgrade_feat_auto:'⚡ Automatisation',upgrade_feat_alloc:'🎯 Répartition',
    upg_chip_tx:'{0} / {0} transactions gratuites utilisées',upg_chip_cat:'{0} / {0} catégories {1} gratuites utilisées',upg_chip_limit:'Limite d’essai gratuit atteinte',
    upg_aria_label:'Mettre à niveau pour débloquer le planificateur complet',
    upg_title_html:'Débloquez le<br>Simple Budget Planner complet',
    upg_sub:"Vous avez atteint la limite d'essai gratuit. Mettez à niveau une fois pour lever tous les plafonds. Jamais d'abonnement.",
    upg_feat_unlimited_tx_html:'Transactions <strong>illimitées</strong>',
    upg_feat_unlimited_cat_html:'Catégories <strong>illimitées</strong> dans chaque section',
    upg_feat_csv:'Import &amp; export CSV, historique complet',upg_feat_onetime:'Paiement unique · mises à jour gratuites à vie',
    upg_price_tag:'unique',upg_price_note:'Sans abonnement',
    upg_cta_sbp:'Débloquer Simple Budget pour {0}',
    upg_upsell_lead:'⚡ Envie de remboursement de dettes, provisions &amp; plus ?',upg_upsell_cta:'Obtenir Ultimate pour {0} →',
    upg_later:'Plus tard',
    reauth_title:'Connectez-vous avec Google pour continuer',
    reauth_sub:'Vos données pour cet outil sont synchronisées avec Google Drive. Reconnectez-vous pour reprendre où vous en étiez.',
    reauth_submit:'Se connecter avec Google',reauth_local:'Utiliser les données locales de cet appareil à la place',
    sync_welcome:'Bienvenue sur Ezzo Budget',sync_choose:'Choisissez comment enregistrer vos données.',sync_recommended:'Recommandé',
    sync_continue_google:'Continuer avec Google',sync_desc_multi_device:'Les données du planificateur sont stockées sur plusieurs appareils',
    sync_use_no_account:'Utiliser sans compte',sync_desc_this_device:'Les données du planificateur sont stockées uniquement sur cet appareil',
    sync_status_wait:"Terminez les étapes dans la fenêtre Google qui vient de s'ouvrir. Si rien n'est apparu, vérifiez votre barre d'adresse pour une icône de pop-up bloquée.",
    sync_footer_note:'Cela peut être modifié plus tard dans les paramètres',
    code_title:'Entrez votre clé de licence',code_sub:'Débloquez le {0} complet avec le code de votre achat.',
    code_placeholder:'Clé de licence',code_error:'Ce code est incorrect. Vérifiez-le et réessayez.',
    code_orderid_placeholder:'Numéro de commande',code_orderid_error:'Saisissez le numéro de commande de votre achat.',
    code_submit:'Valider',code_try_free:'Essayer gratuitement à la place',code_get:'Obtenir un code',
    app_name_sbp:'Simple Budget Planner',app_name_ubp:'Ultimate Budget Planner',
    edit_tx_title:'✏️ Modifier la transaction',save_changes:'Enregistrer les modifications',no_categories:'- aucune catégorie -',
    no_cat_setup:'- configurez d’abord des catégories -',
    tx_error_required:'Veuillez renseigner la date, le type, la catégorie et un montant valide supérieur à 0.',
    csv_error_msg:"Aucune ligne valide trouvée.\n\nFormat attendu :\nDate, Type, Catégorie, Montant, Description\n2024-01-15, expense, Alimentation, 25.50, Courses",
    sync_card_title:'☁️ Données &amp; Synchronisation',sync_card_desc:'Choisissez comment vos données sont stockées et tenues à jour entre les appareils.',
    sync_mode_local_title:'Cet appareil uniquement',sync_mode_local_desc:'Les données sont enregistrées uniquement sur cet appareil',
    sync_mode_google_title:'Synchroniser avec Google',sync_mode_google_desc:'Les données sont synchronisées entre plusieurs appareils',
    sync_signed_in_as:'Connecté en tant que {0}',sync_error_generic:"La connexion n'a pas abouti. Veuillez réessayer.",
    sync_err_popup_blocked:"Votre navigateur a bloqué la fenêtre de connexion Google. Veuillez autoriser les pop-ups pour ce site (vérifiez votre barre d'adresse pour une icône de pop-up bloquée) et réessayez.",
    sync_err_cancelled:'La connexion a été annulée. Veuillez réessayer.',
    toast_synced_google:'Synchronisé avec Google Drive ✓',toast_synced_local:'Basculé vers le stockage local ✓',
    cmp_title:'⚡ Simple vs Ultimate Budget Planner',cmp_col_feature:'Fonctionnalité',cmp_col_simple:'💰 Simple',cmp_col_ultimate:'⚡ Ultimate',
    cmp_section_core:'Budgétisation de base',cmp_section_pro:'Fonctionnalités Pro - Ultimate uniquement',
    cmp_stay_simple:'Rester avec Simple',cmp_open_ultimate:'Ouvrir Ultimate Budget Planner →',
    cmp_feat1:'Suivi du budget - Revenus, Dépenses, Factures &amp; Épargne',
    cmp_feat2:'Enregistrement des transactions avec import CSV',
    cmp_feat3:'Graphique de flux de trésorerie - prévu vs réel',
    cmp_feat4:'Graphiques en anneau des revenus &amp; dépenses',
    cmp_feat5:'Contrôle de la période budgétaire avec préréglages',
    cmp_feat6:'Report de la période précédente',
    cmp_feat7:'Remboursement de dettes (Boule de neige &amp; Avalanche)',
    cmp_feat8:'Suivi des provisions avec objectifs mensuels',
    cmp_feat9:'Calendrier intelligent avec tous les événements auto-remplis',
    cmp_feat10:'Suivi des abonnements avec répartition par catégorie',
    cmp_feat11:'Tableau de bord Pro avec statistiques clés &amp; panneau à venir',
    cmp_feat12:'Import en un clic depuis Simple Budget Planner',
    cmp_feat13:'Ezzo - votre assistant budgétaire IA',
    help_aria:'Aide',close_aria:'Fermer',dismiss_aria:'Ignorer',ok:'OK',
  },
  es: {
    lang_name:'Español',
    tab_dashboard:'Panel',tab_budget:'Presupuesto',tab_transactions:'Transacciones',
    tab_income:'Ingresos',tab_expenses:'Gastos',tab_bills:'Facturas',
    tab_debt:'Deudas',tab_savings:'Ahorros',tab_settings:'Ajustes',
    tab_debt_payoff:'Pago de deudas',tab_sinking:'Fondos de ahorro',
    tab_calendar:'Calendario',tab_subscriptions:'Suscripciones',
    total_income:'Ingresos totales',expenses_bills:'Gastos y facturas',
    debt_payments:'Pagos de deuda',total_savings:'Ahorros totales',
    total_outgoing:'Gastos totales',savings_rate:'Tasa de ahorro',
    net_leftover:'Saldo neto',cash_flow:'Flujo de caja',
    income_sources:'Fuentes de ingresos',spending_breakdown:'Desglose de gastos',
    expected:'Previsto',actual:'Real',progress:'Progreso',
    of:'de',budgeted:'presupuestado',saved:'ahorrado',
    budget_period:'Período presupuestario',start_date:'Fecha de inicio',end_date:'Fecha de fin',
    this_month:'Este mes',this_week:'Esta semana',last_week:'Sem. pasada',last_month:'Mes pasado',last_30_days:'\u00daltimos 30 d\u00edas',this_quarter:'Este trimestre',this_year:'Este a\u00f1o',
    toast_tx_added:'Transacci\u00f3n a\u00f1adida \u2713',toast_tx_updated:'Actualizado \u2713',toast_tx_deleted:'Eliminado',
    toast_period_updated:'Per\u00edodo actualizado \u2713',toast_period_error:'La fecha de fin debe ser posterior a la fecha de inicio',
    toast_currency_updated:'Moneda actualizada \u2713',toast_imported:'{0} importado(s) \u2713',
    toast_fund_created:'Fondo creado \u2713',toast_fund_updated:'Fondo actualizado \u2713',
    toast_fund_contrib:'{amt} a\u00f1adido a {name} \u2713',
    toast_sub_added:'Suscripci\u00f3n a\u00f1adida \u2713',toast_sub_updated:'Suscripci\u00f3n actualizada \u2713',
    toast_alloc_enabled:'Distribuci\u00f3n activada \u2713',toast_alloc_disabled:'Distribuci\u00f3n desactivada',
    toast_lang_updated:'Idioma actualizado \u2713',toast_export:'Exportado \u2713',
    toast_saved:'Guardado \u2713',toast_reset:'Todos los datos borrados',
    toast_alloc_bucket_added:'Segmento a\u00f1adido \u2713',
    confirm_remove_cat:'\u00bfEliminar esta categor\u00eda?',
    confirm_remove_cat_with_tx:'{0} transacci\u00f3n(es) existente(s) usan esta categor\u00eda. La conservar\u00e1n como etiqueta, pero ya no se har\u00e1 seguimiento en tu presupuesto. \u00bfEliminar de todos modos?',
    confirm_delete_all_tx:'\u00bfEliminar TODAS las transacciones? Esto no se puede deshacer.',
    confirm_delete_tx:'\u00bfEliminar esta transacci\u00f3n?',confirm_remove_debt:'\u00bfEliminar esta deuda?',
    confirm_delete_fund:'\u00bfEliminar este fondo?',confirm_remove_sub:'\u00bfEliminar esta suscripci\u00f3n?',
    confirm_reset_1:'\u00bfEst\u00e1s seguro? Todos los datos se eliminar\u00e1n permanentemente.',
    confirm_reset_2:'\u00daltima oportunidad - no se puede deshacer. \u00bfContinuar?',
    export_csv_btn:'\uD83D\uDCE5 Exportar CSV',
    sett_export_title:'\uD83D\uDCE4 Exportar datos',
    sett_export_desc:'Descarga todas las transacciones como archivo CSV para copia de seguridad o uso en otra app.',
    sf_add_contribution:'A\u00f1adir aportaci\u00f3n',sf_contribution_label:'Importe a a\u00f1adir',
    sf_currently_saved:'Actualmente ahorrado',
    tx_search_ph:'Buscar por descripci\u00f3n o categor\u00eda\u2026',
    tx_filter_all_types:'Todos los tipos',tx_filter_all_alloc:'Todas las distribuciones',
    tx_add_btn:'Añadir',tx_add_title:'Añadir una transacción',tx_amount:'Importe',tx_category:'Categoría',tx_clear_all:'Borrar todo',tx_date:'Fecha',tx_desc_label:'Descripción',tx_desc_ph:'p.ej. Compra en supermercado\u2026',tx_empty:'Aún no hay transacciones.',tx_import_csv:'\uD83D\uDCE5 Importar CSV',tx_th_amount:'Importe',tx_th_desc:'Descripción',tx_transaction_many:'transacciones',tx_transaction_one:'transacción',tx_type:'Tipo',tx_type_bill:'Factura',tx_type_debt:'Deuda',tx_type_expense:'Gasto',tx_type_income:'Ingreso',tx_type_savings:'Ahorro',tx_empty_sub:'A\u00f1ade tu primera transacci\u00f3n para empezar',
    tx_sort_date_new:'M\u00e1s reciente primero',tx_sort_date_old:'M\u00e1s antiguo primero',
    tx_sort_amt_high:'Mayor importe',tx_sort_amt_low:'Menor importe',
    tx_showing:'Mostrando {n} de {total}',tx_no_results:'Ninguna transacci\u00f3n coincide con tu filtro.',
    alloc_add_bucket:'+ A\u00f1adir segmento',alloc_remove_btn:'Eliminar',
    alloc_min_buckets:'Se requieren al menos 2 segmentos',
    alloc_auto_tag:'Etiquetado autom\u00e1tico \u2192 {name}',
    tx_prev:'\u2190 Ant.',tx_next:'Sig. \u2192',tx_page_of:'P\u00e1gina {n} de {total}',
    debt_due_day_note:'Los d\u00edas 29-31 no aparecen en meses cortos',
    sub_advanced:'Fecha de facturaci\u00f3n avanzada al {date}',
    currency:'Moneda',rollover:'Saldo anterior',appearance:'Apariencia',
    language:'Idioma',reset_data:'Restablecer datos',
    light:'Claro',dark:'Oscuro',theme_synthwave:'Synthwave',theme_vintage_ledger:'Vintage',theme_terminal:'Terminal',
    dashboard_layout:'Diseño del panel',dashboard_layout_desc:'Elige cómo se diseña y visualiza tu panel.',
    layout_1:'Clásico',layout_2:'Pulso radial',layout_coming_soon:'¡Más próximamente!',
    changes_autosaved:'✅ Los cambios se guardan automáticamente.',
    rollover_desc:'Traspasa el dinero no gastado del período anterior.',
    rollover_amount:'Importe de saldo anterior',
    reset_desc:'Elimina permanentemente todos tus datos. No se puede deshacer.',
    reset_btn:'Restablecer todo',
    add:'Añadir',cancel:'Cancelar',rename_title_prompt:'Renombrar tu planificador de presupuesto',save:'Guardar',delete:'Eliminar',dp_today:'Hoy',dp_clear:'Borrar',edit:'Editar',field_info_aria:'Acerca de {0}',
    mod_name_hint:'El nombre que verás para esta categoría en toda la aplicación.',mod_due_date_hint:'Cuándo vence esto cada mes - se usa para el calendario y el seguimiento de pagos.',
    mod_th_expected_hint:'La cantidad que planeas presupuestar para esta categoría cada mes.',mod_th_actual_hint:'Se calcula automáticamente a partir de tus transacciones registradas en esta categoría.',mod_th_progress_hint:'Qué porcentaje del monto previsto se ha usado hasta ahora.',
    tx_date_hint:'La fecha en que ocurrió esta transacción.',tx_type_hint:'Qué tipo de transacción es - determina de qué lista de categorías puedes elegir.',tx_category_hint:'A qué categoría del presupuesto pertenece esta transacción.',tx_amount_hint:'Cuánto dinero fue esta transacción.',tx_desc_hint:'Una nota opcional para ayudarte a recordar para qué fue esto.',
    paid:'Pagado',due_date:'Fecha de vencimiento',category:'Categoría',amount:'Importe',
    description:'Descripción',date:'Fecha',type:'Tipo',
    add_category:'+ Añadir categoría',no_transactions:'Sin transacciones aún.',
    upgrade_title:'Actualiza a Ultimate Budget Planner',
    upgrade_desc:'Todo lo de Simple, más las herramientas pro para avanzar: elimina deudas, ahorra para lo importante y no te pierdas ninguna factura.',
    upgrade_now:'Actualizar ahora →',upgrade_get_now:'OBTENER',upgrade_compare:'COMPARAR',sett_upgrade_h:'Banner de actualización',sett_upgrade_label:'Mostrar el banner en el panel',
    mon:'Lun',tue:'Mar',wed:'Mié',thu:'Jue',fri:'Vie',sat:'Sáb',sun:'Dom',
    quick_presets:'Accesos rápidos:',select_currency:'Selecciona tu moneda',select_language:'Seleccionar idioma',
    appearance_desc:'Elige un tema de color.',
    dash_anim_title:'Animaciones del panel',dash_anim_desc:'Reproduce una animación de entrada sutil al cargar el panel.',dash_anim_label:'Activar animaciones',
    help_sett_modal_title:'Cómo funcionan los ajustes',help_sett_intro:'Personaliza Ezzo Budget según tu situación.',
    help_sett_currency_li:'Actualiza el símbolo en todas partes (algunas monedas como PLN colocan el símbolo después del importe).',
    help_sett_period_li:'Establece tu rango de fechas. Haz clic en el distintivo de fecha del panel para acceder rápidamente aquí.',
    help_sett_rollover_li:'Traspasa el dinero no gastado del último período.',
    help_sett_theme_li:'Elige entre cinco temas de color - Claro, Oscuro, Synthwave, Vintage o Terminal.',
    help_sett_layout_li:'Elige entre dos diseños de panel - Clásico o Pulso radial - cada uno con sus propios gráficos y disposición; más diseños próximamente.',
    help_dash_modal_title:'Cómo funciona el panel',help_dash_intro:'El panel es tu instantánea financiera en tiempo real. Todo se actualiza automáticamente a medida que registras transacciones.',
    help_dash_cards_h:'Tarjetas de resumen',help_dash_cards_li:'Totales de ingresos, gastos &amp; facturas, pagos de deudas y ahorros del período actual.',
    help_dash_leftover_li:'Lo que queda después de todos los gastos. <span style="color:#10b981;font-weight:600">Verde</span> = superávit, <span style="color:#f43f5e;font-weight:600">rojo</span> = por encima del presupuesto.',
    help_dash_flow_h:'Gráfico de flujo de caja',help_dash_flow_li:'Compara lo que <em>esperabas</em> con lo que <em>realmente ocurrió</em>.',
    help_dash_donut_h:'Gráficos circulares',help_dash_donut_li:'Desglose de ingresos y distribución del gasto en porcentajes.',
    help_dash_datebadge_h:'Distintivo de fecha',help_dash_datebadge_li:'Haz clic para ir directamente a Ajustes y cambiar tu período de presupuesto.',
    help_dash_tip:'💡 Consejo: Introduce primero los importes previstos en Ingresos / Gastos / Facturas / Deudas / Ahorros y luego registra transacciones para ver los importes reales.',
    help_tx_modal_title:'Cómo funcionan las transacciones',help_tx_intro:'Registra aquí cada movimiento de dinero. Los módulos de presupuesto se actualizan automáticamente.',
    help_tx_type_li:'Ingreso, Gasto, Factura, Deuda o Ahorro.',help_tx_category_li:'Se toma de las categorías de tus módulos de presupuesto.',
    help_tx_edit_h:'✏️ Botón de edición',help_tx_edit_li:'Haz clic en el icono del lápiz de cualquier fila para editar o eliminar esa transacción.',
    help_tx_csv_h:'Formato de importación CSV:',
    help_inc_modal_title:'Cómo funcionan los ingresos',help_inc_intro:'Controla lo previsto frente a lo real de tus ingresos. Las barras de progreso se actualizan en vivo mientras escribes los importes previstos.',
    help_inc_expected_li:'Escribe tu ingreso previsto; la barra se actualiza al instante.',help_inc_actual_li:'Se calcula automáticamente a partir de las transacciones de Ingreso.',
    help_inc_tip:'💡 Consejo: Registra tus ingresos como tipo "Ingreso" en Transacciones para ver aquí los importes reales.',
    help_exp_modal_title:'Cómo funcionan los gastos',help_exp_intro:'Establece un límite de gasto por categoría. Las barras de progreso se actualizan en vivo y se ponen en rojo si te pasas.',
    help_exp_expected_li:'Tu límite de gasto; la barra se actualiza mientras escribes.',help_exp_actual_li:'Se totaliza a partir de las transacciones de Gasto.',
    help_bills_modal_title:'Cómo funcionan las facturas',help_bills_intro:'Controla tus facturas recurrentes con fechas de vencimiento y estado de pago.',
    help_bills_duedate_li:'Establece cuándo vence cada factura.',help_bills_paid_li:'Marca la casilla cuando hayas realizado el pago - se te pedirá el importe realmente pagado, que se registrará como transacción, ya que facturas como las de suministros rara vez coinciden exactamente con el importe presupuestado.',help_bills_actual_li:'Se rellena a partir de las transacciones de Factura con el mismo nombre de categoría.',
    help_debt_modal_title:'Cómo funcionan las deudas',help_debt_intro:'Mantente al día con los pagos de préstamos e hipotecas.',
    help_debt_expected_li:'Tu pago mensual previsto.',help_debt_duedate_li:'Cuándo vence el pago.',help_debt_paid_li:'Márcalo cuando se haga efectivo el pago - se te pedirá el importe realmente pagado, que se registrará como transacción, ya que puede diferir de tu pago previsto.',
    help_sav_modal_title:'Cómo funcionan los ahorros',help_sav_intro:'Establece metas de ahorro y controla tus aportaciones.',
    help_sav_expected_li:'Tu objetivo de ahorro para este período.',help_sav_actual_li:'De las transacciones de tipo Ahorro.',
    help_sav_tip:'💡 Consejo: Trata el ahorro como un gasto fijo: presupuéstalo primero y gasta el resto.',
    // Guide
    guide_group_start:'Primeros pasos', guide_group_track:'Controla tu dinero', guide_group_settings:'A tu manera',
    guide_section_big:'La idea general', guide_section_how:'Cómo usarlo', guide_section_connects:'Cómo se conecta', guide_back:'Volver a los temas',
    guide_welcome_title:'Bienvenido a Simple Budget Planner',
    guide_welcome_big:'Esta app responde una pregunta cada mes: ¿adónde fue mi dinero? Registras lo que entra y lo que sale, y ella hace los cálculos silenciosamente para que siempre sepas exactamente dónde estás. Sin hojas de cálculo, sin conjeturas - solo una imagen clara de tu dinero.',
    guide_dashboard_title:'Panel',
    guide_dashboard_big:'Piensa en el Panel como la portada de tus finanzas - un vistazo te dice qué entra, qué sale y qué queda. Es lo primero que vale la pena revisar cada vez que abres la app.',
    guide_dashboard_step1:'Revisa las tarjetas de resumen arriba para tu <strong>Ingreso total</strong>, tu <strong>Gasto total</strong> y tu <strong>Sobrante neto</strong> del período actual.',
    guide_dashboard_step2:'Desplázate al gráfico de <strong>Flujo de caja</strong> para ver cómo se mueve tu dinero semana a semana.',
    guide_dashboard_step3:'Mira el gráfico de <strong>Distribución del gasto</strong> para detectar qué categoría se lleva la mayor parte de tu presupuesto.',
    guide_dashboard_connect1:'Cada transacción que agregas en cualquier parte de la app actualiza estas cifras al instante - no hay nada que actualizar ni recalcular.',
    guide_dashboard_connect2:'El Sobrante neto incluye cualquier importe de <strong>Saldo anterior</strong> que hayas fijado en Ajustes, así un buen mes puede pasar al siguiente.',
    guide_dashboard_connect3:'Si un número no cuadra, casi siempre la solución está en Transacciones, Ingresos, Gastos, Facturas, Deudas o Ahorros - el Panel solo refleja lo que ya se ha registrado.',
    guide_dashboard_tip:'Haz que revisar el Panel sea parte de tu rutina - incluso 10 segundos al día evitan que pequeñas sorpresas se conviertan en grandes.',guide_dashboard_usecase_h:'Así se usa en la práctica',guide_dashboard_usecase_p:'<p><strong>Liam</strong> revisa el Panel antes de decidir si sale a comer esta semana. Ve que su sobrante neto para este período es de solo 45 €, muy por debajo de su margen habitual, así que decide cocinar en casa en lugar de descubrirlo cuando su cuenta esté casi vacía.</p>',
    guide_transactions_title:'Transacciones',
    guide_transactions_big:'Las transacciones son la base de todo lo demás en esta app - cada euro que registras aquí impulsa tu Panel, tus categorías y tu resultado final. Acostúmbrate a registrar en el momento en que gastas, y el resto se cuida solo.',
    guide_transactions_step1:'Toca <strong>Agregar transacción</strong>, elige si es un Ingreso, un Gasto, una Factura, una Deuda o un Ahorro, y completa el importe y la categoría.',
    guide_transactions_step2:'¿Ya tienes tus gastos en una hoja de cálculo? Usa <strong>Importar CSV</strong> para traerlo todo de una vez en lugar de escribir cada línea a mano.',
    guide_transactions_step3:'Toca cualquier transacción en la lista para <strong>editar</strong> el importe, la fecha o la categoría si cometiste un error o algo cambió.',
    guide_transactions_step4:'Usa los controles de búsqueda y filtro sobre la lista para encontrar rápidamente una transacción por tipo, categoría o fecha.',
    guide_transactions_connect1:'Cada transacción que registras cuenta automáticamente para la categoría correspondiente - un Gasto aparece en Gastos, un pago de Factura en Facturas, y así sucesivamente.',
    guide_transactions_connect2:'Los totales y gráficos de tu Panel se construyen enteramente a partir de estos registros - nada se estima.',
    guide_transactions_connect3:'Eliminar o editar una transacción aquí actualiza al instante cada total en toda la app.',
    guide_transactions_tip:'Registra las transacciones el mismo día que ocurren. Toma solo segundos y mantiene tu Panel confiable.',guide_transactions_usecase_h:'Así se usa en la práctica',guide_transactions_usecase_p:'<p>A <strong>Aisha</strong> le pagan el viernes. Abre Transacciones, elige Ingreso → Sueldo, escribe el importe, y queda registrado de inmediato - apareciendo enseguida en su Panel como parte de su Ingreso total del período.</p>',
    guide_income_title:'Ingresos',
    guide_income_big:'Aquí le dices a la app cuánto esperas ganar y luego sigues lo que realmente llegó - así detectas la brecha entre ambos de un vistazo.',
    guide_income_step1:'Fija el importe <strong>Esperado</strong> para cada fuente de ingreso, como tu sueldo o un trabajo extra.',
    guide_income_step2:'Cuando llega el dinero, regístralo como transacción de Ingreso - llenará automáticamente tu columna <strong>Real</strong>.',
    guide_income_step3:'Compara Esperado con Real para ver si vas bien encaminado o si algún ingreso aún no ha llegado.',
    guide_income_connect1:'Las transacciones de ingreso registradas en Transacciones alimentan directamente los totales Reales de esta página.',
    guide_income_connect2:'Tu Ingreso total en el Panel es la suma de todo lo registrado aquí.',
    guide_income_connect3:'Un Sobrante neto más alto empieza aquí - cuanto más precisamente registres tus ingresos, más preciso será todo tu presupuesto.',
    guide_income_tip:'Agrega cada fuente de ingreso por separado, incluso las pequeñas o irregulares - así detectas patrones mucho más fácilmente con el tiempo.',guide_income_usecase_h:'Así se usa en la práctica',guide_income_usecase_p:'<p>Antes de que empiece el mes, <strong>Carlos</strong> fija su Sueldo esperado en 3.200 € y su ingreso Freelance esperado en 400 € en el módulo Ingresos.</p><p>A medida que llegan los pagos por Transacciones, la columna Real se actualiza automáticamente, así puede ver de un vistazo si el trabajo freelance de este mes va según lo planeado.</p>',
    guide_expenses_title:'Gastos',
    guide_expenses_big:'Los gastos son tu día a día - comida, gasolina, café, todo eso. Fijar un importe esperado por categoría te da un punto de referencia en lugar de solo ver cómo desaparece el dinero.',
    guide_expenses_step1:'Agrega una categoría para cada tipo de gasto que quieras seguir, como Comida u Ocio.',
    guide_expenses_step2:'Fija un importe <strong>Esperado</strong> para cada una - lo que te gustaría no superar.',
    guide_expenses_step3:'Registra las compras como transacciones de Gasto y observa cómo se llena automáticamente la columna <strong>Real</strong>.',
    guide_expenses_connect1:'Cada transacción de Gasto que registras en Transacciones se suma directamente a la categoría correspondiente aquí.',
    guide_expenses_connect2:'Las categorías que superan su importe esperado influyen en el gráfico de Distribución del gasto del Panel.',
    guide_expenses_connect3:'Recortar una categoría que se ha excedido aquí es una de las formas más rápidas de aumentar tu Sobrante neto.',
    guide_expenses_tip:'Empieza con solo un puñado de categorías amplias. Siempre puedes dividirlas más adelante en cuanto veas hacia dónde va realmente el dinero.',guide_expenses_usecase_h:'Así se usa en la práctica',guide_expenses_usecase_p:'<p><strong>Nina</strong> quiere ver adónde va realmente su dinero, así que fija importes esperados para Comida, Restaurantes y Transporte en Gastos.</p><p>A mitad de mes nota que Restaurantes ya está al 90% de su presupuesto, y recorta el resto del período en lugar de descubrirlo solo al final del mes.</p>',
    guide_bills_title:'Facturas',
    guide_bills_big:'Las facturas son los pagos que no puedes saltarte - alquiler, servicios, suscripciones a las que te comprometiste. Esta página mantiene visibles las fechas de vencimiento y el estado de pago para que nada se te escape.',
    guide_bills_step1:'Agrega una factura y dale una <strong>Fecha de vencimiento</strong> para saber exactamente cuándo vence.',
    guide_bills_step2:'Una vez que la pagues, marca la casilla <strong>Pagada</strong> para señalarla como resuelta en este período.',
    guide_bills_step3:'Registra el pago real como transacción de Factura para que el importe cuente en tus totales.',
    guide_bills_connect1:'Las facturas sin pagar con un vencimiento próximo merecen revisarse antes de gastar en otra cosa.',
    guide_bills_connect2:'Las transacciones de facturas cuentan para tu Gasto total en el Panel, junto con Gastos y Deudas.',
    guide_bills_connect3:'Marcar una factura como pagada no la elimina - solo sigue su estado, así siempre tienes un registro de lo saldado en este período.',
    guide_bills_tip:'Registra las facturas recurrentes al inicio de cada período para que los vencimientos te esperen a ti, en lugar de tener que recordarlos.',guide_bills_usecase_h:'Así se usa en la práctica',guide_bills_usecase_p:'<p>Cada mes, la factura de luz de <strong>Derek</strong> es un poco distinta. Fija la fecha de vencimiento y el importe esperado (100 €) de Electricidad en Facturas.</p><p>Cuando la paga de verdad, marca la casilla Pagada e introduce los 118,32 € que realmente le cobraron - registrados como una transacción real en vez de solo una marca, para que su historial de gastos siga siendo exacto aunque la factura no fuera exactamente lo previsto.</p>',
    guide_debt_title:'Deudas',
    guide_debt_big:'Esta página reúne cada pago que debes en un solo lugar - tarjetas de crédito, préstamos, cualquier cosa con saldo - para que siempre sepas qué vence y si vas al día.',
    guide_debt_step1:'Agrega cada deuda que sigues junto con tu pago <strong>Esperado</strong> para este período.',
    guide_debt_step2:'Fija una <strong>Fecha de vencimiento</strong> para saber exactamente cuándo debe salir el pago.',
    guide_debt_step3:'Registra el pago como transacción de Deuda y marca <strong>Pagada</strong> una vez que se procese.',
    guide_debt_connect1:'Los pagos de deuda cuentan para tu Gasto total en el Panel, junto con Gastos y Facturas.',
    guide_debt_connect2:'Esta página sigue los pagos como una categoría, no como un plan de pago completo - si quieres una estrategia de bola de nieve o avalancha con proyecciones de interés, para eso está el Pago de deudas de Ultimate Budget Planner.',
    guide_debt_connect3:'Mantenerte constante aquí conserva tu Sobrante neto honesto, ya que las deudas sin pagar suelen alcanzarte después.',
    guide_debt_tip:'Enumera incluso las deudas pequeñas, como un préstamo familiar - lo importante no es el monto, sino saber todo lo que debes en un solo lugar.',guide_debt_usecase_h:'Así se usa en la práctica',guide_debt_usecase_p:'<p><strong>Grace</strong> tiene un pequeño préstamo personal con su hermana. Lo agrega en Deudas con el importe mensual acordado y una fecha de vencimiento.</p><p>Cuando envía el pago, marca Pagada e introduce el importe exacto que envió, para que quede registrado en su historial de transacciones como cualquier otro pago de deuda.</p>',
    guide_savings_title:'Ahorros',
    guide_savings_big:'Los ahorros son donde apartas dinero a propósito, en lugar de simplemente ver qué queda a fin de mes. Tratarlo como cualquier otro gasto planeado es la forma más fácil de realmente acumularlo.',
    guide_savings_step1:'Fija un importe <strong>Esperado</strong> para lo que quieres ahorrar en este período.',
    guide_savings_step2:'Cada vez que muevas dinero al ahorro, regístralo como transacción de Ahorro.',
    guide_savings_step3:'Compara Esperado con <strong>Real</strong> para ver si alcanzaste tu meta de ahorro del período.',
    guide_savings_connect1:'Las transacciones de ahorro registradas en Transacciones cuentan directamente para los totales de esta página.',
    guide_savings_connect2:'Tu cifra de Ahorro total en el Panel proviene directamente de lo registrado aquí.',
    guide_savings_connect3:'El ahorro se incluye en el cálculo de tu Sobrante neto, así que ahorrar de forma constante es una de las formas más directas de aumentar esa cifra con el tiempo.',
    guide_savings_tip:'Fija tu importe de ahorro primero, antes de planear el resto de tu gasto - es mucho más fácil alcanzar una meta con la que te comprometes desde el principio.',guide_savings_usecase_h:'Así se usa en la práctica',guide_savings_usecase_p:'<p>Cada día de pago, <strong>Wen</strong> aparta dinero para la entrada de una casa. Fija su importe de Ahorro esperado en el módulo Ahorros, y a medida que registra transacciones de Ahorro durante el período, ve cómo la barra de progreso se acerca a la meta que se propuso.</p>',
    guide_settings_title:'Ajustes',
    guide_settings_big:'Ajustes es donde la app se adapta a ti - tu moneda, tu período de presupuesto, cómo se ve, en qué idioma habla y cómo se maneja tu información.',
    guide_settings_step1:'Elige tu <strong>Moneda</strong> para que cada importe en la app se muestre como esperas.',
    guide_settings_step2:'Elige tu <strong>Período de presupuesto</strong> (mensual, quincenal, etc.) para que coincida con cómo realmente cobras y pagas.',
    guide_settings_step3:'Ingresa un importe de <strong>Saldo anterior</strong> si quieres que el dinero no gastado del último período pase al Sobrante neto de este.',
    guide_settings_step4:'Elige un tema de <strong>Apariencia</strong> (Claro, Oscuro, Synthwave, Vintage o Terminal), un <strong>Diseño del panel</strong> (2 diseños a elegir, más próximamente), y tu <strong>Idioma</strong> de la lista.',
    guide_settings_step5:'Usa <strong>Exportar datos</strong> para respaldar todo, o <strong>Restablecer datos</strong> si alguna vez quieres empezar completamente de cero.',
    guide_settings_connect1:'Tus elecciones de Moneda y Período de presupuesto determinan cómo cada otra página de la app muestra y calcula los números.',
    guide_settings_connect2:'El importe de Saldo anterior que fijas aquí pasa directamente al Sobrante neto que se muestra en tu Panel.',
    guide_settings_connect3:'Exportar tus datos aquí es la forma más segura de guardar una copia de todo antes de hacer un cambio grande.',
    guide_settings_tip:'Fija tu Moneda y Período de presupuesto desde el principio, antes de registrar transacciones - te ahorra tener que revisar registros antiguos más tarde.',guide_settings_usecase_h:'Así se usa en la práctica',guide_settings_usecase_p:'<p>Cuando <strong>Yuki</strong> se muda a un nuevo país y empieza a ganar en euros, abre Ajustes, cambia su Moneda a EUR, y ajusta su Período de presupuesto a su nuevo ciclo de pago - para que cada cifra de la app refleje su nueva realidad a partir de ese momento.</p>',
    mod_desc_income:'Define tus ingresos previstos para cada fuente. Los montos reales se completan automáticamente al registrar transacciones.',
    mod_desc_expenses:'Define un límite de presupuesto para cada categoría de gasto. Las barras de progreso se ponen rojas si te excedes.',
    mod_desc_bills:'Haz seguimiento de tus facturas recurrentes. Añade una fecha de vencimiento y marca la casilla una vez pagada.',
    mod_desc_debt:'Mantente al día con tus pagos de préstamos e hipoteca. Define los montos previstos y marca cada uno como pagado.',
    mod_desc_savings:'Define una meta de ahorro para cada fondo. Las contribuciones reales provienen de tus transacciones registradas.',
    mod_add_category:'+ Añadir categoría',mod_add_new_category:'Añadir nueva categoría',mod_cat_name_label:'Nombre',
    mod_set_date:'Definir fecha',mod_remove:'Eliminar',mod_mark_paid:'Marcar como pagado',mod_total:'Total',mod_paid_amount_label:'Importe pagado',mod_paid_amount_hint:'Cuánto pagaste realmente - se registrará como transacción para que tu historial de gastos sea exacto, aunque sea distinto del importe presupuestado.',mod_paid_save_btn:'Registrar pago',mod_paid_budgeted_hint:'Presupuestado: {0}',mod_paid_amount_required:'Introduce un importe válido.',toast_mod_paid:'Pago registrado',
    dash_period_title:'Haz clic para cambiar el período de presupuesto',
    sample_loaded_toast:'Datos de ejemplo cargados',
    dash_stat_income:'Ingresos totales',dash_stat_of_expected:'de {0} previsto',
    dash_stat_exp_bills:'Gastos &amp; Facturas',dash_stat_of_budgeted:'de {0} presupuestado',
    dash_stat_debt:'Pagos de deudas',dash_stat_savings:'Ahorros totales',dash_stat_of_goal:'de {0} objetivo',
    dash_net_leftover_period:'Saldo neto de este período',dash_includes_rollover:'Incluye {0} de arrastre del período anterior',
    dash_lf_income:'ingresos',dash_lf_exp_bills:'gastos &amp; fact.',dash_lf_debt:'deudas',dash_lf_savings:'ahorros',dash_lf_rollover:'arrastre',
    dash_cash_flow:'Flujo de caja - Previsto vs Real',dash_income_kept:'de ingresos conservados',dash_expected:'Previsto',dash_actual:'Real',
    dash_daily_spend:'Gasto diario',dash_daily_spend_caption:'gasto total en este período',spend_tip_more:'+{0} más',dash_other_category:'Otro',
    dash_savings_rate:'Tasa de ahorro',dash_saved_sfx:'ahorrado',
    dash_income_sources:'Fuentes de ingresos',dash_no_income:'Aún no se han registrado ingresos.',dash_add_tx_link:'Añadir transacciones →',
    dash_spending_breakdown:'Desglose de gastos',dash_no_spending:'Aún no se han registrado gastos.',
    upgrade_feat_debt:'💳 Pago de deudas',upgrade_feat_sinking:'🏺 Fondos de ahorro',upgrade_feat_calendar:'📅 Calendario inteligente',
    upgrade_feat_subs:'🔄 Suscripciones',upgrade_feat_auto:'⚡ Automatización',upgrade_feat_alloc:'🎯 Asignación',
    upg_chip_tx:'{0} / {0} transacciones gratuitas usadas',upg_chip_cat:'{0} / {0} categorías de {1} gratuitas usadas',upg_chip_limit:'Límite de prueba gratuita alcanzado',
    upg_aria_label:'Actualizar para desbloquear el planificador completo',
    upg_title_html:'Desbloquea el<br>Simple Budget Planner completo',
    upg_sub:'Has alcanzado el límite de la prueba gratuita. Actualiza una vez para eliminar todos los límites. Nunca una suscripción.',
    upg_feat_unlimited_tx_html:'Transacciones <strong>ilimitadas</strong>',
    upg_feat_unlimited_cat_html:'Categorías <strong>ilimitadas</strong> en cada sección',
    upg_feat_csv:'Importación &amp; exportación CSV, historial completo',upg_feat_onetime:'Pago único · actualizaciones gratuitas de por vida',
    upg_price_tag:'pago único',upg_price_note:'Sin suscripción',
    upg_cta_sbp:'Desbloquear Simple Budget por {0}',
    upg_upsell_lead:'⚡ ¿Quieres pago de deudas, fondos de ahorro &amp; más?',upg_upsell_cta:'Obtener Ultimate por {0} →',
    upg_later:'Quizás más tarde',
    reauth_title:'Inicia sesión con Google para continuar',
    reauth_sub:'Tus datos para esta herramienta están sincronizados con Google Drive. Vuelve a iniciar sesión para continuar donde lo dejaste.',
    reauth_submit:'Iniciar sesión con Google',reauth_local:'Usar datos locales de este dispositivo en su lugar',
    sync_welcome:'Bienvenido a Ezzo Budget',sync_choose:'Elige cómo guardar tus datos.',sync_recommended:'Recomendado',
    sync_continue_google:'Continuar con Google',sync_desc_multi_device:'Los datos del planificador se almacenan en varios dispositivos',
    sync_use_no_account:'Usar sin cuenta',sync_desc_this_device:'Los datos del planificador se almacenan solo en este dispositivo',
    sync_status_wait:'Completa los pasos en la ventana de Google que acaba de abrirse. Si no apareció nada, revisa tu barra de direcciones por un icono de ventana emergente bloqueada.',
    sync_footer_note:'Esto se puede cambiar más tarde en los ajustes',
    code_title:'Introduce tu clave de licencia',code_sub:'Desbloquea el {0} completo con el código de tu compra.',
    code_placeholder:'Clave de licencia',code_error:'Ese código no es correcto. Revísalo e inténtalo de nuevo.',
    code_orderid_placeholder:'ID del pedido',code_orderid_error:'Introduce el ID del pedido de tu compra.',
    code_submit:'Enviar',code_try_free:'Probar gratis en su lugar',code_get:'Obtener un código',
    app_name_sbp:'Simple Budget Planner',app_name_ubp:'Ultimate Budget Planner',
    edit_tx_title:'✏️ Editar transacción',save_changes:'Guardar cambios',no_categories:'- sin categorías -',
    no_cat_setup:'- configura categorías primero -',
    tx_error_required:'Por favor completa fecha, tipo, categoría y un monto válido mayor que 0.',
    csv_error_msg:'No se encontraron filas válidas.\n\nFormato esperado:\nFecha, Tipo, Categoría, Monto, Descripción\n2024-01-15, expense, Comida, 25.50, Compra semanal',
    sync_card_title:'☁️ Datos &amp; Sincronización',sync_card_desc:'Elige cómo se almacenan tus datos y se mantienen actualizados entre dispositivos.',
    sync_mode_local_title:'Solo este dispositivo',sync_mode_local_desc:'Los datos se guardan solo en este dispositivo',
    sync_mode_google_title:'Sincronizar con Google',sync_mode_google_desc:'Los datos se sincronizan entre varios dispositivos',
    sync_signed_in_as:'Sesión iniciada como {0}',sync_error_generic:'El inicio de sesión no se completó. Inténtalo de nuevo.',
    sync_err_popup_blocked:'Tu navegador bloqueó la ventana de inicio de sesión de Google. Permite las ventanas emergentes para este sitio (revisa tu barra de direcciones por un icono de ventana emergente bloqueada) e inténtalo de nuevo.',
    sync_err_cancelled:'El inicio de sesión fue cancelado. Inténtalo de nuevo.',
    toast_synced_google:'Sincronizado con Google Drive ✓',toast_synced_local:'Cambiado a almacenamiento local ✓',
    cmp_title:'⚡ Simple vs Ultimate Budget Planner',cmp_col_feature:'Función',cmp_col_simple:'💰 Simple',cmp_col_ultimate:'⚡ Ultimate',
    cmp_section_core:'Presupuesto básico',cmp_section_pro:'Funciones Pro - solo Ultimate',
    cmp_stay_simple:'Quedarme con Simple',cmp_open_ultimate:'Abrir Ultimate Budget Planner →',
    cmp_feat1:'Seguimiento de presupuesto - Ingresos, Gastos, Facturas &amp; Ahorros',
    cmp_feat2:'Registro de transacciones con importación CSV',
    cmp_feat3:'Gráfico de flujo de caja - previsto vs real',
    cmp_feat4:'Gráficos de anillo de ingresos &amp; gastos',
    cmp_feat5:'Control del período de presupuesto con preajustes',
    cmp_feat6:'Arrastre del período anterior',
    cmp_feat7:'Pago de deudas (Bola de nieve &amp; Avalancha)',
    cmp_feat8:'Seguimiento de fondos de ahorro con metas mensuales',
    cmp_feat9:'Calendario inteligente con todos los eventos autocompletados',
    cmp_feat10:'Seguimiento de suscripciones con desglose por categoría',
    cmp_feat11:'Panel Pro con estadísticas clave &amp; panel de próximos eventos',
    cmp_feat12:'Importación con un clic desde Simple Budget Planner',
    cmp_feat13:'Ezzo - tu asistente de presupuesto con IA',
    help_aria:'Ayuda',close_aria:'Cerrar',dismiss_aria:'Descartar',ok:'OK',
  },
  it: {
    lang_name:'Italiano',
    tab_dashboard:'Dashboard',tab_budget:'Budget',tab_transactions:'Transazioni',
    tab_income:'Entrate',tab_expenses:'Spese',tab_bills:'Bollette',
    tab_debt:'Debiti',tab_savings:'Risparmi',tab_settings:'Impostazioni',
    tab_debt_payoff:'Estinzione debiti',tab_sinking:'Accantonamenti',
    tab_calendar:'Calendario',tab_subscriptions:'Abbonamenti',
    total_income:'Entrate totali',expenses_bills:'Spese e bollette',
    debt_payments:'Pagamenti debiti',total_savings:'Risparmi totali',
    total_outgoing:'Uscite totali',savings_rate:'Tasso di risparmio',
    net_leftover:'Saldo netto',cash_flow:'Flusso di cassa',
    income_sources:'Fonti di reddito',spending_breakdown:'Ripartizione spese',
    expected:'Previsto',actual:'Effettivo',progress:'Avanzamento',
    of:'di',budgeted:'preventivato',saved:'risparmiato',
    budget_period:'Periodo di budget',start_date:'Data inizio',end_date:'Data fine',
    this_month:'Questo mese',this_week:'Questa settimana',last_week:'Sett. scorsa',last_month:'Mese scorso',last_30_days:'Ultimi 30 giorni',this_quarter:'Questo trimestre',this_year:'Quest\u2019anno',
    toast_tx_added:'Transazione aggiunta \u2713',toast_tx_updated:'Aggiornato \u2713',toast_tx_deleted:'Eliminato',
    toast_period_updated:'Periodo aggiornato \u2713',toast_period_error:'La data di fine deve essere successiva alla data di inizio',
    toast_currency_updated:'Valuta aggiornata \u2713',toast_imported:'{0} importato/i \u2713',
    toast_fund_created:'Fondo creato \u2713',toast_fund_updated:'Fondo aggiornato \u2713',
    toast_fund_contrib:'{amt} aggiunto a {name} \u2713',
    toast_sub_added:'Abbonamento aggiunto \u2713',toast_sub_updated:'Abbonamento aggiornato \u2713',
    toast_alloc_enabled:'Distribuzione attivata \u2713',toast_alloc_disabled:'Distribuzione disattivata',
    toast_lang_updated:'Lingua aggiornata \u2713',toast_export:'Esportato \u2713',
    toast_saved:'Salvato \u2713',toast_reset:'Tutti i dati cancellati',
    toast_alloc_bucket_added:'Segmento aggiunto \u2713',
    confirm_remove_cat:'Rimuovere questa categoria?',
    confirm_remove_cat_with_tx:'{0} transazione/i esistente/i usa/usano questa categoria. La manterranno come etichetta, ma non sarà più monitorata nel tuo budget. Eliminare comunque?',
    confirm_delete_all_tx:'Eliminare TUTTE le transazioni? Questa azione \u00e8 irreversibile.',
    confirm_delete_tx:'Eliminare questa transazione?',confirm_remove_debt:'Rimuovere questo debito?',
    confirm_delete_fund:'Eliminare questo fondo?',confirm_remove_sub:'Rimuovere questo abbonamento?',
    confirm_reset_1:'Sei sicuro? Tutti i dati verranno eliminati definitivamente.',
    confirm_reset_2:'Ultima possibilit\u00e0 - non \u00e8 reversibile. Continuare?',
    export_csv_btn:'\uD83D\uDCE5 Esporta CSV',
    sett_export_title:'\uD83D\uDCE4 Esporta dati',
    sett_export_desc:"Scarica tutte le transazioni come file CSV per backup o utilizzo in un'altra app.",
    sf_add_contribution:'Aggiungi contributo',sf_contribution_label:'Importo da aggiungere',
    sf_currently_saved:'Attualmente risparmiato',
    tx_search_ph:'Cerca per descrizione o categoria\u2026',
    tx_filter_all_types:'Tutti i tipi',tx_filter_all_alloc:'Tutte le distribuzioni',
    tx_add_btn:'Aggiungi',tx_add_title:'Aggiungi una transazione',tx_amount:'Importo',tx_category:'Categoria',tx_clear_all:'Cancella tutto',tx_date:'Data',tx_desc_label:'Descrizione',tx_desc_ph:'es. Spesa al supermercato\u2026',tx_empty:'Nessuna transazione ancora.',tx_import_csv:'\uD83D\uDCE5 Importa CSV',tx_th_amount:'Importo',tx_th_desc:'Descrizione',tx_transaction_many:'transazioni',tx_transaction_one:'transazione',tx_type:'Tipo',tx_type_bill:'Bolletta',tx_type_debt:'Debito',tx_type_expense:'Spesa',tx_type_income:'Entrata',tx_type_savings:'Risparmio',tx_empty_sub:'Aggiungi la tua prima transazione per iniziare',
    tx_sort_date_new:'Pi\u00f9 recente prima',tx_sort_date_old:'Pi\u00f9 vecchio prima',
    tx_sort_amt_high:'Importo maggiore',tx_sort_amt_low:'Importo minore',
    tx_showing:'Visualizzando {n} di {total}',tx_no_results:'Nessuna transazione corrisponde al tuo filtro.',
    alloc_add_bucket:'+ Aggiungi segmento',alloc_remove_btn:'Rimuovi',
    alloc_min_buckets:'Sono necessari almeno 2 segmenti',
    alloc_auto_tag:'Taggato automaticamente \u2192 {name}',
    tx_prev:'\u2190 Prec.',tx_next:'Succ. \u2192',tx_page_of:'Pagina {n} di {total}',
    debt_due_day_note:'I giorni 29-31 non appaiono nei mesi pi\u00f9 corti',
    sub_advanced:'Data di fatturazione avanzata al {date}',
    currency:'Valuta',rollover:'Riporto',appearance:'Aspetto',
    language:'Lingua',reset_data:'Reimposta dati',
    light:'Chiaro',dark:'Scuro',theme_synthwave:'Synthwave',theme_vintage_ledger:'Vintage',theme_terminal:'Terminal',
    dashboard_layout:'Layout della dashboard',dashboard_layout_desc:'Scegli come viene progettata e visualizzata la tua dashboard.',
    layout_1:'Classico',layout_2:'Impulso radiale',layout_coming_soon:'Presto altri!',
    changes_autosaved:'✅ Le modifiche vengono salvate automaticamente.',
    rollover_desc:'Riporta il denaro non speso dal periodo precedente.',
    rollover_amount:'Importo riporto',
    reset_desc:'Elimina definitivamente tutti i dati. Non reversibile.',
    reset_btn:'Reimposta tutto',
    add:'Aggiungi',cancel:'Annulla',rename_title_prompt:'Rinomina il tuo pianificatore di budget',save:'Salva',delete:'Elimina',dp_today:'Oggi',dp_clear:'Cancella',edit:'Modifica',field_info_aria:'Informazioni su {0}',
    mod_name_hint:'Il nome che vedrai per questa categoria in tutta l’app.',mod_due_date_hint:'Quando scade ogni mese - usato per il calendario e il monitoraggio dei pagamenti.',
    mod_th_expected_hint:'L’importo che prevedi di destinare a questa categoria ogni mese.',mod_th_actual_hint:'Calcolato automaticamente dalle transazioni registrate in questa categoria.',mod_th_progress_hint:'Quale percentuale dell’importo previsto è stata utilizzata finora.',
    tx_date_hint:'La data in cui è avvenuta questa transazione.',tx_type_hint:'Il tipo di transazione - determina da quale elenco di categorie puoi scegliere.',tx_category_hint:'A quale categoria di budget appartiene questa transazione.',tx_amount_hint:'Quanto denaro riguardava questa transazione.',tx_desc_hint:'Una nota facoltativa per aiutarti a ricordare a cosa si riferiva.',
    paid:'Pagato',due_date:'Data di scadenza',category:'Categoria',amount:'Importo',
    description:'Descrizione',date:'Data',type:'Tipo',
    add_category:'+ Aggiungi categoria',no_transactions:'Nessuna transazione.',
    upgrade_title:'Passa a Ultimate Budget Planner',
    upgrade_desc:"Tutto ciò che c'è in Simple, più gli strumenti pro per andare avanti: azzera i debiti, risparmia per ciò che conta e non perdere mai una bolletta.",
    upgrade_now:'Aggiorna ora →',upgrade_get_now:'OTTIENI',upgrade_compare:'CONFRONTA',sett_upgrade_h:'Banner di upgrade',sett_upgrade_label:'Mostra il banner nella dashboard',
    mon:'Lun',tue:'Mar',wed:'Mer',thu:'Gio',fri:'Ven',sat:'Sab',sun:'Dom',
    quick_presets:'Selezione rapida:',select_currency:'Seleziona la tua valuta',select_language:'Seleziona lingua',
    appearance_desc:'Scegli un tema di colore.',
    dash_anim_title:'Animazioni della dashboard',dash_anim_desc:'Riproduci una sottile animazione di ingresso al caricamento della dashboard.',dash_anim_label:'Attiva animazioni',
    help_sett_modal_title:'Come funzionano le impostazioni',help_sett_intro:'Personalizza Ezzo Budget in base alla tua situazione.',
    help_sett_currency_li:"Aggiorna il simbolo ovunque (alcune valute come il PLN inseriscono il simbolo dopo l'importo).",
    help_sett_period_li:'Imposta il tuo intervallo di date. Fai clic sul badge della data nel pannello per accedervi rapidamente.',
    help_sett_rollover_li:"Riporta il denaro non speso dall'ultimo periodo.",
    help_sett_theme_li:'Scegli tra cinque temi di colore - Chiaro, Scuro, Synthwave, Vintage o Terminal.',
    help_sett_layout_li:'Scegli tra due design della dashboard - Classico o Impulso radiale - ognuno con i propri grafici e layout; altri design in arrivo.',
    help_dash_modal_title:'Come funziona la Dashboard',help_dash_intro:'La Dashboard è la tua panoramica finanziaria in tempo reale. Tutto si aggiorna automaticamente man mano che registri le transazioni.',
    help_dash_cards_h:'Schede di riepilogo',help_dash_cards_li:'Totali di entrate, spese &amp; bollette, pagamenti dei debiti e risparmi per il periodo corrente.',
    help_dash_leftover_li:'Ciò che resta dopo tutte le uscite. <span style="color:#10b981;font-weight:600">Verde</span> = surplus, <span style="color:#f43f5e;font-weight:600">rosso</span> = oltre il budget.',
    help_dash_flow_h:'Grafico Flusso di cassa',help_dash_flow_li:'Confronta ciò che avevi <em>previsto</em> con ciò che è <em>realmente accaduto</em>.',
    help_dash_donut_h:'Grafici a ciambella',help_dash_donut_li:'Ripartizione delle entrate e delle spese in percentuale.',
    help_dash_datebadge_h:'Badge della data',help_dash_datebadge_li:'Fai clic per andare direttamente alle Impostazioni e cambiare il tuo periodo di budget.',
    help_dash_tip:'💡 Suggerimento: inserisci prima gli importi previsti in Entrate / Spese / Bollette / Debiti / Risparmi, poi registra le transazioni per vedere comparire gli importi effettivi.',
    help_tx_modal_title:'Come funzionano le Transazioni',help_tx_intro:'Registra qui ogni movimento di denaro. I moduli di budget si aggiornano automaticamente.',
    help_tx_type_li:'Entrata, Spesa, Bolletta, Debito o Risparmio.',help_tx_category_li:'Ripresa dalle categorie dei tuoi moduli di budget.',
    help_tx_edit_h:'✏️ Pulsante Modifica',help_tx_edit_li:"Fai clic sull'icona della matita su qualsiasi riga per modificare o eliminare quella transazione.",
    help_tx_csv_h:'Formato di importazione CSV:',
    help_inc_modal_title:'Come funzionano le Entrate',help_inc_intro:'Confronta previsto ed effettivo per le tue entrate. Le barre di avanzamento si aggiornano dal vivo mentre digiti gli importi previsti.',
    help_inc_expected_li:"Digita l'entrata prevista; la barra si aggiorna all'istante.",help_inc_actual_li:'Calcolato automaticamente dalle transazioni di tipo Entrata.',
    help_inc_tip:'💡 Suggerimento: registra i tuoi guadagni come tipo "Entrata" nelle Transazioni per vedere qui gli importi effettivi.',
    help_exp_modal_title:'Come funzionano le Spese',help_exp_intro:'Imposta un limite di spesa per ogni categoria. Le barre di avanzamento si aggiornano dal vivo e diventano rosse quando lo superi.',
    help_exp_expected_li:'Il tuo limite di spesa; la barra si aggiorna mentre digiti.',help_exp_actual_li:'Totalizzato dalle transazioni di tipo Spesa.',
    help_bills_modal_title:'Come funzionano le Bollette',help_bills_intro:'Tieni traccia delle bollette ricorrenti con scadenze e stato di pagamento.',
    help_bills_duedate_li:'Imposta quando scade ogni bolletta.',help_bills_paid_li:"Spunta la casella quando hai effettuato il pagamento - ti verrà chiesto l'importo effettivamente pagato, che viene registrato come transazione, poiché bollette come le utenze raramente corrispondono esattamente all'importo previsto.",help_bills_actual_li:'Popolato dalle transazioni di tipo Bolletta con lo stesso nome di categoria.',
    help_debt_modal_title:'Come funzionano i Debiti',help_debt_intro:'Tieni sotto controllo i rimborsi di prestiti e mutui.',
    help_debt_expected_li:'Il tuo pagamento mensile previsto.',help_debt_duedate_li:'Quando scade il pagamento.',help_debt_paid_li:"Segnalo quando il pagamento viene saldato - ti verrà chiesto l'importo effettivamente pagato, che viene registrato come transazione, poiché può differire dal pagamento previsto.",
    help_sav_modal_title:'Come funzionano i Risparmi',help_sav_intro:'Imposta obiettivi di risparmio e monitora i tuoi versamenti.',
    help_sav_expected_li:'Il tuo obiettivo di risparmio per questo periodo.',help_sav_actual_li:'Dalle transazioni di tipo Risparmio.',
    help_sav_tip:'💡 Suggerimento: tratta il risparmio come una spesa fissa - mettilo a budget per primo e spendi il resto.',
    // Guide
    guide_group_start:"Per iniziare", guide_group_track:"Tieni traccia dei tuoi soldi", guide_group_settings:"A modo tuo",
    guide_section_big:"Il quadro generale", guide_section_how:"Come si usa", guide_section_connects:"Come si collega", guide_back:"Torna agli argomenti",
    guide_welcome_title:"Benvenuto in Simple Budget Planner",
    guide_welcome_big:"Questa app risponde a una domanda ogni mese: dove sono finiti i miei soldi? Registri quello che entra e quello che esce, e lei fa silenziosamente i calcoli così sai sempre esattamente a che punto sei. Niente fogli di calcolo, niente supposizioni - solo un quadro chiaro delle tue finanze.",
    guide_dashboard_title:"Dashboard",
    guide_dashboard_big:"Pensa alla Dashboard come alla copertina delle tue finanze - un'occhiata ti dice cosa entra, cosa esce e cosa resta. È la prima cosa da controllare ogni volta che apri l'app.",
    guide_dashboard_step1:"Controlla le schede riepilogo in alto per le tue <strong>Entrate totali</strong>, le tue <strong>Uscite totali</strong> e il tuo <strong>Avanzo netto</strong> per il periodo corrente.",
    guide_dashboard_step2:"Scorri fino al grafico <strong>Flusso di cassa</strong> per vedere come si muovono i tuoi soldi settimana per settimana.",
    guide_dashboard_step3:"Guarda il grafico <strong>Distribuzione spese</strong> per individuare quale categoria si prende la fetta più grande del tuo budget.",
    guide_dashboard_connect1:"Ogni transazione che aggiungi ovunque nell'app aggiorna questi numeri all'istante - non c'è nulla da aggiornare o ricalcolare.",
    guide_dashboard_connect2:"L'Avanzo netto include qualsiasi importo di <strong>Riporto</strong> impostato nelle Impostazioni, così un buon mese può ripercuotersi sul successivo.",
    guide_dashboard_connect3:"Se un numero sembra sbagliato, la correzione è quasi sempre in Transazioni, Entrate, Uscite, Bollette, Debiti o Risparmi - la Dashboard riflette solo ciò che è già stato inserito.",
    guide_dashboard_tip:"Rendi il controllo della Dashboard parte della tua routine - anche solo 10 secondi al giorno evitano che piccole sorprese diventino grandi.",guide_dashboard_usecase_h:'Un esempio pratico',guide_dashboard_usecase_p:"<p><strong>Liam</strong> controlla la Dashboard prima di decidere se uscire a mangiare questa settimana. Vede che il suo avanzo netto per questo periodo è solo di 45 €, ben sotto il suo margine abituale, così decide di cucinare a casa invece di scoprire il problema quando il conto è quasi vuoto.</p>",
    guide_transactions_title:"Transazioni",
    guide_transactions_big:"Le transazioni sono la base di tutto il resto in quest'app - ogni euro che registri qui alimenta la tua Dashboard, le tue categorie e il tuo saldo finale. Prendi l'abitudine di registrarle mentre spendi, e il resto va da sé.",
    guide_transactions_step1:"Tocca <strong>Aggiungi transazione</strong>, scegli se si tratta di un'Entrata, una Spesa, una Bolletta, un Debito o un Risparmio, e inserisci importo e categoria.",
    guide_transactions_step2:"Hai già le tue spese in un foglio di calcolo? Usa <strong>Importa CSV</strong> per importarle tutte insieme invece di digitarle una per una.",
    guide_transactions_step3:"Tocca una transazione nell'elenco per <strong>modificare</strong> importo, data o categoria se hai commesso un errore o qualcosa è cambiato.",
    guide_transactions_step4:"Usa i filtri e la ricerca sopra l'elenco per trovare rapidamente una transazione per tipo, categoria o data.",
    guide_transactions_connect1:"Ogni transazione che registri conta automaticamente nella categoria corrispondente - una Spesa compare in Uscite, un pagamento di Bolletta in Bollette, e così via.",
    guide_transactions_connect2:"I totali e i grafici della tua Dashboard si basano interamente su queste registrazioni - niente è stimato.",
    guide_transactions_connect3:"Eliminare o modificare una transazione qui aggiorna all'istante ogni totale in tutta l'app.",
    guide_transactions_tip:"Registra le transazioni lo stesso giorno in cui avvengono. Richiede pochi secondi e mantiene affidabile la tua Dashboard.",guide_transactions_usecase_h:'Un esempio pratico',guide_transactions_usecase_p:"<p><strong>Aisha</strong> viene pagata il venerdì. Apre Transazioni, sceglie Entrata → Stipendio, digita l'importo, ed è registrato immediatamente - compare subito nella sua Dashboard come parte delle Entrate totali del periodo.</p>",
    guide_income_title:"Entrate",
    guide_income_big:"Qui dici all'app quanto prevedi di guadagnare, e poi tieni traccia di quanto è effettivamente arrivato - così noti la differenza tra i due a colpo d'occhio.",
    guide_income_step1:"Imposta l'importo <strong>Previsto</strong> per ogni fonte di entrata, come lo stipendio o un lavoro extra.",
    guide_income_step2:"Quando arrivano i soldi, registrali come transazione di Entrata - riempirà automaticamente la colonna <strong>Effettivo</strong>.",
    guide_income_step3:"Confronta Previsto con Effettivo per vedere se sei in linea o se qualche entrata non è ancora arrivata.",
    guide_income_connect1:"Le transazioni di entrata registrate in Transazioni alimentano direttamente i totali Effettivo di questa pagina.",
    guide_income_connect2:"Le tue Entrate totali nella Dashboard sono la somma di tutto ciò che viene tracciato qui.",
    guide_income_connect3:"Un Avanzo netto più alto inizia da qui - più tracci con precisione le entrate, più preciso sarà tutto il tuo budget.",
    guide_income_tip:"Aggiungi ogni fonte di entrata separatamente, anche quelle piccole o irregolari - così è molto più facile individuare gli schemi nel tempo.",guide_income_usecase_h:'Un esempio pratico',guide_income_usecase_p:"<p>Prima dell'inizio del mese, <strong>Carlos</strong> imposta il suo Stipendio previsto a 3.200 € e la sua Entrata freelance prevista a 400 € nel modulo Entrate.</p><p>Man mano che arrivano i pagamenti tramite Transazioni, la colonna Effettivo si aggiorna automaticamente, così può vedere a colpo d'occhio se il lavoro freelance di questo mese sta procedendo come previsto.</p>",
    guide_expenses_title:"Uscite",
    guide_expenses_big:"Le uscite sono le tue spese quotidiane - spesa, benzina, caffè, tutto quanto. Impostare un importo previsto per categoria ti dà un riferimento invece di guardare semplicemente i soldi sparire.",
    guide_expenses_step1:"Aggiungi una categoria per ogni tipo di spesa che vuoi tracciare, come Spesa o Svago.",
    guide_expenses_step2:"Imposta un importo <strong>Previsto</strong> per ciascuna - quello che vorresti non superare.",
    guide_expenses_step3:"Registra gli acquisti come transazioni di Uscita e guarda la colonna <strong>Effettivo</strong> riempirsi automaticamente.",
    guide_expenses_connect1:"Ogni transazione di uscita che registri in Transazioni si aggiunge direttamente alla categoria corrispondente qui.",
    guide_expenses_connect2:"Le categorie che superano il loro importo previsto contribuiscono al grafico Distribuzione spese nella Dashboard.",
    guide_expenses_connect3:"Ridurre una categoria che ha sforato qui è uno dei modi più rapidi per aumentare il tuo Avanzo netto.",
    guide_expenses_tip:"Inizia con solo una manciata di categorie ampie. Potrai sempre suddividerle meglio più avanti, una volta capito dove vanno davvero i soldi.",guide_expenses_usecase_h:'Un esempio pratico',guide_expenses_usecase_p:"<p><strong>Nina</strong> vuole vedere dove vanno davvero i suoi soldi, così imposta importi previsti per Spesa, Ristoranti e Trasporti in Uscite.</p><p>A metà mese nota che Ristoranti è già al 90% del suo budget, e taglia le spese per il resto del periodo invece di scoprirlo solo alla fine del mese.</p>",
    guide_bills_title:"Bollette",
    guide_bills_big:"Le bollette sono i pagamenti che non puoi saltare - affitto, utenze, abbonamenti a cui ti sei impegnato. Questa pagina tiene ben visibili le scadenze e lo stato di pagamento così niente ti sfugge.",
    guide_bills_step1:"Aggiungi una bolletta e dalle una <strong>Data di scadenza</strong> per sapere esattamente quando è dovuta.",
    guide_bills_step2:"Una volta pagata, spunta la casella <strong>Pagata</strong> per segnarla come saldata per questo periodo.",
    guide_bills_step3:"Registra il pagamento effettivo come transazione di Bolletta così l'importo conta nei tuoi totali.",
    guide_bills_connect1:"Le bollette non pagate con una scadenza vicina meritano un controllo prima di spendere altrove.",
    guide_bills_connect2:"Le transazioni di bollette contano per le tue Uscite totali nella Dashboard, insieme a Uscite e Debiti.",
    guide_bills_connect3:"Segnare una bolletta come pagata non la rimuove - traccia solo lo stato, così hai sempre una registrazione di ciò che è stato saldato in questo periodo.",
    guide_bills_tip:"Registra le bollette ricorrenti a inizio periodo così le scadenze ti aspettano, invece di doverle ricordare.",guide_bills_usecase_h:'Un esempio pratico',guide_bills_usecase_p:"<p>Ogni mese, la bolletta della luce di <strong>Derek</strong> è un po' diversa. Imposta data di scadenza e importo previsto (100 €) per Elettricità in Bollette.</p><p>Quando la paga davvero, spunta la casella Pagata e inserisce i 118,32 € effettivamente addebitati - registrati come una transazione reale invece di un semplice segno di spunta, così la sua cronologia di spesa resta accurata anche se la bolletta non era esattamente quella prevista.</p>",
    guide_debt_title:"Debiti",
    guide_debt_big:"Questa pagina raccoglie ogni pagamento che devi in un unico posto - carte di credito, prestiti, qualsiasi cosa con un saldo - così sai sempre cosa è dovuto e se sei in pari.",
    guide_debt_step1:"Aggiungi ogni debito che tracci insieme al tuo pagamento <strong>Previsto</strong> per questo periodo.",
    guide_debt_step2:"Imposta una <strong>Data di scadenza</strong> per sapere esattamente quando deve partire il pagamento.",
    guide_debt_step3:"Registra il pagamento come transazione di Debito e spunta <strong>Pagata</strong> una volta saldato.",
    guide_debt_connect1:"I pagamenti dei debiti contano per le tue Uscite totali nella Dashboard insieme a Uscite e Bollette.",
    guide_debt_connect2:"Questa pagina traccia i pagamenti come una categoria, non come un piano di rimborso completo - se vuoi una strategia a valanga o a palla di neve con proiezioni sugli interessi, è a questo che serve il Pagamento debiti di Ultimate Budget Planner.",
    guide_debt_connect3:"Restare costante qui mantiene onesto il tuo Avanzo netto, perché i debiti non pagati tendono a raggiungerti più avanti.",
    guide_debt_tip:"Elenca anche i debiti piccoli, come un prestito familiare - non conta l'importo, ma sapere tutto ciò che devi in un unico posto.",guide_debt_usecase_h:'Un esempio pratico',guide_debt_usecase_p:"<p><strong>Grace</strong> ha un piccolo prestito personale verso sua sorella. Lo aggiunge in Debiti con l'importo mensile concordato e una data di scadenza.</p><p>Quando invia il pagamento, spunta Pagata e inserisce l'importo esatto inviato, così viene tracciato nella sua cronologia delle transazioni come qualsiasi altro pagamento di debito.</p>",
    guide_savings_title:"Risparmi",
    guide_savings_big:"I risparmi sono dove metti da parte i soldi di proposito, invece di vedere semplicemente cosa resta a fine mese. Trattarli come qualsiasi altra spesa pianificata è il modo più semplice per costruirli davvero.",
    guide_savings_step1:"Imposta un importo <strong>Previsto</strong> per quello che vuoi risparmiare in questo periodo.",
    guide_savings_step2:"Ogni volta che sposti soldi nel risparmio, registralo come transazione di Risparmio.",
    guide_savings_step3:"Confronta Previsto con <strong>Effettivo</strong> per vedere se hai raggiunto il tuo obiettivo di risparmio per il periodo.",
    guide_savings_connect1:"Le transazioni di risparmio registrate in Transazioni contano direttamente nei totali di questa pagina.",
    guide_savings_connect2:"La tua cifra di Risparmi totali nella Dashboard proviene direttamente da ciò che viene tracciato qui.",
    guide_savings_connect3:"Il risparmio è incluso nel calcolo del tuo Avanzo netto, quindi risparmiare con costanza è uno dei modi più diretti per far crescere quella cifra nel tempo.",
    guide_savings_tip:"Fissa prima l'importo del risparmio, prima di pianificare il resto delle spese - è molto più facile raggiungere un obiettivo a cui ti impegni fin dall'inizio.",guide_savings_usecase_h:'Un esempio pratico',guide_savings_usecase_p:"<p>A ogni stipendio, <strong>Wen</strong> mette da parte soldi per l'acconto di una casa. Imposta il suo importo di Risparmio previsto nel modulo Risparmi, e mentre registra transazioni di Risparmio durante il periodo, vede la barra di avanzamento avvicinarsi all'obiettivo pianificato.</p>",
    guide_settings_title:"Impostazioni",
    guide_settings_big:"Le Impostazioni sono dove l'app si adatta a te - la tua valuta, il tuo periodo di budget, l'aspetto, la lingua e come vengono gestiti i tuoi dati.",
    guide_settings_step1:"Scegli la tua <strong>Valuta</strong> così ogni importo nell'app viene mostrato come ti aspetti.",
    guide_settings_step2:"Scegli il tuo <strong>Periodo di budget</strong> (mensile, quindicinale, ecc.) per adattarlo a come vieni pagato e paghi davvero.",
    guide_settings_step3:"Inserisci un importo di <strong>Riporto</strong> se vuoi che i soldi non spesi del periodo precedente confluiscano nell'Avanzo netto di questo.",
    guide_settings_step4:"Scegli un tema d'<strong>Aspetto</strong> (Chiaro, Scuro, Synthwave, Vintage o Terminal), un <strong>Layout della dashboard</strong> (2 design tra cui scegliere, altri in arrivo), e la tua <strong>Lingua</strong> dall'elenco.",
    guide_settings_step5:"Usa <strong>Esporta dati</strong> per fare un backup di tutto, o <strong>Ripristina dati</strong> se vuoi mai ricominciare completamente da zero.",
    guide_settings_connect1:"Le tue scelte di Valuta e Periodo di budget determinano come ogni altra pagina dell'app mostra e calcola i numeri.",
    guide_settings_connect2:"L'importo di Riporto impostato qui confluisce direttamente nell'Avanzo netto mostrato nella tua Dashboard.",
    guide_settings_connect3:"Esportare i tuoi dati qui è l'abitudine più sicura prima di fare qualsiasi cambiamento importante.",
    guide_settings_tip:"Imposta Valuta e Periodo di budget fin da subito, prima di registrare transazioni - ti risparmia di dover ricontrollare vecchie registrazioni più avanti.",guide_settings_usecase_h:'Un esempio pratico',guide_settings_usecase_p:"<p>Quando <strong>Yuki</strong> si trasferisce in un nuovo paese e inizia a guadagnare in euro, apre Impostazioni, cambia la sua Valuta in EUR, e adatta il suo Periodo di budget al nuovo ciclo di pagamento - così ogni cifra nell'app riflette la sua nuova realtà da quel momento in poi.</p>",
    mod_desc_income:'Imposta le entrate previste per ogni fonte. Gli importi effettivi si compilano automaticamente quando registri le transazioni.',
    mod_desc_expenses:'Imposta un limite di budget per ogni categoria di spesa. Le barre di avanzamento diventano rosse in caso di superamento.',
    mod_desc_bills:'Tieni traccia delle bollette ricorrenti. Aggiungi una scadenza, poi spunta la casella una volta pagata.',
    mod_desc_debt:'Resta al passo con i pagamenti di prestiti e mutui. Imposta gli importi previsti e segna ciascuno come pagato.',
    mod_desc_savings:'Imposta un obiettivo di risparmio per ogni salvadanaio. I contributi effettivi provengono dalle transazioni registrate.',
    mod_add_category:'+ Aggiungi categoria',mod_add_new_category:'Aggiungi nuova categoria',mod_cat_name_label:'Nome',
    mod_set_date:'Imposta data',mod_remove:'Rimuovi',mod_mark_paid:'Segna come pagato',mod_total:'Totale',mod_paid_amount_label:'Importo pagato',mod_paid_amount_hint:"Quanto hai effettivamente pagato - viene registrato come transazione così la tua cronologia di spesa resta accurata, anche se diverso dall'importo previsto.",mod_paid_save_btn:'Registra pagamento',mod_paid_budgeted_hint:'Preventivato: {0}',mod_paid_amount_required:'Inserisci un importo valido.',toast_mod_paid:'Pagamento registrato',
    dash_period_title:'Clicca per cambiare il periodo di budget',
    dash_stat_income:'Entrate totali',dash_stat_of_expected:'di {0} previsto',
    dash_stat_exp_bills:'Spese &amp; Bollette',dash_stat_of_budgeted:'di {0} a budget',
    dash_stat_debt:'Pagamenti debiti',dash_stat_savings:'Risparmi totali',dash_stat_of_goal:'di {0} obiettivo',
    dash_net_leftover_period:'Saldo netto di questo periodo',dash_includes_rollover:'Include {0} di riporto dal periodo precedente',
    dash_lf_income:'entrate',dash_lf_exp_bills:'spese &amp; boll.',dash_lf_debt:'debiti',dash_lf_savings:'risparmi',dash_lf_rollover:'riporto',
    dash_cash_flow:'Flusso di cassa - Previsto vs Effettivo',dash_income_kept:'di reddito trattenuto',dash_expected:'Previsto',dash_actual:'Effettivo',
    dash_daily_spend:'Spesa giornaliera',dash_daily_spend_caption:'spesa totale nel periodo',spend_tip_more:'+{0} altri',dash_other_category:'Altro',
    dash_savings_rate:'Tasso di risparmio',dash_saved_sfx:'risparmiato',
    dash_income_sources:'Fonti di entrata',dash_no_income:'Nessuna entrata registrata.',dash_add_tx_link:'Aggiungi transazioni →',
    dash_spending_breakdown:'Dettaglio spese',dash_no_spending:'Nessuna spesa registrata.',
    upgrade_feat_debt:'💳 Pagamento debiti',upgrade_feat_sinking:'🏺 Fondi di accantonamento',upgrade_feat_calendar:'📅 Calendario intelligente',
    upgrade_feat_subs:'🔄 Abbonamenti',upgrade_feat_auto:'⚡ Automazione',upgrade_feat_alloc:'🎯 Ripartizione',
    upg_chip_tx:'{0} / {0} transazioni gratuite utilizzate',upg_chip_cat:'{0} / {0} categorie {1} gratuite utilizzate',upg_chip_limit:'Limite di prova gratuita raggiunto',
    upg_aria_label:'Esegui l’upgrade per sbloccare il pianificatore completo',
    upg_title_html:'Sblocca il<br>Simple Budget Planner completo',
    upg_sub:'Hai raggiunto il limite della prova gratuita. Esegui l’upgrade una volta per rimuovere ogni limite. Mai un abbonamento.',
    upg_feat_unlimited_tx_html:'Transazioni <strong>illimitate</strong>',
    upg_feat_unlimited_cat_html:'Categorie <strong>illimitate</strong> in ogni sezione',
    upg_feat_csv:'Importazione &amp; esportazione CSV, cronologia completa',upg_feat_onetime:'Pagamento unico · aggiornamenti gratuiti a vita',
    upg_price_tag:'una tantum',upg_price_note:'Nessun abbonamento',
    upg_cta_sbp:'Sblocca Simple Budget per {0}',
    upg_upsell_lead:'⚡ Vuoi pagamento debiti, fondi di accantonamento &amp; altro?',upg_upsell_cta:'Ottieni Ultimate per {0} →',
    upg_later:'Forse più tardi',
    reauth_title:'Accedi con Google per continuare',
    reauth_sub:'I tuoi dati per questo strumento sono sincronizzati con Google Drive. Accedi di nuovo per riprendere da dove avevi lasciato.',
    reauth_submit:'Accedi con Google',reauth_local:'Usa invece i dati locali su questo dispositivo',
    sync_welcome:'Benvenuto su Ezzo Budget',sync_choose:'Scegli come salvare i tuoi dati.',sync_recommended:'Consigliato',
    sync_continue_google:'Continua con Google',sync_desc_multi_device:'I dati del pianificatore sono memorizzati su più dispositivi',
    sync_use_no_account:'Usa senza account',sync_desc_this_device:'I dati del pianificatore sono memorizzati solo su questo dispositivo',
    sync_status_wait:'Completa i passaggi nella finestra Google appena apertasi. Se non è apparso nulla, controlla la barra degli indirizzi per un’icona di popup bloccato.',
    sync_footer_note:'Questo può essere modificato in seguito nelle impostazioni',
    code_title:'Inserisci la tua chiave di licenza',code_sub:'Sblocca il {0} completo con il codice del tuo acquisto.',
    code_placeholder:'Chiave di licenza',code_error:'Il codice non è corretto. Controllalo e riprova.',
    code_orderid_placeholder:'ID ordine',code_orderid_error:"Inserisci l'ID dell'ordine del tuo acquisto.",
    code_submit:'Invia',code_try_free:'Prova gratis invece',code_get:'Ottieni un codice',
    app_name_sbp:'Simple Budget Planner',app_name_ubp:'Ultimate Budget Planner',
    edit_tx_title:'✏️ Modifica transazione',save_changes:'Salva modifiche',no_categories:'- nessuna categoria -',
    no_cat_setup:'- imposta prima le categorie -',
    tx_error_required:'Compila data, tipo, categoria e un importo valido maggiore di 0.',
    csv_error_msg:'Nessuna riga valida trovata.\n\nFormato previsto:\nData, Tipo, Categoria, Importo, Descrizione\n2024-01-15, expense, Alimentari, 25.50, Spesa settimanale',
    sync_card_title:'☁️ Dati &amp; Sincronizzazione',sync_card_desc:'Scegli come vengono memorizzati e tenuti aggiornati i tuoi dati tra i dispositivi.',
    sync_mode_local_title:'Solo questo dispositivo',sync_mode_local_desc:'I dati sono salvati solo su questo dispositivo',
    sync_mode_google_title:'Sincronizza con Google',sync_mode_google_desc:'I dati sono sincronizzati tra più dispositivi',
    sync_signed_in_as:'Accesso effettuato come {0}',sync_error_generic:'L’accesso non è andato a buon fine. Riprova.',
    sync_err_popup_blocked:'Il tuo browser ha bloccato la finestra di accesso Google. Consenti i popup per questo sito (controlla la barra degli indirizzi per un’icona di popup bloccato) e riprova.',
    sync_err_cancelled:'Accesso annullato. Riprova.',
    toast_synced_google:'Sincronizzato con Google Drive ✓',toast_synced_local:'Passato all’archiviazione locale ✓',
    cmp_title:'⚡ Simple vs Ultimate Budget Planner',cmp_col_feature:'Funzione',cmp_col_simple:'💰 Simple',cmp_col_ultimate:'⚡ Ultimate',
    cmp_section_core:'Budgeting principale',cmp_section_pro:'Funzioni Pro - solo Ultimate',
    cmp_stay_simple:'Resta con Simple',cmp_open_ultimate:'Apri Ultimate Budget Planner →',
    cmp_feat1:'Monitoraggio budget - Entrate, Spese, Bollette &amp; Risparmi',
    cmp_feat2:'Registrazione transazioni con importazione CSV',
    cmp_feat3:'Grafico del flusso di cassa - previsto vs effettivo',
    cmp_feat4:'Grafici a ciambella di entrate &amp; spese',
    cmp_feat5:'Controllo del periodo di budget con preimpostazioni',
    cmp_feat6:'Riporto dal periodo precedente',
    cmp_feat7:'Pagamento debiti (Palla di neve &amp; Valanga)',
    cmp_feat8:'Monitoraggio fondi di accantonamento con obiettivi mensili',
    cmp_feat9:'Calendario intelligente con tutti gli eventi popolati automaticamente',
    cmp_feat10:'Monitoraggio abbonamenti con ripartizione per categoria',
    cmp_feat11:'Dashboard Pro con statistiche principali &amp; pannello eventi in arrivo',
    cmp_feat12:'Importazione con un clic da Simple Budget Planner',
    cmp_feat13:'Ezzo - il tuo assistente di budget IA',
    help_aria:'Aiuto',close_aria:'Chiudi',dismiss_aria:'Ignora',ok:'OK',
  },
  pl: {
    lang_name:'Polski',
    tab_dashboard:'Panel',tab_budget:'Budżet',tab_transactions:'Transakcje',
    tab_income:'Przychody',tab_expenses:'Wydatki',tab_bills:'Rachunki',
    tab_debt:'Długi',tab_savings:'Oszczędności',tab_settings:'Ustawienia',
    tab_debt_payoff:'Spłata długów',tab_sinking:'Fundusze celowe',
    tab_calendar:'Kalendarz',tab_subscriptions:'Subskrypcje',
    total_income:'Łączne przychody',expenses_bills:'Wydatki i rachunki',
    debt_payments:'Spłaty długów',total_savings:'Łączne oszczędności',
    total_outgoing:'Łączne wydatki',savings_rate:'Stopa oszczędności',
    net_leftover:'Saldo netto',cash_flow:'Przepływ gotówki',
    income_sources:'Źródła dochodów',spending_breakdown:'Podział wydatków',
    expected:'Planowane',actual:'Rzeczywiste',progress:'Postęp',
    of:'z',budgeted:'zaplanowane',saved:'zaoszczędzone',
    budget_period:'Okres budżetowy',start_date:'Data rozpoczęcia',end_date:'Data zakończenia',
    this_month:'Ten miesiąc',this_week:'Ten tydzień',last_week:'Poprz. tydzień',last_month:'Poprz. miesiąc',last_30_days:'Ostatnie 30 dni',this_quarter:'Ten kwartał',this_year:'Ten rok',
    toast_tx_added:'Transakcja dodana \u2713',toast_tx_updated:'Zaktualizowano \u2713',toast_tx_deleted:'Usuni\u0119to',
    toast_period_updated:'Okres zaktualizowany \u2713',toast_period_error:'Data ko\u0144cowa musi by\u0107 po dacie pocz\u0105tkowej',
    toast_currency_updated:'Waluta zaktualizowana \u2713',toast_imported:'Zaimportowano {0} \u2713',
    toast_fund_created:'Fundusz utworzony \u2713',toast_fund_updated:'Fundusz zaktualizowany \u2713',
    toast_fund_contrib:'Dodano {amt} do {name} \u2713',
    toast_sub_added:'Subskrypcja dodana \u2713',toast_sub_updated:'Subskrypcja zaktualizowana \u2713',
    toast_alloc_enabled:'Podzia\u0142 w\u0142\u0105czony \u2713',toast_alloc_disabled:'Podzia\u0142 wy\u0142\u0105czony',
    toast_lang_updated:'J\u0119zyk zaktualizowany \u2713',toast_export:'Wyeksportowano \u2713',
    toast_saved:'Zapisano \u2713',toast_reset:'Wszystkie dane usuni\u0119te',
    toast_alloc_bucket_added:'Segment dodany \u2713',
    confirm_remove_cat:'Usun\u0105\u0107 t\u0119 kategori\u0119?',
    confirm_remove_cat_with_tx:'{0} istniej\u0105ca(-ych) transakcja(-i) u\u017cywa tej kategorii. Zachowaj\u0105 j\u0105 jako etykiet\u0119, ale nie b\u0119dzie ju\u017c \u015bledzona w Twoim bud\u017cecie. Usun\u0105\u0107 mimo to?',
    confirm_delete_all_tx:'Usun\u0105\u0107 WSZYSTKIE transakcje? Tej operacji nie mo\u017cna cofn\u0105\u0107.',
    confirm_delete_tx:'Usun\u0105\u0107 t\u0119 transakcj\u0119?',confirm_remove_debt:'Usun\u0105\u0107 ten d\u0142ug?',
    confirm_delete_fund:'Usun\u0105\u0107 ten fundusz?',confirm_remove_sub:'Usun\u0105\u0107 t\u0119 subskrypcj\u0119?',
    confirm_reset_1:'Jeste\u015b pewny? Wszystkie dane zostan\u0105 trwale usuni\u0119te.',
    confirm_reset_2:'Ostatnia szansa - tego nie mo\u017cna cofn\u0105\u0107. Kontynuowa\u0107?',
    export_csv_btn:'\uD83D\uDCE5 Eksportuj CSV',
    sett_export_title:'\uD83D\uDCE4 Eksportuj dane',
    sett_export_desc:'Pobierz wszystkie transakcje jako plik CSV do kopii zapasowej lub u\u017cycia w innej aplikacji.',
    sf_add_contribution:'Dodaj wp\u0142at\u0119',sf_contribution_label:'Kwota do dodania',
    sf_currently_saved:'Dotychczas zaoszcz\u0119dzono',
    tx_search_ph:'Szukaj po opisie lub kategorii\u2026',
    tx_filter_all_types:'Wszystkie typy',tx_filter_all_alloc:'Wszystkie podzia\u0142y',
    tx_add_btn:'Dodaj',tx_add_title:'Dodaj transakcję',tx_amount:'Kwota',tx_category:'Kategoria',tx_clear_all:'Wyczyść wszystko',tx_date:'Data',tx_desc_label:'Opis',tx_desc_ph:'np. Zakupy spożywcze\u2026',tx_empty:'Brak transakcji.',tx_import_csv:'\uD83D\uDCE5 Importuj CSV',tx_th_amount:'Kwota',tx_th_desc:'Opis',tx_transaction_many:'transakcji',tx_transaction_one:'transakcja',tx_type:'Typ',tx_type_bill:'Rachunek',tx_type_debt:'Dług',tx_type_expense:'Wydatek',tx_type_income:'Przychód',tx_type_savings:'Oszczędności',tx_empty_sub:'Dodaj pierwsz\u0105 transakcj\u0119, aby rozpocz\u0105\u0107',
    tx_sort_date_new:'Najnowsze najpierw',tx_sort_date_old:'Najstarsze najpierw',
    tx_sort_amt_high:'Najwy\u017csza kwota',tx_sort_amt_low:'Najni\u017csza kwota',
    tx_showing:'Wy\u015bwietlono {n} z {total}',tx_no_results:'\u017badna transakcja nie odpowiada filtrowi.',
    alloc_add_bucket:'+ Dodaj segment',alloc_remove_btn:'Usu\u0144',
    alloc_min_buckets:'Wymagane co najmniej 2 segmenty',
    alloc_auto_tag:'Automatycznie oznaczono \u2192 {name}',
    tx_prev:'\u2190 Poprz.',tx_next:'Nast. \u2192',tx_page_of:'Strona {n} z {total}',
    debt_due_day_note:'Dni 29-31 nie pojawiaj\u0105 si\u0119 w kr\u00f3tszych miesi\u0105cach',
    sub_advanced:'Data rozliczenia przeniesiona na {date}',
    currency:'Waluta',rollover:'Przeniesienie',appearance:'Wygląd',
    language:'Język',reset_data:'Zresetuj dane',
    light:'Jasny',dark:'Ciemny',theme_synthwave:'Synthwave',theme_vintage_ledger:'Vintage',theme_terminal:'Terminal',
    dashboard_layout:'Układ pulpitu',dashboard_layout_desc:'Wybierz, jak Twój pulpit jest zaprojektowany i wizualizowany.',
    layout_1:'Klasyczny',layout_2:'Puls promienisty',layout_coming_soon:'Wkrótce więcej!',
    changes_autosaved:'✅ Zmiany są zapisywane automatycznie.',
    rollover_desc:'Przenieś niewydane środki z poprzedniego okresu.',
    rollover_amount:'Kwota przeniesienia',
    reset_desc:'Trwale usuwa wszystkie dane. Nie można cofnąć.',
    reset_btn:'Zresetuj wszystko',
    add:'Dodaj',cancel:'Anuluj',rename_title_prompt:'Zmień nazwę planera budżetu',save:'Zapisz',delete:'Usuń',dp_today:'Dziś',dp_clear:'Wyczyść',edit:'Edytuj',field_info_aria:'O {0}',
    mod_name_hint:'Nazwa, którą zobaczysz dla tej kategorii w całej aplikacji.',mod_due_date_hint:'Kiedy termin płatności przypada każdego miesiąca - używane do kalendarza i śledzenia płatności.',
    mod_th_expected_hint:'Kwota, którą planujesz przeznaczyć na tę kategorię każdego miesiąca.',mod_th_actual_hint:'Obliczane automatycznie na podstawie zarejestrowanych transakcji w tej kategorii.',mod_th_progress_hint:'Jaki procent planowanej kwoty został dotychczas wykorzystany.',
    tx_date_hint:'Data, kiedy miała miejsce ta transakcja.',tx_type_hint:'Jaki to rodzaj transakcji - określa, z jakiej listy kategorii możesz wybierać.',tx_category_hint:'Do której kategorii budżetu należy ta transakcja.',tx_amount_hint:'Ile pieniędzy dotyczyło tej transakcji.',tx_desc_hint:'Opcjonalna notatka, która pomoże ci zapamiętać, czego to dotyczyło.',
    paid:'Zapłacone',due_date:'Termin płatności',category:'Kategoria',amount:'Kwota',
    description:'Opis',date:'Data',type:'Typ',
    add_category:'+ Dodaj kategorię',no_transactions:'Brak transakcji.',
    upgrade_title:'Przejdź na Ultimate Budget Planner',
    upgrade_desc:'Wszystko z Simple oraz narzędzia pro, aby iść naprzód: spłać długi, oszczędzaj na to, co ważne, i nie przegap żadnego rachunku.',
    upgrade_now:'Ulepsz teraz →',upgrade_get_now:'POBIERZ',upgrade_compare:'PORÓWNAJ',sett_upgrade_h:'Baner ulepszenia',sett_upgrade_label:'Pokaż baner na pulpicie',
    mon:'Pon',tue:'Wt',wed:'Śr',thu:'Czw',fri:'Pt',sat:'Sob',sun:'Nd',
    quick_presets:'Szybki wybór:',select_currency:'Wybierz walutę',select_language:'Wybierz język',
    appearance_desc:'Wybierz motyw kolorystyczny.',
    dash_anim_title:'Animacje pulpitu',dash_anim_desc:'Odtwarzaj delikatną animację wejścia przy ładowaniu pulpitu.',dash_anim_label:'Włącz animacje',
    help_sett_modal_title:'Jak działają ustawienia',help_sett_intro:'Dostosuj Ezzo Budget do swojej sytuacji.',
    help_sett_currency_li:'Aktualizuje symbol wszędzie (niektóre waluty jak PLN umieszczają symbol po kwocie).',
    help_sett_period_li:'Ustaw zakres dat. Kliknij znacznik daty na panelu, aby szybko przejść tutaj.',
    help_sett_rollover_li:'Przenieś niewydane środki z ostatniego okresu.',
    help_sett_theme_li:'Wybierz spośród pięciu motywów kolorystycznych - Jasny, Ciemny, Synthwave, Vintage lub Terminal.',
    help_sett_layout_li:'Wybierz spośród dwóch projektów pulpitu - Klasyczny lub Puls promienisty - każdy z własnymi wykresami i układem; więcej projektów wkrótce.',
    help_dash_modal_title:'Jak działa Panel',help_dash_intro:'Panel to Twój migawkowy obraz finansów w czasie rzeczywistym. Wszystko aktualizuje się automatycznie podczas rejestrowania transakcji.',
    help_dash_cards_h:'Karty podsumowania',help_dash_cards_li:'Sumy przychodów, wydatków &amp; rachunków, spłat długów i oszczędności za bieżący okres.',
    help_dash_leftover_li:'To, co zostaje po wszystkich wydatkach. <span style="color:#10b981;font-weight:600">Zielony</span> = nadwyżka, <span style="color:#f43f5e;font-weight:600">czerwony</span> = przekroczenie budżetu.',
    help_dash_flow_h:'Wykres przepływów pieniężnych',help_dash_flow_li:'Porównuje to, co <em>planowano</em>, z tym, co <em>faktycznie się wydarzyło</em>.',
    help_dash_donut_h:'Wykresy kołowe',help_dash_donut_li:'Podział przychodów i wydatków w procentach.',
    help_dash_datebadge_h:'Znacznik daty',help_dash_datebadge_li:'Kliknij, aby przejść od razu do ustawień i zmienić okres budżetowy.',
    help_dash_tip:'💡 Wskazówka: Najpierw wpisz planowane kwoty w Przychodach / Wydatkach / Rachunkach / Długach / Oszczędnościach, a następnie rejestruj transakcje, aby zobaczyć rzeczywiste wartości.',
    help_tx_modal_title:'Jak działają Transakcje',help_tx_intro:'Rejestruj tu każdy przepływ pieniędzy. Moduły budżetu aktualizują się automatycznie.',
    help_tx_type_li:'Przychód, Wydatek, Rachunek, Dług lub Oszczędności.',help_tx_category_li:'Pobierane z kategorii Twoich modułów budżetu.',
    help_tx_edit_h:'✏️ Przycisk edycji',help_tx_edit_li:'Kliknij ikonę ołówka przy dowolnym wierszu, aby edytować lub usunąć tę transakcję.',
    help_tx_csv_h:'Format importu CSV:',
    help_inc_modal_title:'Jak działają Przychody',help_inc_intro:'Śledź planowane i rzeczywiste przychody. Paski postępu aktualizują się na bieżąco podczas wpisywania planowanych kwot.',
    help_inc_expected_li:'Wpisz planowany przychód; pasek aktualizuje się natychmiast.',help_inc_actual_li:'Obliczane automatycznie na podstawie transakcji typu Przychód.',
    help_inc_tip:'💡 Wskazówka: Rejestruj zarobki jako typ „Przychód” w Transakcjach, aby zobaczyć tu rzeczywiste wartości.',
    help_exp_modal_title:'Jak działają Wydatki',help_exp_intro:'Ustaw limit wydatków dla każdej kategorii. Paski postępu aktualizują się na bieżąco i zmieniają kolor na czerwony po przekroczeniu limitu.',
    help_exp_expected_li:'Twój limit wydatków; pasek aktualizuje się podczas wpisywania.',help_exp_actual_li:'Sumowane na podstawie transakcji typu Wydatek.',
    help_bills_modal_title:'Jak działają Rachunki',help_bills_intro:'Śledź cykliczne rachunki wraz z terminami płatności i statusem opłacenia.',
    help_bills_duedate_li:'Ustaw termin płatności każdego rachunku.',help_bills_paid_li:'Zaznacz, gdy dokonasz płatności - zostaniesz poproszony o rzeczywiście zapłaconą kwotę, która zostanie zapisana jako transakcja, ponieważ rachunki takie jak media rzadko dokładnie odpowiadają zaplanowanej kwocie.',help_bills_actual_li:'Uzupełniane na podstawie transakcji typu Rachunek o tej samej nazwie kategorii.',
    help_debt_modal_title:'Jak działają Długi',help_debt_intro:'Panuj nad spłatami kredytów i hipotek.',
    help_debt_expected_li:'Twoja planowana miesięczna płatność.',help_debt_duedate_li:'Termin płatności.',help_debt_paid_li:'Zaznacz, gdy płatność zostanie zaksięgowana - zostaniesz poproszony o rzeczywiście zapłaconą kwotę, która zostanie zapisana jako transakcja, ponieważ może różnić się od planowanej płatności.',
    help_sav_modal_title:'Jak działają Oszczędności',help_sav_intro:'Ustal cele oszczędnościowe i śledź swoje wpłaty.',
    help_sav_expected_li:'Twój cel oszczędnościowy na ten okres.',help_sav_actual_li:'Z transakcji typu Oszczędności.',
    help_sav_tip:'💡 Wskazówka: Traktuj oszczędności jak stały wydatek - zaplanuj je najpierw, a resztę wydaj.',
    // Guide
    guide_group_start:'Pierwsze kroki', guide_group_track:'Kontroluj swoje pieniądze', guide_group_settings:'Dostosuj do siebie',
    guide_section_big:'Ogólny obraz', guide_section_how:'Jak z tego korzystać', guide_section_connects:'Jak to się łączy', guide_back:'Wróć do tematów',
    guide_welcome_title:'Witamy w Simple Budget Planner',
    guide_welcome_big:'Ta aplikacja odpowiada na jedno pytanie każdego miesiąca: gdzie podziały się moje pieniądze? Zapisujesz, co wpływa i co wypływa, a ona po cichu wykonuje obliczenia, dzięki czemu zawsze dokładnie wiesz, na czym stoisz. Żadnych arkuszy kalkulacyjnych, żadnego zgadywania - tylko jasny obraz twoich finansów.',
    guide_dashboard_title:'Pulpit',
    guide_dashboard_big:'Traktuj Pulpit jak okładkę swoich finansów - jedno spojrzenie mówi ci, co wpływa, co wypływa i co zostaje. To pierwsza rzecz, którą warto sprawdzić za każdym razem, gdy otwierasz aplikację.',
    guide_dashboard_step1:'Sprawdź karty podsumowania u góry, aby zobaczyć swój <strong>Całkowity przychód</strong>, <strong>Całkowite wydatki</strong> i <strong>Saldo netto</strong> za bieżący okres.',
    guide_dashboard_step2:'Przewiń do wykresu <strong>Przepływ gotówki</strong>, aby zobaczyć, jak twoje pieniądze poruszają się tydzień po tygodniu.',
    guide_dashboard_step3:'Spójrz na wykres <strong>Podział wydatków</strong>, aby zauważyć, która kategoria pochłania największą część twojego budżetu.',
    guide_dashboard_connect1:'Każda transakcja dodana w dowolnym miejscu aplikacji natychmiast aktualizuje te liczby - nie ma nic do odświeżenia ani ponownego obliczenia.',
    guide_dashboard_connect2:'Saldo netto uwzględnia każdą kwotę <strong>Przeniesienia</strong> ustawioną w Ustawieniach, dzięki czemu dobry miesiąc może przenieść się na kolejny.',
    guide_dashboard_connect3:'Jeśli liczba wygląda źle, poprawka znajduje się prawie zawsze w Transakcjach, Przychodach, Wydatkach, Rachunkach, Długach lub Oszczędnościach - Pulpit tylko odzwierciedla to, co już zostało wprowadzone.',
    guide_dashboard_tip:'Zrób z sprawdzania Pulpitu część swojej rutyny - nawet 10 sekund dziennie zapobiega temu, by małe niespodzianki stały się dużymi.',guide_dashboard_usecase_h:'Zobacz to w praktyce',guide_dashboard_usecase_p:'<p><strong>Liam</strong> sprawdza Pulpit przed podjęciem decyzji, czy w tym tygodniu wyjść coś zjeść. Widzi, że jego saldo netto na ten okres wynosi tylko 190 zł, znacznie poniżej zwykłego bufora, więc zamiast tego gotuje w domu - wyłapując problem wcześnie, zamiast odkryć go, gdy konto jest prawie puste.</p>',
    guide_transactions_title:'Transakcje',
    guide_transactions_big:'Transakcje są fundamentem wszystkiego innego w tej aplikacji - każda złotówka, którą tu zapiszesz, napędza twój Pulpit, twoje kategorie i twój wynik końcowy. Wyrób sobie nawyk zapisywania w momencie wydawania, a reszta zajmie się sobą.',
    guide_transactions_step1:'Dotknij <strong>Dodaj transakcję</strong>, wybierz, czy to Przychód, Wydatek, Rachunek, Dług czy Oszczędności, i wpisz kwotę oraz kategorię.',
    guide_transactions_step2:'Masz już swoje wydatki w arkuszu kalkulacyjnym? Użyj <strong>Importuj CSV</strong>, aby wprowadzić wszystko naraz zamiast wpisywać każdą pozycję ręcznie.',
    guide_transactions_step3:'Dotknij dowolnej transakcji na liście, aby <strong>edytować</strong> kwotę, datę lub kategorię, jeśli popełniłeś błąd lub coś się zmieniło.',
    guide_transactions_step4:'Skorzystaj z wyszukiwania i filtrów nad listą, aby szybko znaleźć konkretną transakcję według typu, kategorii lub daty.',
    guide_transactions_connect1:'Każda zapisana transakcja automatycznie liczy się do odpowiedniej kategorii - Wydatek pojawia się w Wydatkach, płatność Rachunku w Rachunkach i tak dalej.',
    guide_transactions_connect2:'Sumy i wykresy na twoim Pulpicie są budowane wyłącznie na podstawie tych zapisów - nic nie jest szacowane.',
    guide_transactions_connect3:'Usunięcie lub edycja transakcji tutaj natychmiast aktualizuje każdą sumę w całej aplikacji.',
    guide_transactions_tip:'Zapisuj transakcje tego samego dnia, w którym mają miejsce. Zajmuje to tylko kilka sekund i sprawia, że twój Pulpit pozostaje wiarygodny.',guide_transactions_usecase_h:'Zobacz to w praktyce',guide_transactions_usecase_p:'<p><strong>Aisha</strong> dostaje wypłatę w piątek. Otwiera Transakcje, wybiera Przychód → Pensja, wpisuje kwotę, i jest ona od razu zapisana - pojawia się natychmiast na jej Pulpicie jako część Całkowitego przychodu za okres.</p>',
    guide_income_title:'Przychody',
    guide_income_big:'Tutaj mówisz aplikacji, ile spodziewasz się zarobić, a następnie śledzisz, ile faktycznie wpłynęło - dzięki czemu od razu widzisz różnicę między nimi.',
    guide_income_step1:'Ustaw kwotę <strong>Oczekiwaną</strong> dla każdego źródła przychodu, na przykład pensji lub dodatkowej pracy.',
    guide_income_step2:'Gdy wpływają pieniądze, zapisz je jako transakcję Przychodu - automatycznie wypełni to twoją kolumnę <strong>Rzeczywista</strong>.',
    guide_income_step3:'Porównaj Oczekiwaną z Rzeczywistą, aby zobaczyć, czy jesteś na dobrej drodze, czy jakiś przychód jeszcze nie wpłynął.',
    guide_income_connect1:'Transakcje przychodu zapisane w Transakcjach trafiają bezpośrednio do sum Rzeczywistych na tej stronie.',
    guide_income_connect2:'Twój Całkowity przychód na Pulpicie to suma wszystkiego, co jest tu śledzone.',
    guide_income_connect3:'Wyższe Saldo netto zaczyna się właśnie tutaj - im dokładniej śledzisz przychody, tym dokładniejszy jest cały twój budżet.',
    guide_income_tip:'Dodawaj każde źródło przychodu osobno, nawet te małe lub nieregularne - dzięki temu znacznie łatwiej zauważyć wzorce z czasem.',guide_income_usecase_h:'Zobacz to w praktyce',guide_income_usecase_p:'<p>Przed początkiem miesiąca <strong>Carlos</strong> ustawia oczekiwaną Pensję na 13 500 zł, a oczekiwany przychód z Freelance na 1 700 zł w module Przychody.</p><p>W miarę wpływania wypłat przez Transakcje, kolumna Rzeczywista aktualizuje się automatycznie, dzięki czemu może na pierwszy rzut oka zobaczyć, czy praca freelance w tym miesiącu idzie zgodnie z planem.</p>',
    guide_expenses_title:'Wydatki',
    guide_expenses_big:'Wydatki to twoje codzienne zakupy - jedzenie, benzyna, kawa, wszystko to. Ustawienie oczekiwanej kwoty dla każdej kategorii daje ci punkt odniesienia zamiast po prostu patrzeć, jak pieniądze znikają.',
    guide_expenses_step1:'Dodaj kategorię dla każdego rodzaju wydatku, który chcesz śledzić, na przykład Jedzenie lub Rozrywka.',
    guide_expenses_step2:'Ustaw kwotę <strong>Oczekiwaną</strong> dla każdej z nich - taką, której nie chciałbyś przekroczyć.',
    guide_expenses_step3:'Zapisuj zakupy jako transakcje Wydatku i obserwuj, jak kolumna <strong>Rzeczywista</strong> wypełnia się automatycznie.',
    guide_expenses_connect1:'Każda transakcja Wydatku zapisana w Transakcjach dodaje się bezpośrednio do odpowiedniej kategorii tutaj.',
    guide_expenses_connect2:'Kategorie, które przekraczają oczekiwaną kwotę, wpływają na wykres Podział wydatków na Pulpicie.',
    guide_expenses_connect3:'Ograniczenie przekroczonej kategorii tutaj to jeden z najszybszych sposobów na zwiększenie Salda netto.',
    guide_expenses_tip:'Zacznij od kilku szerokich kategorii. Zawsze możesz je później podzielić bardziej szczegółowo, gdy zobaczysz, gdzie naprawdę idą pieniądze.',guide_expenses_usecase_h:'Zobacz to w praktyce',guide_expenses_usecase_p:'<p><strong>Nina</strong> chce zobaczyć, gdzie naprawdę idą jej pieniądze, więc ustawia oczekiwane kwoty na Zakupy spożywcze, Restauracje i Transport w Wydatkach.</p><p>W połowie miesiąca zauważa, że Restauracje są już na poziomie 90% budżetu, i ogranicza wydatki do końca okresu, zamiast dowiedzieć się o tym dopiero na koniec miesiąca.</p>',
    guide_bills_title:'Rachunki',
    guide_bills_big:'Rachunki to płatności, których nie możesz pominąć - czynsz, media, subskrypcje, do których się zobowiązałeś. Ta strona utrzymuje terminy płatności i status na widoku, aby nic nie umknęło.',
    guide_bills_step1:'Dodaj rachunek i nadaj mu <strong>Termin płatności</strong>, abyś dokładnie wiedział, kiedy jest wymagalny.',
    guide_bills_step2:'Gdy go opłacisz, zaznacz pole <strong>Opłacony</strong>, aby oznaczyć go jako uregulowany w tym okresie.',
    guide_bills_step3:'Zapisz rzeczywistą płatność jako transakcję Rachunku, aby kwota liczyła się do twoich sum.',
    guide_bills_connect1:'Nieopłacone rachunki ze zbliżającym się terminem warto sprawdzić przed wydaniem pieniędzy gdzie indziej.',
    guide_bills_connect2:'Transakcje rachunków liczą się do Całkowitych wydatków na Pulpicie, obok Wydatków i Długów.',
    guide_bills_connect3:'Oznaczenie rachunku jako opłaconego go nie usuwa - jedynie śledzi status, dzięki czemu zawsze masz zapis tego, co zostało uregulowane w danym okresie.',
    guide_bills_tip:'Dodawaj cykliczne rachunki na początku każdego okresu, aby terminy na ciebie czekały, zamiast że musisz je pamiętać.',guide_bills_usecase_h:'Zobacz to w praktyce',guide_bills_usecase_p:'<p>Co miesiąc rachunek za prąd <strong>Dereka</strong> jest nieco inny. Ustawia termin płatności i oczekiwaną kwotę (420 zł) dla Prądu w Rachunkach.</p><p>Gdy faktycznie go opłaca, zaznacza pole Opłacony i wpisuje rzeczywiście naliczone 498,32 zł - co zostaje zapisane jako prawdziwa transakcja zamiast samego znacznika, dzięki czemu jego historia wydatków pozostaje dokładna, nawet jeśli rachunek nie był dokładnie taki, jak planował.</p>',
    guide_debt_title:'Długi',
    guide_debt_big:'Ta strona gromadzi każdą płatność, którą jesteś winien, w jednym miejscu - karty kredytowe, pożyczki, wszystko z saldem - dzięki czemu zawsze wiesz, co jest wymagalne i czy nadążasz.',
    guide_debt_step1:'Dodaj każdy śledzony dług wraz z <strong>Oczekiwaną</strong> płatnością na ten okres.',
    guide_debt_step2:'Ustaw <strong>Termin płatności</strong>, abyś dokładnie wiedział, kiedy płatność musi zostać wysłana.',
    guide_debt_step3:'Zapisz płatność jako transakcję Długu i zaznacz <strong>Opłacony</strong>, gdy zostanie rozliczona.',
    guide_debt_connect1:'Płatności długów liczą się do Całkowitych wydatków na Pulpicie obok Wydatków i Rachunków.',
    guide_debt_connect2:'Ta strona śledzi płatności jako kategorię, a nie pełny plan spłaty - jeśli chcesz strategię kuli śnieżnej lub lawiny z prognozami odsetek, właśnie do tego służy Spłata długów w Ultimate Budget Planner.',
    guide_debt_connect3:'Zachowanie konsekwencji tutaj utrzymuje twoje Saldo netto uczciwe, ponieważ nieopłacone długi mają zwyczaj dogonić cię później.',
    guide_debt_tip:'Wypisz nawet małe długi, takie jak pożyczka rodzinna - liczy się nie kwota, lecz wiedza o wszystkim, co jesteś winien, w jednym miejscu.',guide_debt_usecase_h:'Zobacz to w praktyce',guide_debt_usecase_p:'<p><strong>Grace</strong> ma małą pożyczkę osobistą u swojej siostry. Dodaje ją w Długach z uzgodnioną miesięczną kwotą i terminem płatności.</p><p>Gdy wysyła płatność, zaznacza Opłacony i wpisuje dokładną wysłaną kwotę, dzięki czemu jest ona śledzona w jej historii transakcji tak samo jak każda inna spłata długu.</p>',
    guide_savings_title:'Oszczędności',
    guide_savings_big:'Oszczędności to miejsce, w którym celowo odkładasz pieniądze, zamiast po prostu patrzeć, co zostaje pod koniec miesiąca. Traktowanie ich jak każdego innego zaplanowanego wydatku to najłatwiejszy sposób, by naprawdę je zbudować.',
    guide_savings_step1:'Ustaw kwotę <strong>Oczekiwaną</strong> na to, co chcesz zaoszczędzić w tym okresie.',
    guide_savings_step2:'Za każdym razem, gdy przenosisz pieniądze do oszczędności, zapisz to jako transakcję Oszczędności.',
    guide_savings_step3:'Porównaj Oczekiwaną z <strong>Rzeczywistą</strong>, aby zobaczyć, czy osiągnąłeś swój cel oszczędnościowy na ten okres.',
    guide_savings_connect1:'Transakcje oszczędności zapisane w Transakcjach liczą się bezpośrednio do sum na tej stronie.',
    guide_savings_connect2:'Twoja liczba Całkowitych oszczędności na Pulpicie pochodzi bezpośrednio z tego, co jest tu śledzone.',
    guide_savings_connect3:'Oszczędności są uwzględniane w obliczeniu twojego Salda netto, więc regularne oszczędzanie to jeden z najbardziej bezpośrednich sposobów na zwiększenie tej liczby z czasem.',
    guide_savings_tip:'Ustaw najpierw kwotę oszczędności, zanim zaplanujesz resztę wydatków - dużo łatwiej jest osiągnąć cel, do którego zobowiązujesz się od samego początku.',guide_savings_usecase_h:'Zobacz to w praktyce',guide_savings_usecase_p:'<p>Przy każdej wypłacie <strong>Wen</strong> odkłada pieniądze na wkład własny na dom. Ustawia swoją oczekiwaną kwotę Oszczędności w module Oszczędności, a w miarę zapisywania transakcji Oszczędności w ciągu okresu widzi, jak pasek postępu zbliża się do zaplanowanego celu.</p>',
    guide_settings_title:'Ustawienia',
    guide_settings_big:'Ustawienia to miejsce, w którym aplikacja dostosowuje się do ciebie - twoja waluta, okres budżetowy, wygląd, język i sposób obsługi twoich danych.',
    guide_settings_step1:'Wybierz swoją <strong>Walutę</strong>, aby każda kwota w aplikacji wyświetlała się tak, jak oczekujesz.',
    guide_settings_step2:'Wybierz swój <strong>Okres budżetowy</strong> (na przykład miesięczny lub dwutygodniowy), aby pasował do tego, jak faktycznie otrzymujesz wypłatę i płacisz rachunki.',
    guide_settings_step3:'Wpisz kwotę <strong>Przeniesienia</strong>, jeśli chcesz, aby niewydane pieniądze z ostatniego okresu przeszły do Salda netto bieżącego okresu.',
    guide_settings_step4:'Wybierz motyw <strong>Wyglądu</strong> (Jasny, Ciemny, Synthwave, Vintage lub Terminal), <strong>Układ pulpitu</strong> (2 projekty do wyboru, więcej wkrótce) i swój <strong>Język</strong> z listy.',
    guide_settings_step5:'Użyj <strong>Eksportuj dane</strong>, aby zrobić kopię zapasową wszystkiego, lub <strong>Zresetuj dane</strong>, jeśli kiedykolwiek zechcesz zacząć zupełnie od nowa.',
    guide_settings_connect1:'Twój wybór Waluty i Okresu budżetowego określa, jak każda inna strona aplikacji wyświetla i oblicza liczby.',
    guide_settings_connect2:'Kwota Przeniesienia ustawiona tutaj trafia bezpośrednio do Salda netto pokazanego na twoim Pulpicie.',
    guide_settings_connect3:'Eksportowanie danych tutaj to najbezpieczniejszy sposób na zachowanie kopii wszystkiego przed dokonaniem większej zmiany.',
    guide_settings_tip:'Ustaw Walutę i Okres budżetowy od razu na początku, zanim zaczniesz zapisywać transakcje - oszczędzi ci to konieczności sprawdzania starych zapisów później.',guide_settings_usecase_h:'Zobacz to w praktyce',guide_settings_usecase_p:'<p>Gdy <strong>Yuki</strong> przeprowadza się do nowego kraju i zaczyna zarabiać w euro, otwiera Ustawienia, zmienia swoją Walutę na EUR i dostosowuje Okres budżetowy do nowego harmonogramu wypłat - dzięki czemu od tego momentu każda liczba w aplikacji odzwierciedla jej nową rzeczywistość.</p>',
    mod_desc_income:'Ustal spodziewane przychody dla każdego źródła. Rzeczywiste kwoty wypełniają się automatycznie po zarejestrowaniu transakcji.',
    mod_desc_expenses:'Ustal limit budżetu dla każdej kategorii wydatków. Paski postępu zmieniają się na czerwone po przekroczeniu.',
    mod_desc_bills:'Śledź powtarzające się rachunki. Dodaj termin płatności, a następnie zaznacz pole po opłaceniu.',
    mod_desc_debt:'Trzymaj rękę na pulsie spłat kredytów i hipotek. Ustal spodziewane kwoty i oznacz każdą jako opłaconą.',
    mod_desc_savings:'Ustal cel oszczędnościowy dla każdego funduszu. Rzeczywiste wpłaty pochodzą z zarejestrowanych transakcji.',
    mod_add_category:'+ Dodaj kategorię',mod_add_new_category:'Dodaj nową kategorię',mod_cat_name_label:'Nazwa',
    mod_set_date:'Ustaw datę',mod_remove:'Usuń',mod_mark_paid:'Oznacz jako opłacone',mod_total:'Suma',mod_paid_amount_label:'Zapłacona kwota',mod_paid_amount_hint:'Ile faktycznie zapłaciłeś - zostanie to zapisane jako transakcja, aby Twoja historia wydatków była dokładna, nawet jeśli różni się od zaplanowanej kwoty.',mod_paid_save_btn:'Zapisz płatność',mod_paid_budgeted_hint:'Zaplanowano: {0}',mod_paid_amount_required:'Podaj prawidłową kwotę.',toast_mod_paid:'Płatność zapisana',
    dash_period_title:'Kliknij, aby zmienić okres budżetowy',
    dash_stat_income:'Łączne przychody',dash_stat_of_expected:'z {0} spodziewanych',
    dash_stat_exp_bills:'Wydatki &amp; Rachunki',dash_stat_of_budgeted:'z {0} zaplanowanych',
    dash_stat_debt:'Spłaty długów',dash_stat_savings:'Łączne oszczędności',dash_stat_of_goal:'z {0} celu',
    dash_net_leftover_period:'Saldo netto tego okresu',dash_includes_rollover:'Zawiera {0} przeniesienia z poprzedniego okresu',
    dash_lf_income:'przychody',dash_lf_exp_bills:'wyd. &amp; rach.',dash_lf_debt:'długi',dash_lf_savings:'oszczędności',dash_lf_rollover:'przeniesienie',
    dash_cash_flow:'Przepływ gotówki - Spodziewane vs Rzeczywiste',dash_income_kept:'zachowanego dochodu',dash_expected:'Spodziewane',dash_actual:'Rzeczywiste',
    dash_daily_spend:'Wydatki dzienne',dash_daily_spend_caption:'łączne wydatki w tym okresie',spend_tip_more:'+{0} więcej',dash_other_category:'Inne',
    dash_savings_rate:'Stopa oszczędności',dash_saved_sfx:'zaoszczędzono',
    dash_income_sources:'Źródła przychodów',dash_no_income:'Brak zarejestrowanych przychodów.',dash_add_tx_link:'Dodaj transakcje →',
    dash_spending_breakdown:'Zestawienie wydatków',dash_no_spending:'Brak zarejestrowanych wydatków.',
    upgrade_feat_debt:'💳 Spłata długów',upgrade_feat_sinking:'🏺 Fundusze celowe',upgrade_feat_calendar:'📅 Inteligentny kalendarz',
    upgrade_feat_subs:'🔄 Subskrypcje',upgrade_feat_auto:'⚡ Automatyzacja',upgrade_feat_alloc:'🎯 Alokacja',
    upg_chip_tx:'{0} / {0} bezpłatnych transakcji wykorzystanych',upg_chip_cat:'{0} / {0} bezpłatnych kategorii {1} wykorzystanych',upg_chip_limit:'Osiągnięto limit bezpłatnej wersji próbnej',
    upg_aria_label:'Ulepsz, aby odblokować pełny planer',
    upg_title_html:'Odblokuj pełny<br>Simple Budget Planner',
    upg_sub:'Osiągnąłeś limit bezpłatnej wersji próbnej. Ulepsz raz, aby usunąć wszystkie limity. Nigdy subskrypcji.',
    upg_feat_unlimited_tx_html:'<strong>Nieograniczone</strong> transakcje',
    upg_feat_unlimited_cat_html:'<strong>Nieograniczone</strong> kategorie w każdej sekcji',
    upg_feat_csv:'Import &amp; eksport CSV, pełna historia',upg_feat_onetime:'Jednorazowa płatność · darmowe aktualizacje na zawsze',
    upg_price_tag:'jednorazowo',upg_price_note:'Bez subskrypcji',
    upg_cta_sbp:'Odblokuj Simple Budget za {0}',
    upg_upsell_lead:'⚡ Chcesz spłatę długów, fundusze celowe &amp; więcej?',upg_upsell_cta:'Zdobądź Ultimate za {0} →',
    upg_later:'Może później',
    reauth_title:'Zaloguj się przez Google, aby kontynuować',
    reauth_sub:'Twoje dane dla tego narzędzia są synchronizowane z Google Drive. Zaloguj się ponownie, aby kontynuować tam, gdzie skończyłeś.',
    reauth_submit:'Zaloguj się przez Google',reauth_local:'Zamiast tego użyj danych lokalnych na tym urządzeniu',
    sync_welcome:'Witaj w Ezzo Budget',sync_choose:'Wybierz, jak zapisywać swoje dane.',sync_recommended:'Zalecane',
    sync_continue_google:'Kontynuuj z Google',sync_desc_multi_device:'Dane planera są przechowywane na wielu urządzeniach',
    sync_use_no_account:'Użyj bez konta',sync_desc_this_device:'Dane planera są przechowywane tylko na tym urządzeniu',
    sync_status_wait:'Ukończ kroki w oknie Google, które właśnie się otworzyło. Jeśli nic się nie pojawiło, sprawdź pasek adresu pod kątem zablokowanej ikony wyskakującego okienka.',
    sync_footer_note:'Można to później zmienić w ustawieniach',
    code_title:'Wprowadź swój klucz licencyjny',code_sub:'Odblokuj pełny {0} za pomocą kodu z Twojego zakupu.',
    code_placeholder:'Klucz licencyjny',code_error:'Ten kod jest nieprawidłowy. Sprawdź go i spróbuj ponownie.',
    code_orderid_placeholder:'Numer zamówienia',code_orderid_error:'Wpisz numer zamówienia z Twojego zakupu.',
    code_submit:'Wyślij',code_try_free:'Wypróbuj za darmo zamiast tego',code_get:'Zdobądź kod',
    app_name_sbp:'Simple Budget Planner',app_name_ubp:'Ultimate Budget Planner',
    edit_tx_title:'✏️ Edytuj transakcję',save_changes:'Zapisz zmiany',no_categories:'- brak kategorii -',
    no_cat_setup:'- najpierw skonfiguruj kategorie -',
    tx_error_required:'Podaj datę, typ, kategorię i prawidłową kwotę większą niż 0.',
    csv_error_msg:'Nie znaleziono prawidłowych wierszy.\n\nOczekiwany format:\nData, Typ, Kategoria, Kwota, Opis\n2024-01-15, expense, Jedzenie, 25.50, Zakupy spożywcze',
    sync_card_title:'☁️ Dane &amp; Synchronizacja',sync_card_desc:'Wybierz, jak Twoje dane są przechowywane i aktualizowane na różnych urządzeniach.',
    sync_mode_local_title:'Tylko to urządzenie',sync_mode_local_desc:'Dane są zapisywane tylko na tym urządzeniu',
    sync_mode_google_title:'Synchronizuj z Google',sync_mode_google_desc:'Dane są synchronizowane na wielu urządzeniach',
    sync_signed_in_as:'Zalogowano jako {0}',sync_error_generic:'Logowanie nie powiodło się. Spróbuj ponownie.',
    sync_err_popup_blocked:'Twoja przeglądarka zablokowała okno logowania Google. Zezwól na wyskakujące okienka dla tej strony (sprawdź pasek adresu pod kątem zablokowanej ikony wyskakującego okienka) i spróbuj ponownie.',
    sync_err_cancelled:'Logowanie zostało anulowane. Spróbuj ponownie.',
    toast_synced_google:'Zsynchronizowano z Google Drive ✓',toast_synced_local:'Przełączono na lokalne przechowywanie ✓',
    cmp_title:'⚡ Simple vs Ultimate Budget Planner',cmp_col_feature:'Funkcja',cmp_col_simple:'💰 Simple',cmp_col_ultimate:'⚡ Ultimate',
    cmp_section_core:'Podstawowe budżetowanie',cmp_section_pro:'Funkcje Pro - tylko Ultimate',
    cmp_stay_simple:'Zostań przy Simple',cmp_open_ultimate:'Otwórz Ultimate Budget Planner →',
    cmp_feat1:'Śledzenie budżetu - Przychody, Wydatki, Rachunki &amp; Oszczędności',
    cmp_feat2:'Rejestrowanie transakcji z importem CSV',
    cmp_feat3:'Wykres przepływu gotówki - spodziewane vs rzeczywiste',
    cmp_feat4:'Wykresy pierścieniowe przychodów &amp; wydatków',
    cmp_feat5:'Kontrola okresu budżetowego z ustawieniami wstępnymi',
    cmp_feat6:'Przeniesienie z poprzedniego okresu',
    cmp_feat7:'Spłata długów (Kula śniegowa &amp; Lawina)',
    cmp_feat8:'Śledzenie funduszy celowych z miesięcznymi celami',
    cmp_feat9:'Inteligentny kalendarz z automatycznie uzupełnianymi wydarzeniami',
    cmp_feat10:'Śledzenie subskrypcji z podziałem na kategorie',
    cmp_feat11:'Panel Pro z kluczowymi statystykami &amp; panelem nadchodzących wydarzeń',
    cmp_feat12:'Import jednym kliknięciem z Simple Budget Planner',
    cmp_feat13:'Ezzo - Twój asystent budżetowy AI',
    help_aria:'Pomoc',close_aria:'Zamknij',dismiss_aria:'Odrzuć',ok:'OK',
  }
};

function t(key) {
  const lang = state?.settings?.language || 'en';
  const v = TRANSLATIONS[lang]?.[key] ?? TRANSLATIONS.en[key];
  if (v != null) return v;
  // Last-resort safeguard: never render a raw key identifier in the UI
  return String(key).replace(/^(tx|sf|dpc|cal|sett|alloc|bud|dtype|help|toast|freq|dash|sub|rec|dp|sett)_/, '').replace(/_/g, ' ').replace(/^\w/, c => c.toUpperCase());
}
function tf(key,...args){let s=t(key);args.forEach((v,i)=>s=s.replaceAll(`{${i}}`,v));return s;}

function applyLanguage() {
  const lang = state?.settings?.language || 'en';
  document.documentElement.lang = lang;
  // Update tab labels live
  document.querySelectorAll('.btab[data-btab]').forEach(btn => {
    const key = 'tab_' + btn.dataset.btab;
    const tx = TRANSLATIONS[lang]?.[key] || TRANSLATIONS.en[key];
    if (tx) {
      // Preserve emoji prefix if present
      const current = btn.textContent.trim();
      const emoji = current.match(/^(\p{Emoji}[\uFE0F\u20E3]?\s*)/u)?.[0] || '';
      btn.textContent = emoji + tx;
    }
  });
}


function defaultState() {
  const { start, end } = getMonthBounds();
  return {
    settings: { currency: 'USD', symbol: '$', periodStart: start, periodEnd: end, language: 'en', hideUpgrade: false, dashboardLayout: 1, dashboardAnimations: true, onboardingDone: false },
    rollover: 0,
    budgets: {
      income: [
        { id: uid(), category: 'Paycheck',    expected: 0 },
        { id: uid(), category: 'Business',    expected: 0 },
        { id: uid(), category: 'Side Hustle', expected: 0 }
      ],
      expenses: [
        { id: uid(), category: 'Food',             expected: 0 },
        { id: uid(), category: 'Social Life',       expected: 0 },
        { id: uid(), category: 'Transportation',    expected: 0 },
        { id: uid(), category: 'Household',         expected: 0 },
        { id: uid(), category: 'Apparel',           expected: 0 },
        { id: uid(), category: 'Beauty',            expected: 0 },
        { id: uid(), category: 'Health',            expected: 0 },
        { id: uid(), category: 'Education',         expected: 0 },
        { id: uid(), category: 'Gift',              expected: 0 },
        { id: uid(), category: 'Pet',               expected: 0 },
        { id: uid(), category: 'Self-development',  expected: 0 }
      ],
      bills: [
        { id: uid(), category: 'Internet',         expected: 0, dueDate: '', paid: false },
        { id: uid(), category: 'Electricity',      expected: 0, dueDate: '', paid: false },
        { id: uid(), category: 'Water',            expected: 0, dueDate: '', paid: false },
        { id: uid(), category: 'Mobile',           expected: 0, dueDate: '', paid: false },
        { id: uid(), category: 'Life Insurance',   expected: 0, dueDate: '', paid: false },
        { id: uid(), category: 'Health Insurance', expected: 0, dueDate: '', paid: false },
        { id: uid(), category: 'City Garbage',     expected: 0, dueDate: '', paid: false },
        { id: uid(), category: 'Gas',              expected: 0, dueDate: '', paid: false }
      ],
      debt: [
        { id: uid(), category: 'Student Loans', expected: 0, dueDate: '', paid: false },
        { id: uid(), category: 'Mortgage',      expected: 0, dueDate: '', paid: false },
        { id: uid(), category: 'Car Payments',  expected: 0, dueDate: '', paid: false }
      ],
      savings: [
        { id: uid(), category: 'Travel Fund',    expected: 0 },
        { id: uid(), category: 'Wedding Fund',   expected: 0 },
        { id: uid(), category: 'Car Fund',       expected: 0 },
        { id: uid(), category: 'Stocks',         expected: 0 },
        { id: uid(), category: 'Mutual Funds',   expected: 0 },
        { id: uid(), category: 'Cryptocurrency', expected: 0 }
      ]
    },
    transactions: []
  };
}

let state;
function loadState()  { try { const r = localStorage.getItem(STATE_KEY); const s = r ? JSON.parse(r) : null; return (s && s.settings && s.budgets) ? s : null; } catch { return null; } }
function saveState()  { localStorage.setItem(STATE_KEY, JSON.stringify(state)); SYM = state.settings.symbol; syncPushDebounced('sbp'); }
function syncSymbol() { SYM = state.settings.symbol; }

// ══════════════════════════════════════════════════════════════════════
//  FREE TRIAL GATING (SBP)
//  Entering via "TRY FOR FREE" caps usage; entering via "Open" is full.
// ══════════════════════════════════════════════════════════════════════
const SBP_MODE_KEY = 'evobudget_sbp_mode';                 // 'trial' | 'full'
const TRIAL_LIMITS = { transactions: 3, income: 3, expenses: 3, bills: 3, debt: 3, savings: 3 };

// ▼▼ EDIT THESE: drop in your real checkout links + prices ▼▼
// TEST MODE links (ezzohub.lemonsqueezy.com store is not yet activated) -
// swap these for the live-mode checkout links once the store is approved
// and the products are copied over via Lemon Squeezy's "Copy to Live Mode".
const PURCHASE_URLS = {
  sbp: 'https://ezzohub.lemonsqueezy.com/checkout/buy/06896e34-a3a0-485d-a470-891e1bd45b6d',
  ubp: 'https://ezzohub.lemonsqueezy.com/checkout/buy/82d76580-b132-4c74-8d1c-2a383087510c',
};
const PRICES        = { sbp: '$19.99', ubp: '$49.99' };
// ▲▲ ─────────────────────────────────────────────────────── ▲▲

function getSbpMode() { const m = localStorage.getItem(SBP_MODE_KEY); return m === 'trial' || m === 'full' ? m : null; }
function setSbpMode(m) { localStorage.setItem(SBP_MODE_KEY, m); }
function isTrial()     { return getSbpMode() === 'trial'; }

// Trimmed seed for a brand-new trial user: exactly the free allowance per section.
function trialDefaultState() {
  const s = defaultState();
  ['income','expenses','bills','debt','savings'].forEach(k => { s.budgets[k] = s.budgets[k].slice(0, TRIAL_LIMITS[k]); });
  s.transactions = [];
  return s;
}

function enterSbpFull()  { setSbpMode('full'); navigateTo('budget'); }
function enterSbpTrial() {
  const hadState = !!localStorage.getItem(STATE_KEY);
  setSbpMode('trial');
  if (!hadState) { state = trialDefaultState(); syncSymbol(); saveState(); }
  navigateTo('budget');
}

// Returns true when the action is blocked (caller should stop and show the upgrade prompt).
function trialBlocks(kind) {
  if (!isTrial()) return false;
  if (kind === 'transaction') return state.transactions.length >= TRIAL_LIMITS.transactions;
  return (state.budgets[kind]?.length || 0) >= (TRIAL_LIMITS[kind] || Infinity);
}

function goToPurchase(product) {
  const url = PURCHASE_URLS[product];
  if (url) { window.open(url, '_blank', 'noopener'); }
  else { showToast('Add your checkout link in PURCHASE_URLS.' + product); }
}

// Traps Tab/Shift+Tab focus inside a custom modal overlay so keyboard users
// can't tab past it into page content that's only visually covered by it.
// Returns true if it handled the keypress (caller should not also act on it).
function modalTabTrap(overlay, e) {
  if (e.key !== 'Tab' || !overlay) return false;
  const els = Array.from(overlay.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'))
    .filter(el => el.offsetParent !== null);
  if (!els.length) return false;
  const first = els[0], last = els[els.length - 1];
  if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); return true; }
  if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); return true; }
  if (!els.includes(document.activeElement)) { e.preventDefault(); first.focus(); return true; }
  return false;
}

// ── Upgrade prompt ─────────────────────────────────────────────────────
function showUpgradeModal(ctx = {}) {
  document.getElementById('fkUpgradeOverlay')?.remove();

  let chip;
  if (ctx.reason === 'transaction') chip = tf('upg_chip_tx', TRIAL_LIMITS.transactions);
  else if (ctx.reason === 'category') {
    const label = t(MODULE_META[ctx.type]?.titleKey) || 'category';
    chip = tf('upg_chip_cat', TRIAL_LIMITS[ctx.type], label);
  } else chip = t('upg_chip_limit');

  const check = `<svg class="fk-up-check" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>`;

  const ov = document.createElement('div');
  ov.className = 'fk-up-overlay';
  ov.id = 'fkUpgradeOverlay';
  ov.setAttribute('role', 'dialog');
  ov.setAttribute('aria-modal', 'true');
  ov.setAttribute('aria-label', t('upg_aria_label'));
  ov.innerHTML = `
    <div class="fk-up-card" role="document">
      <button class="fk-up-x" id="fkUpClose" type="button" aria-label="${t('close_aria')}">&times;</button>
      <div class="fk-up-hero">
        <div class="fk-up-glow" aria-hidden="true"></div>
        <div class="fk-up-badge">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="11" width="18" height="10" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
          ${esc(chip)}
        </div>
        <h2 class="fk-up-title">${t('upg_title_html')}</h2>
        <p class="fk-up-sub">${t('upg_sub')}</p>
      </div>
      <div class="fk-up-body">
        <ul class="fk-up-list">
          <li>${check}<span>${t('upg_feat_unlimited_tx_html')}</span></li>
          <li>${check}<span>${t('upg_feat_unlimited_cat_html')}</span></li>
          <li>${check}<span>${t('upg_feat_csv')}</span></li>
          <li>${check}<span>${t('upg_feat_onetime')}</span></li>
        </ul>
        <div class="fk-up-price-row">
          <div class="fk-up-price"><span class="fk-up-price-num">${esc(PRICES.sbp)}</span><span class="fk-up-price-tag">${t('upg_price_tag')}</span></div>
          <span class="fk-up-price-note">${t('upg_price_note')}</span>
        </div>
        <button class="fk-up-cta" id="fkUpBuySbp" type="button">${tf('upg_cta_sbp',esc(PRICES.sbp))}</button>
        <button class="fk-up-upsell" id="fkUpBuyUbp" type="button">
          <span class="fk-up-upsell-lead">${t('upg_upsell_lead')}</span>
          <span class="fk-up-upsell-cta">${tf('upg_upsell_cta',esc(PRICES.ubp))}</span>
        </button>
        <div class="fk-up-foot">
          <button class="fk-up-later" id="fkUpLater" type="button">${t('upg_later')}</button>
        </div>
      </div>
    </div>`;
  document.body.appendChild(ov);

  const opener = document.activeElement;
  const close = () => { ov.classList.add('is-leaving'); document.removeEventListener('keydown', onKey); setTimeout(() => { ov.remove(); opener?.focus?.(); }, 180); };
  const onKey = e => { if (e.key === 'Escape') { e.stopPropagation(); close(); } else { modalTabTrap(ov, e); } };
  document.addEventListener('keydown', onKey);
  ov.addEventListener('click', e => { if (e.target === ov) close(); });
  ov.querySelector('#fkUpClose')?.addEventListener('click', close);
  ov.querySelector('#fkUpLater')?.addEventListener('click', close);
  ov.querySelector('#fkUpBuySbp')?.addEventListener('click', () => goToPurchase('sbp'));
  requestAnimationFrame(() => ov.querySelector('#fkUpClose')?.focus());
  ov.querySelector('#fkUpBuyUbp')?.addEventListener('click', () => goToPurchase('ubp'));
  requestAnimationFrame(() => ov.classList.add('is-in'));
}

// ══════════════════════════════════════════════════════════════════════
//  ACCESS CODES + LAUNCH ROUTING (both tools)
//  "Open" needs a code (full version); "Try for free" opens the trial.
// ══════════════════════════════════════════════════════════════════════
const UBP_MODE_KEY  = 'evobudget_ubp_mode';                // 'trial' | 'full'
const UNLOCK_KEYS   = { sbp: 'evobudget_sbp_unlocked', ubp: 'evobudget_ubp_unlocked' };

// ── Launch codes: unlock the full version AND pre-configure which
//    dashboard layout + appearance theme the tool opens with. ─────────
//    Format: [ID tens digit][App][Layout][Theme][ID units digit] - the
//    2-digit sequential id is split across the front and back of the
//    code, wrapping the 3 middle letters:
//      App:    S = Simple (SBP)        U = Ultimate (UBP)
//      Layout: C = Classic dashboard   R = Radial Pulse dashboard
//      Theme:  L = Light   D = Dark   S = Synthwave   V = Vintage Ledger   T = Terminal
//    Matched case-insensitively (input is upper-cased before lookup).
const LAUNCH_CODES = {
  '0SCL1': { tool: 'sbp', layout: 1, theme: 'light' },
  '0SCD2': { tool: 'sbp', layout: 1, theme: 'dark' },
  '0SCS3': { tool: 'sbp', layout: 1, theme: 'synthwave' },
  '0SCV4': { tool: 'sbp', layout: 1, theme: 'vintage-ledger' },
  '0SCT5': { tool: 'sbp', layout: 1, theme: 'terminal' },
  '0SRL6': { tool: 'sbp', layout: 2, theme: 'light' },
  '0SRD7': { tool: 'sbp', layout: 2, theme: 'dark' },
  '0SRS8': { tool: 'sbp', layout: 2, theme: 'synthwave' },
  '0SRV9': { tool: 'sbp', layout: 2, theme: 'vintage-ledger' },
  '1SRT0': { tool: 'sbp', layout: 2, theme: 'terminal' },
  '1UCL1': { tool: 'ubp', layout: 1, theme: 'light' },
  '1UCD2': { tool: 'ubp', layout: 1, theme: 'dark' },
  '1UCS3': { tool: 'ubp', layout: 1, theme: 'synthwave' },
  '1UCV4': { tool: 'ubp', layout: 1, theme: 'vintage-ledger' },
  '1UCT5': { tool: 'ubp', layout: 1, theme: 'terminal' },
  '1URL6': { tool: 'ubp', layout: 2, theme: 'light' },
  '1URD7': { tool: 'ubp', layout: 2, theme: 'dark' },
  '1URS8': { tool: 'ubp', layout: 2, theme: 'synthwave' },
  '1URV9': { tool: 'ubp', layout: 2, theme: 'vintage-ledger' },
  '2URT0': { tool: 'ubp', layout: 2, theme: 'terminal' },
};

// ▼▼ EDIT: fill in once your Lemon Squeezy products exist - each product's
// ID is in its Lemon Squeezy dashboard URL (Products → click product →
// the number in the address bar). Leave blank and the name-based fallback
// below still works as long as the product name contains "Simple"/"Ultimate". ▼▼
const LEMON_SQUEEZY_PRODUCT_TOOL = {
  // 'YOUR_SBP_PRODUCT_ID': 'sbp',
  // 'YOUR_UBP_PRODUCT_ID': 'ubp',
};
// ▲▲ ──────────────────────────────────────────────────────────────────── ▲▲

// Codes not found in LAUNCH_CODES (the fixed Etsy-sale codes above) fall
// back to checking whether they're a real Lemon Squeezy license key. The
// License API's validate endpoint is deliberately public-safe - it only
// needs the license key itself, never a merchant secret - so this is a
// plain client-side fetch, no backend required. Returns null (never
// throws) on anything invalid/unrecognized/offline, so the caller can
// treat it exactly like "wrong code" without special-casing network errors.
async function validateLemonSqueezyKey(licenseKey) {
  try {
    const res = await fetch('https://api.lemonsqueezy.com/v1/licenses/validate', {
      method: 'POST',
      headers: { 'Accept': 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ license_key: licenseKey }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (!data.valid) return null;
    const productId   = String(data.meta?.product_id ?? '');
    const productName = String(data.meta?.product_name ?? '').toLowerCase();
    // Fail safe rather than guess: an unrecognized product on an otherwise
    // valid key is treated as "not one of ours" instead of unlocking the
    // wrong tool for a paying customer.
    const tool = LEMON_SQUEEZY_PRODUCT_TOOL[productId]
      || (productName.includes('ultimate') ? 'ubp' : productName.includes('simple') ? 'sbp' : null);
    if (!tool) return null;
    return { tool, orderId: data.meta?.order_id ?? null };
  } catch {
    return null;
  }
}

// One-time handoff for the dashboard layout a code was redeemed with -
// UBP is a full page navigation away (ultimate-budget.html), so it can't
// be applied to a live `state` object the way SBP's can; init() there
// reads and clears this once on load instead.
const UBP_PENDING_LAYOUT_KEY = 'evobudget_ubp_pending_layout';

function setUbpMode(m)   { localStorage.setItem(UBP_MODE_KEY, m); }
function isUnlocked(tool){ return localStorage.getItem(UNLOCK_KEYS[tool]) === '1'; }
function setUnlocked(tool){ localStorage.setItem(UNLOCK_KEYS[tool], '1'); }

function enterFull(tool)  { if (tool === 'ubp') { setUbpMode('full'); syncStashTokenForHandoff('ubp'); window.location.href = 'ultimate-budget'; } else enterSbpFull(); }
function enterTrial(tool) { if (tool === 'ubp') { setUbpMode('trial'); window.location.href = 'ultimate-budget'; } else enterSbpTrial(); }

async function openFull(tool) {
  if (!isUnlocked(tool)) { showAccessCodeModal(tool); return; }
  if (syncGetMode(tool) !== 'google') { enterFull(tool); return; }
  if (_syncAccessToken) {
    // Already have a live session cached this browser session (e.g. signed
    // in moments ago) - reuse it directly, no request of any kind needed.
    const result = await syncSilentResync(tool).catch(() => ({ authOk: false, data: null }));
    if (result.authOk) { enterFull(tool); return; }
  }
  // No cached session on a fresh page load - deliberately do NOT attempt a
  // "silent" prompt:'none' request here. It can still visibly flash a real
  // popup open and closed without reliably resolving either way (confirmed
  // via testing), which is exactly the confusing dead-end this is meant to
  // avoid. Go straight to the proven-reliable interactive sign-in prompt.
  showGoogleReauthModal(tool);
}

// ── Google re-auth prompt (returning device, Google session expired) ──
function showGoogleReauthModal(tool) {
  document.getElementById('fkSyncOverlay')?.remove();
  const ov = document.createElement('div');
  ov.className = 'fk-code-overlay';
  ov.id = 'fkSyncOverlay';
  ov.setAttribute('role', 'dialog');
  ov.setAttribute('aria-modal', 'true');
  ov.innerHTML = `
    <div class="fk-code-card" role="document">
      <button class="fk-code-x" id="fkReauthClose" type="button" aria-label="${t('close_aria')}">&times;</button>
      <div class="fk-code-key" aria-hidden="true">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 16l4-4m0 0l-4-4m4 4H7m6 5v1a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3V6a3 3 0 0 1 3-3h4a3 3 0 0 1 3 3v1"/></svg>
      </div>
      <h2 class="fk-code-title">${t('reauth_title')}</h2>
      <p class="fk-code-sub">${t('reauth_sub')}</p>
      <p class="fk-code-error" id="fkReauthError" hidden></p>
      <button class="fk-code-submit" id="fkReauthSubmit" type="button">${t('reauth_submit')}</button>
      <div class="fk-code-foot">
        <button class="fk-code-link" id="fkReauthLocal" type="button">${t('reauth_local')}</button>
      </div>
    </div>`;
  document.body.appendChild(ov);
  const close = () => { ov.classList.add('is-leaving'); setTimeout(() => ov.remove(), 180); };
  ov.addEventListener('click', e => { if (e.target === ov) close(); });
  ov.querySelector('#fkReauthClose')?.addEventListener('click', close);
  ov.querySelector('#fkReauthSubmit')?.addEventListener('click', async () => {
    const errEl = ov.querySelector('#fkReauthError');
    try { await syncSignInAndAdopt(tool); close(); enterFull(tool); }
    catch (e) { errEl.textContent = syncFriendlyError(e); errEl.hidden = false; }
  });
  ov.querySelector('#fkReauthLocal')?.addEventListener('click', () => { syncSetMode(tool, 'local'); close(); enterFull(tool); });
  requestAnimationFrame(() => ov.classList.add('is-in'));
}

// ── Local vs Google Sync choice (shown once, right after a code is redeemed) ──
function showSyncChoiceModal(tool) {
  document.getElementById('fkSyncOverlay')?.remove();
  const ov = document.createElement('div');
  ov.className = 'fk-code-overlay';
  ov.id = 'fkSyncOverlay';
  ov.setAttribute('role', 'dialog');
  ov.setAttribute('aria-modal', 'true');
  ov.innerHTML = `
    <div class="fk-code-card fk-sync-card" role="document">
      <h2 class="fk-code-title">${t('sync_welcome')}</h2>
      <p class="fk-code-sub">${t('sync_choose')}</p>
      <button class="fk-sync-option fk-sync-option--google" id="fkSyncGoogle" type="button">
        <span class="fk-sync-option-badge">${t('sync_recommended')}</span>
        <span class="fk-sync-option-icon fk-sync-option-icon--google">${SYNC_ICON_GOOGLE}</span>
        <span class="fk-sync-option-text">
          <span class="fk-sync-option-title">${t('sync_continue_google')}</span>
          <span class="fk-sync-option-desc">${t('sync_desc_multi_device')}</span>
        </span>
        <span class="fk-sync-option-chevron">${SYNC_ICON_CHEVRON}</span>
      </button>
      <button class="fk-sync-option" id="fkSyncLocal" type="button">
        <span class="fk-sync-option-icon">${SYNC_ICON_LOCAL}</span>
        <span class="fk-sync-option-text">
          <span class="fk-sync-option-title">${t('sync_use_no_account')}</span>
          <span class="fk-sync-option-desc">${t('sync_desc_this_device')}</span>
        </span>
        <span class="fk-sync-option-chevron">${SYNC_ICON_CHEVRON}</span>
      </button>
      <p class="fk-code-error" id="fkSyncError" hidden></p>
      <p class="fk-sync-status" id="fkSyncStatus" hidden>${t('sync_status_wait')}</p>
      <p class="fk-sync-footer">${t('sync_footer_note')}</p>
    </div>`;
  document.body.appendChild(ov);
  const close = () => { ov.classList.add('is-leaving'); setTimeout(() => ov.remove(), 180); };
  const statusEl = ov.querySelector('#fkSyncStatus');
  const errEl = ov.querySelector('#fkSyncError');
  ov.querySelector('#fkSyncLocal')?.addEventListener('click', () => { syncSetMode(tool, 'local'); close(); enterFull(tool); });
  ov.querySelector('#fkSyncGoogle')?.addEventListener('click', async () => {
    errEl.hidden = true; statusEl.hidden = false;
    ov.querySelectorAll('.fk-sync-option').forEach(b => b.disabled = true);
    try { await syncSignInAndAdopt(tool); syncSetMode(tool, 'google'); close(); enterFull(tool); }
    catch (e) {
      statusEl.hidden = true;
      errEl.textContent = syncFriendlyError(e); errEl.hidden = false;
      ov.querySelectorAll('.fk-sync-option').forEach(b => b.disabled = false);
    }
  });
  requestAnimationFrame(() => ov.classList.add('is-in'));
}

// ── License key prompt ─────────────────────────────────────────────────
function showAccessCodeModal(tool) {
  document.getElementById('fkCodeOverlay')?.remove();
  const isU  = tool === 'ubp';
  const name = isU ? t('app_name_ubp') : t('app_name_sbp');

  const ov = document.createElement('div');
  ov.className = 'fk-code-overlay';
  ov.id = 'fkCodeOverlay';
  ov.setAttribute('role', 'dialog');
  ov.setAttribute('aria-modal', 'true');
  ov.setAttribute('aria-label', t('code_title'));
  ov.innerHTML = `
    <div class="fk-code-card" role="document">
      <button class="fk-code-x" id="fkCodeClose" type="button" aria-label="${t('close_aria')}">&times;</button>
      <div class="fk-code-key" aria-hidden="true">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3"/></svg>
      </div>
      <h2 class="fk-code-title">${t('code_title')}</h2>
      <p class="fk-code-sub">${tf('code_sub',esc(name))}</p>
      <input class="fk-code-input" id="fkCodeInput" type="text" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="${t('code_placeholder')}" aria-label="${t('code_placeholder')}" />
      <p class="fk-code-error" id="fkCodeError" hidden>${t('code_error')}</p>
      <input class="fk-code-input fk-code-input--orderid" id="fkOrderIdInput" type="text" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="${t('code_orderid_placeholder')}" aria-label="${t('code_orderid_placeholder')}" />
      <p class="fk-code-error" id="fkOrderIdError" hidden>${t('code_orderid_error')}</p>
      <button class="fk-code-submit" id="fkCodeSubmit" type="button">${t('code_submit')}</button>
      <div class="fk-code-foot">
        <button class="fk-code-link" id="fkCodeTry" type="button">${t('code_try_free')}</button>
        <button class="fk-code-link" id="fkCodeBuy" type="button">${t('code_get')}</button>
      </div>
    </div>`;
  document.body.appendChild(ov);

  const input = ov.querySelector('#fkCodeInput');
  const errEl = ov.querySelector('#fkCodeError');
  const orderIdInput = ov.querySelector('#fkOrderIdInput');
  const orderIdErrEl = ov.querySelector('#fkOrderIdError');
  const card  = ov.querySelector('.fk-code-card');
  const opener = document.activeElement;
  const close = () => { ov.classList.add('is-leaving'); document.removeEventListener('keydown', onKey); setTimeout(() => { ov.remove(); opener?.focus?.(); }, 180); };
  const onKey = e => { if (e.key === 'Escape') { e.stopPropagation(); close(); } else { modalTabTrap(ov, e); } };
  const submitBtn = ov.querySelector('#fkCodeSubmit');
  const redeemLaunchCode = (cfg, codeVal, orderIdVal) => {
    // The code names its own tool - honor that even if it differs from
    // whichever "Open" button opened this modal, rather than rejecting
    // a valid code just because it was typed in the "other" prompt.
    setUnlocked(cfg.tool);
    trackEvent('launch_code_redeemed', { code: codeVal, tool: cfg.tool, orderId: orderIdVal });
    localStorage.setItem('evobudget_theme', cfg.theme); // theme is a single global preference, shared by both tools
    if (cfg.tool === 'ubp') localStorage.setItem(UBP_PENDING_LAYOUT_KEY, String(cfg.layout));
    else { state.settings.dashboardLayout = cfg.layout; saveState(); }
    applyTheme(cfg.theme);
    close();
    showSyncChoiceModal(cfg.tool);
  };
  const redeemLemonSqueezyKey = (lsResult, codeVal, orderIdVal) => {
    // Unlike a launch code, a Lemon Squeezy key carries no layout/theme -
    // leave those exactly as they already are rather than forcing a default.
    setUnlocked(lsResult.tool);
    trackEvent('launch_code_redeemed', { code: codeVal, tool: lsResult.tool, orderId: orderIdVal, source: 'lemonsqueezy' });
    close();
    showSyncChoiceModal(lsResult.tool);
  };
  const submit = async () => {
    const codeVal = input.value.trim().toUpperCase();
    const orderIdVal = orderIdInput.value.trim();
    const cfg = LAUNCH_CODES[codeVal];
    // An order ID is always required - for launch codes it's the site
    // owner's only manual cross-reference; for Lemon Squeezy keys it's
    // just kept for the buyer's own record since the key itself is
    // already verified against Lemon Squeezy directly.
    orderIdErrEl.hidden = !!orderIdVal;
    if (!orderIdVal) {
      card.classList.remove('shake'); void card.offsetWidth; card.classList.add('shake');
      orderIdInput.select();
      return;
    }
    if (cfg) {
      errEl.hidden = true;
      redeemLaunchCode(cfg, codeVal, orderIdVal);
      return;
    }
    // Not one of the fixed launch codes (those are reserved for Etsy sales)
    // - try it as a real Lemon Squeezy license key before rejecting it.
    errEl.hidden = true;
    submitBtn.disabled = true;
    const originalLabel = submitBtn.textContent;
    submitBtn.textContent = t('code_checking');
    const lsResult = await validateLemonSqueezyKey(codeVal);
    submitBtn.disabled = false;
    submitBtn.textContent = originalLabel;

    if (lsResult) { redeemLemonSqueezyKey(lsResult, codeVal, orderIdVal); return; }

    errEl.hidden = false;
    card.classList.remove('shake'); void card.offsetWidth; card.classList.add('shake');
    input.select();
  };
  document.addEventListener('keydown', onKey);
  ov.addEventListener('click', e => { if (e.target === ov) close(); });
  ov.querySelector('#fkCodeClose')?.addEventListener('click', close);
  submitBtn?.addEventListener('click', submit);
  input.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); submit(); } });
  input.addEventListener('input', () => { errEl.hidden = true; });
  orderIdInput.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); submit(); } });
  orderIdInput.addEventListener('input', () => { orderIdErrEl.hidden = true; });
  ov.querySelector('#fkCodeTry')?.addEventListener('click', () => { close(); enterTrial(tool); });
  ov.querySelector('#fkCodeBuy')?.addEventListener('click', () => goToPurchase(tool));
  requestAnimationFrame(() => { ov.classList.add('is-in'); input.focus(); });
}

// ── Aggregations ──────────────────────────────────────────────────────
// Type label/color for the Daily Spend hover tooltip's per-transaction
// breakdown - the SAME colors as the Cash Flow rows/rings elsewhere on
// this dashboard, so a category reads as the same category everywhere.
function spendTypeLabel(type) {
  return { expense: t('tab_expenses'), bill: t('tab_bills'), debt: t('tab_debt'), savings: t('tab_savings') }[type] || type;
}
function spendTypeColor(type) {
  return { expense: '#ec4899', bill: '#fb923c', debt: '#a855f7', savings: '#3b82f6' }[type] || '#6366f1';
}

function computeActuals() {
  const a = { income: {}, expenses: {}, bills: {}, debt: {}, savings: {} };
  const MAP = { income: 'income', expense: 'expenses', bill: 'bills', debt: 'debt', savings: 'savings' };
  const { periodStart, periodEnd } = state.settings;
  for (const tx of state.transactions) {
    // Only count transactions that fall within the active budget period
    if (tx.date < periodStart || tx.date > periodEnd) continue;
    const sec = MAP[tx.type];
    if (sec) a[sec][tx.category] = (a[sec][tx.category] || 0) + tx.amount;
  }
  return a;
}

function computeSummary(act) {
  const sum = o => Object.values(o).reduce((s, v) => s + v, 0);
  const totalIncome   = sum(act.income);
  const totalExpenses = sum(act.expenses);
  const totalBills    = sum(act.bills);
  const totalDebt     = sum(act.debt);
  const totalSavings  = sum(act.savings);
  const totalExpBills = totalExpenses + totalBills;
  const leftover      = (state.rollover || 0) + totalIncome - totalExpBills - totalDebt - totalSavings;
  return { totalIncome, totalExpenses, totalBills, totalDebt, totalSavings, totalExpBills, leftover };
}

function hasAnyData() {
  if (state.transactions.length > 0) return true;
  return Object.values(state.budgets).some(arr => arr.some(r => (r.expected || 0) > 0));
}

// ── SVG Donut Chart ───────────────────────────────────────────────────
const COLOR_WHEEL = ['#06b6d4','#ec4899','#fb923c','#8b5cf6','#10b981','#eab308','#3b82f6','#f43f5e','#14b8a6','#a855f7','#f97316','#6366f1'];
let _did=0;

function svgDonut(segments, size = 130, sw = 17) {
  const r=size/2-sw/2, c=2*Math.PI*r, cx=size/2, cy=size/2;
  const gid='d'+(++_did);
  const defs=`<defs><radialGradient id="rg${gid}" cx="38%" cy="32%" r="68%"><stop offset="0%" stop-color="white" stop-opacity="0.18"/><stop offset="100%" stop-color="black" stop-opacity="0.06"/></radialGradient></defs>`;
  const bg=`<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="rgba(30,27,46,.08)" stroke-width="${sw}"/>`;
  if (!segments||!segments.length) return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" style="flex-shrink:0">${defs}${bg}</svg>`;
  let arcs='', cum=0;
  segments.forEach((seg,idx) => {
    const p=seg.pct||0; if(p<=0){cum+=p;return;}
    const dash=(p/100)*c, gap=c-dash, rot=-90+(cum/100)*360;
    arcs+=`<circle class="dseg" data-idx="${idx}" data-label="${esc(seg.label||'')}" data-pct="${p.toFixed(1)}" data-val="${seg.value||0}"
      cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${seg.color}" stroke-width="${sw}"
      stroke-dasharray="${dash.toFixed(2)} ${gap.toFixed(2)}"
      transform="rotate(${rot.toFixed(2)} ${cx} ${cy})"
      style="cursor:pointer;transition:stroke-width .18s,opacity .18s"/>`;
    cum+=p;
  });
  const overlay=`<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="url(#rg${gid})" stroke-width="${sw+6}" pointer-events="none"/>`;
  const fs1=(size*.14).toFixed(0), fs2=(size*.085).toFixed(0);
  const center=`<g class="donut-center" pointer-events="none">
    <text class="donut-hover-pct" x="${cx}" y="${cy+2}" text-anchor="middle" dominant-baseline="middle"
      style="font-family:var(--font-display);font-weight:800;font-size:${fs1}px;fill:var(--text-primary);opacity:0;transition:opacity .15s"></text>
    <text class="donut-hover-lbl" x="${cx}" y="${cy+parseInt(fs1)+4}" text-anchor="middle"
      style="font-size:${fs2}px;fill:var(--text-secondary);opacity:0;transition:opacity .15s"></text>
  </g>`;
  return `<svg class="donut-svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" style="flex-shrink:0;overflow:visible">${defs}${bg}${arcs}${overlay}${center}</svg>`;
}

function initDonuts(container) {
  (container||document).querySelectorAll('.donut-svg').forEach(svg=>{
    const segs=svg.querySelectorAll('.dseg'); if(!segs.length) return;
    const baseSW=parseFloat(segs[0].getAttribute('stroke-width')||17);
    const pctEl=svg.querySelector('.donut-hover-pct'), lblEl=svg.querySelector('.donut-hover-lbl');
    const legend=svg.closest('.donut-block')?.querySelector('.donut-legend');
    const legRows=legend?Array.from(legend.querySelectorAll('.dleg-row')):[];
    const show=seg=>{segs.forEach(s=>{s.setAttribute('stroke-width',baseSW);s.style.opacity='0.45';});
      seg.setAttribute('stroke-width',baseSW+5);seg.style.opacity='1';
      if(pctEl){pctEl.textContent=seg.dataset.pct+'%';pctEl.style.opacity='1';}
      if(lblEl){lblEl.textContent=seg.dataset.label;lblEl.style.opacity='1';}
      const row=legRows.find(r=>r.dataset.idx===seg.dataset.idx);
      if(row){
        row.classList.add('is-active');
        const amtEl=row.querySelector('.dleg-pct');
        if(amtEl){if(amtEl.dataset.pctText===undefined)amtEl.dataset.pctText=amtEl.textContent;amtEl.textContent=fmt(parseFloat(seg.dataset.val)||0);}
      }};
    const hide=()=>{segs.forEach(s=>{s.setAttribute('stroke-width',baseSW);s.style.opacity='1';});
      if(pctEl)pctEl.style.opacity='0'; if(lblEl)lblEl.style.opacity='0';
      legRows.forEach(row=>{
        row.classList.remove('is-active');
        const amtEl=row.querySelector('.dleg-pct');
        if(amtEl&&amtEl.dataset.pctText!==undefined)amtEl.textContent=amtEl.dataset.pctText;
      });};
    segs.forEach(seg=>{
      seg.addEventListener('mouseenter',()=>show(seg));
      seg.addEventListener('mouseleave',hide);
      seg.addEventListener('touchstart',e=>{e.preventDefault();show(seg);},{passive:false});
      seg.addEventListener('touchend',()=>setTimeout(hide,1600));
    });
    legRows.forEach(row=>{
      const seg=Array.from(segs).find(s=>s.dataset.idx===row.dataset.idx);
      if(!seg) return;
      row.addEventListener('mouseenter',()=>show(seg));
      row.addEventListener('mouseleave',hide);
    });
  });
}

// ── Drag-to-scroll (mouse) for tab bar ───────────────────────────────
function enableDragScroll(el) {
  if (!el) return;
  let pos = null, dragged = false;

  el.addEventListener('mousedown', e => {
    pos = { left: el.scrollLeft, x: e.clientX };
    dragged = false;
  });
  el.addEventListener('mousemove', e => {
    if (!pos || !(e.buttons & 1)) { pos = null; return; }
    const dx = e.clientX - pos.x;
    if (Math.abs(dx) > 4) { dragged = true; el.classList.add('is-dragging'); }
    el.scrollLeft = pos.left - dx;
  });
  const stop = () => { pos = null; el.classList.remove('is-dragging'); };
  el.addEventListener('mouseup',    stop);
  el.addEventListener('mouseleave', stop);
  // Swallow click that was actually a drag - capture phase fires before button handler
  el.addEventListener('click', e => { if (dragged) { e.stopPropagation(); dragged = false; } }, true);
}

// ── Theme ─────────────────────────────────────────────────────────────
function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  localStorage.setItem('evobudget_theme', theme);
  document.querySelectorAll('.theme-opt').forEach(b => b.classList.toggle('is-active', b.dataset.themeVal === theme));
}
function initTheme() { applyTheme(localStorage.getItem('evobudget_theme') || 'dark'); }

// ── Dashboard Layout picker (Settings) ─────────────────────────────────
const DASHBOARD_LAYOUT_ICONS = {
  1: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  2: '<circle cx="12" cy="12" r="2.5"/><circle cx="12" cy="12" r="6.5"/><circle cx="12" cy="12" r="10.5"/>'
};
function dashboardLayoutCardHtml() {
  if ((state.settings.dashboardLayout || 1) > 2) state.settings.dashboardLayout = 1;
  const cur = state.settings.dashboardLayout || 1;
  const opts = [1, 2].map(n => `
    <button class="layout-opt${cur === n ? ' is-active' : ''}" data-layout-val="${n}" type="button" title="${t('layout_' + n)}">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">${DASHBOARD_LAYOUT_ICONS[n]}</svg>
      ${t('layout_' + n)}
    </button>`).join('') + `
    <button class="layout-opt layout-opt--soon" type="button" disabled title="${t('layout_coming_soon')}">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="5" cy="12" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="19" cy="12" r="1.4"/></svg>
      ${t('layout_coming_soon')}
    </button>`;
  return `<div class="panel"><div class="panel-inner">
    <div class="settings-card-title">📊 ${t('dashboard_layout')}</div>
    <p class="settings-desc">${t('dashboard_layout_desc')}</p>
    <div class="layout-setting-row">
      <div class="layout-pill theme-pill" role="group" aria-label="${t('dashboard_layout')}">${opts}</div>
    </div>
  </div></div>`;
}
function wireDashboardLayoutPicker(el) {
  el.querySelectorAll('.layout-opt').forEach(btn => {
    btn.addEventListener('click', () => {
      const n = parseInt(btn.dataset.layoutVal, 10) || 1;
      state.settings.dashboardLayout = n;
      saveState();
      trackEvent('dashboard_layout_changed', { layout: n });
      el.querySelectorAll('.layout-opt').forEach(b => b.classList.toggle('is-active', b === btn));
      renderDashboard();
    });
  });
}

// ── Navigation ────────────────────────────────────────────────────────
let currentView = 'hub';
let currentBTab = 'dashboard';
let txFilter={search:'',type:'',sort:'date_desc'};
let txPage=0;
const TX_PAGE_SIZE=25;

function navigateTo(view) {
  document.querySelectorAll('.view').forEach(el => el.classList.remove('is-active'));
  document.getElementById(`view-${view}`)?.classList.add('is-active');
  currentView = view;
  if (view === 'budget') {
    const sel = document.getElementById('currencySelect');
    if (sel) sel.value = `${state.settings.currency}|${state.settings.symbol}`;
    switchBTab(currentBTab || 'dashboard');
    maybeStartOnboarding();
  }
  window.scrollTo(0, 0);
}

function switchBTab(tab) {
  currentBTab = tab;
  trackEvent('tab_viewed', { tab });
  document.querySelectorAll('.btab').forEach(b => b.classList.toggle('is-active', b.dataset.btab === tab));
  document.querySelectorAll('.btab[role="tab"]').forEach(b => b.setAttribute('aria-selected', b.dataset.btab === tab ? 'true' : 'false'));
  document.querySelectorAll('.bview').forEach(v => v.classList.remove('is-active'));
  document.getElementById(`bview-${tab}`)?.classList.add('is-active');
  dispatchRender(tab);
  document.querySelector('#view-budget .app-scroll')?.scrollTo({top:0});   // new tab starts at the top
}

function dispatchRender(tab) {
  switch (tab) {
    case 'dashboard':                              renderDashboard();    break;
    case 'transactions':                           renderTransactions(); break;
    case 'income': case 'expenses': case 'bills':
    case 'debt':   case 'savings':                 renderModule(tab);    break;
    case 'settings':                               renderSettings();     break;
  }
}

// ── Hub ───────────────────────────────────────────────────────────────
const TOOLS = [
  { id:'budget', icon:'💰', color:'indigo', status:'live', name:'Simple Budget Planner', desc:'Track income, expenses, bills, debt, and savings - all in one place. Perfect for monthly budget control.' },
  { id:'ubp',    icon:'⚡', color:'orange', status:'live', name:'Ultimate Budget Planner', desc:'The pro upgrade. Debt payoff calculator, sinking funds tracker, smart calendar, subscription tracker, and Ezzo, your AI budget assistant - all in one.' }
];

function renderHub() {
  document.getElementById('toolGrid').innerHTML = TOOLS.map(t => `
    <div class="tool-card-wrap">
      ${t.id === 'ubp' ? '<span class="tool-card-popular-pill">Most Popular</span>' : ''}
      <div class="tool-card tool-card--${t.color}${t.status === 'live' ? ' is-live' : ''}">
      <div class="tool-card-inner">
        <div class="tool-card-top">
          <span class="tool-card-icon">${t.icon}</span>
          <h3 class="tool-card-name">${esc(t.name)}</h3>
          ${t.status === 'live' ? `<span class="badge badge-price">${PRICES[t.id === 'budget' ? 'sbp' : t.id]}</span>` : '<span class="badge badge-soon">Coming soon</span>'}
        </div>
        <p class="tool-card-desc">${esc(t.desc)}</p>
        ${t.status === 'live'
          ? `<div class="tool-card-actions">
              <div class="tool-card-btns">
                <button class="btn btn-primary btn-sm tool-open-btn" data-tool="${t.id}" type="button">Open</button>
                <button class="btn btn-ghost btn-sm tool-buy-btn" data-tool="${t.id}" type="button">Buy Now</button>
              </div>
              <a class="tool-try-link" data-tool="${t.id}" role="button" tabindex="0">Free Demo</a>
            </div>`
          : `<button class="btn btn-ghost btn-sm" disabled type="button">Notify me</button>`}
      </div>
      </div>
    </div>
  `).join('');

  // Open → full version (license key required)
  document.querySelectorAll('.tool-open-btn[data-tool]').forEach(btn => {
    btn.addEventListener('click', () => {
      if (btn.dataset.tool === 'budget') openFull('sbp');
      else if (btn.dataset.tool === 'ubp') openFull('ubp');
    });
  });

  // Try for free → trial version (limits apply)
  const startTry = tool => {
    if (tool === 'budget') enterTrial('sbp');
    else if (tool === 'ubp') enterTrial('ubp');
  };
  document.querySelectorAll('.tool-try-link[data-tool]').forEach(el => {
    el.addEventListener('click', () => startTry(el.dataset.tool));
    el.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); startTry(el.dataset.tool); } });
  });

  // Buy now → checkout
  document.querySelectorAll('.tool-buy-btn[data-tool]').forEach(btn => {
    btn.addEventListener('click', () => goToPurchase(btn.dataset.tool === 'ubp' ? 'ubp' : 'sbp'));
  });

  renderCarousel();

  // Comparison buy buttons
  document.querySelectorAll('.cc-buy-btn[data-buy]').forEach(btn => {
    btn.addEventListener('click', () => goToPurchase(btn.dataset.buy));
  });

  // Scenario + banner CTA buttons (start the relevant tool's free demo)
  document.querySelectorAll('[data-try]').forEach(btn => {
    btn.addEventListener('click', () => enterTrial(btn.dataset.try));
  });

  initFeatureTips();
}

// ── Feature tooltips (comparison table) ────────────────────────────────
function initFeatureTips() {
  let tipEl = null, tipBtn = null;
  function hide() { if (tipEl) { tipEl.remove(); tipEl = null; tipBtn = null; } }
  function show(btn) {
    if (tipBtn === btn) return;
    hide();
    const name = btn.parentElement.querySelector('.cc-label-text')?.textContent || '';
    tipEl = document.createElement('div');
    tipEl.className = 'cc-tip-pop';
    tipEl.innerHTML =
      `<div class="cc-tip-head"><span class="cc-tip-dot"></span>${esc(name)}</div>` +
      `<div class="cc-tip-body">${esc(btn.dataset.tip)}</div>` +
      `<span class="cc-tip-arrow"></span>`;
    document.body.appendChild(tipEl);
    tipBtn = btn;

    const r = btn.getBoundingClientRect();
    const tw = tipEl.offsetWidth, th = tipEl.offsetHeight;
    const iconCenter = r.left + r.width / 2 + window.scrollX;

    let left = iconCenter - tw / 2;
    const minL = window.scrollX + 10, maxL = window.scrollX + window.innerWidth - tw - 10;
    left = Math.max(minL, Math.min(left, maxL));

    let top = r.top + window.scrollY - th - 11;
    if (r.top - th - 11 < 0) { top = r.bottom + window.scrollY + 11; tipEl.classList.add('cc-tip-below'); }
    else { tipEl.classList.add('cc-tip-above'); }

    tipEl.style.left = left + 'px';
    tipEl.style.top = top + 'px';

    const arrow = tipEl.querySelector('.cc-tip-arrow');
    let ax = iconCenter - left - 6;
    ax = Math.max(14, Math.min(ax, tw - 26));
    arrow.style.left = ax + 'px';

    requestAnimationFrame(() => tipEl && tipEl.classList.add('is-in'));
  }
  document.querySelectorAll('.cc-info[data-tip]').forEach(btn => {
    btn.addEventListener('pointerenter', e => { if (e.pointerType === 'mouse') show(btn); });
    btn.addEventListener('pointerleave', e => { if (e.pointerType === 'mouse') hide(); });
    btn.addEventListener('click', e => { e.stopPropagation(); if (tipBtn === btn) hide(); else show(btn); });
    btn.addEventListener('blur', hide);
  });
  document.addEventListener('click', hide);
  window.addEventListener('scroll', hide, true);
}

// ── Lightweight "?" field-info tooltips ("tiny helpers") for SBP forms ──
function tipLabel(text,hintKey,required){
  return `<span class="cc-label-text">${text}</span>${required?' <span class="required-star" aria-hidden="true">*</span>':''}<button class="cc-info" type="button" data-tip="${esc(t(hintKey))}" aria-label="${tf('field_info_aria',text)}">i</button>`;
}
function initFieldTips(container){
  const scope=container||document;
  let tipBtn=null,shownViaHover=false;
  const hideAll=()=>{document.querySelectorAll('.cc-tip-pop').forEach(el=>el.remove());tipBtn=null;shownViaHover=false;};
  const show=(btn,viaHover)=>{
    hideAll();
    const name=btn.parentElement.querySelector('.cc-label-text')?.textContent||'';
    const tipEl=document.createElement('div');
    tipEl.className='cc-tip-pop';
    tipEl.innerHTML=`<div class="cc-tip-head"><span class="cc-tip-dot"></span>${esc(name)}</div><div class="cc-tip-body">${esc(btn.dataset.tip)}</div><span class="cc-tip-arrow"></span>`;
    document.body.appendChild(tipEl);
    tipBtn=btn;shownViaHover=!!viaHover;
    const r=btn.getBoundingClientRect();
    const tw=tipEl.offsetWidth,th=tipEl.offsetHeight;
    const iconCenter=r.left+r.width/2+window.scrollX;
    let left=iconCenter-tw/2;
    const minL=window.scrollX+10,maxL=window.scrollX+window.innerWidth-tw-10;
    left=Math.max(minL,Math.min(left,maxL));
    let top=r.top+window.scrollY-th-11;
    if(r.top-th-11<0){top=r.bottom+window.scrollY+11;tipEl.classList.add('cc-tip-below');}
    else{tipEl.classList.add('cc-tip-above');}
    tipEl.style.left=left+'px';tipEl.style.top=top+'px';
    const arrow=tipEl.querySelector('.cc-tip-arrow');
    let ax=iconCenter-left-6;
    ax=Math.max(14,Math.min(ax,tw-26));
    arrow.style.left=ax+'px';
    requestAnimationFrame(()=>tipEl.classList.add('is-in'));
  };
  scope.querySelectorAll('.cc-info[data-tip]').forEach(btn=>{
    btn.addEventListener('pointerenter',e=>{if(e.pointerType==='mouse')show(btn,true);});
    btn.addEventListener('pointerleave',e=>{if(e.pointerType==='mouse'&&shownViaHover)hideAll();});
    btn.addEventListener('click',e=>{
      e.stopPropagation();
      if(tipBtn===btn&&document.querySelector('.cc-tip-pop')){
        if(shownViaHover){shownViaHover=false;return;}
        hideAll();return;
      }
      show(btn,false);
    });
    btn.addEventListener('blur',hideAll);
  });
}
document.addEventListener('click',()=>document.querySelectorAll('.cc-tip-pop').forEach(el=>el.remove()));
window.addEventListener('scroll',()=>document.querySelectorAll('.cc-tip-pop').forEach(el=>el.remove()),true);

// ── Dashboard ─────────────────────────────────────────────────────────
// Demo numbers for the onboarding banner's "Load sample data" button -
// every date is built relative to the CURRENTLY SELECTED budget period
// (state.settings.periodStart), clamped to periodEnd, so the sample data
// always lands inside whatever period the user has open rather than a
// hardcoded month that might fall outside it.
function loadSampleData() {
  const ps = state.settings.periodStart, pe = state.settings.periodEnd;
  const day = n => { const d = new Date(ps + 'T00:00:00'); d.setDate(d.getDate() + n); const iso = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); return iso > pe ? pe : iso; };
  state.budgets = {
    income: [{ id: uid(), category: 'Paycheck', expected: 3200 }, { id: uid(), category: 'Side Hustle', expected: 400 }],
    expenses: [{ id: uid(), category: 'Food', expected: 450 }, { id: uid(), category: 'Transportation', expected: 150 }, { id: uid(), category: 'Social Life', expected: 120 }],
    bills: [{ id: uid(), category: 'Internet', expected: 70, dueDate: day(24), paid: false }, { id: uid(), category: 'Mobile', expected: 55, dueDate: day(19), paid: false }, { id: uid(), category: 'Electricity', expected: 130, dueDate: day(21), paid: false }],
    debt: [{ id: uid(), category: 'Student Loans', expected: 180, dueDate: day(15), paid: false }],
    savings: [{ id: uid(), category: 'Travel Fund', expected: 200 }, { id: uid(), category: 'Car Fund', expected: 100 }]
  };
  state.transactions = [
    { id: uid(), date: day(0), type: 'income', category: 'Paycheck', amount: 1600, description: 'Payday' },
    { id: uid(), date: day(14), type: 'income', category: 'Paycheck', amount: 1600, description: 'Payday' },
    { id: uid(), date: day(9), type: 'income', category: 'Side Hustle', amount: 220, description: 'Side project' },
    { id: uid(), date: day(2), type: 'expense', category: 'Food', amount: 82.40, description: 'Groceries' },
    { id: uid(), date: day(5), type: 'expense', category: 'Food', amount: 54.10, description: 'Groceries' },
    { id: uid(), date: day(7), type: 'expense', category: 'Transportation', amount: 45, description: 'Gas' },
    { id: uid(), date: day(8), type: 'expense', category: 'Social Life', amount: 38, description: 'Dinner out' },
    { id: uid(), date: day(11), type: 'expense', category: 'Food', amount: 61.75, description: 'Groceries' },
    { id: uid(), date: day(13), type: 'expense', category: 'Social Life', amount: 52, description: 'Concert' },
    { id: uid(), date: day(4), type: 'savings', category: 'Travel Fund', amount: 120, description: '' },
    { id: uid(), date: day(14), type: 'savings', category: 'Car Fund', amount: 100, description: '' },
    { id: uid(), date: day(15), type: 'debt', category: 'Student Loans', amount: 180, description: 'Loan payment' },
    { id: uid(), date: day(24), type: 'bill', category: 'Internet', amount: 70, description: '' }
  ];
  // Link the internet payment to its bill row so it shows as paid, not duplicated
  const netRow = state.budgets.bills.find(b => b.category === 'Internet');
  const netTx = state.transactions.find(tx => tx.type === 'bill' && tx.category === 'Internet');
  if (netRow && netTx) { netRow.paid = true; netRow.paidTxId = netTx.id; }
  saveState();
  trackEvent('feature_used', { feature: 'sample_data_loaded' });
  renderDashboard();
  showToast(t('sample_loaded_toast'));
}
function renderDashboard() {
  const layout = state.settings.dashboardLayout || 1;
  ({
    1: renderDashboardLayout1,
    2: renderDashboardLayout2
  }[layout] || renderDashboardLayout1)();
}

function renderDashboardLayout1() {
  const actuals = computeActuals();
  const sum     = computeSummary(actuals);

  const expIncome   = state.budgets.income.reduce((t, r) => t + (r.expected || 0), 0);
  const expExpenses = state.budgets.expenses.reduce((t, r) => t + (r.expected || 0), 0);
  const expBills    = state.budgets.bills.reduce((t, r) => t + (r.expected || 0), 0);
  const expDebt     = state.budgets.debt.reduce((t, r) => t + (r.expected || 0), 0);
  const expSavings  = state.budgets.savings.reduce((t, r) => t + (r.expected || 0), 0);
  const expExpBills = expExpenses + expBills;

  // Income donut
  const incItems = assignSegColors(state.budgets.income
    .map(r => ({ label: r.category, value: actuals.income[r.category] || 0 }))
    .filter(s => s.value > 0)
    .sort((a, b) => b.value - a.value), COLOR_WHEEL);
  const incTotal = incItems.reduce((t, s) => t + s.value, 0);
  const incSegs  = incItems.map(s => ({ ...s, pct: incTotal > 0 ? s.value / incTotal * 100 : 0 }));

  // Spending donut
  const spendItems = assignSegColors([
    ...state.budgets.expenses.map(r  => ({ label: r.category, value: actuals.expenses[r.category] || 0 })),
    ...state.budgets.bills.map(r     => ({ label: r.category, value: actuals.bills[r.category]    || 0 })),
    ...state.budgets.debt.map(r      => ({ label: r.category, value: actuals.debt[r.category]     || 0 }))
  ].filter(s => s.value > 0).sort((a, b) => b.value - a.value), COLOR_WHEEL);
  const spendTotal = spendItems.reduce((t, s) => t + s.value, 0);
  const spendSegs  = spendItems.slice(0, 50).map(s => ({ ...s, pct: spendTotal > 0 ? s.value / spendTotal * 100 : 0 }));

  const leftColor = sum.leftover >= 0 ? '#10b981' : '#f43f5e';

  const flowRows = [
    { label:t('tab_income'),   exp:expIncome,   act:sum.totalIncome,   color:'#10b981', isIncome:true  },
    { label:t('tab_expenses'), exp:expExpenses,  act:sum.totalExpenses, color:'#ec4899', isIncome:false },
    { label:t('tab_bills'),    exp:expBills,     act:sum.totalBills,    color:'#fb923c', isIncome:false },
    { label:t('tab_debt'),     exp:expDebt,      act:sum.totalDebt,     color:'#a855f7', isIncome:false },
    { label:t('tab_savings'),  exp:expSavings,   act:sum.totalSavings,  color:'#3b82f6', isIncome:false }
  ];

  const spendPoints = computeDailySpendPoints();
  const spendLineTotal = spendPoints.reduce((s, p) => s + p.value, 0);

  const el = document.getElementById('bview-dashboard');
  const isCurrentRender = markRenderGen(el);
  el.innerHTML = `
    <div class="section-header">
      <h2 class="section-title">${t('tab_dashboard')}</h2>
      <!-- Period badge is a button → navigates to Settings to change dates -->
      <button class="period-badge period-badge--btn" id="periodBadgeBtn" type="button"
              title="${t('dash_period_title')}">
        ${formatDateDisplay(state.settings.periodStart)} - ${formatDateDisplay(state.settings.periodEnd)}
      </button>
      <button class="help-icon-btn" data-help="dashboard" type="button" aria-label="${t('help_aria')}">?</button>
    </div>

    <div class="summary-cards">
      <div class="scard scard--income">
        <div class="scard-label">${t('dash_stat_income')}</div>
        <div class="scard-value">${fmt(sum.totalIncome)}</div>
        <div class="scard-sub">${tf('dash_stat_of_expected',fmt(expIncome))}</div>
      </div>
      <div class="scard scard--expenses">
        <div class="scard-label">${t('dash_stat_exp_bills')}</div>
        <div class="scard-value">${fmt(sum.totalExpBills)}</div>
        <div class="scard-sub">${tf('dash_stat_of_budgeted',fmt(expExpBills))}</div>
      </div>
      <div class="scard scard--debt">
        <div class="scard-label">${t('dash_stat_debt')}</div>
        <div class="scard-value">${fmt(sum.totalDebt)}</div>
        <div class="scard-sub">${tf('dash_stat_of_budgeted',fmt(expDebt))}</div>
      </div>
      <div class="scard scard--savings">
        <div class="scard-label">${t('dash_stat_savings')}</div>
        <div class="scard-value">${fmt(sum.totalSavings)}</div>
        <div class="scard-sub">${tf('dash_stat_of_goal',fmt(expSavings))}</div>
      </div>
    </div>

    <div class="panel leftover-panel">
      <div class="leftover-inner">
        <div>
          <div class="leftover-label">${t('dash_net_leftover_period')}</div>
          <div class="leftover-value" style="color:${leftColor}">${sum.leftover < 0 ? '−' : ''}${fmt(Math.abs(sum.leftover))}</div>
          ${state.rollover ? `<div class="leftover-rollover">${tf('dash_includes_rollover',fmt(state.rollover))}</div>` : ''}
        </div>
        <div class="leftover-formula">
          <span class="lf-chip lf-income">${fmt(sum.totalIncome)} ${t('dash_lf_income')}</span>
          <span class="lf-sep">−</span>
          <span class="lf-chip lf-expense">${fmt(sum.totalExpBills)} ${t('dash_lf_exp_bills')}</span>
          <span class="lf-sep">−</span>
          <span class="lf-chip lf-debt">${fmt(sum.totalDebt)} ${t('dash_lf_debt')}</span>
          <span class="lf-sep">−</span>
          <span class="lf-chip lf-savings">${fmt(sum.totalSavings)} ${t('dash_lf_savings')}</span>
          ${state.rollover ? `<span class="lf-sep">+</span><span class="lf-chip lf-rollover">${fmt(state.rollover)} ${t('dash_lf_rollover')}</span>` : ''}
        </div>
      </div>
    </div>

    <div class="dashboard-grid">
      <div class="panel cash-flow-panel">
        <div class="panel-inner-sm">
          <div class="panel-titlebar">
            <span class="panel-title-sm">${t('dash_cash_flow')}</span>
            <div class="flow-legend">
              <span class="legend-item"><span class="legend-dot" style="background:rgba(30,27,46,.22)"></span>${t('dash_expected')}</span>
              <span class="legend-item"><span class="legend-dot" style="background:#6366f1"></span>${t('dash_actual')}</span>
            </div>
          </div>
          <div class="flow-table">
            ${flowRows.map(row => {
              const pct  = row.exp > 0 ? (row.act / row.exp * 100) : (row.act > 0 ? 100 : 0);
              const aw   = Math.min(100, pct).toFixed(1);
              const over = !row.isIncome && row.act > row.exp && row.exp > 0;
              return `
                <div class="flow-row">
                  <div class="flow-row-top">
                    <span class="flow-label">${esc(row.label)}</span>
                    <span class="flow-amounts">
                      <span style="color:${over ? '#f43f5e' : row.color}">${fmt(row.act)}</span>
                      <span class="flow-amt--exp"> / ${fmt(row.exp)}</span>
                    </span>
                  </div>
                  <div class="flow-bars">
                    <div class="flow-bar-wrap"><div class="flow-bar" style="width:${aw}%;background:${over ? '#f43f5e' : row.color}"></div></div>
                  </div>
                </div>`;
            }).join('')}
          </div>
        </div>
      </div>

      <div class="charts-col">
        <div class="panel chart-panel">
          <div class="panel-inner-sm">
            <div class="panel-title-sm" style="margin-bottom:14px">${t('dash_income_sources')}</div>
            ${incSegs.length === 0
              ? `<div class="chart-empty">${t('dash_no_income')}<br><button class="link-btn" data-btab="transactions">${t('dash_add_tx_link')}</button></div>`
              : `<div class="donut-block">
                  ${svgDonut(incSegs, 110, 16)}
                  <div class="donut-legend">${incSegs.slice(0,5).map((s,idx) => `
                    <div class="dleg-row" data-idx="${idx}">
                      <span class="dleg-swatch" style="background:${s.color}"></span>
                      <span class="dleg-label">${esc(s.label)}</span>
                      <span class="dleg-pct">${s.pct.toFixed(0)}%</span>
                    </div>`).join('')}</div>
                </div>`}
          </div>
        </div>
        <div class="panel chart-panel">
          <div class="panel-inner-sm">
            <div class="panel-title-sm" style="margin-bottom:14px">${t('dash_spending_breakdown')}</div>
            ${spendSegs.length === 0
              ? `<div class="chart-empty">${t('dash_no_spending')}<br><button class="link-btn" data-btab="transactions">${t('dash_add_tx_link')}</button></div>`
              : `<div class="donut-block">
                  ${svgDonut(spendSegs, 110, 16)}
                  <div class="donut-legend">${spendSegs.slice(0,5).map((s,idx) => `
                    <div class="dleg-row" data-idx="${idx}">
                      <span class="dleg-swatch" style="background:${s.color}"></span>
                      <span class="dleg-label">${esc(s.label)}</span>
                      <span class="dleg-pct">${s.pct.toFixed(0)}%</span>
                    </div>`).join('')}</div>
                </div>`}
          </div>
        </div>
      </div>
    </div>

    <div class="panel spend-line-panel">
      <div class="panel-inner-sm">
        <div class="panel-title-sm" style="margin-bottom:10px">${t('dash_daily_spend')}</div>
        ${spendLineTotal > 0
          ? svgSpendLine(spendPoints, { w: 900, h: 140 }) + `<div class="spend-line-caption"><span class="spend-line-num">${fmt(spendLineTotal)}</span><span class="spend-line-label">${t('dash_daily_spend_caption')}</span></div>`
          : `<div class="chart-empty">${t('dash_no_spending')}</div>`}
      </div>
    </div>
  `;  // end el.innerHTML

  // Period badge → go to settings
  el.querySelector('#periodBadgeBtn')?.addEventListener('click', () => switchBTab('settings'));
  requestAnimationFrame(()=>{
    if (!isCurrentRender()) return;
    initDonuts(el);
    wireChartHover(el, '.spend-line-dot', { format: d =>
      formatSpendTooltipHtml(spendPoints[parseInt(d.idx, 10)] || { label: d.label, value: parseFloat(d.val) || 0, items: [] },
        { typeLabel: spendTypeLabel, typeColor: spendTypeColor, moreText: n => tf('spend_tip_more', n) }) });
    animateDashboardEntrance(el, [
      { el: el.querySelector('.scard--income .scard-value'), target: sum.totalIncome, render: fmt },
      { el: el.querySelector('.scard--expenses .scard-value'), target: sum.totalExpBills, render: fmt },
      { el: el.querySelector('.scard--debt .scard-value'), target: sum.totalDebt, render: fmt },
      { el: el.querySelector('.scard--savings .scard-value'), target: sum.totalSavings, render: fmt },
      { el: el.querySelector('.leftover-value'), target: Math.abs(sum.leftover), render: v => (sum.leftover < 0 ? '−' : '') + fmt(v) }
    ]);
  });
  el.querySelectorAll('[data-btab]').forEach(b => b.addEventListener('click', () => switchBTab(b.dataset.btab)));
  el.querySelector('[data-help]')?.addEventListener('click', e => showHelp(e.currentTarget.dataset.help));

  // Upgrade section - appended AFTER innerHTML; visibility controlled from Settings
  if (!state.settings.hideUpgrade) {
    el.insertAdjacentHTML('beforeend', `
      <div class="upgrade-pro" id="upgradeBanner">
        <button class="upgrade-pro-close" id="upgradeCloseBtn" type="button" aria-label="${t('dismiss_aria')}">×</button>
        <div class="upgrade-pro-head">
          <span class="upgrade-pro-badge">⚡ PRO</span>
          <h3 class="upgrade-pro-title">${t('upgrade_title')}</h3>
        </div>
        <p class="upgrade-pro-sub">${t('upgrade_desc')}</p>
        <div class="upgrade-pro-feats">
          <span class="upgrade-feat">${t('upgrade_feat_debt')}</span>
          <span class="upgrade-feat">${t('upgrade_feat_sinking')}</span>
          <span class="upgrade-feat">${t('upgrade_feat_calendar')}</span>
          <span class="upgrade-feat">${t('upgrade_feat_subs')}</span>
          <span class="upgrade-feat">${t('upgrade_feat_auto')}</span>
          <span class="upgrade-feat">${t('upgrade_feat_alloc')}</span>
        </div>
        <div class="upgrade-pro-actions">
          <button class="btn btn-primary btn-sm upgrade-get" id="upgradeNowBtn" type="button">${t('upgrade_get_now')}</button>
          <button class="btn btn-ghost btn-sm upgrade-compare" id="upgradeCompareBtn" type="button">${t('upgrade_compare')}</button>
        </div>
      </div>`);
    document.getElementById('upgradeNowBtn')?.addEventListener('click', () => { window.location.href = 'ultimate-budget'; });
    document.getElementById('upgradeCompareBtn')?.addEventListener('click', showUpgradeComparison);
    document.getElementById('upgradeCloseBtn')?.addEventListener('click', () => {
      state.settings.hideUpgrade = true;
      saveState();
      document.getElementById('upgradeBanner')?.remove();
    });
  }
}

// ── Layout 2: "Radial Pulse" - KPI-cockpit feel ─────────────────────────
function renderDashboardLayout2() {
  const actuals = computeActuals();
  const sum     = computeSummary(actuals);

  const expIncome   = state.budgets.income.reduce((t, r) => t + (r.expected || 0), 0);
  const expExpenses = state.budgets.expenses.reduce((t, r) => t + (r.expected || 0), 0);
  const expBills    = state.budgets.bills.reduce((t, r) => t + (r.expected || 0), 0);
  const expDebt     = state.budgets.debt.reduce((t, r) => t + (r.expected || 0), 0);
  const expSavings  = state.budgets.savings.reduce((t, r) => t + (r.expected || 0), 0);
  const expExpBills = expExpenses + expBills;

  const incItems = assignSegColors(state.budgets.income
    .map(r => ({ label: r.category, value: actuals.income[r.category] || 0 }))
    .filter(s => s.value > 0).sort((a, b) => b.value - a.value), COLOR_WHEEL);
  const incTotal = incItems.reduce((t, s) => t + s.value, 0);
  const incSegs  = incItems.map(s => ({ ...s, pct: incTotal > 0 ? s.value / incTotal * 100 : 0 }));

  const spendItems = assignSegColors([
    ...state.budgets.expenses.map(r => ({ label: r.category, value: actuals.expenses[r.category] || 0 })),
    ...state.budgets.bills.map(r    => ({ label: r.category, value: actuals.bills[r.category]    || 0 })),
    ...state.budgets.debt.map(r     => ({ label: r.category, value: actuals.debt[r.category]     || 0 }))
  ].filter(s => s.value > 0).sort((a, b) => b.value - a.value), COLOR_WHEEL);
  const spendTotal = spendItems.reduce((t, s) => t + s.value, 0);
  const spendSegs  = spendItems.slice(0, 50).map(s => ({ ...s, pct: spendTotal > 0 ? s.value / spendTotal * 100 : 0 }));

  const leftColor = sum.leftover >= 0 ? '#10b981' : '#f43f5e';
  const gaugePct  = sum.totalIncome > 0 ? Math.max(0, Math.min(100, sum.leftover / sum.totalIncome * 100)) : 0;

  const rings = [
    { label: t('tab_expenses'), value: sum.totalExpenses, expected: expExpenses, color: '#ec4899' },
    { label: t('tab_bills'),    value: sum.totalBills,    expected: expBills,    color: '#fb923c' },
    { label: t('tab_debt'),     value: sum.totalDebt,     expected: expDebt,     color: '#a855f7' },
    { label: t('tab_savings'),  value: sum.totalSavings,  expected: expSavings,  color: '#3b82f6' }
  ];

  const spendPoints = computeDailySpendPoints();
  const spendLineTotal = spendPoints.reduce((s, p) => s + p.value, 0);

  const el = document.getElementById('bview-dashboard');
  const isCurrentRender = markRenderGen(el);
  el.innerHTML = `
    <div class="section-header">
      <h2 class="section-title">${t('tab_dashboard')}</h2>
      <button class="period-badge period-badge--btn" id="periodBadgeBtn" type="button" title="${t('dash_period_title')}">
        ${formatDateDisplay(state.settings.periodStart)} - ${formatDateDisplay(state.settings.periodEnd)}
      </button>
      <button class="help-icon-btn" data-help="dashboard" type="button" aria-label="${t('help_aria')}">?</button>
    </div>

    <div class="ist-row">
      ${iconStatTile('💰', t('dash_stat_income'), fmt(sum.totalIncome), tf('dash_stat_of_expected', fmt(expIncome)), '#10b981')}
      ${iconStatTile('🧾', t('dash_stat_exp_bills'), fmt(sum.totalExpBills), tf('dash_stat_of_budgeted', fmt(expExpBills)), '#f43f5e')}
      ${iconStatTile('💳', t('dash_stat_debt'), fmt(sum.totalDebt), tf('dash_stat_of_budgeted', fmt(expDebt)), '#a855f7')}
      ${iconStatTile('🏦', t('dash_stat_savings'), fmt(sum.totalSavings), tf('dash_stat_of_goal', fmt(expSavings)), '#3b82f6')}
    </div>

    <div class="panel leftover-hero-panel" data-chart-scope>
      <div class="panel-inner-sm">
        <div class="panel-title-sm" style="margin-bottom:10px">${t('dash_net_leftover_period')}</div>
        <div class="leftover-hero-inner">
        <div class="leftover-hero-left">
          <div class="leftover-gauge-wrap">${svgSemiGauge(gaugePct, 170, leftColor)}<div class="leftover-gauge-caption">${t('dash_income_kept')}</div></div>
          <div class="leftover-hero-text">
            <div class="leftover-value" style="color:${leftColor};font-size:26px">${sum.leftover < 0 ? '−' : ''}${fmt(Math.abs(sum.leftover))}</div>
            ${state.rollover ? `<div class="leftover-rollover">${tf('dash_includes_rollover', fmt(state.rollover))}</div>` : ''}
          </div>
        </div>
        <div class="leftover-formula leftover-hero-formula">
          <span class="lf-chip lf-income">${fmt(sum.totalIncome)} ${t('dash_lf_income')}</span>
          <span class="lf-sep">−</span>
          <span class="lf-chip lf-expense">${fmt(sum.totalExpBills)} ${t('dash_lf_exp_bills')}</span>
          <span class="lf-sep">−</span>
          <span class="lf-chip lf-debt">${fmt(sum.totalDebt)} ${t('dash_lf_debt')}</span>
          <span class="lf-sep">−</span>
          <span class="lf-chip lf-savings">${fmt(sum.totalSavings)} ${t('dash_lf_savings')}</span>
        </div>
        </div>
      </div>
    </div>

    <div class="dashboard-grid">
      <div class="panel cash-flow-hero-panel" data-chart-scope>
        <div class="panel-inner-sm">
          <div class="panel-title-sm" style="margin-bottom:10px">${t('dash_cash_flow')}</div>
          <div class="radial-bars-block">
            ${svgRadialBars(rings, 230)}
            <div class="donut-legend">${rings.map((r, idx) => {
              const over = r.expected > 0 && r.value > r.expected;
              return `
              <div class="dleg-row dleg-row--stacked" data-idx="${idx}">
                <span class="dleg-swatch" style="background:${over ? '#f43f5e' : r.color}"></span>
                <div class="dleg-stack">
                <span class="dleg-label">${esc(r.label)}</span>
                <span class="dleg-pct">
                  <span style="color:${over ? '#f43f5e' : r.color}">${fmt(r.value)}</span>
                  <span class="flow-amt--exp"> / ${fmt(r.expected)}</span>
                </span>
                </div>
              </div>`;}).join('')}</div>
          </div>
        </div>
      </div>

      <div class="charts-col pulse-charts-col">
        <div class="panel chart-panel" data-chart-scope>
          <div class="panel-inner-sm">
            <div class="panel-title-sm" style="margin-bottom:14px">${t('dash_income_sources')}</div>
            ${incSegs.length === 0
              ? `<div class="chart-empty">${t('dash_no_income')}<br><button class="link-btn" data-btab="transactions">${t('dash_add_tx_link')}</button></div>`
              : pieChartHtml(incSegs, { limit: 5, otherLabel: t('dash_other_category') })}
          </div>
        </div>
        <div class="panel chart-panel" data-chart-scope>
          <div class="panel-inner-sm">
            <div class="panel-title-sm" style="margin-bottom:14px">${t('dash_spending_breakdown')}</div>
            ${spendSegs.length === 0
              ? `<div class="chart-empty">${t('dash_no_spending')}<br><button class="link-btn" data-btab="transactions">${t('dash_add_tx_link')}</button></div>`
              : pieChartHtml(spendSegs, { limit: 5, otherLabel: t('dash_other_category') })}
          </div>
        </div>
      </div>
    </div>

    <div class="panel spend-line-panel" data-chart-scope>
      <div class="panel-inner-sm">
        <div class="panel-title-sm" style="margin-bottom:10px">${t('dash_daily_spend')}</div>
        ${spendLineTotal > 0
          ? svgSpendLine(spendPoints, { w: 900, h: 140 }) + `<div class="spend-line-caption"><span class="spend-line-num">${fmt(spendLineTotal)}</span><span class="spend-line-label">${t('dash_daily_spend_caption')}</span></div>`
          : `<div class="chart-empty">${t('dash_no_spending')}</div>`}
      </div>
    </div>
  `;

  el.querySelector('#periodBadgeBtn')?.addEventListener('click', () => switchBTab('settings'));
  requestAnimationFrame(() => {
    if (!isCurrentRender()) return;
    el.querySelectorAll('[data-chart-scope]').forEach(scope => {
      wireChartHover(scope, '.rbar-seg', { legendScope: scope, swapText: true, swapFormat: d => `${d.pct}%`, format: d =>
        `<strong>${esc(d.label)}</strong><br>` +
        `<span style="color:var(--text-faint)">${esc(t('dash_expected'))}: ${esc(fmt(parseFloat(d.expected) || 0))}</span><br>` +
        `<span style="color:${d.color || 'var(--text-primary)'};font-weight:800">${esc(t('dash_actual'))}: ${esc(fmt(parseFloat(d.val) || 0))}</span>` });
      wireChartHover(scope, '.pie-seg', { legendScope: scope, swapText: false, highlightClass: 'is-exploded', format: d =>
        `<strong>${esc(d.label)}</strong><br>${esc(fmt(parseFloat(d.val) || 0))} · ${parseFloat(d.pct || 0).toFixed(0)}%` });
      wireChartHover(scope, '.spend-line-dot', { format: d =>
        formatSpendTooltipHtml(spendPoints[parseInt(d.idx, 10)] || { label: d.label, value: parseFloat(d.val) || 0, items: [] },
          { typeLabel: spendTypeLabel, typeColor: spendTypeColor, moreText: n => tf('spend_tip_more', n) }) });
    });
    const istVals = el.querySelectorAll('.ist-row .ist-value');
    animateDashboardEntrance(el, [
      { el: istVals[0], target: sum.totalIncome, render: fmt },
      { el: istVals[1], target: sum.totalExpBills, render: fmt },
      { el: istVals[2], target: sum.totalDebt, render: fmt },
      { el: istVals[3], target: sum.totalSavings, render: fmt },
      { el: el.querySelector('.leftover-value'), target: Math.abs(sum.leftover), render: v => (sum.leftover < 0 ? '−' : '') + fmt(v) }
    ]);
  });
  el.querySelectorAll('[data-btab]').forEach(b => b.addEventListener('click', () => switchBTab(b.dataset.btab)));
  el.querySelector('[data-help]')?.addEventListener('click', e => showHelp(e.currentTarget.dataset.help));
}

// ── Budget Modules ─────────────────────────────────────────────────────
const MODULE_META = {
  income:   { icon:'💰', titleKey:'tab_income',   hasDates:false, descKey:'mod_desc_income' },
  expenses: { icon:'🛒', titleKey:'tab_expenses', hasDates:false, descKey:'mod_desc_expenses' },
  bills:    { icon:'🧾', titleKey:'tab_bills',    hasDates:true,  descKey:'mod_desc_bills' },
  debt:     { icon:'💳', titleKey:'tab_debt',     hasDates:true,  descKey:'mod_desc_debt' },
  savings:  { icon:'🏦', titleKey:'tab_savings',  hasDates:false, descKey:'mod_desc_savings' }
};

const TX_TYPE_FOR_MODULE = { income:'income', expenses:'expense', bills:'bill', debt:'debt', savings:'savings' };

// Marking a bill or debt row paid logs the actual amount as a real transaction
// rather than just flipping a status flag - the flag alone would leave "paid"
// disconnected from what was actually spent (both bills and debt payments
// commonly differ from the budgeted/minimum figure).
function promptMarkModulePaid(type, rowId, onDone) {
  const row = (state.budgets[type] || []).find(r => r.id === rowId);
  if (!row) return;
  document.getElementById('modalTitle').textContent = `${t('mod_mark_paid')} - ${esc(row.category)}`;
  document.getElementById('modalBody').innerHTML = `
    <div class="field"><label class="field-label field-label--tip">${tipLabel(t('mod_paid_amount_label'), 'mod_paid_amount_hint', true)}</label>
      <input class="input" type="number" id="modPaidAmt" min="0" step="0.01" placeholder="0.00" autocomplete="off">
      ${row.expected ? `<p class="field-hint">${tf('mod_paid_budgeted_hint', fmt(row.expected))}</p>` : ''}
    </div>
    <div class="tx-error" id="modPaidErr" hidden></div>
    <div class="edit-tx-actions">
      <button class="btn btn-primary" id="modPaidSaveBtn" type="button">${t('mod_paid_save_btn')}</button>
      <button class="btn btn-ghost btn-sm" id="modPaidCancelBtn" type="button">${t('cancel')}</button>
    </div>`;
  document.getElementById('tutorialOverlay').hidden = false;
  initFieldTips(document.getElementById('modalBody'));
  setTimeout(() => document.getElementById('modPaidAmt')?.focus(), 50);
  const amtEl = document.getElementById('modPaidAmt');
  amtEl?.addEventListener('input', () => { amtEl.classList.remove('fk-invalid'); const e = document.getElementById('modPaidErr'); if (e) e.hidden = true; });
  document.getElementById('modPaidSaveBtn')?.addEventListener('click', () => {
    const amt = parseFloat(amtEl?.value);
    if (!(amt > 0)) {
      amtEl?.classList.add('fk-invalid');
      const e = document.getElementById('modPaidErr'); if (e) { e.textContent = t('mod_paid_amount_required'); e.hidden = false; }
      return;
    }
    const tx = { id: uid(), date: today(), type: TX_TYPE_FOR_MODULE[type], category: row.category, amount: amt, description: '' };
    state.transactions.push(tx);
    row.paid = true; row.paidTxId = tx.id;
    saveState();
    document.getElementById('tutorialOverlay').hidden = true;
    onDone();
    showToast(t('toast_mod_paid'));
  });
  document.getElementById('modPaidCancelBtn')?.addEventListener('click', () => { document.getElementById('tutorialOverlay').hidden = true; });
}
function unmarkModulePaid(type, rowId, onDone) {
  const row = (state.budgets[type] || []).find(r => r.id === rowId);
  if (!row) return;
  if (row.paidTxId) state.transactions = state.transactions.filter(tx => tx.id !== row.paidTxId);
  row.paid = false; row.paidTxId = null;
  saveState();
  onDone();
}
// Keeps bill/debt "paid" status honest whenever a transaction is removed through
// any of the delete paths (single delete, edit-modal delete, clear all) - a row
// linked to a since-deleted transaction can't stay marked paid.
function syncModulePaidLinks() {
  const liveIds = new Set(state.transactions.map(tx => tx.id));
  let changed = false;
  ['bills', 'debt'].forEach(type => {
    (state.budgets[type] || []).forEach(row => {
      if (row.paid && row.paidTxId && !liveIds.has(row.paidTxId)) { row.paid = false; row.paidTxId = null; changed = true; }
    });
  });
  return changed;
}

function renderModule(type) {
  const meta    = MODULE_META[type];
  const rows    = state.budgets[type];
  const actuals = computeActuals()[type];
  const isInc   = type === 'income';

  const totalExp = rows.reduce((t, r) => t + (r.expected || 0), 0);
  const totalAct = rows.reduce((t, r) => t + (actuals[r.category] || 0), 0);
  const totalP   = pct(totalAct, totalExp);
  const totalOvr = !isInc && totalAct > totalExp && totalExp > 0;

  document.getElementById(`bview-${type}`).innerHTML = `
    <div class="section-header">
      <h2 class="section-title">${meta.icon} ${t(meta.titleKey)}</h2>
      <div class="section-header-actions">
        <button class="help-icon-btn" data-help="${type}" type="button" aria-label="${t('help_aria')}">?</button>
        <button class="btn btn-ghost btn-sm" id="addRowBtn" type="button">${t('mod_add_category')}</button>
      </div>
    </div>
    <p class="section-desc">${t(meta.descKey)}</p>

    <div class="panel">
      <div class="module-table-wrap">
        <table class="module-table">
          <thead>
            <tr>
              <th>${t('category')}</th>
              <th><span class="cc-label-text">${t('expected')} (${SYM})</span><button class="cc-info" type="button" data-tip="${esc(t('mod_th_expected_hint'))}" aria-label="${tf('field_info_aria',t('expected'))}">i</button></th>
              ${meta.hasDates ? `<th>${t('due_date')}</th>` : ''}
              <th><span class="cc-label-text">${t('actual')} (${SYM})</span><button class="cc-info" type="button" data-tip="${esc(t('mod_th_actual_hint'))}" aria-label="${tf('field_info_aria',t('actual'))}">i</button></th>
              <th class="prog-cell"><span class="cc-label-text">${t('progress')}</span><button class="cc-info" type="button" data-tip="${esc(t('mod_th_progress_hint'))}" aria-label="${tf('field_info_aria',t('progress'))}">i</button></th>
              ${meta.hasDates ? `<th>${t('paid')}</th>` : ''}
              <th></th>
            </tr>
          </thead>
          <tbody>
            ${rows.map(row => {
              const act = actuals[row.category] || 0;
              const p   = pct(act, row.expected);
              const ovr = !isInc && p > 100;
              return `
                <tr class="module-row">
                  <td class="cat-cell"><span class="cat-name">${esc(row.category)}</span></td>
                  <td><input class="expected-input" type="number" min="0" step="0.01"
                             value="${row.expected || ''}" placeholder="0.00" data-id="${row.id}"></td>
                  ${meta.hasDates ? `<td>
                    <div class="date-cell-styled" id="dwrap-${row.id}" data-input-id="dinp-${row.id}">
                      <span class="date-cell-val" id="dcell-${row.id}">${row.dueDate ? formatDateDisplay(row.dueDate) : `<span class="no-date">${t('mod_set_date')}</span>`}</span>
                      <input type="date" id="dinp-${row.id}" class="date-input" value="${row.dueDate || ''}" data-id="${row.id}">
                    </div>
                  </td>` : ''}
                  <td class="act-cell">
                    <span class="actual-val${ovr ? ' is-over' : isInc && p >= 100 ? ' is-good' : ''}">${fmt(act)}</span>
                  </td>
                  <td class="prog-cell">
                    <div class="prog-bar-wrap">
                      <div class="prog-bar${isInc ? ' prog-bar--income' : ovr ? ' prog-bar--over' : ' prog-bar--normal'}"
                           style="width:${Math.min(p, 100)}%"></div>
                    </div>
                    <span class="prog-label${ovr ? ' is-over' : ''}">${p}%</span>
                  </td>
                  ${meta.hasDates ? `
                  <td class="paid-cell">
                    <label class="check-label" aria-label="${t('mod_mark_paid')}">
                      <input type="checkbox" class="paid-cb" ${row.paid ? 'checked' : ''} data-id="${row.id}">
                      <span class="checkmark"></span>
                    </label>
                  </td>` : ''}
                  <td class="action-cell">
                    <button class="del-btn" data-id="${row.id}" type="button" title="${t('mod_remove')}" aria-label="${t('mod_remove')}">×</button>
                  </td>
                </tr>`;
            }).join('')}
          </tbody>
          <tfoot>
            <tr class="total-row">
              <td><strong>${t('mod_total')}</strong></td>
              <td><strong>${fmt(totalExp)}</strong></td>
              ${meta.hasDates ? '<td></td>' : ''}
              <td><strong>${fmt(totalAct)}</strong></td>
              <td class="prog-cell">
                <div class="prog-bar-wrap">
                  <div class="prog-bar${isInc ? ' prog-bar--income' : totalOvr ? ' prog-bar--over' : ' prog-bar--normal'}"
                       style="width:${Math.min(totalP, 100)}%"></div>
                </div>
                <span class="prog-label${totalOvr ? ' is-over' : ''}">${totalP}%</span>
              </td>
              ${meta.hasDates ? '<td></td>' : ''}
              <td></td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>

    <div class="panel add-cat-card" id="addCatCard" style="display:none">
      <div class="panel-inner-sm">
        <div class="add-cat-title">${t('mod_add_new_category')}</div>
        <div class="add-cat-row">
          <div class="field"><label class="field-label field-label--tip">${tipLabel(t('mod_cat_name_label'),'mod_name_hint',false)}</label>
            <input class="input input-sm" type="text" id="newCatName" placeholder="e.g. Freelance"></div>
          ${meta.hasDates ? `<div class="field"><label class="field-label field-label--tip">${tipLabel(t('due_date'),'mod_due_date_hint',false)}</label>
            <input class="input input-sm" type="date" id="newCatDate"></div>` : ''}
          <div class="add-cat-btns">
            <button class="btn btn-primary btn-sm" id="saveCatBtn" type="button">${t('add')}</button>
            <button class="btn btn-ghost btn-sm"   id="cancelCatBtn" type="button">${t('cancel')}</button>
          </div>
        </div>
      </div>
    </div>
  `;

  const el = document.getElementById(`bview-${type}`);

  // Expected inputs - LIVE progress update on every keystroke
  el.querySelectorAll('.expected-input').forEach(inp => {
    inp.addEventListener('input', () => {
      const liveExp   = parseFloat(inp.value) || 0;
      const rowId     = inp.dataset.id;
      const rowObj    = state.budgets[type].find(r => r.id === rowId);
      if (!rowObj) return;

      const typeActs  = computeActuals()[type];
      const rowAct    = typeActs[rowObj.category] || 0;
      const p         = pct(rowAct, liveExp);
      const over      = !isInc && p > 100;

      // Update this row's bar + label
      const tr = inp.closest('tr');
      if (tr) {
        const bar = tr.querySelector('.prog-bar');
        const lbl = tr.querySelector('.prog-label');
        if (bar) { bar.className = `prog-bar${isInc ? ' prog-bar--income' : over ? ' prog-bar--over' : ' prog-bar--normal'}`; bar.style.width = `${Math.min(p, 100)}%`; }
        if (lbl) { lbl.className = `prog-label${over ? ' is-over' : ''}`; lbl.textContent = `${p}%`; }
      }

      // Update total row - use live value for this row, saved values for others
      const totExp = state.budgets[type].reduce((s, r) => s + (r.id === rowId ? liveExp : (r.expected || 0)), 0);
      const totAct = state.budgets[type].reduce((s, r) => s + (typeActs[r.category] || 0), 0);
      const totP   = pct(totAct, totExp);
      const totOvr = !isInc && totAct > totExp && totExp > 0;
      const totRow = el.querySelector('tfoot .total-row');
      if (totRow) {
        const tds = totRow.querySelectorAll('td');
        if (tds[1]) tds[1].innerHTML = `<strong>${fmt(totExp)}</strong>`;
        const totBar = totRow.querySelector('.prog-bar');
        const totLbl = totRow.querySelector('.prog-label');
        if (totBar) { totBar.className = `prog-bar${isInc ? ' prog-bar--income' : totOvr ? ' prog-bar--over' : ' prog-bar--normal'}`; totBar.style.width = `${Math.min(totP, 100)}%`; }
        if (totLbl) { totLbl.className = `prog-label${totOvr ? ' is-over' : ''}`; totLbl.textContent = `${totP}%`; }
      }
    });

    // Save to state when user leaves the field
    inp.addEventListener('change', () => {
      const row = state.budgets[type].find(r => r.id === inp.dataset.id);
      if (row) { row.expected = parseFloat(inp.value) || 0; saveState(); }
    });
  });

  // Due date inputs - save state and refresh formatted display
  el.querySelectorAll('.date-input').forEach(inp => {
    inp.addEventListener('change', () => {
      const row = state.budgets[type].find(r => r.id === inp.dataset.id);
      if (row) { row.dueDate = inp.value; saveState(); }
      const dispEl = document.getElementById(`dcell-${inp.dataset.id}`);
      if (dispEl) dispEl.innerHTML = inp.value
        ? formatDateDisplay(inp.value)
        : `<span class="no-date">${t('mod_set_date')}</span>`;
    });
  });

  // Click on styled date cells opens the native picker
  el.querySelectorAll('.date-cell-styled').forEach(wrap => {
    wrap.addEventListener('click', () => {
      const inp = document.getElementById(wrap.dataset.inputId);
      openDatePicker(inp, wrap);
    });
    document.getElementById(wrap.dataset.inputId)?.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown') {
        e.preventDefault();
        openDatePicker(document.getElementById(wrap.dataset.inputId), wrap);
      }
    });
  });

  // Paid checkboxes
  el.querySelectorAll('.paid-cb').forEach(cb => {
    cb.addEventListener('change', () => {
      if (cb.checked) { cb.checked = false; promptMarkModulePaid(type, cb.dataset.id, () => renderModule(type)); }
      else { unmarkModulePaid(type, cb.dataset.id, () => renderModule(type)); }
    });
  });

  // Delete row
  el.querySelectorAll('.del-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const row = state.budgets[type].find(r => r.id === btn.dataset.id);
      const txCount = row ? state.transactions.filter(tx => tx.type === TX_TYPE_FOR_MODULE[type] && tx.category === row.category).length : 0;
      const message = txCount > 0 ? tf('confirm_remove_cat_with_tx', txCount) : t('confirm_remove_cat');
      if (!await confirmDialog({ message, confirmText: t('delete') })) return;
      state.budgets[type] = state.budgets[type].filter(r => r.id !== btn.dataset.id);
      saveState(); renderModule(type);
    });
  });

  // Add category
  el.querySelector('#addRowBtn').addEventListener('click', () => {
    if (trialBlocks(type)) { showUpgradeModal({ reason: 'category', type }); return; }
    el.querySelector('#addCatCard').style.display = '';
    el.querySelector('#newCatName')?.focus();
  });
  el.querySelector('#saveCatBtn').addEventListener('click', () => {
    if (trialBlocks(type)) { showUpgradeModal({ reason: 'category', type }); return; }
    const name = el.querySelector('#newCatName')?.value.trim();
    if (!name) { el.querySelector('#newCatName')?.focus(); return; }
    const newRow = { id: uid(), category: name, expected: 0 };
    if (meta.hasDates) { newRow.dueDate = el.querySelector('#newCatDate')?.value || ''; newRow.paid = false; }
    state.budgets[type].push(newRow);
    saveState(); renderModule(type);
  });
  el.querySelector('#cancelCatBtn').addEventListener('click', () => {
    el.querySelector('#addCatCard').style.display = 'none';
    const n = el.querySelector('#newCatName'); if (n) n.value = '';
  });

  el.querySelector('[data-help]')?.addEventListener('click', e => showHelp(e.currentTarget.dataset.help));
  initFieldTips(el);
}

// ── Transactions ──────────────────────────────────────────────────────
function getCats(txType) {
  const MAP = { income:'income', expense:'expenses', bill:'bills', debt:'debt', savings:'savings' };
  const key = MAP[txType];
  return key ? state.budgets[key].map(r => r.category) : [];
}

function txTypeLabel(type){return{income:t('tx_type_income'),expense:t('tx_type_expense'),bill:t('tx_type_bill'),savings:t('tx_type_savings'),debt:t('tx_type_debt')}[type]||type;}
function renderTxList(){
  const el=document.getElementById('txListWrap');
  if(!el)return;
  let filtered=[...state.transactions];
  if(txFilter.search){const q=txFilter.search.toLowerCase();filtered=filtered.filter(tx=>(tx.category||'').toLowerCase().includes(q)||(tx.description||'').toLowerCase().includes(q));}
  if(txFilter.type)filtered=filtered.filter(tx=>tx.type===txFilter.type);
  switch(txFilter.sort){
    case'date_asc':filtered.sort((a,b)=>a.date.localeCompare(b.date));break;
    case'amount_desc':filtered.sort((a,b)=>b.amount-a.amount);break;
    case'amount_asc':filtered.sort((a,b)=>a.amount-b.amount);break;
    default:filtered.sort((a,b)=>b.date.localeCompare(a.date));
  }
  const total=state.transactions.length,count=filtered.length;
  const totalPages=Math.max(1,Math.ceil(count/TX_PAGE_SIZE));
  if(txPage>=totalPages)txPage=totalPages-1;
  const page=txPage;
  const paged=filtered.slice(page*TX_PAGE_SIZE,(page+1)*TX_PAGE_SIZE);
  const isFiltered=txFilter.search||txFilter.type;
  const countLabel=isFiltered?t('tx_showing').replace('{n}',count).replace('{total}',total):`${total} ${total===1?t('tx_transaction_one'):t('tx_transaction_many')}`;
  const pagination=count>TX_PAGE_SIZE?`<div class="tx-pagination"><button class="btn btn-ghost btn-sm" id="txPrevBtn" ${page===0?'disabled':''}>${t('tx_prev')}</button><span class="tx-page-label">${t('tx_page_of').replace('{n}',page+1).replace('{total}',totalPages)}</span><button class="btn btn-ghost btn-sm" id="txNextBtn" ${page>=totalPages-1?'disabled':''}>${t('tx_next')}</button></div>`:'';
  el.innerHTML=`<div class="tx-list-header"><span>${countLabel}</span>${total>0?`<button class="link-btn" id="clearAllBtn2" type="button">${t('tx_clear_all')}</button>`:''}</div>
    ${count===0&&total===0
      ?`<div class="empty-state"><div class="empty-icon">\uD83D\uDCCB</div><p>${t('tx_empty')}</p><p class="empty-sub">${t('tx_empty_sub')}</p></div>`
      :count===0
      ?`<div class="empty-state"><div class="empty-icon">\uD83D\uDD0D</div><p>${t('tx_no_results')}</p></div>`
      :`<div class="panel"><div class="tx-table-wrap"><table class="tx-table"><thead><tr>
          <th>${t('tx_date')}</th><th>${t('tx_type')}</th><th>${t('tx_category')}</th>
          <th>${t('tx_th_amount')}</th><th>${t('tx_th_desc')}</th><th></th>
        </tr></thead><tbody>
        ${paged.map(tx=>`<tr class="tx-row">
          <td class="tx-date">${formatDateDisplay(tx.date)}</td>
          <td><span class="tx-pill tx-pill--${tx.type}">${esc(txTypeLabel(tx.type))}</span></td>
          <td class="tx-cat">${esc(tx.category)}</td>
          <td class="tx-amt tx-amt--${tx.type}">${tx.type==='income'?'+':'\u2212'}${fmt(tx.amount)}</td>
          <td class="tx-desc">${esc(tx.description||'-')}</td>
          <td><div class="tx-actions"><button class="edit-btn" data-tx="${tx.id}" type="button" title="${t('edit')}" aria-label="${t('edit')}">\u270f\ufe0f</button><button class="del-btn" data-tx="${tx.id}" type="button" title="${t('delete')}" aria-label="${t('delete')}">\xd7</button></div></td>
        </tr>`).join('')}</tbody></table></div></div>${pagination}`}`;
  el.querySelectorAll('.edit-btn[data-tx]').forEach(b=>b.addEventListener('click',()=>openEditTx(b.dataset.tx)));
  el.querySelectorAll('.del-btn[data-tx]').forEach(b=>b.addEventListener('click',()=>{state.transactions=state.transactions.filter(t=>t.id!==b.dataset.tx);syncModulePaidLinks();saveState();renderTxList();}));
  document.getElementById('clearAllBtn2')?.addEventListener('click',async()=>{if(await confirmDialog({message:t('confirm_delete_all_tx'),confirmText:t('delete')})){state.transactions=[];syncModulePaidLinks();saveState();renderTxList();}});
  document.getElementById('txPrevBtn')?.addEventListener('click',()=>{if(txPage>0){txPage--;renderTxList();}});
  document.getElementById('txNextBtn')?.addEventListener('click',()=>{if(txPage<totalPages-1){txPage++;renderTxList();}});
}
function renderTransactions() {
  const el=document.getElementById('bview-transactions');
  el.innerHTML=`<div class="section-header"><h2 class="section-title">\uD83D\uDCCB ${t('tab_transactions')}</h2>
      <div class="section-header-actions">
        <button class="help-icon-btn" data-help="transactions" type="button" aria-label="${t('help_aria')}">?</button>
        <label class="btn btn-ghost btn-sm csv-label" title="${t('tx_import_csv')}">${t('tx_import_csv')}<input type="file" id="csvInput" accept=".csv" style="display:none"></label>
      </div></div>
    <div class="panel tx-form-panel"><div class="panel-inner-sm">
      <div class="panel-title-sm" style="margin-bottom:14px">${t('tx_add_title')}</div>
      <div class="tx-form-row">
        <div class="field"><label class="field-label field-label--tip">${tipLabel(t('tx_date'),'tx_date_hint',false)}</label>
          <div class="date-field-styled" id="txDateWrap">
            <svg class="date-cal-icon" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>
            <span class="date-field-val" id="txDateDisp">${formatDateDisplay(today())}</span>
            <input type="date" id="txDate" value="${today()}">
          </div></div>
        <div class="field"><label class="field-label field-label--tip">${tipLabel(t('tx_type'),'tx_type_hint',false)}</label>
          <select class="select" id="txType">
            <option value="expense" selected>${t('tx_type_expense')}</option>
            <option value="bill">${t('tx_type_bill')}</option>
            <option value="savings">${t('tx_type_savings')}</option>
            <option value="debt">${t('tx_type_debt')}</option>
            <option value="income">${t('tx_type_income')}</option>
          </select></div>
        <div class="field"><label class="field-label field-label--tip">${tipLabel(t('tx_category'),'tx_category_hint',false)}</label><select class="select" id="txCategory"></select></div>
        <div class="field"><label class="field-label field-label--tip">${tipLabel(`${t('tx_amount')} (${SYM})`,'tx_amount_hint',false)}</label>
          <input class="input" type="number" id="txAmount" min="0" step="0.01" placeholder="0.00"></div>
        <div class="field field-grow"><label class="field-label field-label--tip">${tipLabel(t('tx_desc_label'),'tx_desc_hint',false)}</label>
          <input class="input" type="text" id="txDesc" placeholder="${t('tx_desc_ph')}" maxlength="120"></div>
        <div class="field field-btn"><label class="field-label" style="visibility:hidden">.</label>
          <button class="btn btn-primary" id="addTxBtn" type="button">${t('tx_add_btn')}</button></div>
      </div>
      <div class="tx-error" id="txError" hidden></div>
    </div></div>
    <div class="tx-filter-bar tx-filter-bar--3col">
      <input class="input input-sm" type="text" id="txSearch" placeholder="${t('tx_search_ph')}" value="${esc(txFilter.search)}">
      <select class="select select-sm" id="txTypeFilter">
        <option value="">${t('tx_filter_all_types')}</option>
        <option value="income"${txFilter.type==='income'?' selected':''}>${t('tx_type_income')}</option>
        <option value="expense"${txFilter.type==='expense'?' selected':''}>${t('tx_type_expense')}</option>
        <option value="bill"${txFilter.type==='bill'?' selected':''}>${t('tx_type_bill')}</option>
        <option value="debt"${txFilter.type==='debt'?' selected':''}>${t('tx_type_debt')}</option>
        <option value="savings"${txFilter.type==='savings'?' selected':''}>${t('tx_type_savings')}</option>
      </select>
      <select class="select select-sm" id="txSort">
        <option value="date_desc"${txFilter.sort==='date_desc'?' selected':''}>${t('tx_sort_date_new')}</option>
        <option value="date_asc"${txFilter.sort==='date_asc'?' selected':''}>${t('tx_sort_date_old')}</option>
        <option value="amount_desc"${txFilter.sort==='amount_desc'?' selected':''}>${t('tx_sort_amt_high')}</option>
        <option value="amount_asc"${txFilter.sort==='amount_asc'?' selected':''}>${t('tx_sort_amt_low')}</option>
      </select>
    </div>
    <div id="txListWrap"></div>`;
  renderTxList();
  populateTxCats();
  document.getElementById('txDateWrap')?.addEventListener('click',()=>{openDatePicker(document.getElementById('txDate'),document.getElementById('txDateWrap'));});
  document.getElementById('txDate')?.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '||e.key==='ArrowDown'){e.preventDefault();openDatePicker(document.getElementById('txDate'),document.getElementById('txDateWrap'));}});
  document.getElementById('txDate')?.addEventListener('change',e=>{document.getElementById('txDateDisp').textContent=formatDateDisplay(e.target.value);});
  document.getElementById('txType')?.addEventListener('change',populateTxCats);
  document.getElementById('addTxBtn')?.addEventListener('click',addTransaction);
  document.getElementById('csvInput')?.addEventListener('change',handleCSV);
  el.querySelector('[data-help]')?.addEventListener('click',e=>showHelp(e.currentTarget.dataset.help));
  initFieldTips(el);
  document.getElementById('txSearch')?.addEventListener('input',e=>{txFilter.search=e.target.value;txPage=0;renderTxList();});
  document.getElementById('txTypeFilter')?.addEventListener('change',e=>{txFilter.type=e.target.value;txPage=0;renderTxList();});
  document.getElementById('txSort')?.addEventListener('change',e=>{txFilter.sort=e.target.value;txPage=0;renderTxList();});
}
function populateTxCats() {
  const type = document.getElementById('txType')?.value;
  const cats = getCats(type);
  const sel  = document.getElementById('txCategory');
  if (!sel) return;
  sel.innerHTML = cats.length > 0
    ? cats.map(c => `<option value="${esc(c)}">${esc(c)}</option>`).join('')
    : `<option value="">${t('no_cat_setup')}</option>`;
}

function addTransaction() {
  if (trialBlocks('transaction')) { showUpgradeModal({ reason: 'transaction' }); return; }
  const date   = document.getElementById('txDate')?.value;
  const type   = document.getElementById('txType')?.value;
  const cat    = document.getElementById('txCategory')?.value;
  const amount = parseFloat(document.getElementById('txAmount')?.value);
  const desc   = document.getElementById('txDesc')?.value?.trim() || '';
  const errEl  = document.getElementById('txError');
  if (!date || !type || !cat || isNaN(amount) || amount <= 0) {
    if (errEl) { errEl.textContent = t('tx_error_required'); errEl.hidden = false; }
    return;
  }
  if (errEl) errEl.hidden = true;
  state.transactions.push({ id: uid(), date, type, category: cat, amount, description: desc });
  saveState();
  document.getElementById('txAmount').value = '';
  document.getElementById('txDesc').value   = '';
  renderTxList();
  showToast(t('toast_tx_added'));
}

// ── Edit transaction modal ─────────────────────────────────────────────
function openEditTx(txId) {
  const tx = state.transactions.find(t => t.id === txId);
  if (!tx) return;

  document.getElementById('modalTitle').textContent = t('edit_tx_title');
  document.getElementById('modalBody').innerHTML = `
    <div class="field">
      <label class="field-label">${t('tx_date')}</label>
      <div class="date-field-styled" id="editDateWrap">
        <svg class="date-cal-icon" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>
        <span class="date-field-val" id="editDateDisp">${formatDateDisplay(tx.date)}</span>
        <input type="date" id="editDate" value="${tx.date}">
      </div>
    </div>
    <div class="field"><label class="field-label">${t('tx_type')}</label>
      <select class="select" id="editType">
        <option value="expense" ${tx.type==='expense' ?'selected':''}>${t('tx_type_expense')}</option>
        <option value="bill"    ${tx.type==='bill'    ?'selected':''}>${t('tx_type_bill')}</option>
        <option value="savings" ${tx.type==='savings' ?'selected':''}>${t('tx_type_savings')}</option>
        <option value="debt"    ${tx.type==='debt'    ?'selected':''}>${t('tx_type_debt')}</option>
        <option value="income"  ${tx.type==='income'  ?'selected':''}>${t('tx_type_income')}</option>
      </select></div>
    <div class="field"><label class="field-label">${t('tx_category')}</label>
      <select class="select" id="editCategory"></select></div>
    <div class="field"><label class="field-label">${t('tx_amount')} (${SYM})</label>
      <input class="input" type="number" id="editAmount" min="0" step="0.01" value="${tx.amount}"></div>
    <div class="field"><label class="field-label">${t('tx_desc_label')}</label>
      <input class="input" type="text" id="editDesc" value="${esc(tx.description || '')}" maxlength="120"></div>
    <div class="edit-tx-actions">
      <button class="btn btn-primary" id="saveEditBtn" type="button">${t('save_changes')}</button>
      <button class="btn btn-ghost btn-sm" id="cancelEditBtn" type="button">${t('cancel')}</button>
      <button class="btn btn-danger btn-sm" id="deleteEditBtn" type="button">${t('delete')}</button>
    </div>
  `;
  document.getElementById('tutorialOverlay').hidden = false;

  const fillEditCats = () => {
    const type = document.getElementById('editType')?.value;
    const sel  = document.getElementById('editCategory');
    const cats = getCats(type);
    if (sel) sel.innerHTML = cats.map(c => `<option value="${esc(c)}" ${c===tx.category?'selected':''}>${esc(c)}</option>`).join('')
      || `<option value="">${t('no_categories')}</option>`;
  };
  fillEditCats();
  document.getElementById('editType')?.addEventListener('change', fillEditCats);
  document.getElementById('editDateWrap')?.addEventListener('click', () => {
    openDatePicker(document.getElementById('editDate'), document.getElementById('editDateWrap'));
  });
  document.getElementById('editDate')?.addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown') {
      e.preventDefault();
      openDatePicker(document.getElementById('editDate'), document.getElementById('editDateWrap'));
    }
  });
  document.getElementById('editDate')?.addEventListener('change', e => {
    document.getElementById('editDateDisp').textContent = formatDateDisplay(e.target.value);
  });

  document.getElementById('saveEditBtn')?.addEventListener('click', () => {
    const date   = document.getElementById('editDate')?.value;
    const type   = document.getElementById('editType')?.value;
    const cat    = document.getElementById('editCategory')?.value;
    const amount = parseFloat(document.getElementById('editAmount')?.value);
    const desc   = document.getElementById('editDesc')?.value?.trim() || '';
    if (!date || !type || !cat || isNaN(amount) || amount <= 0) return;
    const idx = state.transactions.findIndex(t => t.id === txId);
    if (idx !== -1) state.transactions[idx] = { id: txId, date, type, category: cat, amount, description: desc };
    saveState(); closeModal(); renderTxList();
    showToast(t('toast_tx_updated'));
  });

  document.getElementById('cancelEditBtn')?.addEventListener('click', closeModal);

  document.getElementById('deleteEditBtn')?.addEventListener('click', async () => {
    if (!await confirmDialog({ message: t('confirm_delete_tx'), confirmText: t('delete') })) return;
    state.transactions = state.transactions.filter(t => t.id !== txId);
    syncModulePaidLinks();
    saveState(); closeModal(); renderTxList();
    showToast(t('toast_tx_deleted'));
  });
}

// ── CSV Import ────────────────────────────────────────────────────────
function handleCSV(e) {
  const file = e.target.files[0]; if (!file) return;
  const reader = new FileReader();
  reader.onload = ev => {
    const lines = ev.target.result.split('\n').filter(l => l.trim());
    const TYPES = new Set(['income','expense','bill','debt','savings']);
    let imported = 0, skipped = 0, limitHit = false;
    for (let i = 1; i < lines.length; i++) {
      if (trialBlocks('transaction')) { limitHit = true; break; }
      const parts = lines[i].split(',').map(p => p.trim().replace(/^"|"$/g, ''));
      if (parts.length < 4) { skipped++; continue; }
      const [date, type, category, amtStr, ...rest] = parts;
      const amount = parseFloat(amtStr);
      if (!date || !TYPES.has(type) || !category || isNaN(amount) || amount <= 0) { skipped++; continue; }
      state.transactions.push({ id: uid(), date, type, category, amount, description: rest.join(',') || '' });
      imported++;
    }
    saveState(); renderTxList();
    e.target.value = '';
    if (limitHit) { if (imported > 0) showToast(tf('toast_imported',imported)); showUpgradeModal({ reason: 'transaction' }); return; }
    if (imported > 0) showToast(tf('toast_imported',imported));
    else alertDialog(t('csv_error_msg'), '\uD83D\uDCC4');
    e.target.value = '';
  };
  reader.readAsText(file);
}

// ── Settings ──────────────────────────────────────────────────────────
function exportCSV(){
  trackEvent('feature_used', { feature: 'csv_exported' });
  const rows=[[t('tx_date'),t('tx_type'),t('tx_category'),t('tx_amount'),t('tx_desc_label')]];
  for(const tx of state.transactions)rows.push([tx.date,tx.type,tx.category,tx.amount,tx.description||'']);
  const csv=rows.map(r=>r.map(v=>`"${String(v).replace(/"/g,'""')}"`).join(',')).join('\n');
  const blob=new Blob([csv],{type:'text/csv'});
  const url=URL.createObjectURL(blob);
  const a=document.createElement('a');
  a.href=url;a.download=`evobudget-sbp-${state.settings.periodStart||'export'}.csv`;
  document.body.appendChild(a);a.click();document.body.removeChild(a);
  URL.revokeObjectURL(url);
  showToast(t('toast_export'));
}

function renderSettings() {
  const s  = state.settings;
  const el = document.getElementById('bview-settings');

  el.innerHTML = `
    <div class="section-header">
      <h2 class="section-title">⚙️ ${t('tab_settings')}</h2>
      <button class="help-icon-btn" data-help="settings" type="button" aria-label="${t('help_aria')}">?</button>
    </div>

    <div class="settings-grid">
      <div class="panel"><div class="panel-inner">
        <div class="settings-card-title">📅 ${t('budget_period')}</div>
        <div class="field-grid">
          <div class="field">
            <label class="field-label">${t('start_date')}</label>
            <div class="date-field-styled" id="settStartWrap">
              <svg class="date-cal-icon" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>
              <span class="date-field-val" id="settStartDisp">${formatDateDisplay(s.periodStart)}</span>
              <input type="date" id="settStart" value="${s.periodStart}">
            </div>
          </div>
          <div class="field">
            <label class="field-label">${t('end_date')}</label>
            <div class="date-field-styled" id="settEndWrap">
              <svg class="date-cal-icon" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>
              <span class="date-field-val" id="settEndDisp">${formatDateDisplay(s.periodEnd)}</span>
              <input type="date" id="settEnd" value="${s.periodEnd}">
            </div>
          </div>
        </div>
        <div class="preset-row">
          <span class="field-label">${t('quick_presets')}</span>
          ${(()=>{
            const now=new Date(),d=now.getDay();
            const thisMonday=new Date(now.getFullYear(),now.getMonth(),now.getDate()-(d===0?6:d-1));
            const q=Math.floor(now.getMonth()/3);
            const presets={
              week:[toLocalISO(thisMonday),toLocalISO(new Date(thisMonday.getFullYear(),thisMonday.getMonth(),thisMonday.getDate()+6))],
              last_week:[toLocalISO(new Date(thisMonday.getFullYear(),thisMonday.getMonth(),thisMonday.getDate()-7)),toLocalISO(new Date(thisMonday.getFullYear(),thisMonday.getMonth(),thisMonday.getDate()-1))],
              month:[toLocalISO(new Date(now.getFullYear(),now.getMonth(),1)),toLocalISO(new Date(now.getFullYear(),now.getMonth()+1,0))],
              last_month:[toLocalISO(new Date(now.getFullYear(),now.getMonth()-1,1)),toLocalISO(new Date(now.getFullYear(),now.getMonth(),0))],
              last_30:[toLocalISO(new Date(now.getFullYear(),now.getMonth(),now.getDate()-29)),toLocalISO(now)],
              quarter:[toLocalISO(new Date(now.getFullYear(),q*3,1)),toLocalISO(new Date(now.getFullYear(),q*3+3,0))],
              year:[toLocalISO(new Date(now.getFullYear(),0,1)),toLocalISO(new Date(now.getFullYear(),11,31))],
            };
            const ps=s.periodStart,pe=s.periodEnd;
            const active=Object.entries(presets).find(([,v])=>v[0]===ps&&v[1]===pe)?.[0]||null;
            return['week','last_week','month','last_month','last_30','quarter','year'].map(k=>`<button class="btn btn-ghost btn-sm${active===k?' preset-active':''}" data-preset="${k}" type="button">${t({week:'this_week',last_week:'last_week',month:'this_month',last_month:'last_month',last_30:'last_30_days',quarter:'this_quarter',year:'this_year'}[k])}</button>`).join('');
          })()}
        </div>
      </div></div>
      <div class="panel"><div class="panel-inner">
        <div class="settings-card-title">💱 ${t('currency')}</div>
        <div class="field"><label class="field-label">${t('select_currency')}</label>
          <select class="select" id="settCurrency">
            ${[['USD','$'],['EUR','€'],['GBP','£'],['PLN','zł'],['JPY','¥'],['CAD','$'],
               ['AUD','$'],['CHF','CHF'],['SEK','kr'],['NOK','kr'],['DKK','kr'],
               ['INR','₹'],['BRL','R$'],['MXN','$'],['ZAR','R']]
              .map(([code,sym]) => `<option value="${code}|${sym}" ${s.currency===code?'selected':''}>${code} (${sym})</option>`).join('')}
          </select></div>
      </div></div>
      <div class="panel"><div class="panel-inner">
        <div class="settings-card-title">🔄 ${t('rollover')}</div>
        <p class="settings-desc">${t('rollover_desc')}</p>
        <div class="field"><label class="field-label">${t('rollover_amount')} (${s.symbol})</label>
          <input class="input" type="number" id="settRollover" min="0" step="0.01"
                 value="${state.rollover || ''}" placeholder="0.00"></div>
      </div></div>
      ${dashboardLayoutCardHtml()}
      <div class="panel"><div class="panel-inner">
        <div class="settings-card-title">🌙 ${t('appearance')}</div>
        <p class="settings-desc">${t('appearance_desc')}</p>
        <div class="theme-setting-row">
          <div class="theme-pill" role="group" aria-label="${t('appearance')}">
            <button class="theme-opt${(document.documentElement.dataset.theme||'light')==='light'?' is-active':''}" data-theme-val="light" type="button" title="${t('light')}">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/></svg>
              ${t('light')}
            </button>
            <button class="theme-opt${(document.documentElement.dataset.theme||'light')==='dark'?' is-active':''}" data-theme-val="dark" type="button" title="${t('dark')}">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>
              ${t('dark')}
            </button>
            <button class="theme-opt${(document.documentElement.dataset.theme||'light')==='synthwave'?' is-active':''}" data-theme-val="synthwave" type="button" title="${t('theme_synthwave')}">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 16a8 8 0 0 1 16 0"/><line x1="4" y1="16" x2="20" y2="16"/><line x1="2" y1="20" x2="22" y2="20"/><line x1="6" y1="12" x2="18" y2="12"/></svg>
              ${t('theme_synthwave')}
            </button>
            <button class="theme-opt${(document.documentElement.dataset.theme||'light')==='vintage-ledger'?' is-active':''}" data-theme-val="vintage-ledger" type="button" title="${t('theme_vintage_ledger')}">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 5c3-1.5 6-1.5 8 0v14c-2-1.5-5-1.5-8 0V5z"/><path d="M20 5c-3-1.5-6-1.5-8 0v14c2-1.5 5-1.5 8 0V5z"/></svg>
              ${t('theme_vintage_ledger')}
            </button>
            <button class="theme-opt${(document.documentElement.dataset.theme||'light')==='terminal'?' is-active':''}" data-theme-val="terminal" type="button" title="${t('theme_terminal')}">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="m7 9 3 3-3 3"/><line x1="12" y1="15" x2="16" y2="15"/></svg>
              ${t('theme_terminal')}
            </button>
          </div>
        </div>
      </div></div>
      <div class="panel"><div class="panel-inner">
        <div class="settings-card-title">✨ ${t('dash_anim_title')}</div>
        <p class="settings-desc">${t('dash_anim_desc')}</p>
        <label class="automate-row" style="margin-top:8px">
          <span class="automate-row-text"><span class="automate-row-title">${t('dash_anim_label')}</span></span>
          <span class="recurring-toggle"><input type="checkbox" id="settDashboardAnimations" ${state.settings.dashboardAnimations===false?'':'checked'}><span class="rec-toggle-track"></span></span>
        </label>
      </div></div>
      <div class="panel"><div class="panel-inner">
        <div class="settings-card-title">${t('sync_card_title')}</div>
        <p class="settings-desc">${t('sync_card_desc')}</p>
        <div class="sync-mode-row">
          <button class="sync-mode-opt${(syncGetMode('sbp')||'local')!=='google'?' is-active':''}" data-sync-mode="local" type="button">
            ${(syncGetMode('sbp')||'local')!=='google'?'<span class="sync-mode-check">✓</span>':''}
            <span class="sync-mode-icon">${SYNC_ICON_LOCAL}</span>
            <span class="sync-mode-title">${t('sync_mode_local_title')}</span>
            <span class="sync-mode-desc">${t('sync_mode_local_desc')}</span>
          </button>
          <button class="sync-mode-opt sync-mode-opt--google${(syncGetMode('sbp')||'local')==='google'?' is-active':''}" data-sync-mode="google" type="button">
            <span class="sync-mode-badge">${t('sync_recommended')}</span>
            ${(syncGetMode('sbp')||'local')==='google'?'<span class="sync-mode-check">✓</span>':''}
            <span class="sync-mode-icon sync-mode-icon--google">${SYNC_ICON_GOOGLE}</span>
            <span class="sync-mode-title">${t('sync_mode_google_title')}</span>
            <span class="sync-mode-desc">${t('sync_mode_google_desc')}</span>
          </button>
        </div>
        ${(syncGetMode('sbp')==='google'&&syncGetEmail('sbp'))?`<p class="sync-status-line">${tf('sync_signed_in_as',`<strong>${esc(syncGetEmail('sbp'))}</strong>`)}</p>`:''}
        <p class="sync-error" id="syncSettError" hidden>${t('sync_error_generic')}</p>
      </div></div>
      <div class="panel"><div class="panel-inner">
        <div class="settings-card-title">🌐 ${t('language')}</div>
        <div class="field"><label class="field-label">${t('select_language')}</label>
          <select class="select" id="settLanguage">
            ${Object.entries(TRANSLATIONS).map(([code,tr])=>`<option value="${code}" ${(s.language||'en')===code?'selected':''}>${tr.lang_name}</option>`).join('')}
          </select></div>
      </div></div>
      <div class="panel settings-card"><div class="panel-inner">
        <div class="settings-card-title">${t('sett_export_title')}</div>
        <p class="settings-desc">${t('sett_export_desc')}</p>
        <button class="btn btn-secondary btn-sm" id="exportCsvBtn" type="button">${t('export_csv_btn')}</button>
      </div></div>
      <div class="panel"><div class="panel-inner">
        <div class="settings-card-title">🚀 ${t('sett_upgrade_h')}</div>
        <label class="automate-row" style="margin-top:8px">
          <span class="automate-row-text"><span class="automate-row-title">${t('sett_upgrade_label')}</span></span>
          <span class="recurring-toggle"><input type="checkbox" id="settShowUpgrade" ${state.settings.hideUpgrade?'':'checked'}><span class="rec-toggle-track"></span></span>
        </label>
      </div></div>
      <div class="panel settings-card--danger"><div class="panel-inner">
        <div class="settings-card-title">⚠️ ${t('reset_data')}</div>
        <p class="settings-desc">${t('reset_desc')}</p>
        <button class="btn btn-danger btn-sm" id="resetBtn" type="button">${t('reset_btn')}</button>
      </div></div>

    <div class="settings-save-row"><p class="settings-desc" style="margin:0;font-size:12px">${t('changes_autosaved')}</p></div>
  `;

  el.querySelectorAll('.theme-opt').forEach(btn => {
    btn.addEventListener('click', () => { applyTheme(btn.dataset.themeVal); trackEvent('theme_changed', { theme: btn.dataset.themeVal }); });
  });
  wireDashboardLayoutPicker(el);

  el.querySelectorAll('[data-sync-mode]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const target = btn.dataset.syncMode;
      const current = syncGetMode('sbp') || 'local';
      if (target === current) return;
      const errEl = document.getElementById('syncSettError');
      if (errEl) errEl.hidden = true;
      el.querySelectorAll('[data-sync-mode]').forEach(b => b.disabled = true);
      try {
        if (target === 'google') { saveState(); await syncSwitchToGoogle('sbp'); showToast(t('toast_synced_google')); }
        else { await syncSwitchToLocal('sbp'); showToast(t('toast_synced_local')); }
        trackEvent('sync_mode_chosen', { mode: target });
        state = loadState() || defaultState(); syncSymbol();
        renderSettings();
      } catch (e) {
        if (errEl) { errEl.textContent = syncFriendlyError(e); errEl.hidden = false; }
        el.querySelectorAll('[data-sync-mode]').forEach(b => b.disabled = false);
      }
    });
  });

  document.getElementById('settLanguage')?.addEventListener('change', e => {
    state.settings.language = e.target.value;
    saveState();
    applyLanguage();
    trackEvent('language_changed', { lang: e.target.value });
    dispatchRender(currentBTab);
  });

  el.querySelectorAll('[data-preset]').forEach(btn => {
    btn.addEventListener('click', () => {
      const now = new Date(), d = now.getDay();
      const thisMonday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - (d === 0 ? 6 : d - 1));
      let start, end;
      switch (btn.dataset.preset) {
        case 'week':
          start = toLocalISO(thisMonday);
          end   = toLocalISO(new Date(thisMonday.getFullYear(), thisMonday.getMonth(), thisMonday.getDate() + 6));
          break;
        case 'last_week': {
          const lm = new Date(thisMonday.getFullYear(), thisMonday.getMonth(), thisMonday.getDate() - 7);
          start = toLocalISO(lm);
          end   = toLocalISO(new Date(lm.getFullYear(), lm.getMonth(), lm.getDate() + 6));
          break;
        }
        case 'month':
          ({ start, end } = getMonthBounds());
          break;
        case 'last_month':
          start = toLocalISO(new Date(now.getFullYear(), now.getMonth() - 1, 1));
          end   = toLocalISO(new Date(now.getFullYear(), now.getMonth(), 0));
          break;
        case 'last_30':
          start = toLocalISO(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 29));
          end   = toLocalISO(now);
          break;
        case 'quarter': {
          const q = Math.floor(now.getMonth() / 3);
          start = toLocalISO(new Date(now.getFullYear(), q * 3, 1));
          end   = toLocalISO(new Date(now.getFullYear(), q * 3 + 3, 0));
          break;
        }
        case 'year':
          start = toLocalISO(new Date(now.getFullYear(), 0, 1));
          end   = toLocalISO(new Date(now.getFullYear(), 11, 31));
          break;
        default: return;
      }
      document.getElementById('settStart').value = start;
      document.getElementById('settEnd').value   = end;
      document.getElementById('settStartDisp').textContent = formatDateDisplay(start);
      document.getElementById('settEndDisp').textContent   = formatDateDisplay(end);
      state.settings.periodStart = start;
      state.settings.periodEnd   = end;
      saveState();
      el.querySelectorAll('[data-preset]').forEach(b=>b.classList.toggle('preset-active',b===btn));
      showToast(t('toast_period_updated'));
    });
  });

  // Click on styled date fields → open the custom calendar
  document.getElementById('settStartWrap')?.addEventListener('click', () => {
    openDatePicker(document.getElementById('settStart'), document.getElementById('settStartWrap'));
  });
  document.getElementById('settEndWrap')?.addEventListener('click', () => {
    openDatePicker(document.getElementById('settEnd'), document.getElementById('settEndWrap'));
  });
  // Space/ArrowDown open the picker; Enter is handled separately (advances to next field)
  document.getElementById('settStart')?.addEventListener('keydown', e => {
    if (e.key === ' ' || e.key === 'ArrowDown') { e.preventDefault(); document.getElementById('settStartWrap')?.click(); }
  });
  document.getElementById('settEnd')?.addEventListener('keydown', e => {
    if (e.key === ' ' || e.key === 'ArrowDown') { e.preventDefault(); document.getElementById('settEndWrap')?.click(); }
  });

  // Auto-save on change
  document.getElementById('settCurrency')?.addEventListener('change',e=>{
    const[curr,sym]=e.target.value.split('|');
    state.settings.currency=curr;state.settings.symbol=sym;SYM=sym;saveState();
    showToast(t('toast_currency_updated'));dispatchRender(currentBTab);
  });
  document.getElementById('settRollover')?.addEventListener('change',e=>{
    state.rollover=parseFloat(e.target.value)||0;saveState();showToast(t('toast_saved'));
  });
  document.getElementById('settStart')?.addEventListener('change',e=>{
    if(e.target.value&&state.settings.periodEnd&&e.target.value>state.settings.periodEnd){showToast(t('toast_period_error'));e.target.value=state.settings.periodStart;document.getElementById('settStartDisp').textContent=formatDateDisplay(state.settings.periodStart);return;}
    state.settings.periodStart=e.target.value;saveState();
    document.getElementById('settStartDisp').textContent=formatDateDisplay(e.target.value);
  });
  document.getElementById('settEnd')?.addEventListener('change',e=>{
    if(e.target.value&&state.settings.periodStart&&e.target.value<state.settings.periodStart){showToast(t('toast_period_error'));e.target.value=state.settings.periodEnd;document.getElementById('settEndDisp').textContent=formatDateDisplay(state.settings.periodEnd);return;}
    state.settings.periodEnd=e.target.value;saveState();
    document.getElementById('settEndDisp').textContent=formatDateDisplay(e.target.value);
  });

  document.getElementById('exportCsvBtn')?.addEventListener('click', exportCSV);

  document.getElementById('settShowUpgrade')?.addEventListener('change', e => {
    state.settings.hideUpgrade = !e.target.checked;
    saveState();
  });
  document.getElementById('settDashboardAnimations')?.addEventListener('change', e => {
    state.settings.dashboardAnimations = e.target.checked;
    saveState();
  });
  document.getElementById('resetBtn')?.addEventListener('click', async () => {
    if (!await confirmDialog({ message: t('confirm_reset_1'), confirmText: t('reset_btn') })) return;
    if (!await confirmDialog({ message: t('confirm_reset_2'), confirmText: t('reset_btn') })) return;
    localStorage.removeItem(STATE_KEY);
    state = defaultState(); SYM = '$'; saveState();
    showToast(t('toast_reset'));
    switchBTab('dashboard');
  });

  el.querySelector('[data-help]')?.addEventListener('click', e => showHelp(e.currentTarget.dataset.help));
}

// ── Help / Tutorial ───────────────────────────────────────────────────
const HELP = {
  dashboard: {
    title: () => `📊 ${t('help_dash_modal_title')}`,
    body: () => `<p>${t('help_dash_intro')}</p>
<ul>
  <li><strong>${t('help_dash_cards_h')}</strong> - ${t('help_dash_cards_li')}</li>
  <li><strong>${t('net_leftover')}</strong> - ${t('help_dash_leftover_li')}</li>
  <li><strong>${t('help_dash_flow_h')}</strong> - ${t('help_dash_flow_li')}</li>
  <li><strong>${t('help_dash_donut_h')}</strong> - ${t('help_dash_donut_li')}</li>
  <li><strong>${t('help_dash_datebadge_h')}</strong> - ${t('help_dash_datebadge_li')}</li>
</ul>
<p><em>${t('help_dash_tip')}</em></p>`
  },
  transactions: {
    title: () => `📋 ${t('help_tx_modal_title')}`,
    body: () => `<p>${t('help_tx_intro')}</p>
<ul>
  <li><strong>${t('type')}</strong> - ${t('help_tx_type_li')}</li>
  <li><strong>${t('category')}</strong> - ${t('help_tx_category_li')}</li>
  <li><strong>${t('help_tx_edit_h')}</strong> - ${t('help_tx_edit_li')}</li>
</ul>
<p><strong>${t('help_tx_csv_h')}</strong><br><code>Date,Type,Category,Amount,Description</code><br><code>2024-01-15,expense,Food,25.50,Grocery run</code></p>`
  },
  income: {
    title: () => `💰 ${t('help_inc_modal_title')}`,
    body: () => `<p>${t('help_inc_intro')}</p>
<ul>
  <li><strong>${t('expected')}</strong> - ${t('help_inc_expected_li')}</li>
  <li><strong>${t('actual')}</strong> - ${t('help_inc_actual_li')}</li>
</ul>
<p><em>${t('help_inc_tip')}</em></p>`
  },
  expenses: {
    title: () => `🛒 ${t('help_exp_modal_title')}`,
    body: () => `<p>${t('help_exp_intro')}</p>
<ul>
  <li><strong>${t('expected')}</strong> - ${t('help_exp_expected_li')}</li>
  <li><strong>${t('actual')}</strong> - ${t('help_exp_actual_li')}</li>
</ul>`
  },
  bills: {
    title: () => `🧾 ${t('help_bills_modal_title')}`,
    body: () => `<p>${t('help_bills_intro')}</p>
<ul>
  <li><strong>${t('due_date')}</strong> - ${t('help_bills_duedate_li')}</li>
  <li><strong>${t('paid')}</strong> - ${t('help_bills_paid_li')}</li>
  <li><strong>${t('actual')}</strong> - ${t('help_bills_actual_li')}</li>
</ul>`
  },
  debt: {
    title: () => `💳 ${t('help_debt_modal_title')}`,
    body: () => `<p>${t('help_debt_intro')}</p>
<ul>
  <li><strong>${t('expected')}</strong> - ${t('help_debt_expected_li')}</li>
  <li><strong>${t('due_date')}</strong> - ${t('help_debt_duedate_li')}</li>
  <li><strong>${t('paid')}</strong> - ${t('help_debt_paid_li')}</li>
</ul>`
  },
  savings: {
    title: () => `🏦 ${t('help_sav_modal_title')}`,
    body: () => `<p>${t('help_sav_intro')}</p>
<ul>
  <li><strong>${t('expected')}</strong> - ${t('help_sav_expected_li')}</li>
  <li><strong>${t('actual')}</strong> - ${t('help_sav_actual_li')}</li>
</ul>
<p><em>${t('help_sav_tip')}</em></p>`
  },
  settings: {
    title: () => `⚙️ ${t('help_sett_modal_title')}`,
    body:  () => `<p>${t('help_sett_intro')}</p>
<ul>
  <li><strong>${t('currency')}</strong> - ${t('help_sett_currency_li')}</li>
  <li><strong>${t('budget_period')}</strong> - ${t('help_sett_period_li')}</li>
  <li><strong>${t('rollover')}</strong> - ${t('help_sett_rollover_li')}</li>
  <li><strong>${t('appearance')}</strong> - ${t('help_sett_theme_li')}</li>
  <li><strong>${t('dashboard_layout')}</strong> - ${t('help_sett_layout_li')}</li>
</ul>`
  }
};

function showHelp(key) {
  const h = HELP[key]; if (!h) return;
  document.getElementById('modalTitle').textContent = typeof h.title === 'function' ? h.title() : h.title;
  document.getElementById('modalBody').innerHTML    = typeof h.body  === 'function' ? h.body()  : h.body;
  document.getElementById('tutorialOverlay').hidden = false;
  document.getElementById('modalClose')?.focus();
}
function closeModal() { document.getElementById('tutorialOverlay').hidden = true; document.getElementById('tutorialModal')?.classList.remove('compare-modal'); document.getElementById('modalBody').innerHTML = ''; }

// ── Guide ─────────────────────────────────────────────────────────────
const GUIDE_TOPICS = [
  { id: 'welcome',      group: 'guide_group_start',    icon: '👋', steps: 0, connects: 0, tip: false },
  { id: 'dashboard',    group: 'guide_group_start',    icon: '📊', steps: 3, connects: 3, tip: true  },
  { id: 'transactions', group: 'guide_group_track',    icon: '📋', steps: 4, connects: 3, tip: true  },
  { id: 'income',       group: 'guide_group_track',    icon: '💰', steps: 3, connects: 3, tip: true  },
  { id: 'expenses',     group: 'guide_group_track',    icon: '🛒', steps: 3, connects: 3, tip: true  },
  { id: 'bills',        group: 'guide_group_track',    icon: '🧾', steps: 3, connects: 3, tip: true  },
  { id: 'debt',         group: 'guide_group_track',    icon: '💳', steps: 3, connects: 3, tip: true  },
  { id: 'savings',      group: 'guide_group_track',    icon: '🏦', steps: 3, connects: 3, tip: true  },
  { id: 'settings',     group: 'guide_group_settings', icon: '⚙️', steps: 5, connects: 3, tip: true  }
];
let guideActiveTopic = null;
let guideKeydownHandler = null;

function guideFocusableEls(overlay) {
  return Array.from(overlay.querySelectorAll('button, [href], [tabindex]:not([tabindex="-1"])'))
    .filter(el => el.offsetParent !== null);
}
function guideHandleKeydown(e) {
  const overlay = document.getElementById('guideOverlay');
  if (!overlay || overlay.hidden) return;
  if (e.key === 'Escape') { e.preventDefault(); closeGuide(); return; }
  if (e.key === 'Tab') {
    const els = guideFocusableEls(overlay);
    if (!els.length) return;
    const first = els[0], last = els[els.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    return;
  }
  const sidebar = document.getElementById('guideSidebar');
  if (sidebar && sidebar.contains(document.activeElement) && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
    e.preventDefault();
    const idx = GUIDE_TOPICS.findIndex(x => x.id === guideActiveTopic);
    const next = e.key === 'ArrowDown' ? Math.min(idx + 1, GUIDE_TOPICS.length - 1) : Math.max(idx - 1, 0);
    selectGuideTopic(GUIDE_TOPICS[next].id);
    document.querySelector(`.guide-topic-btn[data-topic="${GUIDE_TOPICS[next].id}"]`)?.focus();
  }
}
function renderGuideSidebar() {
  const sidebar = document.getElementById('guideSidebar');
  if (!sidebar) return;
  let lastGroup = null;
  sidebar.innerHTML = GUIDE_TOPICS.map(topic => {
    let groupHtml = '';
    if (topic.group !== lastGroup) { groupHtml = `<div class="guide-group-label">${esc(t(topic.group))}</div>`; lastGroup = topic.group; }
    return `${groupHtml}<button class="guide-topic-btn" data-topic="${topic.id}" type="button">
      <span class="guide-topic-icon">${topic.icon}</span><span>${esc(t('guide_' + topic.id + '_title'))}</span>
    </button>`;
  }).join('');
  sidebar.querySelectorAll('.guide-topic-btn').forEach(btn => {
    btn.addEventListener('click', () => selectGuideTopic(btn.dataset.topic));
  });
}
function renderGuideTopic(id) {
  const topic = GUIDE_TOPICS.find(x => x.id === id);
  const content = document.getElementById('guideContent');
  if (!topic || !content) return;
  const stepsHtml = topic.steps > 0
    ? `<div class="guide-section"><div class="guide-section-label">${esc(t('guide_section_how'))}</div>
        <ol class="guide-steps">${Array.from({ length: topic.steps }, (_, i) => `<li><span class="guide-step-num">${i + 1}</span><span>${t('guide_' + id + '_step' + (i + 1))}</span></li>`).join('')}</ol>
       </div>` : '';
  const connectsHtml = topic.connects > 0
    ? `<div class="guide-section"><div class="guide-section-label">${esc(t('guide_section_connects'))}</div>
        <ul class="guide-connects">${Array.from({ length: topic.connects }, (_, i) => `<li><span class="guide-connect-dot"></span><span>${t('guide_' + id + '_connect' + (i + 1))}</span></li>`).join('')}</ul>
       </div>` : '';
  const tipHtml = topic.tip
    ? `<div class="guide-section"><div class="guide-tip"><span class="guide-tip-icon">💡</span><span>${t('guide_' + id + '_tip')}</span></div></div>` : '';
  const useCaseHtml = topic.steps > 0
    ? `<div class="guide-section"><details class="recurring-panel panel guide-usecase">
        <summary class="recurring-summary"><span class="recurring-summary-title"><span class="recurring-summary-icon" aria-hidden="true">👤</span>${esc(t('guide_' + id + '_usecase_h'))}</span></summary>
        <div class="recurring-body">${t('guide_' + id + '_usecase_p')}</div>
      </details></div>` : '';
  // Prev/next footer so the guide also reads linearly, like a short book
  const topicIdx = GUIDE_TOPICS.findIndex(x => x.id === id);
  const prev = GUIDE_TOPICS[topicIdx - 1], next = GUIDE_TOPICS[topicIdx + 1];
  const pagerHtml = `<div class="guide-pager">
      ${prev ? `<button class="guide-pager-btn guide-pager-btn--prev" data-goto="${prev.id}" type="button"><span class="guide-pager-dir">←</span><span class="guide-pager-label">${prev.icon} ${esc(t('guide_' + prev.id + '_title'))}</span></button>` : '<span></span>'}
      ${next ? `<button class="guide-pager-btn guide-pager-btn--next" data-goto="${next.id}" type="button"><span class="guide-pager-label">${next.icon} ${esc(t('guide_' + next.id + '_title'))}</span><span class="guide-pager-dir">→</span></button>` : '<span></span>'}
    </div>`;
  content.innerHTML = `
    <button class="guide-back-btn" type="button">← ${esc(t('guide_back'))}</button>
    <div class="guide-topic-header">
      <div class="guide-topic-icon-badge">${topic.icon}</div>
      <h3 class="guide-topic-title">${esc(t('guide_' + id + '_title'))}</h3>
      <span class="guide-topic-count">${topicIdx + 1} / ${GUIDE_TOPICS.length}</span>
    </div>
    <div class="guide-section"><div class="guide-section-label">${esc(t('guide_section_big'))}</div><p class="guide-big-picture">${t('guide_' + id + '_big')}</p></div>
    ${stepsHtml}${connectsHtml}${tipHtml}${useCaseHtml}${pagerHtml}`;
  content.querySelector('.guide-back-btn')?.addEventListener('click', () => {
    document.getElementById('guideModal')?.classList.remove('is-topic-open');
  });
  content.querySelectorAll('.guide-pager-btn[data-goto]').forEach(btn =>
    btn.addEventListener('click', () => selectGuideTopic(btn.dataset.goto)));
}
function selectGuideTopic(id, userInitiated = true) {
  guideActiveTopic = id;
  document.querySelectorAll('.guide-topic-btn').forEach(btn => btn.classList.toggle('is-active', btn.dataset.topic === id));
  renderGuideTopic(id);
  if (userInitiated) document.getElementById('guideModal')?.classList.add('is-topic-open');
  const content = document.getElementById('guideContent');
  if (content) { content.scrollTop = 0; if (userInitiated) content.focus(); }
}
function openGuide(initialId) {
  const overlay = document.getElementById('guideOverlay');
  if (!overlay) return;
  overlay.hidden = false;
  document.getElementById('guideModal')?.classList.remove('is-topic-open');
  renderGuideSidebar();
  selectGuideTopic(initialId || guideActiveTopic || GUIDE_TOPICS[0].id, false);
  guideKeydownHandler = e => guideHandleKeydown(e);
  document.addEventListener('keydown', guideKeydownHandler, true);
  setTimeout(() => {
    const overlayEl = document.getElementById('guideOverlay');
    (overlayEl?.querySelector('.guide-topic-btn.is-active') || overlayEl?.querySelector('.guide-close'))?.focus();
  }, 40);
}
function closeGuide() {
  const overlay = document.getElementById('guideOverlay');
  if (!overlay) return;
  overlay.hidden = true;
  if (guideKeydownHandler) { document.removeEventListener('keydown', guideKeydownHandler, true); guideKeydownHandler = null; }
}

// ── Toast ─────────────────────────────────────────────────────────────
function showToast(msg) {
  let t = document.getElementById('toast');
  if (!t) { t = document.createElement('div'); t.id = 'toast'; t.setAttribute('role', 'status'); t.setAttribute('aria-live', 'polite'); document.body.appendChild(t); }
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.remove('show'), 2800);
}

// ── In-app dialog (replaces native confirm / alert) ───────────────────
function fkDialog({ message, confirmText, cancelText, danger = false, alertOnly = false, icon }) {
  return new Promise(resolve => {
    document.getElementById('fkDialogOverlay')?.remove();
    const ov = document.createElement('div');
    ov.className = 'fk-dialog-overlay';
    ov.id = 'fkDialogOverlay';
    ov.setAttribute('role', 'dialog');
    ov.setAttribute('aria-modal', 'true');
    const glyph = icon || (danger ? '\u26A0\uFE0F' : alertOnly ? '\u2139\uFE0F' : '\u2753');
    ov.innerHTML =
      `<div class="fk-dialog${danger ? ' fk-dialog--danger' : ''}" role="document">
        <div class="fk-dialog-icon" aria-hidden="true">${glyph}</div>
        <p class="fk-dialog-msg">${esc(message)}</p>
        <div class="fk-dialog-actions">
          ${alertOnly ? '' : `<button class="btn btn-ghost" data-act="cancel" type="button">${esc(cancelText || t('cancel'))}</button>`}
          <button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" data-act="ok" type="button">${esc(confirmText || (alertOnly ? t('ok') : t('save')))}</button>
        </div>
      </div>`;
    document.body.appendChild(ov);
    requestAnimationFrame(() => ov.classList.add('is-open'));
    const done = val => {
      ov.classList.remove('is-open');
      document.removeEventListener('keydown', onKey, true);
      setTimeout(() => ov.remove(), 200);
      resolve(val);
    };
    const onKey = e => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); done(alertOnly ? true : false); }
      else if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); done(true); }
      else if (e.key === 'Tab') {
        const els = Array.from(ov.querySelectorAll('button')).filter(el => el.offsetParent !== null);
        if (!els.length) return;
        const first = els[0], last = els[els.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
        else if (!els.includes(document.activeElement)) { e.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener('keydown', onKey, true);
    ov.querySelector('[data-act="ok"]')?.addEventListener('click', () => done(true));
    ov.querySelector('[data-act="cancel"]')?.addEventListener('click', () => done(false));
    ov.addEventListener('click', e => { if (e.target === ov) done(alertOnly ? true : false); });
    setTimeout(() => ov.querySelector('[data-act="ok"]')?.focus(), 40);
  });
}
function confirmDialog(opts)         { return fkDialog({ danger: true, ...opts }); }
function alertDialog(message, icon)  { return fkDialog({ message, alertOnly: true, icon }); }

// ── Editable planner title ────────────────────────────────────────────
function applyAppTitle(){ const el=document.getElementById('appTitleText'); if(el&&state?.settings?.appTitle) el.textContent=state.settings.appTitle; }
function bindAppTitle(defaultTitle){
  const el=document.getElementById('appTitleText'); if(!el) return;
  const open=()=>openRenameDialog(el.textContent.trim(), defaultTitle, v=>{ state.settings.appTitle=v; saveState(); el.textContent=v; showToast(t('toast_saved')); });
  el.addEventListener('click',open);
  el.addEventListener('keydown',e=>{ if(e.key==='Enter'||e.key===' '){ e.preventDefault(); open(); } });
}
function openRenameDialog(current, defaultTitle, onSave){
  document.getElementById('fkRenameOverlay')?.remove();
  const ov=document.createElement('div'); ov.className='fk-dialog-overlay'; ov.id='fkRenameOverlay'; ov.setAttribute('role','dialog'); ov.setAttribute('aria-modal','true');
  ov.innerHTML=`<div class="fk-dialog" role="document">
    <div class="fk-dialog-icon">\u270F\uFE0F</div>
    <p class="fk-dialog-msg">${t('rename_title_prompt')}</p>
    <input class="input fk-rename-input" id="fkRenameInput" type="text" maxlength="40" value="${esc(current)}" placeholder="${esc(defaultTitle)}">
    <div class="fk-dialog-actions">
      <button class="btn btn-ghost" data-act="cancel" type="button">${t('cancel')}</button>
      <button class="btn btn-primary" data-act="ok" type="button">${t('save')}</button>
    </div>
  </div>`;
  document.body.appendChild(ov);
  requestAnimationFrame(()=>ov.classList.add('is-open'));
  const inp=ov.querySelector('#fkRenameInput');
  setTimeout(()=>{inp.focus();inp.select();},50);
  const close=()=>{ov.classList.remove('is-open');document.removeEventListener('keydown',onKey,true);setTimeout(()=>ov.remove(),180);};
  const submit=()=>{const v=inp.value.trim();if(v)onSave(v);close();};
  function onKey(e){ if(e.key==='Escape'){e.preventDefault();close();} else if(e.key==='Enter'){e.preventDefault();submit();} }
  document.addEventListener('keydown',onKey,true);
  ov.querySelector('[data-act="ok"]').addEventListener('click',submit);
  ov.querySelector('[data-act="cancel"]').addEventListener('click',close);
  ov.addEventListener('click',e=>{if(e.target===ov)close();});
}

// ── Custom themed date picker (replaces native calendar popup) ────────
function openDatePicker(input, anchor){
  if(!input) return;
  const existing=document.getElementById('fkDatePop');
  const wasFor=existing&&existing._for;
  if(existing) existing.remove();
  if(wasFor===input) return; // toggle off if re-clicking same field
  const lang=(typeof state!=='undefined'&&state?.settings?.language)||'en';
  const parse=v=>{const m=/^(\d{4})-(\d{2})-(\d{2})$/.exec(v||'');return m?new Date(+m[1],+m[2]-1,+m[3]):null;};
  const iso=d=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  const sel=parse(input.value), base=sel||new Date();
  let vy=base.getFullYear(), vm=base.getMonth();
  const today0=new Date(); today0.setHours(0,0,0,0);
  const pop=document.createElement('div'); pop.className='fk-datepop'; pop.id='fkDatePop'; pop._for=input;
  let titleFmt,dowFmt; try{titleFmt=new Intl.DateTimeFormat(lang,{month:'long',year:'numeric'});dowFmt=new Intl.DateTimeFormat(lang,{weekday:'short'});}catch(e){titleFmt=new Intl.DateTimeFormat('en',{month:'long',year:'numeric'});dowFmt=new Intl.DateTimeFormat('en',{weekday:'short'});}
  const dow=[]; for(let i=0;i<7;i++) dow.push(dowFmt.format(new Date(2024,0,1+i))); // 2024-01-01 = Monday
  function draw(){
    const startDow=(new Date(vy,vm,1).getDay()+6)%7, dim=new Date(vy,vm+1,0).getDate();
    let cells='';
    for(let i=0;i<startDow;i++) cells+='<span class="fk-dp-day fk-dp-empty"></span>';
    for(let d=1;d<=dim;d++){const dd=new Date(vy,vm,d),sd=sel&&iso(sel)===iso(dd),td=dd.getTime()===today0.getTime();cells+=`<button type="button" class="fk-dp-day${sd?' is-sel':''}${td?' is-today':''}" data-iso="${iso(dd)}">${d}</button>`;}
    pop.innerHTML=`<div class="fk-dp-head"><button type="button" class="fk-dp-nav" data-nav="-1">\u2039</button><span class="fk-dp-title">${titleFmt.format(new Date(vy,vm,1))}</span><button type="button" class="fk-dp-nav" data-nav="1">\u203A</button></div><div class="fk-dp-dow">${dow.map(n=>`<span>${n}</span>`).join('')}</div><div class="fk-dp-grid">${cells}</div><div class="fk-dp-foot"><button type="button" class="fk-dp-today">${t('dp_today')}</button><button type="button" class="fk-dp-clear">${t('dp_clear')}</button></div>`;
    pop.querySelectorAll('[data-nav]').forEach(b=>b.addEventListener('click',ev=>{ev.stopPropagation();vm+=+b.dataset.nav;if(vm<0){vm=11;vy--;}else if(vm>11){vm=0;vy++;}draw();}));
    pop.querySelectorAll('.fk-dp-day[data-iso]').forEach(b=>b.addEventListener('click',ev=>{ev.stopPropagation();commit(b.dataset.iso);}));
    pop.querySelector('.fk-dp-today').addEventListener('click',ev=>{ev.stopPropagation();commit(iso(new Date()));});
    pop.querySelector('.fk-dp-clear').addEventListener('click',ev=>{ev.stopPropagation();commit('');});
  }
  function commit(v){input.value=v;input.dispatchEvent(new Event('change',{bubbles:true}));close();}
  function close(){pop.remove();document.removeEventListener('mousedown',outside,true);document.removeEventListener('keydown',onKey,true);window.removeEventListener('resize',close);}
  function outside(e){if(!pop.contains(e.target))close();}
  function onKey(e){if(e.key==='Escape'){e.preventDefault();close();}}
  document.body.appendChild(pop); draw();
  if(!window.matchMedia('(max-width:480px)').matches){
    const r=(anchor||input).getBoundingClientRect(), pw=pop.offsetWidth, ph=pop.offsetHeight, vw=document.documentElement.clientWidth, vh=window.innerHeight;
    let top=r.bottom+6+window.scrollY, left=r.left+window.scrollX;
    if(left-window.scrollX+pw>vw-8) left=window.scrollX+vw-pw-8;
    if(r.bottom+6+ph>vh && r.top-6-ph>0) top=r.top+window.scrollY-ph-6;
    pop.style.top=Math.max(8+window.scrollY,top)+'px'; pop.style.left=Math.max(8,left)+'px';
  }
  setTimeout(()=>{document.addEventListener('mousedown',outside,true);document.addEventListener('keydown',onKey,true);window.addEventListener('resize',close);},0);
}
// Intercept raw native date inputs (not behind a styled wrapper)
document.addEventListener('mousedown',e=>{
  const inp=e.target.closest?.('input[type="date"]');
  if(inp && !inp.closest('.date-field-styled') && !inp.closest('.date-cell-styled')){ e.preventDefault(); openDatePicker(inp,inp); }
},true);

// ── Themed number steppers (replaces native spinner arrows) ───────────
function fkAddStepper(inp){
  if(inp.dataset.stepper) return; inp.dataset.stepper='1';
  const wrap=document.createElement('span'); wrap.className='num-field';
  inp.parentNode.insertBefore(wrap,inp); wrap.appendChild(inp);
  const st=document.createElement('span'); st.className='num-steppers';
  st.innerHTML='<button type="button" class="num-step" data-d="1" tabindex="-1">\u25B2</button><button type="button" class="num-step" data-d="-1" tabindex="-1">\u25BC</button>';
  wrap.appendChild(st);
  st.querySelectorAll('.num-step').forEach(b=>b.addEventListener('click',()=>{
    const step=parseFloat(inp.step)||1, cur=parseFloat(inp.value)||0, dir=+b.dataset.d, mn=parseFloat(inp.min), mx=parseFloat(inp.max);
    let n=cur+dir*step; if(!isNaN(mn)&&n<mn)n=mn; if(!isNaN(mx)&&n>mx)n=mx; n=Math.round(n*100)/100;
    inp.value=n; inp.dispatchEvent(new Event('input',{bubbles:true})); inp.dispatchEvent(new Event('change',{bubbles:true}));
  }));
}
function fkScanSteppers(root){ root&&root.querySelectorAll&&root.querySelectorAll('input.input[type="number"]:not([data-stepper])').forEach(fkAddStepper); }
function fkInitUIEnhancers(){
  fkScanSteppers(document);
  new MutationObserver(muts=>{for(const m of muts)for(const n of m.addedNodes){if(n.nodeType!==1)continue;if(n.matches&&n.matches('input.input[type="number"]'))fkAddStepper(n);fkScanSteppers(n);}}).observe(document.body,{childList:true,subtree:true});
}

// ── Init ──────────────────────────────────────────────────────────────

function showUpgradeComparison() {
  const modal = document.getElementById('tutorialModal');
  if (modal) modal.classList.add('compare-modal');

  const feats = [
    ['📊',t('cmp_feat1'), true],
    ['📋',t('cmp_feat2'), true],
    ['📈',t('cmp_feat3'), true],
    ['🍩',t('cmp_feat4'), true],
    ['📅',t('cmp_feat5'), true],
    ['🔄',t('cmp_feat6'), true],
    ['💳',t('cmp_feat7'), false],
    ['🏺',t('cmp_feat8'), false],
    ['📅',t('cmp_feat9'), false],
    ['🔄',t('cmp_feat10'), false],
    ['⚡',t('cmp_feat11'), false],
    ['📥',t('cmp_feat12'), false],
    ['✨',t('cmp_feat13'), false],
  ];

  const makeRow = ([icon, label, inSimple]) =>
    `<tr class="${inSimple?'':'row-pro-only'}">
      <td><div class="feat-cell"><span class="feat-icon">${icon}</span><span class="feat-text">${label}</span></div></td>
      <td class="col-simple">${inSimple?'✅':''}</td>
      <td class="col-ultimate">✅</td>
    </tr>`;

  const coreRows = feats.filter((_,i) => i < 6).map(makeRow).join('');
  const proRows  = feats.filter((_,i) => i >= 6).map(makeRow).join('');

  document.getElementById('modalTitle').textContent = t('cmp_title');
  document.getElementById('modalBody').innerHTML = `
    <table class="compare-table">
      <thead>
        <tr>
          <th class="col-feat">${t('cmp_col_feature')}</th>
          <th class="col-simple">${t('cmp_col_simple')}</th>
          <th class="col-ultimate">${t('cmp_col_ultimate')}</th>
        </tr>
      </thead>
      <tbody>
        <tr class="compare-section-row"><td colspan="3">${t('cmp_section_core')}</td></tr>
        ${coreRows}
        <tr class="compare-section-row"><td colspan="3">${t('cmp_section_pro')}</td></tr>
        ${proRows}
      </tbody>
    </table>
    <div class="compare-actions">
      <button class="btn btn-ghost btn-sm" id="compareStay" type="button">${t('cmp_stay_simple')}</button>
      <button class="btn btn-primary" id="compareUpgrade" type="button">${t('cmp_open_ultimate')}</button>
    </div>`;

  document.getElementById('tutorialOverlay').hidden = false;

  document.getElementById('compareStay')?.addEventListener('click', () => {
    if (modal) modal.classList.remove('compare-modal');
    document.getElementById('tutorialOverlay').hidden = true;
    document.getElementById('modalBody').innerHTML = '';
  });
  document.getElementById('compareUpgrade')?.addEventListener('click', () => {
    window.location.href = 'ultimate-budget';
  });
}


function init() {
  state = loadState() || defaultState();
  syncSymbol();
  saveState(); // ensures localStorage always mirrors state, so Google sync has real data to seed a Drive file with right away

  initTheme();  // apply saved theme before rendering
  renderHub();

  // Budget tab navigation
  document.getElementById('budgetTabs')?.querySelectorAll('.btab').forEach(btn => {
    btn.addEventListener('click', () => switchBTab(btn.dataset.btab));
  });

  // Mouse drag-to-scroll on tab bar
  enableDragScroll(document.getElementById('budgetTabs'));

  // Content dissolves under the empty nav ONLY while scrolled (none at rest)
  const _scroller = document.querySelector('#view-budget .app-scroll');
  if (_scroller) _scroller.addEventListener('scroll', () => _scroller.classList.toggle('is-scrolled', _scroller.scrollTop > 4), { passive: true });

  // Back to hub
  document.getElementById('backToHub')?.addEventListener('click', () => navigateTo('hub'));

  // Settings gear → Settings tab
  document.getElementById('settingsNavBtn')?.addEventListener('click', () => switchBTab('settings'));

  // Guide - open on the topic for the tab the user is currently viewing
  document.getElementById('guideNavBtn')?.addEventListener('click', () => {
    const topicIds = new Set(GUIDE_TOPICS.map(x => x.id));
    openGuide(topicIds.has(currentBTab) ? currentBTab : undefined);
  });
  document.getElementById('guideClose')?.addEventListener('click', closeGuide);
  document.getElementById('guideOverlay')?.addEventListener('click', e => {
    if (e.target === e.currentTarget) closeGuide();
  });

  // Modal close
  document.getElementById('modalClose')?.addEventListener('click', closeModal);
  document.getElementById('tutorialOverlay')?.addEventListener('click', e => {
    if (e.target === e.currentTarget) closeModal();
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') { closeModal(); return; }
    const overlay = document.getElementById('tutorialOverlay');
    if (overlay && !overlay.hidden) modalTabTrap(overlay, e);
  });
  // Move focus into the modal whenever it opens, so keyboard users don't
  // start tabbing through the (visually hidden) page behind the overlay.
  const tutorialOverlayEl = document.getElementById('tutorialOverlay');
  if (tutorialOverlayEl) {
    new MutationObserver(muts => {
      for (const m of muts) {
        if (m.attributeName === 'hidden' && !tutorialOverlayEl.hidden) {
          const els = Array.from(tutorialOverlayEl.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'))
            .filter(el => el.offsetParent !== null);
          (els[0] || tutorialOverlayEl).focus();
        }
      }
    }).observe(tutorialOverlayEl, { attributes: true });
  }


  fkInitUIEnhancers();
  applyAppTitle();
  bindAppTitle('Simple Budget');

  // Direct trial deep-link (?trial=sbp or ?trial=ubp) - lets a shared URL
  // drop someone straight into the trial without clicking through the hub.
  // The param is stripped from the address bar first, always, so a later
  // refresh or "back to hub" + reload never re-triggers it. Never touches
  // an already-unlocked tool - a paying customer's own bookmark/link must
  // never be pulled back into trial mode.
  const trialParam = new URLSearchParams(location.search).get('trial');
  if (trialParam === 'sbp' || trialParam === 'ubp') {
    const url = new URL(location.href);
    url.searchParams.delete('trial');
    history.replaceState(null, '', url);
    if (!isUnlocked(trialParam)) {
      trackEvent('feature_used', { feature: 'trial_deep_link', tool: trialParam });
      enterTrial(trialParam);
    }
  }
}

// ── Review carousel ────────────────────────────────────────────────────
const REVIEWS = [
  {name:'Megan T.',title:'Freelance Graphic Designer & Illustrator',stars:5,tool:'SBP',img:'https://randomuser.me/api/portraits/women/44.jpg',text:'I tried every app out there and they all wanted $10 a month just to see my own spending. Ezzo Budget was the first tool that actually felt like mine. Paid off $3,200 in credit card debt in five months.'},
  {name:'Daniel K.',title:'Full-Stack Software Engineer at a Startup',stars:5,tool:'UBP',img:'https://randomuser.me/api/portraits/men/32.jpg',text:'The sinking funds feature changed how I save. I set a target for a trip to Japan and the planner calculated exactly how much I needed each month. The automatic transactions did the rest.'},
  {name:'James R.',title:'Senior Account Manager in Advertising',stars:5,tool:'UBP',img:'https://randomuser.me/api/portraits/men/75.jpg',text:'My wife and I used spreadsheets for years but always fell off after a month. Ezzo Budget is just clean enough that we actually stick with it. We can see our bills, track subscriptions, and it all lives in the browser.'},
  {name:'Priya S.',title:'Recent Business Graduate & Job Seeker',stars:4,tool:'SBP',img:'https://randomuser.me/api/portraits/women/65.jpg',text:'As a recent graduate I needed something dead simple. The Simple planner lets me see income vs. expenses in one screen. I caught a gym membership I forgot to cancel on day one.'},
  {name:'Carlos M.',title:'Independent Restaurant Owner & Operator',stars:5,tool:'UBP',img:'https://randomuser.me/api/portraits/men/46.jpg',text:'I run a small restaurant and the subscription tracker alone saves me from forgetting about services I signed up for months ago. The calendar view is perfect for seeing what is due and when.'},
  {name:'Sarah L.',title:'Registered Nurse Working Night Shifts',stars:5,tool:'SBP',img:'https://randomuser.me/api/portraits/women/17.jpg',text:'I work 12-hour shifts and have zero energy left for complicated finance apps. This one took me two minutes to set up and I have not missed a bill payment since. Exactly what I needed.'},
  {name:'Tom W.',title:'High School History Teacher & Coach',stars:5,tool:'UBP',img:'https://randomuser.me/api/portraits/men/22.jpg',text:'The debt payoff calculator gave me a clear timeline for paying off my student loans. Seeing the numbers update in real time keeps me motivated. Down $8,000 in seven months.'},
  {name:'Aisha N.',title:'Digital Marketing Manager at an Agency',stars:5,tool:'SBP',img:'https://randomuser.me/api/portraits/women/90.jpg',text:'I love that nothing leaves my device. Every other app wanted my bank login and I was never comfortable with that. Ezzo Budget gave me real budgeting without the privacy trade-off.'},
  {name:'Ryan P.',title:'Licensed Electrician & Small Business Owner',stars:4,tool:'UBP',img:'https://randomuser.me/api/portraits/men/55.jpg',text:'I set up sinking funds for my tools, truck insurance, and license renewals. No more scrambling when a big expense hits. The automatic transactions make it completely hands-off.'},
  {name:'Emily C.',title:'Stay-at-Home Parent Managing Family Finances',stars:5,tool:'SBP',img:'https://randomuser.me/api/portraits/women/33.jpg',text:'With three kids, every dollar matters. The Simple planner helped me find over $400 in monthly spending I did not even realize we had. We are finally putting real money into savings.'},
  {name:'Marco D.',title:'PhD Candidate in Applied Mathematics',stars:5,tool:'SBP',img:'https://randomuser.me/api/portraits/men/86.jpg',text:'I budgeted on paper for years. Ezzo Budget is basically the digital version of that but with better math. CSV export means I can still pull data into my own spreadsheets when I want to.'},
  {name:'Jenny H.',title:'Senior Product Designer at a Tech Company',stars:5,tool:'UBP',img:'https://randomuser.me/api/portraits/women/26.jpg',text:'The allocation buckets were a game changer. I split everything into needs, wants, and savings and now every transaction goes into the right bucket automatically. So satisfying.'},
  {name:'David B.',title:'Regional Sales Representative in Pharma',stars:4,tool:'UBP',img:'https://randomuser.me/api/portraits/men/41.jpg',text:'I bought this for the debt payoff calculator and ended up using every single feature. The subscription tracker found three services I was double-paying for.'},
  {name:'Olivia F.',title:'Yoga Instructor & Wellness Studio Owner',stars:5,tool:'SBP',img:'https://randomuser.me/api/portraits/women/49.jpg',text:'I run a small studio and my personal finances were always tangled up with business. The Simple planner helped me separate everything. Clear categories, simple progress bars, done.'},
  {name:'Kevin Z.',title:'IT Consultant Working with Enterprise Clients',stars:5,tool:'UBP',img:'https://randomuser.me/api/portraits/men/29.jpg',text:'I have used YNAB, Monarch, and Mint before it shut down. This is the first tool where I do not feel like the product. My data stays local, I paid once, and I actually use it daily.'},
  {name:'Rachel A.',title:'Dental Hygienist Saving for a First Home',stars:5,tool:'SBP',img:'https://randomuser.me/api/portraits/women/58.jpg',text:'I have never been good with money but this made it almost impossible to lose track. The dashboard shows me exactly where I stand and the progress bars turn red before I overspend.'},
  {name:'Chris G.',title:'Rideshare Driver & Gig Economy Worker',stars:5,tool:'UBP',img:'https://randomuser.me/api/portraits/men/64.jpg',text:'My income changes every week. The Ultimate planner lets me adjust on the fly and the calendar shows me exactly when bills hit so I can plan my driving hours around it.'},
  {name:'Natalie V.',title:'Professional Event Planner & Coordinator',stars:5,tool:'UBP',img:'https://randomuser.me/api/portraits/women/12.jpg',text:'Sinking funds are perfect for my work. I create one for each upcoming event and watch the progress bars fill up. When the event arrives, the money is already there. No stress.'},
  {name:'Alex J.',title:'Computer Science Major & Part-Time Tutor',stars:4,tool:'SBP',img:'https://randomuser.me/api/portraits/men/18.jpg',text:'I showed this to my roommates and now all four of us use it. It runs in the browser so there is nothing to install. We each have our own budget on our own laptop. Simple and private.'},
  {name:'Linda M.',title:'Retired Public School Teacher on a Pension',stars:5,tool:'SBP',img:'https://randomuser.me/api/portraits/women/79.jpg',text:'At 63 I did not want another app to learn. This took me five minutes. I track my pension, Social Security, and monthly expenses. The CSV export lets my financial advisor review everything.'},
  {name:'Hassan E.',title:'Civil Engineer & First-Generation Homeowner',stars:5,tool:'UBP',img:'https://randomuser.me/api/portraits/men/94.jpg',text:'Bought a house last year and suddenly had a dozen new bills to track. The Ultimate planner keeps my mortgage, insurance, utilities, and maintenance funds all organized. Wish I had found it sooner.'},
];

function renderCarousel() {
  const track = document.getElementById('rcTrack');
  const dots  = document.getElementById('rcDots');
  if (!track) return;
  track.innerHTML = REVIEWS.map((r,i) => {
    const initials = r.name.split(' ').map(w=>w[0]).join('');
    const stars = '★'.repeat(r.stars) + (r.stars < 5 ? '☆'.repeat(5-r.stars) : '');
    const avatar = r.img
      ? `<img class="rc-avatar" src="${esc(r.img)}" alt="${esc(r.name)}" loading="lazy" />`
      : `<div class="rc-avatar-fallback" style="background:${r.color||'#6366f1'}">${esc(initials)}</div>`;
    return `<div class="rc-card" data-idx="${i}">
      <div class="rc-card-top">
        ${avatar}
        <div class="rc-meta"><strong class="rc-name">${esc(r.name)}</strong><span class="rc-title">${esc(r.title)}</span></div>
        <span class="rc-pill rc-pill--${r.tool==='UBP'?'ubp':'sbp'}">${r.tool}</span>
      </div>
      <div class="rc-stars" aria-label="${r.stars} stars">${stars}</div>
      <p class="rc-text">"${esc(r.text)}"</p>
    </div>`;
  }).join('');

  const perPage = () => window.innerWidth <= 680 ? 1 : window.innerWidth <= 900 ? 2 : 3;
  let page = 0;
  function totalPages(){ return Math.ceil(REVIEWS.length / perPage()); }
  function go(p){
    page = Math.max(0, Math.min(p, totalPages()-1));
    const card = track.querySelector('.rc-card');
    if (!card) return;
    const gap = 16;
    const cardW = card.offsetWidth;
    // offsetWidth is 0 when an ancestor view is display:none; skip so we don't
    // bake in a wrong transform - the ResizeObserver re-runs go() once laid out.
    if (!cardW) return;
    track.style.transform = `translateX(-${page * perPage() * (cardW + gap)}px)`;
    renderDots();
  }
  function renderDots(){
    if (!dots) return;
    const tp = totalPages();
    dots.innerHTML = Array.from({length:tp},(_,i)=>`<button class="rc-dot${i===page?' is-active':''}" data-p="${i}" type="button" aria-label="Page ${i+1}"></button>`).join('');
    dots.querySelectorAll('.rc-dot').forEach(d=>d.addEventListener('click',()=>go(+d.dataset.p)));
  }
  document.getElementById('rcLeft')?.addEventListener('click', ()=>go(page-1));
  document.getElementById('rcRight')?.addEventListener('click', ()=>go(page+1));
  const viewport = track.parentElement;
  if (window.ResizeObserver && viewport) {
    // Recompute when the carousel is actually laid out (0 -> real width when the
    // hub view is re-shown, on orientation change, or after fonts/images settle).
    let lastW = -1;
    new ResizeObserver(entries => {
      const w = entries[0].contentRect.width;
      if (w > 0 && Math.abs(w - lastW) > 0.5) { lastW = w; go(Math.min(page, totalPages()-1)); }
    }).observe(viewport);
  } else {
    let resizeTimer; window.addEventListener('resize',()=>{clearTimeout(resizeTimer);resizeTimer=setTimeout(()=>go(Math.min(page,totalPages()-1)),120);});
  }
  go(0);
}

// ══════════════════════════════════════════════════════════════════════
//  ONBOARDING WALKTHROUGH
//  Runs once, the first time a brand-new user reaches the budget view
//  with no real data yet (state.settings.onboardingDone gates it for
//  good). Step 1 collects currency/period with a dedicated setup UI
//  that writes straight into state.settings (the real Settings tab is
//  never touched/navigated to). Steps 2-3 spotlight the actual live
//  dashboard UI and wait for the user to perform the real action. Step
//  4 is a short "what else you can do" wrap-up.
// ══════════════════════════════════════════════════════════════════════
let onbActive = false;
let onbPollTimer = null;
let onbResizeHandler = null;
const ONB_TOTAL_STEPS = 4;

function maybeStartOnboarding() {
  if (onbActive || hasAnyData() || state.settings.onboardingDone) return;
  onbActive = true;
  onbShowSetup();
}

function onbClearOverlay() {
  document.getElementById('onbOverlay')?.remove();
  document.getElementById('onbMask')?.remove();
  document.getElementById('onbCoach')?.remove();
  if (onbPollTimer) { clearInterval(onbPollTimer); onbPollTimer = null; }
  if (onbResizeHandler) { window.removeEventListener('resize', onbResizeHandler); window.removeEventListener('scroll', onbResizeHandler, true); onbResizeHandler = null; }
}

function onbFinish() {
  onbClearOverlay();
  state.settings.onboardingDone = true;
  saveState();
  onbActive = false;
  switchBTab('dashboard');
}

function onbSkipAll() {
  onbClearOverlay();
  loadSampleData();
  state.settings.onboardingDone = true;
  saveState();
  onbActive = false;
}

function onbCloseOverlayEl(ov, then) {
  ov.classList.add('is-leaving');
  setTimeout(() => { ov.remove(); then?.(); }, 200);
}

// ── Step 1: setup (currency + budget period) ────────────────────────────
function onbPeriodPresets() {
  const now = new Date(), d = now.getDay();
  const thisMonday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - (d === 0 ? 6 : d - 1));
  const q = Math.floor(now.getMonth() / 3);
  return {
    week:    [toLocalISO(thisMonday), toLocalISO(new Date(thisMonday.getFullYear(), thisMonday.getMonth(), thisMonday.getDate() + 6))],
    month:   [toLocalISO(new Date(now.getFullYear(), now.getMonth(), 1)), toLocalISO(new Date(now.getFullYear(), now.getMonth() + 1, 0))],
    quarter: [toLocalISO(new Date(now.getFullYear(), q * 3, 1)), toLocalISO(new Date(now.getFullYear(), q * 3 + 3, 0))],
    year:    [toLocalISO(new Date(now.getFullYear(), 0, 1)), toLocalISO(new Date(now.getFullYear(), 11, 31))],
  };
}

function onbShowSetup() {
  const presets = onbPeriodPresets();
  const currencies = [['USD','$'],['EUR','€'],['GBP','£'],['PLN','zł'],['JPY','¥'],['CAD','$'],
    ['AUD','$'],['CHF','CHF'],['SEK','kr'],['NOK','kr'],['DKK','kr'],
    ['INR','₹'],['BRL','R$'],['MXN','$'],['ZAR','R']];
  const periodLabels = { week:'this_week', month:'this_month', quarter:'this_quarter', year:'this_year' };
  let selectedPeriod = 'month';

  const ov = document.createElement('div');
  ov.className = 'onb-overlay';
  ov.id = 'onbOverlay';
  ov.setAttribute('role', 'dialog');
  ov.setAttribute('aria-modal', 'true');
  ov.setAttribute('aria-label', t('onb_setup_title'));
  ov.innerHTML = `
    <div class="onb-card" role="document">
      <div class="onb-progress">${[0,1,2,3].map(i => `<span class="onb-progress-dot${i===0?' is-active':''}"></span>`).join('')}</div>
      <div class="onb-step-label">${tf('onb_step_x_of_y', 1, ONB_TOTAL_STEPS)}</div>
      <div class="onb-icon">👋</div>
      <h2 class="onb-title">${t('onb_setup_title')}</h2>
      <p class="onb-sub">${t('onb_setup_sub')}</p>
      <div class="onb-section">
        <label class="onb-field-label" for="onbCurrency">${t('select_currency')}</label>
        <select class="select" id="onbCurrency">
          ${currencies.map(([c,s]) => `<option value="${c}|${s}" ${state.settings.currency===c?'selected':''}>${c} (${s})</option>`).join('')}
        </select>
      </div>
      <div class="onb-section">
        <span class="onb-field-label">${t('budget_period')}</span>
        <div class="onb-period-grid" id="onbPeriodGrid">
          ${['week','month','quarter','year'].map(k => `<button class="onb-period-chip${k===selectedPeriod?' is-active':''}" data-period="${k}" type="button">${t(periodLabels[k])}</button>`).join('')}
        </div>
      </div>
      <div class="onb-actions">
        <button class="btn btn-primary" id="onbSetupContinue" type="button">${t('onb_continue_btn')}</button>
        <button class="onb-skip-link" id="onbSkipBtn" type="button">${t('onb_skip_link')}</button>
      </div>
    </div>`;
  document.body.appendChild(ov);

  ov.querySelectorAll('.onb-period-chip').forEach(btn => {
    btn.addEventListener('click', () => {
      selectedPeriod = btn.dataset.period;
      ov.querySelectorAll('.onb-period-chip').forEach(b => b.classList.toggle('is-active', b === btn));
    });
  });
  ov.querySelector('#onbSetupContinue').addEventListener('click', () => {
    const [currency, symbol] = document.getElementById('onbCurrency').value.split('|');
    const [start, end] = presets[selectedPeriod];
    state.settings.currency = currency;
    state.settings.symbol = symbol;
    state.settings.periodStart = start;
    state.settings.periodEnd = end;
    syncSymbol();
    saveState();
    onbCloseOverlayEl(ov, () => onbStartSpotlight(0));
  });
  ov.querySelector('#onbSkipBtn').addEventListener('click', () => onbCloseOverlayEl(ov, onbSkipAll));
  requestAnimationFrame(() => ov.classList.add('is-in'));
}

// ── Steps 2-3: spotlight the real UI, wait for the real action ─────────
const ONB_SPOTLIGHT_STEPS = [
  {
    tab: 'income', selector: '.expected-input',
    titleKey: 'onb_spot_budget_title', bodyKey: 'onb_spot_budget_body',
    isDone: () => state.budgets.income.some(r => (r.expected || 0) > 0),
  },
  {
    tab: 'transactions', selector: '.tx-form-panel',
    titleKey: 'onb_spot_tx_title', bodyKey: 'onb_spot_tx_body',
    isDone: () => state.transactions.length > 0,
  },
];

function onbStartSpotlight(idx) {
  const cfg = ONB_SPOTLIGHT_STEPS[idx];
  if (!cfg) { onbShowTips(); return; }
  switchBTab(cfg.tab); // synchronous DOM replacement - the target is queryable immediately after
  onbRenderSpotlight(cfg, idx);
}

function onbRenderSpotlight(cfg, idx) {
  onbClearOverlay();
  const target = document.querySelector(cfg.selector);
  if (!target) { onbAdvanceSpotlight(idx); return; }

  const mask = document.createElement('div');
  mask.className = 'onb-mask';
  mask.id = 'onbMask';
  mask.innerHTML = `<div class="onb-mask-hole" id="onbHole"><div class="onb-mask-ring"></div></div>`;
  document.body.appendChild(mask);

  const coach = document.createElement('div');
  coach.className = 'onb-coach';
  coach.id = 'onbCoach';
  coach.setAttribute('role', 'dialog');
  coach.innerHTML = `
    <div class="onb-coach-step">${tf('onb_step_x_of_y', idx + 2, ONB_TOTAL_STEPS)}</div>
    <div class="onb-coach-title">${t(cfg.titleKey)}</div>
    <div class="onb-coach-body">${t(cfg.bodyKey)}</div>
    <div class="onb-coach-actions">
      <button class="onb-skip-link" id="onbCoachSkip" type="button">${t('onb_skip_link')}</button>
      <button class="btn btn-primary btn-sm" id="onbCoachNext" type="button">${t('onb_next_btn')}</button>
    </div>`;
  document.body.appendChild(coach);

  const position = () => {
    const hole = document.getElementById('onbHole');
    const coachEl = document.getElementById('onbCoach');
    if (!hole || !coachEl || !document.body.contains(target)) return;
    const r = target.getBoundingClientRect(), pad = 8;
    hole.style.top = `${r.top - pad}px`;
    hole.style.left = `${r.left - pad}px`;
    hole.style.width = `${r.width + pad * 2}px`;
    hole.style.height = `${r.height + pad * 2}px`;

    const cw = coachEl.offsetWidth || 300, ch = coachEl.offsetHeight || 140;
    let top = r.bottom + pad + 12;
    if (top + ch > window.innerHeight - 16) top = Math.max(16, r.top - pad - 12 - ch);
    const left = Math.min(Math.max(16, r.left), window.innerWidth - cw - 16);
    coachEl.style.top = `${top}px`;
    coachEl.style.left = `${left}px`;
  };
  position();
  onbResizeHandler = position;
  window.addEventListener('resize', onbResizeHandler);
  window.addEventListener('scroll', onbResizeHandler, true);
  requestAnimationFrame(() => coach.classList.add('is-in'));

  document.getElementById('onbCoachNext').addEventListener('click', () => onbAdvanceSpotlight(idx));
  document.getElementById('onbCoachSkip').addEventListener('click', onbSkipAll);

  onbPollTimer = setInterval(() => { if (cfg.isDone()) onbAdvanceSpotlight(idx, true); }, 600);
}

function onbAdvanceSpotlight(idx, completed) {
  onbClearOverlay();
  if (completed) showToast(t('onb_nice_toast'));
  onbStartSpotlight(idx + 1);
}

// ── Step 4: wrap-up tips ─────────────────────────────────────────────────
function onbShowTips() {
  const ov = document.createElement('div');
  ov.className = 'onb-overlay';
  ov.id = 'onbOverlay';
  ov.setAttribute('role', 'dialog');
  ov.setAttribute('aria-modal', 'true');
  ov.setAttribute('aria-label', t('onb_tips_title'));
  ov.innerHTML = `
    <div class="onb-card" role="document">
      <div class="onb-progress">${[0,1,2,3].map(() => `<span class="onb-progress-dot is-done"></span>`).join('')}</div>
      <div class="onb-step-label">${tf('onb_step_x_of_y', ONB_TOTAL_STEPS, ONB_TOTAL_STEPS)}</div>
      <div class="onb-icon">🎉</div>
      <h2 class="onb-title">${t('onb_tips_title')}</h2>
      <p class="onb-sub">${t('onb_tips_sub')}</p>
      <div class="onb-tips-list">
        <div class="onb-tip"><span class="onb-tip-icon">📖</span><span><strong>${t('onb_tip1_h')}</strong> ${t('onb_tip1_b')}</span></div>
        <div class="onb-tip"><span class="onb-tip-icon">🎨</span><span><strong>${t('onb_tip2_h')}</strong> ${t('onb_tip2_b')}</span></div>
        <div class="onb-tip"><span class="onb-tip-icon">☁️</span><span><strong>${t('onb_tip3_h')}</strong> ${t('onb_tip3_b')}</span></div>
        <div class="onb-tip"><span class="onb-tip-icon">📤</span><span><strong>${t('onb_tip4_h')}</strong> ${t('onb_tip4_b')}</span></div>
      </div>
      <div class="onb-actions">
        <button class="btn btn-primary" id="onbFinishBtn" type="button">${t('onb_finish_btn')}</button>
      </div>
    </div>`;
  document.body.appendChild(ov);
  ov.querySelector('#onbFinishBtn').addEventListener('click', () => onbCloseOverlayEl(ov, onbFinish));
  requestAnimationFrame(() => ov.classList.add('is-in'));
}

document.addEventListener('DOMContentLoaded', init);

// ── Keyboard Navigation (SBP) ─────────────────────────────────────────
// Enter in transaction amount/desc → add transaction
document.addEventListener('keydown', e => {
  if (e.key !== 'Enter') return;
  const active = document.activeElement;
  if (!active) return;

  // Transaction form: Enter in amount or desc triggers Add
  if (active.id === 'txAmount' || active.id === 'txDesc') {
    e.preventDefault();
    document.getElementById('addTxBtn')?.click();
    return;
  }

  // Settings date fields: Enter moves to next or saves
  if (active.id === 'settStart') {
    e.preventDefault();
    document.getElementById('settEndWrap')?.click();
    return;
  }

  // Modal primary button: Enter confirms (unless on a select)
  if (active.tagName !== 'SELECT' && active.tagName !== 'TEXTAREA' && active.tagName !== 'BUTTON') {
    const overlay = document.getElementById('tutorialOverlay');
    if (overlay && !overlay.hidden) {
      e.preventDefault();
      overlay.querySelector('.btn-primary')?.click();
    }
  }
});

// Calendar arrow-key month navigation (SBP - if calendar tab active)
document.addEventListener('keydown', e => {
  if (document.getElementById('bview-calendar')?.classList.contains('is-active')) {
    if (e.key === 'ArrowLeft')  { e.preventDefault(); document.getElementById('calPrev')?.click(); }
    if (e.key === 'ArrowRight') { e.preventDefault(); document.getElementById('calNext')?.click(); }
  }
});
