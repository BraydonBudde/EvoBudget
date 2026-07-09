'use strict';
/* Evo Budget - v2.7 "Onboarding & Upgrade"  (2026-07-01)
   Change set vs v1.0 "Baseline":
   - All native browser confirm()/alert() popups replaced with in-app
     glass dialogs (confirmDialog / alertDialog) - mobile-friendly.
   - UBP: duplicated init()/applyLayout() collapsed into one; recurring
     engine restored and init now runs exactly once. */
/* =====================================================================
   Evo Budget - script.js  v2
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
    expected:'Expected', actual:'Actual',
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
    light:'Light', dark:'Dark',
    changes_autosaved:'✅ Changes are saved automatically.',
    rollover_desc:'Carry unspent money from your previous period into this one.',
    rollover_amount:'Rollover amount',
    reset_desc:'Permanently deletes all your data. This cannot be undone.',
    reset_btn:'Reset everything',
    // Common
    add:'Add', cancel:'Cancel',rename_title_prompt:'Rename your budget planner', save:'Save', delete:'Delete',dp_today:'Today',dp_clear:'Clear', edit:'Edit',
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
    appearance_desc:'Switch between light and dark mode.',video_tutorial:'▶ Video Tutorial',
    help_sett_modal_title:'How Settings work',help_sett_intro:'Customise Evo Budget to match your situation.',
    help_sett_currency_li:'Updates the symbol everywhere (some currencies like PLN place the symbol after the amount).',
    help_sett_period_li:'Set your date range. Click the date badge on Dashboard to jump here quickly.',
    help_sett_rollover_li:'Carry forward unspent money from the last period.',
    help_sett_theme_li:'Use the sun/moon toggle in the top bar to switch Light and Dark mode.',
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
    help_bills_duedate_li:'Set when each bill is due.',help_bills_paid_li:'Tick when you\'ve made the payment.',help_bills_actual_li:'Populated from Bill transactions with matching category name.',
    help_debt_modal_title:'How Debt works',help_debt_intro:'Stay on top of loan repayments and mortgages.',
    help_debt_expected_li:'Your planned monthly payment.',help_debt_duedate_li:'When the payment is due.',help_debt_paid_li:'Mark when the payment clears.',
    help_sav_modal_title:'How Savings work',help_sav_intro:'Set savings goals and track contributions.',
    help_sav_expected_li:'Your savings target for this period.',help_sav_actual_li:'From Savings type transactions.',
    help_sav_tip:'💡 Tip: Treat savings like a fixed expense - budget it first, spend the rest.',
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
    expected:'Geplant',actual:'Tatsächlich',
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
    light:'Hell',dark:'Dunkel',
    changes_autosaved:'✅ Änderungen werden automatisch gespeichert.',
    rollover_desc:'Überträgt nicht ausgegebenes Geld aus der vorherigen Periode.',
    rollover_amount:'Übertragsbetrag',
    reset_desc:'Löscht alle Daten dauerhaft. Dies kann nicht rückgängig gemacht werden.',
    reset_btn:'Alles zurücksetzen',
    add:'Hinzufügen',cancel:'Abbrechen',rename_title_prompt:'Budgetplaner umbenennen',save:'Speichern',delete:'Löschen',dp_today:'Heute',dp_clear:'Löschen',edit:'Bearbeiten',
    paid:'Bezahlt',due_date:'Fälligkeitsdatum',category:'Kategorie',amount:'Betrag',
    description:'Beschreibung',date:'Datum',type:'Typ',
    add_category:'+ Kategorie hinzufügen',no_transactions:'Noch keine Transaktionen.',
    upgrade_title:'Upgrade auf Ultimate Budget Planner',
    upgrade_desc:'Alles aus Simple, plus die Pro-Tools, um voranzukommen: Schulden abbauen, gezielt sparen und keine Rechnung mehr verpassen.',
    upgrade_now:'Jetzt upgraden →',upgrade_get_now:'JETZT HOLEN',upgrade_compare:'PLANER VERGLEICHEN',sett_upgrade_h:'Upgrade-Banner',sett_upgrade_label:'Upgrade-Banner im Dashboard anzeigen',
    mon:'Mo',tue:'Di',wed:'Mi',thu:'Do',fri:'Fr',sat:'Sa',sun:'So',
    quick_presets:'Schnellauswahl:',select_currency:'Währung auswählen',select_language:'Sprache auswählen',
    appearance_desc:'Zwischen hellem und dunklem Modus wechseln.',video_tutorial:'▶ Video-Tutorial',
    help_sett_modal_title:'Einstellungen im Überblick',help_sett_intro:'Passe Evo Budget an deine Situation an.',
    help_sett_currency_li:'Aktualisiert das Symbol überall (manche Währungen wie PLN setzen das Symbol nach dem Betrag).',
    help_sett_period_li:'Lege deinen Datumsbereich fest. Klicke auf das Datums-Badge im Dashboard, um schnell hierher zu gelangen.',
    help_sett_rollover_li:'Überträgt nicht ausgegebenes Geld aus der letzten Periode.',
    help_sett_theme_li:'Nutze den Sonne/Mond-Schalter in der oberen Leiste, um zwischen Hell- und Dunkelmodus zu wechseln.',
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
    help_bills_duedate_li:'Lege fest, wann jede Rechnung fällig ist.',help_bills_paid_li:'Hake ab, sobald du die Zahlung geleistet hast.',help_bills_actual_li:'Wird aus Rechnung-Transaktionen mit passendem Kategorienamen befüllt.',
    help_debt_modal_title:'Wie Schulden funktionieren',help_debt_intro:'Behalte Kredit- und Hypothekenzahlungen im Blick.',
    help_debt_expected_li:'Deine geplante monatliche Zahlung.',help_debt_duedate_li:'Wann die Zahlung fällig ist.',help_debt_paid_li:'Markiere sie, sobald die Zahlung erfolgt ist.',
    help_sav_modal_title:'Wie Ersparnisse funktionieren',help_sav_intro:'Lege Sparziele fest und verfolge deine Einzahlungen.',
    help_sav_expected_li:'Dein Sparziel für diesen Zeitraum.',help_sav_actual_li:'Aus Transaktionen vom Typ Ersparnisse.',
    help_sav_tip:'💡 Tipp: Behandle Sparen wie eine feste Ausgabe - budgetiere es zuerst und gib danach den Rest aus.',
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
    expected:'Prévu',actual:'Réel',
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
    light:'Clair',dark:'Sombre',
    changes_autosaved:'✅ Les modifications sont enregistrées automatiquement.',
    rollover_desc:"Reporte l'argent non dépensé de la période précédente.",
    rollover_amount:'Montant du report',
    reset_desc:'Supprime définitivement toutes vos données. Irréversible.',
    reset_btn:'Tout réinitialiser',
    add:'Ajouter',cancel:'Annuler',rename_title_prompt:'Renommer votre planificateur de budget',save:'Enregistrer',delete:'Supprimer',dp_today:"Aujourd'hui",dp_clear:'Effacer',edit:'Modifier',
    paid:'Payé',due_date:"Date d'échéance",category:'Catégorie',amount:'Montant',
    description:'Description',date:'Date',type:'Type',
    add_category:'+ Ajouter une catégorie',no_transactions:'Aucune transaction.',
    upgrade_title:'Passer à Ultimate Budget Planner',
    upgrade_desc:"Tout ce qu'offre Simple, plus les outils pro pour progresser : éliminez vos dettes, épargnez pour l'essentiel et ne manquez plus aucune facture.",
    upgrade_now:'Mettre à niveau →',upgrade_get_now:'OBTENIR',upgrade_compare:'COMPARER',sett_upgrade_h:'Bannière de mise à niveau',sett_upgrade_label:'Afficher la bannière sur le tableau de bord',
    mon:'Lun',tue:'Mar',wed:'Mer',thu:'Jeu',fri:'Ven',sat:'Sam',sun:'Dim',
    quick_presets:'Raccourcis :',select_currency:'Sélectionnez votre devise',select_language:'Sélectionner la langue',
    appearance_desc:'Basculer entre le mode clair et sombre.',video_tutorial:'▶ Tutoriel vidéo',
    help_sett_modal_title:'Fonctionnement des paramètres',help_sett_intro:'Personnalisez Evo Budget selon votre situation.',
    help_sett_currency_li:"Met à jour le symbole partout (certaines devises comme le PLN placent le symbole après le montant).",
    help_sett_period_li:'Définissez votre plage de dates. Cliquez sur le badge de date du tableau de bord pour y accéder rapidement.',
    help_sett_rollover_li:"Reporte l'argent non dépensé de la dernière période.",
    help_sett_theme_li:'Utilisez le bouton soleil/lune dans la barre supérieure pour basculer entre les modes clair et sombre.',
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
    help_bills_duedate_li:"Définissez la date d'échéance de chaque facture.",help_bills_paid_li:'Cochez une fois le paiement effectué.',help_bills_actual_li:'Renseigné à partir des transactions de type Facture portant le même nom de catégorie.',
    help_debt_modal_title:'Comment fonctionnent les dettes',help_debt_intro:'Gardez le contrôle sur vos remboursements de prêts et de crédits immobiliers.',
    help_debt_expected_li:'Votre paiement mensuel prévu.',help_debt_duedate_li:"La date d'échéance du paiement.",help_debt_paid_li:'Marquez-le une fois le paiement effectué.',
    help_sav_modal_title:"Comment fonctionne l'épargne",help_sav_intro:"Définissez des objectifs d'épargne et suivez vos versements.",
    help_sav_expected_li:"Votre objectif d'épargne pour cette période.",help_sav_actual_li:'À partir des transactions de type Épargne.',
    help_sav_tip:"💡 Astuce : Traitez l'épargne comme une dépense fixe - budgétez-la en premier, puis dépensez le reste.",
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
    expected:'Previsto',actual:'Real',
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
    light:'Claro',dark:'Oscuro',
    changes_autosaved:'✅ Los cambios se guardan automáticamente.',
    rollover_desc:'Traspasa el dinero no gastado del período anterior.',
    rollover_amount:'Importe de saldo anterior',
    reset_desc:'Elimina permanentemente todos tus datos. No se puede deshacer.',
    reset_btn:'Restablecer todo',
    add:'Añadir',cancel:'Cancelar',rename_title_prompt:'Renombrar tu planificador de presupuesto',save:'Guardar',delete:'Eliminar',dp_today:'Hoy',dp_clear:'Borrar',edit:'Editar',
    paid:'Pagado',due_date:'Fecha de vencimiento',category:'Categoría',amount:'Importe',
    description:'Descripción',date:'Fecha',type:'Tipo',
    add_category:'+ Añadir categoría',no_transactions:'Sin transacciones aún.',
    upgrade_title:'Actualiza a Ultimate Budget Planner',
    upgrade_desc:'Todo lo de Simple, más las herramientas pro para avanzar: elimina deudas, ahorra para lo importante y no te pierdas ninguna factura.',
    upgrade_now:'Actualizar ahora →',upgrade_get_now:'OBTENER',upgrade_compare:'COMPARAR',sett_upgrade_h:'Banner de actualización',sett_upgrade_label:'Mostrar el banner en el panel',
    mon:'Lun',tue:'Mar',wed:'Mié',thu:'Jue',fri:'Vie',sat:'Sáb',sun:'Dom',
    quick_presets:'Accesos rápidos:',select_currency:'Selecciona tu moneda',select_language:'Seleccionar idioma',
    appearance_desc:'Cambiar entre modo claro y oscuro.',video_tutorial:'▶ Tutorial en vídeo',
    help_sett_modal_title:'Cómo funcionan los ajustes',help_sett_intro:'Personaliza Evo Budget según tu situación.',
    help_sett_currency_li:'Actualiza el símbolo en todas partes (algunas monedas como PLN colocan el símbolo después del importe).',
    help_sett_period_li:'Establece tu rango de fechas. Haz clic en el distintivo de fecha del panel para acceder rápidamente aquí.',
    help_sett_rollover_li:'Traspasa el dinero no gastado del último período.',
    help_sett_theme_li:'Usa el botón sol/luna en la barra superior para cambiar entre los modos claro y oscuro.',
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
    help_bills_duedate_li:'Establece cuándo vence cada factura.',help_bills_paid_li:'Marca la casilla cuando hayas realizado el pago.',help_bills_actual_li:'Se rellena a partir de las transacciones de Factura con el mismo nombre de categoría.',
    help_debt_modal_title:'Cómo funcionan las deudas',help_debt_intro:'Mantente al día con los pagos de préstamos e hipotecas.',
    help_debt_expected_li:'Tu pago mensual previsto.',help_debt_duedate_li:'Cuándo vence el pago.',help_debt_paid_li:'Márcalo cuando se haga efectivo el pago.',
    help_sav_modal_title:'Cómo funcionan los ahorros',help_sav_intro:'Establece metas de ahorro y controla tus aportaciones.',
    help_sav_expected_li:'Tu objetivo de ahorro para este período.',help_sav_actual_li:'De las transacciones de tipo Ahorro.',
    help_sav_tip:'💡 Consejo: Trata el ahorro como un gasto fijo: presupuéstalo primero y gasta el resto.',
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
    expected:'Previsto',actual:'Effettivo',
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
    light:'Chiaro',dark:'Scuro',
    changes_autosaved:'✅ Le modifiche vengono salvate automaticamente.',
    rollover_desc:'Riporta il denaro non speso dal periodo precedente.',
    rollover_amount:'Importo riporto',
    reset_desc:'Elimina definitivamente tutti i dati. Non reversibile.',
    reset_btn:'Reimposta tutto',
    add:'Aggiungi',cancel:'Annulla',rename_title_prompt:'Rinomina il tuo pianificatore di budget',save:'Salva',delete:'Elimina',dp_today:'Oggi',dp_clear:'Cancella',edit:'Modifica',
    paid:'Pagato',due_date:'Data di scadenza',category:'Categoria',amount:'Importo',
    description:'Descrizione',date:'Data',type:'Tipo',
    add_category:'+ Aggiungi categoria',no_transactions:'Nessuna transazione.',
    upgrade_title:'Passa a Ultimate Budget Planner',
    upgrade_desc:"Tutto ciò che c'è in Simple, più gli strumenti pro per andare avanti: azzera i debiti, risparmia per ciò che conta e non perdere mai una bolletta.",
    upgrade_now:'Aggiorna ora →',upgrade_get_now:'OTTIENI',upgrade_compare:'CONFRONTA',sett_upgrade_h:'Banner di upgrade',sett_upgrade_label:'Mostra il banner nella dashboard',
    mon:'Lun',tue:'Mar',wed:'Mer',thu:'Gio',fri:'Ven',sat:'Sab',sun:'Dom',
    quick_presets:'Selezione rapida:',select_currency:'Seleziona la tua valuta',select_language:'Seleziona lingua',
    appearance_desc:'Passa dalla modalità chiara a quella scura.',video_tutorial:'▶ Video Tutorial',
    help_sett_modal_title:'Come funzionano le impostazioni',help_sett_intro:'Personalizza Evo Budget in base alla tua situazione.',
    help_sett_currency_li:"Aggiorna il simbolo ovunque (alcune valute come il PLN inseriscono il simbolo dopo l'importo).",
    help_sett_period_li:'Imposta il tuo intervallo di date. Fai clic sul badge della data nel pannello per accedervi rapidamente.',
    help_sett_rollover_li:"Riporta il denaro non speso dall'ultimo periodo.",
    help_sett_theme_li:'Usa il pulsante sole/luna nella barra superiore per passare tra modalità chiara e scura.',
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
    help_bills_duedate_li:'Imposta quando scade ogni bolletta.',help_bills_paid_li:'Spunta la casella quando hai effettuato il pagamento.',help_bills_actual_li:'Popolato dalle transazioni di tipo Bolletta con lo stesso nome di categoria.',
    help_debt_modal_title:'Come funzionano i Debiti',help_debt_intro:'Tieni sotto controllo i rimborsi di prestiti e mutui.',
    help_debt_expected_li:'Il tuo pagamento mensile previsto.',help_debt_duedate_li:'Quando scade il pagamento.',help_debt_paid_li:'Segnalo quando il pagamento viene saldato.',
    help_sav_modal_title:'Come funzionano i Risparmi',help_sav_intro:'Imposta obiettivi di risparmio e monitora i tuoi versamenti.',
    help_sav_expected_li:'Il tuo obiettivo di risparmio per questo periodo.',help_sav_actual_li:'Dalle transazioni di tipo Risparmio.',
    help_sav_tip:'💡 Suggerimento: tratta il risparmio come una spesa fissa - mettilo a budget per primo e spendi il resto.',
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
    expected:'Planowane',actual:'Rzeczywiste',
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
    light:'Jasny',dark:'Ciemny',
    changes_autosaved:'✅ Zmiany są zapisywane automatycznie.',
    rollover_desc:'Przenieś niewydane środki z poprzedniego okresu.',
    rollover_amount:'Kwota przeniesienia',
    reset_desc:'Trwale usuwa wszystkie dane. Nie można cofnąć.',
    reset_btn:'Zresetuj wszystko',
    add:'Dodaj',cancel:'Anuluj',rename_title_prompt:'Zmień nazwę planera budżetu',save:'Zapisz',delete:'Usuń',dp_today:'Dziś',dp_clear:'Wyczyść',edit:'Edytuj',
    paid:'Zapłacone',due_date:'Termin płatności',category:'Kategoria',amount:'Kwota',
    description:'Opis',date:'Data',type:'Typ',
    add_category:'+ Dodaj kategorię',no_transactions:'Brak transakcji.',
    upgrade_title:'Przejdź na Ultimate Budget Planner',
    upgrade_desc:'Wszystko z Simple oraz narzędzia pro, aby iść naprzód: spłać długi, oszczędzaj na to, co ważne, i nie przegap żadnego rachunku.',
    upgrade_now:'Ulepsz teraz →',upgrade_get_now:'POBIERZ',upgrade_compare:'PORÓWNAJ',sett_upgrade_h:'Baner ulepszenia',sett_upgrade_label:'Pokaż baner na pulpicie',
    mon:'Pon',tue:'Wt',wed:'Śr',thu:'Czw',fri:'Pt',sat:'Sob',sun:'Nd',
    quick_presets:'Szybki wybór:',select_currency:'Wybierz walutę',select_language:'Wybierz język',
    appearance_desc:'Przełącz między trybem jasnym a ciemnym.',video_tutorial:'▶ Samouczek wideo',
    help_sett_modal_title:'Jak działają ustawienia',help_sett_intro:'Dostosuj Evo Budget do swojej sytuacji.',
    help_sett_currency_li:'Aktualizuje symbol wszędzie (niektóre waluty jak PLN umieszczają symbol po kwocie).',
    help_sett_period_li:'Ustaw zakres dat. Kliknij znacznik daty na panelu, aby szybko przejść tutaj.',
    help_sett_rollover_li:'Przenieś niewydane środki z ostatniego okresu.',
    help_sett_theme_li:'Użyj przełącznika słońce/księżyc na górnym pasku, aby przełączyć tryb jasny i ciemny.',
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
    help_bills_duedate_li:'Ustaw termin płatności każdego rachunku.',help_bills_paid_li:'Zaznacz, gdy dokonasz płatności.',help_bills_actual_li:'Uzupełniane na podstawie transakcji typu Rachunek o tej samej nazwie kategorii.',
    help_debt_modal_title:'Jak działają Długi',help_debt_intro:'Panuj nad spłatami kredytów i hipotek.',
    help_debt_expected_li:'Twoja planowana miesięczna płatność.',help_debt_duedate_li:'Termin płatności.',help_debt_paid_li:'Zaznacz, gdy płatność zostanie zaksięgowana.',
    help_sav_modal_title:'Jak działają Oszczędności',help_sav_intro:'Ustal cele oszczędnościowe i śledź swoje wpłaty.',
    help_sav_expected_li:'Twój cel oszczędnościowy na ten okres.',help_sav_actual_li:'Z transakcji typu Oszczędności.',
    help_sav_tip:'💡 Wskazówka: Traktuj oszczędności jak stały wydatek - zaplanuj je najpierw, a resztę wydaj.',
  }
};

function t(key) {
  const lang = state?.settings?.language || 'en';
  const v = TRANSLATIONS[lang]?.[key] ?? TRANSLATIONS.en[key];
  if (v != null) return v;
  // Last-resort safeguard: never render a raw key identifier in the UI
  return String(key).replace(/^(tx|sf|dpc|cal|sett|alloc|bud|dtype|help|toast|freq|dash|sub|rec|dp|sett)_/, '').replace(/_/g, ' ').replace(/^\w/, c => c.toUpperCase());
}
function tf(key,...args){let s=t(key);args.forEach((v,i)=>s=s.replace(`{${i}}`,v));return s;}

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
    settings: { currency: 'USD', symbol: '$', periodStart: start, periodEnd: end, language: 'en', hideUpgrade: false },
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
const PURCHASE_URLS = { sbp: '', ubp: '' };  // leave '' to show a placeholder toast
const PRICES        = { sbp: '$9.99', ubp: '$19.99' };
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

// ── Upgrade prompt ─────────────────────────────────────────────────────
function showUpgradeModal(ctx = {}) {
  document.getElementById('fkUpgradeOverlay')?.remove();

  let chip;
  if (ctx.reason === 'transaction') chip = `${TRIAL_LIMITS.transactions} / ${TRIAL_LIMITS.transactions} free transactions used`;
  else if (ctx.reason === 'category') {
    const label = MODULE_META[ctx.type]?.title || 'category';
    chip = `${TRIAL_LIMITS[ctx.type]} / ${TRIAL_LIMITS[ctx.type]} free ${label} categories used`;
  } else chip = 'Free trial limit reached';

  const check = `<svg class="fk-up-check" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>`;

  const ov = document.createElement('div');
  ov.className = 'fk-up-overlay';
  ov.id = 'fkUpgradeOverlay';
  ov.setAttribute('role', 'dialog');
  ov.setAttribute('aria-modal', 'true');
  ov.setAttribute('aria-label', 'Upgrade to unlock the full planner');
  ov.innerHTML = `
    <div class="fk-up-card" role="document">
      <button class="fk-up-x" id="fkUpClose" type="button" aria-label="Close">&times;</button>
      <div class="fk-up-hero">
        <div class="fk-up-glow" aria-hidden="true"></div>
        <div class="fk-up-badge">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="11" width="18" height="10" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
          ${esc(chip)}
        </div>
        <h2 class="fk-up-title">Unlock the full<br>Simple Budget Planner</h2>
        <p class="fk-up-sub">You're at the free trial limit. Upgrade once to remove every cap. No subscription, ever.</p>
      </div>
      <div class="fk-up-body">
        <ul class="fk-up-list">
          <li>${check}<span><strong>Unlimited</strong> transactions</span></li>
          <li>${check}<span><strong>Unlimited</strong> categories in every section</span></li>
          <li>${check}<span>CSV import &amp; export, full history</span></li>
          <li>${check}<span>One-time payment · free updates for life</span></li>
        </ul>
        <div class="fk-up-price-row">
          <div class="fk-up-price"><span class="fk-up-price-num">${esc(PRICES.sbp)}</span><span class="fk-up-price-tag">one-time</span></div>
          <span class="fk-up-price-note">No subscription</span>
        </div>
        <button class="fk-up-cta" id="fkUpBuySbp" type="button">Unlock Simple Budget for ${esc(PRICES.sbp)}</button>
        <button class="fk-up-upsell" id="fkUpBuyUbp" type="button">
          <span class="fk-up-upsell-lead">⚡ Want debt payoff, sinking funds &amp; more?</span>
          <span class="fk-up-upsell-cta">Get Ultimate for ${esc(PRICES.ubp)} →</span>
        </button>
        <div class="fk-up-foot">
          <button class="fk-up-later" id="fkUpLater" type="button">Maybe later</button>
        </div>
      </div>
    </div>`;
  document.body.appendChild(ov);

  const close = () => { ov.classList.add('is-leaving'); document.removeEventListener('keydown', onKey); setTimeout(() => ov.remove(), 180); };
  const onKey = e => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
  document.addEventListener('keydown', onKey);
  ov.addEventListener('click', e => { if (e.target === ov) close(); });
  ov.querySelector('#fkUpClose')?.addEventListener('click', close);
  ov.querySelector('#fkUpLater')?.addEventListener('click', close);
  ov.querySelector('#fkUpBuySbp')?.addEventListener('click', () => goToPurchase('sbp'));
  ov.querySelector('#fkUpBuyUbp')?.addEventListener('click', () => goToPurchase('ubp'));
  requestAnimationFrame(() => ov.classList.add('is-in'));
}

// ══════════════════════════════════════════════════════════════════════
//  ACCESS CODES + LAUNCH ROUTING (both tools)
//  "Open" needs a code (full version); "Try for free" opens the trial.
// ══════════════════════════════════════════════════════════════════════
const UBP_MODE_KEY  = 'evobudget_ubp_mode';                // 'trial' | 'full'
const ACCESS_CODES  = { sbp: 'SBP', ubp: 'UBP' };           // case-sensitive
const UNLOCK_KEYS   = { sbp: 'evobudget_sbp_unlocked', ubp: 'evobudget_ubp_unlocked' };

function setUbpMode(m)   { localStorage.setItem(UBP_MODE_KEY, m); }
function isUnlocked(tool){ return localStorage.getItem(UNLOCK_KEYS[tool]) === '1'; }
function setUnlocked(tool){ localStorage.setItem(UNLOCK_KEYS[tool], '1'); }

function enterFull(tool)  { if (tool === 'ubp') { setUbpMode('full'); syncStashTokenForHandoff('ubp'); window.location.href = 'ultimate-budget.html'; } else enterSbpFull(); }
function enterTrial(tool) { if (tool === 'ubp') { setUbpMode('trial'); window.location.href = 'ultimate-budget.html'; } else enterSbpTrial(); }

async function openFull(tool) {
  if (!isUnlocked(tool)) { showAccessCodeModal(tool); return; }
  if (syncGetMode(tool) !== 'google') { enterFull(tool); return; }
  const result = await syncSilentResync(tool).catch(() => ({ authOk: false, data: null }));
  if (result.authOk) enterFull(tool);
  else showGoogleReauthModal(tool);
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
      <button class="fk-code-x" id="fkReauthClose" type="button" aria-label="Close">&times;</button>
      <div class="fk-code-key" aria-hidden="true">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 16l4-4m0 0l-4-4m4 4H7m6 5v1a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3V6a3 3 0 0 1 3-3h4a3 3 0 0 1 3 3v1"/></svg>
      </div>
      <h2 class="fk-code-title">Sign in with Google to continue</h2>
      <p class="fk-code-sub">Your data for this tool is synced with Google Drive. Sign in again to pick up where you left off.</p>
      <p class="fk-code-error" id="fkReauthError" hidden></p>
      <button class="fk-code-submit" id="fkReauthSubmit" type="button">Sign in with Google</button>
      <div class="fk-code-foot">
        <button class="fk-code-link" id="fkReauthLocal" type="button">Use local data on this device instead</button>
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
      <h2 class="fk-code-title">Welcome to Evo Budget</h2>
      <p class="fk-code-sub">Choose how to save your data.</p>
      <button class="fk-sync-option fk-sync-option--google" id="fkSyncGoogle" type="button">
        <span class="fk-sync-option-badge">Recommended</span>
        <span class="fk-sync-option-icon fk-sync-option-icon--google">${SYNC_ICON_GOOGLE}</span>
        <span class="fk-sync-option-text">
          <span class="fk-sync-option-title">Continue with Google</span>
          <span class="fk-sync-option-desc">Planner data is stored across multiple devices</span>
        </span>
        <span class="fk-sync-option-chevron">${SYNC_ICON_CHEVRON}</span>
      </button>
      <button class="fk-sync-option" id="fkSyncLocal" type="button">
        <span class="fk-sync-option-icon">${SYNC_ICON_LOCAL}</span>
        <span class="fk-sync-option-text">
          <span class="fk-sync-option-title">Use without an account</span>
          <span class="fk-sync-option-desc">Planner data is stored on this device only</span>
        </span>
        <span class="fk-sync-option-chevron">${SYNC_ICON_CHEVRON}</span>
      </button>
      <p class="fk-code-error" id="fkSyncError" hidden></p>
      <p class="fk-sync-status" id="fkSyncStatus" hidden>Complete the steps in the Google window that just opened. If nothing appeared, check your address bar for a blocked pop-up icon.</p>
      <p class="fk-sync-footer">This can be changed in settings later</p>
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

// ── Access-code prompt ─────────────────────────────────────────────────
function showAccessCodeModal(tool) {
  document.getElementById('fkCodeOverlay')?.remove();
  const isU  = tool === 'ubp';
  const name = isU ? 'Ultimate Budget Planner' : 'Simple Budget Planner';
  const code = ACCESS_CODES[tool];

  const ov = document.createElement('div');
  ov.className = 'fk-code-overlay';
  ov.id = 'fkCodeOverlay';
  ov.setAttribute('role', 'dialog');
  ov.setAttribute('aria-modal', 'true');
  ov.setAttribute('aria-label', 'Enter your access code');
  ov.innerHTML = `
    <div class="fk-code-card" role="document">
      <button class="fk-code-x" id="fkCodeClose" type="button" aria-label="Close">&times;</button>
      <div class="fk-code-key" aria-hidden="true">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3"/></svg>
      </div>
      <h2 class="fk-code-title">Enter your access code</h2>
      <p class="fk-code-sub">Unlock the full ${esc(name)} with the code from your purchase.</p>
      <input class="fk-code-input" id="fkCodeInput" type="text" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="Access code" aria-label="Access code" />
      <p class="fk-code-error" id="fkCodeError" hidden>That code isn't right. Check for exact capitalization and try again.</p>
      <button class="fk-code-submit" id="fkCodeSubmit" type="button">Submit</button>
      <div class="fk-code-foot">
        <button class="fk-code-link" id="fkCodeTry" type="button">Try for free instead</button>
        <button class="fk-code-link" id="fkCodeBuy" type="button">Get a code</button>
      </div>
    </div>`;
  document.body.appendChild(ov);

  const input = ov.querySelector('#fkCodeInput');
  const errEl = ov.querySelector('#fkCodeError');
  const card  = ov.querySelector('.fk-code-card');
  const close = () => { ov.classList.add('is-leaving'); document.removeEventListener('keydown', onKey); setTimeout(() => ov.remove(), 180); };
  const onKey = e => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
  const submit = () => {
    if (input.value.trim() === code) { setUnlocked(tool); close(); showSyncChoiceModal(tool); }
    else {
      errEl.hidden = false;
      card.classList.remove('shake'); void card.offsetWidth; card.classList.add('shake');
      input.select();
    }
  };
  document.addEventListener('keydown', onKey);
  ov.addEventListener('click', e => { if (e.target === ov) close(); });
  ov.querySelector('#fkCodeClose')?.addEventListener('click', close);
  ov.querySelector('#fkCodeSubmit')?.addEventListener('click', submit);
  input.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); submit(); } });
  input.addEventListener('input', () => { errEl.hidden = true; });
  ov.querySelector('#fkCodeTry')?.addEventListener('click', () => { close(); enterTrial(tool); });
  ov.querySelector('#fkCodeBuy')?.addEventListener('click', () => goToPurchase(tool));
  requestAnimationFrame(() => { ov.classList.add('is-in'); input.focus(); });
}

// ── Aggregations ──────────────────────────────────────────────────────
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
const COLOR_WHEEL = ['#6366f1','#10b981','#fb923c','#a855f7','#ec4899','#06b6d4','#eab308','#8b5cf6','#f43f5e','#3b82f6','#14b8a6','#f97316'];
let _did=0;

function svgDonut(segments, size = 130, sw = 17) {
  const r=size/2-sw/2, c=2*Math.PI*r, cx=size/2, cy=size/2;
  const gid='d'+(++_did);
  const defs=`<defs><radialGradient id="rg${gid}" cx="38%" cy="32%" r="68%"><stop offset="0%" stop-color="white" stop-opacity="0.18"/><stop offset="100%" stop-color="black" stop-opacity="0.06"/></radialGradient></defs>`;
  const bg=`<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="rgba(30,27,46,.08)" stroke-width="${sw}"/>`;
  if (!segments||!segments.length) return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" style="flex-shrink:0">${defs}${bg}</svg>`;
  let arcs='', cum=0;
  for (const seg of segments) {
    const p=seg.pct||0; if(p<=0){cum+=p;continue;}
    const dash=(p/100)*c, gap=c-dash, rot=-90+(cum/100)*360;
    arcs+=`<circle class="dseg" data-label="${seg.label||''}" data-pct="${p.toFixed(1)}"
      cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${seg.color}" stroke-width="${sw}"
      stroke-dasharray="${dash.toFixed(2)} ${gap.toFixed(2)}"
      transform="rotate(${rot.toFixed(2)} ${cx} ${cy})"
      style="cursor:pointer;transition:stroke-width .18s,opacity .18s"/>`;
    cum+=p;
  }
  const overlay=`<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="url(#rg${gid})" stroke-width="${sw+6}" pointer-events="none"/>`;
  const fs1=(size*.14).toFixed(0), fs2=(size*.085).toFixed(0);
  const center=`<g class="donut-center" pointer-events="none">
    <text class="donut-hover-pct" x="${cx}" y="${cy+2}" text-anchor="middle" dominant-baseline="middle"
      style="font-family:Sora,sans-serif;font-weight:800;font-size:${fs1}px;fill:var(--text-primary);opacity:0;transition:opacity .15s"></text>
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
    const show=seg=>{segs.forEach(s=>{s.setAttribute('stroke-width',baseSW);s.style.opacity='0.45';});
      seg.setAttribute('stroke-width',baseSW+5);seg.style.opacity='1';
      if(pctEl){pctEl.textContent=seg.dataset.pct+'%';pctEl.style.opacity='1';}
      if(lblEl){lblEl.textContent=seg.dataset.label;lblEl.style.opacity='1';}};
    const hide=()=>{segs.forEach(s=>{s.setAttribute('stroke-width',baseSW);s.style.opacity='1';});
      if(pctEl)pctEl.style.opacity='0'; if(lblEl)lblEl.style.opacity='0';};
    segs.forEach(seg=>{
      seg.addEventListener('mouseenter',()=>show(seg));
      seg.addEventListener('mouseleave',hide);
      seg.addEventListener('touchstart',e=>{e.preventDefault();show(seg);},{passive:false});
      seg.addEventListener('touchend',()=>setTimeout(hide,1600));
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
function initTheme() { applyTheme(localStorage.getItem('evobudget_theme') || 'light'); }

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
  }
  window.scrollTo(0, 0);
}

function switchBTab(tab) {
  currentBTab = tab;
  document.querySelectorAll('.btab').forEach(b => b.classList.toggle('is-active', b.dataset.btab === tab));
  document.querySelectorAll('.bview').forEach(v => v.classList.remove('is-active'));
  document.getElementById(`bview-${tab}`)?.classList.add('is-active');
  dispatchRender(tab);
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
  { id:'ubp',    icon:'⚡', color:'pink',   status:'live', name:'Ultimate Budget Planner', desc:'The pro upgrade. Debt payoff calculator, sinking funds tracker, smart calendar, and subscription tracker - all in one.' }
];

function renderHub() {
  document.getElementById('toolGrid').innerHTML = TOOLS.map(t => `
    <div class="tool-card tool-card--${t.color}${t.status === 'live' ? ' is-live' : ''}">
      <div class="tool-card-inner">
        <div class="tool-card-top">
          <span class="tool-card-icon">${t.icon}</span>
          ${t.status === 'live' ? '<span class="badge badge-live">Live</span>' : '<span class="badge badge-soon">Coming soon</span>'}
        </div>
        <h3 class="tool-card-name">${esc(t.name)}</h3>
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
  `).join('');

  // Open → full version (access code required)
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

// ── Dashboard ─────────────────────────────────────────────────────────
function renderDashboard() {
  const actuals = computeActuals();
  const sum     = computeSummary(actuals);

  const expIncome   = state.budgets.income.reduce((t, r) => t + (r.expected || 0), 0);
  const expExpenses = state.budgets.expenses.reduce((t, r) => t + (r.expected || 0), 0);
  const expBills    = state.budgets.bills.reduce((t, r) => t + (r.expected || 0), 0);
  const expDebt     = state.budgets.debt.reduce((t, r) => t + (r.expected || 0), 0);
  const expSavings  = state.budgets.savings.reduce((t, r) => t + (r.expected || 0), 0);
  const expExpBills = expExpenses + expBills;

  // Income donut
  const incItems = state.budgets.income
    .map((r, i) => ({ label: r.category, value: actuals.income[r.category] || 0, color: COLOR_WHEEL[i % COLOR_WHEEL.length] }))
    .filter(s => s.value > 0)
    .sort((a, b) => b.value - a.value);
  const incTotal = incItems.reduce((t, s) => t + s.value, 0);
  const incSegs  = incItems.map(s => ({ ...s, pct: incTotal > 0 ? s.value / incTotal * 100 : 0 }));

  // Spending donut
  const spendItems = [
    ...state.budgets.expenses.map((r, i)  => ({ label: r.category, value: actuals.expenses[r.category] || 0, color: COLOR_WHEEL[i % COLOR_WHEEL.length] })),
    ...state.budgets.bills.map((r, i)     => ({ label: r.category, value: actuals.bills[r.category]    || 0, color: COLOR_WHEEL[(i + 5) % COLOR_WHEEL.length] })),
    ...state.budgets.debt.map((r, i)      => ({ label: r.category, value: actuals.debt[r.category]     || 0, color: COLOR_WHEEL[(i + 9) % COLOR_WHEEL.length] }))
  ].filter(s => s.value > 0).sort((a, b) => b.value - a.value);
  const spendTotal = spendItems.reduce((t, s) => t + s.value, 0);
  const spendSegs  = spendItems.slice(0, 50).map(s => ({ ...s, pct: spendTotal > 0 ? s.value / spendTotal * 100 : 0 }));

  const leftColor = sum.leftover >= 0 ? '#10b981' : '#f43f5e';

  const flowRows = [
    { label:'Income',   exp:expIncome,   act:sum.totalIncome,   color:'#10b981', isIncome:true  },
    { label:'Expenses', exp:expExpenses,  act:sum.totalExpenses, color:'#f43f5e', isIncome:false },
    { label:'Bills',    exp:expBills,     act:sum.totalBills,    color:'#fb923c', isIncome:false },
    { label:'Debt',     exp:expDebt,      act:sum.totalDebt,     color:'#a855f7', isIncome:false },
    { label:'Savings',  exp:expSavings,   act:sum.totalSavings,  color:'#3b82f6', isIncome:false }
  ];

  const onboardHTML = !hasAnyData() ? `
    <div class="onboard-banner">
      <div class="onboard-title">👋 Welcome! Here's how to get started:</div>
      <div class="onboard-steps">
        <div class="onboard-step"><span class="onboard-num">1</span>Go to <strong>Income, Expenses, Bills</strong> etc. and enter your expected amounts.</div>
        <div class="onboard-step"><span class="onboard-num">2</span>Use <strong>Transactions</strong> to log what you actually earn and spend.</div>
        <div class="onboard-step"><span class="onboard-num">3</span>Return here to see your full financial picture update in real time.</div>
      </div>
    </div>` : '';

  const el = document.getElementById('bview-dashboard');
  el.innerHTML = `
    <div class="section-header">
      <h2 class="section-title">Dashboard</h2>
      <!-- Period badge is a button → navigates to Settings to change dates -->
      <button class="period-badge period-badge--btn" id="periodBadgeBtn" type="button"
              title="Click to change budget period">
        ${formatDateDisplay(state.settings.periodStart)} - ${formatDateDisplay(state.settings.periodEnd)}
      </button>
      <button class="help-icon-btn" data-help="dashboard" type="button" aria-label="Help">?</button>
    </div>

    ${onboardHTML}

    <div class="summary-cards">
      <div class="scard scard--income">
        <div class="scard-label">Total Income</div>
        <div class="scard-value">${fmt(sum.totalIncome)}</div>
        <div class="scard-sub">of ${fmt(expIncome)} expected</div>
      </div>
      <div class="scard scard--expenses">
        <div class="scard-label">Expenses &amp; Bills</div>
        <div class="scard-value">${fmt(sum.totalExpBills)}</div>
        <div class="scard-sub">of ${fmt(expExpBills)} budgeted</div>
      </div>
      <div class="scard scard--debt">
        <div class="scard-label">Debt Payments</div>
        <div class="scard-value">${fmt(sum.totalDebt)}</div>
        <div class="scard-sub">of ${fmt(expDebt)} budgeted</div>
      </div>
      <div class="scard scard--savings">
        <div class="scard-label">Total Savings</div>
        <div class="scard-value">${fmt(sum.totalSavings)}</div>
        <div class="scard-sub">of ${fmt(expSavings)} goal</div>
      </div>
    </div>

    <div class="panel leftover-panel">
      <div class="leftover-inner">
        <div>
          <div class="leftover-label">Net Leftover this period</div>
          <div class="leftover-value" style="color:${leftColor}">${sum.leftover < 0 ? '−' : ''}${fmt(Math.abs(sum.leftover))}</div>
          ${state.rollover ? `<div class="leftover-rollover">Includes ${fmt(state.rollover)} rollover from last period</div>` : ''}
        </div>
        <div class="leftover-formula">
          <span class="lf-chip lf-income">${fmt(sum.totalIncome)} income</span>
          <span class="lf-sep">−</span>
          <span class="lf-chip lf-expense">${fmt(sum.totalExpBills)} exp &amp; bills</span>
          <span class="lf-sep">−</span>
          <span class="lf-chip lf-debt">${fmt(sum.totalDebt)} debt</span>
          <span class="lf-sep">−</span>
          <span class="lf-chip lf-savings">${fmt(sum.totalSavings)} savings</span>
          ${state.rollover ? `<span class="lf-sep">+</span><span class="lf-chip lf-rollover">${fmt(state.rollover)} rollover</span>` : ''}
        </div>
      </div>
    </div>

    <div class="dashboard-grid">
      <div class="panel cash-flow-panel">
        <div class="panel-inner-sm">
          <div class="panel-titlebar">
            <span class="panel-title-sm">Cash Flow - Expected vs Actual</span>
            <div class="flow-legend">
              <span class="legend-item"><span class="legend-dot" style="background:rgba(30,27,46,.22)"></span>Expected</span>
              <span class="legend-item"><span class="legend-dot" style="background:#6366f1"></span>Actual</span>
            </div>
          </div>
          <div class="flow-table">
            ${flowRows.map(row => {
              const max = Math.max(row.exp, row.act, 1);
              const ew  = (row.exp / max * 100).toFixed(1);
              const aw  = (row.act / max * 100).toFixed(1);
              const over = !row.isIncome && row.act > row.exp && row.exp > 0;
              return `
                <div class="flow-row">
                  <span class="flow-label">${esc(row.label)}</span>
                  <div class="flow-bars">
                    <div class="flow-bar-wrap"><div class="flow-bar flow-bar--exp" style="width:${ew}%"></div></div>
                    <div class="flow-bar-wrap"><div class="flow-bar" style="width:${aw}%;background:${over ? '#f43f5e' : row.color}"></div></div>
                  </div>
                  <div class="flow-amounts">
                    <div class="flow-amt flow-amt--exp">${fmt(row.exp)}</div>
                    <div class="flow-amt" style="color:${row.color};font-weight:700">${fmt(row.act)}</div>
                  </div>
                </div>`;
            }).join('')}
          </div>
        </div>
      </div>

      <div class="charts-col">
        <div class="panel chart-panel">
          <div class="panel-inner-sm">
            <div class="panel-title-sm" style="margin-bottom:14px">Income Sources</div>
            ${incSegs.length === 0
              ? `<div class="chart-empty">No income logged yet.<br><button class="link-btn" data-btab="transactions">Add transactions →</button></div>`
              : `<div class="donut-block">
                  ${svgDonut(incSegs, 110, 16)}
                  <div class="donut-legend">${incSegs.slice(0,5).map(s => `
                    <div class="dleg-row">
                      <span class="dleg-swatch" style="background:${s.color}"></span>
                      <span class="dleg-label">${esc(s.label)}</span>
                      <span class="dleg-pct">${s.pct.toFixed(0)}%</span>
                    </div>`).join('')}</div>
                </div>`}
          </div>
        </div>
        <div class="panel chart-panel">
          <div class="panel-inner-sm">
            <div class="panel-title-sm" style="margin-bottom:14px">Spending Breakdown</div>
            ${spendSegs.length === 0
              ? `<div class="chart-empty">No spending logged yet.<br><button class="link-btn" data-btab="transactions">Add transactions →</button></div>`
              : `<div class="donut-block">
                  ${svgDonut(spendSegs, 110, 16)}
                  <div class="donut-legend">${spendSegs.slice(0,5).map(s => `
                    <div class="dleg-row">
                      <span class="dleg-swatch" style="background:${s.color}"></span>
                      <span class="dleg-label">${esc(s.label)}</span>
                      <span class="dleg-pct">${s.pct.toFixed(0)}%</span>
                    </div>`).join('')}</div>
                </div>`}
          </div>
        </div>
      </div>
    </div>
  `;  // end el.innerHTML

  // Period badge → go to settings
  el.querySelector('#periodBadgeBtn')?.addEventListener('click', () => switchBTab('settings'));
  requestAnimationFrame(()=>initDonuts(el));
  el.querySelectorAll('[data-btab]').forEach(b => b.addEventListener('click', () => switchBTab(b.dataset.btab)));
  el.querySelector('[data-help]')?.addEventListener('click', e => showHelp(e.currentTarget.dataset.help));

  // Upgrade section - appended AFTER innerHTML; visibility controlled from Settings
  if (!state.settings.hideUpgrade) {
    el.insertAdjacentHTML('beforeend', `
      <div class="upgrade-pro" id="upgradeBanner">
        <div class="upgrade-pro-badge">⚡ PRO</div>
        <h3 class="upgrade-pro-title">🚀 ${t('upgrade_title')}</h3>
        <p class="upgrade-pro-sub">${t('upgrade_desc')}</p>
        <div class="upgrade-pro-feats">
          <div class="upgrade-feat"><span class="upgrade-feat-ico">💳</span><span>Debt Payoff Planner</span></div>
          <div class="upgrade-feat"><span class="upgrade-feat-ico">🏺</span><span>Sinking Funds</span></div>
          <div class="upgrade-feat"><span class="upgrade-feat-ico">📅</span><span>Smart Calendar</span></div>
          <div class="upgrade-feat"><span class="upgrade-feat-ico">🔄</span><span>Subscription Tracker</span></div>
          <div class="upgrade-feat"><span class="upgrade-feat-ico">⚡</span><span>Automatic Transactions</span></div>
          <div class="upgrade-feat"><span class="upgrade-feat-ico">🎯</span><span>Spending Allocation</span></div>
        </div>
        <div class="upgrade-pro-actions">
          <button class="btn btn-primary upgrade-get" id="upgradeNowBtn" type="button">${t('upgrade_get_now')}</button>
          <button class="btn btn-ghost upgrade-compare" id="upgradeCompareBtn" type="button">${t('upgrade_compare')}</button>
        </div>
      </div>`);
    document.getElementById('upgradeNowBtn')?.addEventListener('click', () => { window.location.href = 'ultimate-budget.html'; });
    document.getElementById('upgradeCompareBtn')?.addEventListener('click', showUpgradeComparison);
  }
}

// ── Budget Modules ─────────────────────────────────────────────────────
const MODULE_META = {
  income:   { icon:'💰', title:'Income',   hasDates:false, desc:'Set your expected income for each source. Actual amounts fill in automatically when you log transactions.' },
  expenses: { icon:'🛒', title:'Expenses', hasDates:false, desc:'Set a budget limit for each spending category. Progress bars turn red when you go over.' },
  bills:    { icon:'🧾', title:'Bills',    hasDates:true,  desc:"Track recurring bills. Add a due date, then tick the checkbox once you've paid." },
  debt:     { icon:'💳', title:'Debt',     hasDates:true,  desc:'Stay on top of loan and mortgage repayments. Set expected amounts and mark each as paid.' },
  savings:  { icon:'🏦', title:'Savings',  hasDates:false, desc:'Set a savings goal for each bucket. Actual contributions come from your logged transactions.' }
};

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
      <h2 class="section-title">${meta.icon} ${meta.title}</h2>
      <div class="section-header-actions">
        <button class="help-icon-btn" data-help="${type}" type="button" aria-label="Help">?</button>
        <button class="btn btn-ghost btn-sm" id="addRowBtn" type="button">+ Add category</button>
      </div>
    </div>
    <p class="section-desc">${meta.desc}</p>

    <div class="panel">
      <div class="module-table-wrap">
        <table class="module-table">
          <thead>
            <tr>
              <th>Category</th>
              <th>Expected (${SYM})</th>
              ${meta.hasDates ? '<th>Due Date</th>' : ''}
              <th>Actual (${SYM})</th>
              <th class="prog-cell">Progress</th>
              ${meta.hasDates ? '<th>Paid</th>' : ''}
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
                      <span class="date-cell-val" id="dcell-${row.id}">${row.dueDate ? formatDateDisplay(row.dueDate) : '<span class="no-date">Set date</span>'}</span>
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
                    <label class="check-label" aria-label="Mark as paid">
                      <input type="checkbox" class="paid-cb" ${row.paid ? 'checked' : ''} data-id="${row.id}">
                      <span class="checkmark"></span>
                    </label>
                  </td>` : ''}
                  <td class="action-cell">
                    <button class="del-btn" data-id="${row.id}" type="button" title="Remove">×</button>
                  </td>
                </tr>`;
            }).join('')}
          </tbody>
          <tfoot>
            <tr class="total-row">
              <td><strong>Total</strong></td>
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
        <div class="add-cat-title">Add new category</div>
        <div class="add-cat-row">
          <div class="field"><label class="field-label">Name</label>
            <input class="input input-sm" type="text" id="newCatName" placeholder="e.g. Freelance"></div>
          ${meta.hasDates ? `<div class="field"><label class="field-label">Due date</label>
            <input class="input input-sm" type="date" id="newCatDate"></div>` : ''}
          <div class="add-cat-btns">
            <button class="btn btn-primary btn-sm" id="saveCatBtn" type="button">Add</button>
            <button class="btn btn-ghost btn-sm"   id="cancelCatBtn" type="button">Cancel</button>
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
        : '<span class="no-date">Set date</span>';
    });
  });

  // Click on styled date cells opens the native picker
  el.querySelectorAll('.date-cell-styled').forEach(wrap => {
    wrap.addEventListener('click', () => {
      const inp = document.getElementById(wrap.dataset.inputId);
      openDatePicker(inp, wrap);
    });
  });

  // Paid checkboxes
  el.querySelectorAll('.paid-cb').forEach(cb => {
    cb.addEventListener('change', () => {
      const row = state.budgets[type].find(r => r.id === cb.dataset.id);
      if (row) { row.paid = cb.checked; saveState(); }
    });
  });

  // Delete row
  el.querySelectorAll('.del-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!await confirmDialog({ message: t('confirm_remove_cat'), confirmText: t('delete') })) return;
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
          <td><div class="tx-actions"><button class="edit-btn" data-tx="${tx.id}" type="button" title="Edit">\u270f\ufe0f</button><button class="del-btn" data-tx="${tx.id}" type="button" title="Delete">\xd7</button></div></td>
        </tr>`).join('')}</tbody></table></div></div>${pagination}`}`;
  el.querySelectorAll('.edit-btn[data-tx]').forEach(b=>b.addEventListener('click',()=>openEditTx(b.dataset.tx)));
  el.querySelectorAll('.del-btn[data-tx]').forEach(b=>b.addEventListener('click',()=>{state.transactions=state.transactions.filter(t=>t.id!==b.dataset.tx);saveState();renderTxList();}));
  document.getElementById('clearAllBtn2')?.addEventListener('click',async()=>{if(await confirmDialog({message:t('confirm_delete_all_tx'),confirmText:t('delete')})){state.transactions=[];saveState();renderTxList();}});
  document.getElementById('txPrevBtn')?.addEventListener('click',()=>{if(txPage>0){txPage--;renderTxList();}});
  document.getElementById('txNextBtn')?.addEventListener('click',()=>{if(txPage<totalPages-1){txPage++;renderTxList();}});
}
function renderTransactions() {
  const el=document.getElementById('bview-transactions');
  el.innerHTML=`<div class="section-header"><h2 class="section-title">\uD83D\uDCCB ${t('tab_transactions')}</h2>
      <div class="section-header-actions">
        <button class="help-icon-btn" data-help="transactions" type="button" aria-label="Help">?</button>
        <label class="btn btn-ghost btn-sm csv-label" title="${t('tx_import_csv')}">${t('tx_import_csv')}<input type="file" id="csvInput" accept=".csv" style="display:none"></label>
      </div></div>
    <div class="panel tx-form-panel"><div class="panel-inner-sm">
      <div class="panel-title-sm" style="margin-bottom:14px">${t('tx_add_title')}</div>
      <div class="tx-form-row">
        <div class="field"><label class="field-label">${t('tx_date')}</label>
          <div class="date-field-styled" id="txDateWrap">
            <svg class="date-cal-icon" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>
            <span class="date-field-val" id="txDateDisp">${formatDateDisplay(today())}</span>
            <input type="date" id="txDate" value="${today()}">
          </div></div>
        <div class="field"><label class="field-label">${t('tx_type')}</label>
          <select class="select" id="txType">
            <option value="expense" selected>${t('tx_type_expense')}</option>
            <option value="bill">${t('tx_type_bill')}</option>
            <option value="savings">${t('tx_type_savings')}</option>
            <option value="debt">${t('tx_type_debt')}</option>
            <option value="income">${t('tx_type_income')}</option>
          </select></div>
        <div class="field"><label class="field-label">${t('tx_category')}</label><select class="select" id="txCategory"></select></div>
        <div class="field"><label class="field-label">${t('tx_amount')} (${SYM})</label>
          <input class="input" type="number" id="txAmount" min="0" step="0.01" placeholder="0.00"></div>
        <div class="field field-grow"><label class="field-label">${t('tx_desc_label')}</label>
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
  document.getElementById('txDate')?.addEventListener('change',e=>{document.getElementById('txDateDisp').textContent=formatDateDisplay(e.target.value);});
  document.getElementById('txType')?.addEventListener('change',populateTxCats);
  document.getElementById('addTxBtn')?.addEventListener('click',addTransaction);
  document.getElementById('csvInput')?.addEventListener('change',handleCSV);
  el.querySelector('[data-help]')?.addEventListener('click',e=>showHelp(e.currentTarget.dataset.help));
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
    : '<option value="">- set up categories first -</option>';
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
    if (errEl) { errEl.textContent = 'Please fill in date, type, category, and a valid amount greater than 0.'; errEl.hidden = false; }
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

  document.getElementById('modalTitle').textContent = '✏️ Edit Transaction';
  document.getElementById('modalBody').innerHTML = `
    <div class="field">
      <label class="field-label">Date</label>
      <div class="date-field-styled" id="editDateWrap">
        <svg class="date-cal-icon" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>
        <span class="date-field-val" id="editDateDisp">${formatDateDisplay(tx.date)}</span>
        <input type="date" id="editDate" value="${tx.date}">
      </div>
    </div>
    <div class="field"><label class="field-label">Type</label>
      <select class="select" id="editType">
        <option value="expense" ${tx.type==='expense' ?'selected':''}>Expense</option>
        <option value="bill"    ${tx.type==='bill'    ?'selected':''}>Bill</option>
        <option value="savings" ${tx.type==='savings' ?'selected':''}>Savings</option>
        <option value="debt"    ${tx.type==='debt'    ?'selected':''}>Debt</option>
        <option value="income"  ${tx.type==='income'  ?'selected':''}>Income</option>
      </select></div>
    <div class="field"><label class="field-label">Category</label>
      <select class="select" id="editCategory"></select></div>
    <div class="field"><label class="field-label">Amount (${SYM})</label>
      <input class="input" type="number" id="editAmount" min="0" step="0.01" value="${tx.amount}"></div>
    <div class="field"><label class="field-label">Description</label>
      <input class="input" type="text" id="editDesc" value="${esc(tx.description || '')}" maxlength="120"></div>
    <div class="edit-tx-actions">
      <button class="btn btn-primary" id="saveEditBtn" type="button">Save changes</button>
      <button class="btn btn-ghost btn-sm" id="cancelEditBtn" type="button">Cancel</button>
      <button class="btn btn-danger btn-sm" id="deleteEditBtn" type="button">Delete</button>
    </div>
  `;
  document.getElementById('tutorialOverlay').hidden = false;

  const fillEditCats = () => {
    const type = document.getElementById('editType')?.value;
    const sel  = document.getElementById('editCategory');
    const cats = getCats(type);
    if (sel) sel.innerHTML = cats.map(c => `<option value="${esc(c)}" ${c===tx.category?'selected':''}>${esc(c)}</option>`).join('')
      || '<option value="">- no categories -</option>';
  };
  fillEditCats();
  document.getElementById('editType')?.addEventListener('change', fillEditCats);
  document.getElementById('editDateWrap')?.addEventListener('click', () => {
    openDatePicker(document.getElementById('editDate'), document.getElementById('editDateWrap'));
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
    else alertDialog('No valid rows found.\n\nExpected format:\nDate, Type, Category, Amount, Description\n2024-01-15, expense, Food, 25.50, Grocery run', '\uD83D\uDCC4');
    e.target.value = '';
  };
  reader.readAsText(file);
}

// ── Settings ──────────────────────────────────────────────────────────
function exportCSV(){
  const rows=[['Date','Type','Category','Amount','Description']];
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
      <button class="help-icon-btn" data-help="settings" type="button" aria-label="Help">?</button>
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
      <div class="panel"><div class="panel-inner">
        <div class="settings-card-title">🌙 ${t('appearance')}</div>
        <p class="settings-desc">${t('appearance_desc')}</p>
        <div class="theme-setting-row">
          <div class="theme-pill" role="group" aria-label="Colour theme">
            <button class="theme-opt${(document.documentElement.dataset.theme||'light')==='light'?' is-active':''}" data-theme-val="light" type="button" title="Light mode">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/></svg>
              ${t('light')}
            </button>
            <button class="theme-opt${(document.documentElement.dataset.theme||'light')==='dark'?' is-active':''}" data-theme-val="dark" type="button" title="Dark mode">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>
              ${t('dark')}
            </button>
          </div>
        </div>
      </div></div>
      <div class="panel"><div class="panel-inner">
        <div class="settings-card-title">☁️ Data &amp; Sync</div>
        <p class="settings-desc">Choose how your data is stored and kept up to date across devices.</p>
        <div class="sync-mode-row">
          <button class="sync-mode-opt${(syncGetMode('sbp')||'local')!=='google'?' is-active':''}" data-sync-mode="local" type="button">
            ${(syncGetMode('sbp')||'local')!=='google'?'<span class="sync-mode-check">✓</span>':''}
            <span class="sync-mode-icon">${SYNC_ICON_LOCAL}</span>
            <span class="sync-mode-title">This device only</span>
            <span class="sync-mode-desc">Data is saved on this device only</span>
          </button>
          <button class="sync-mode-opt sync-mode-opt--google${(syncGetMode('sbp')||'local')==='google'?' is-active':''}" data-sync-mode="google" type="button">
            <span class="sync-mode-badge">Recommended</span>
            ${(syncGetMode('sbp')||'local')==='google'?'<span class="sync-mode-check">✓</span>':''}
            <span class="sync-mode-icon sync-mode-icon--google">${SYNC_ICON_GOOGLE}</span>
            <span class="sync-mode-title">Sync with Google</span>
            <span class="sync-mode-desc">Data is synced across multiple devices</span>
          </button>
        </div>
        ${(syncGetMode('sbp')==='google'&&syncGetEmail('sbp'))?`<p class="sync-status-line">Signed in as <strong>${esc(syncGetEmail('sbp'))}</strong></p>`:''}
        <p class="sync-error" id="syncSettError" hidden>Sign-in didn't go through. Please try again.</p>
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
    btn.addEventListener('click', () => applyTheme(btn.dataset.themeVal));
  });

  el.querySelectorAll('[data-sync-mode]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const target = btn.dataset.syncMode;
      const current = syncGetMode('sbp') || 'local';
      if (target === current) return;
      const errEl = document.getElementById('syncSettError');
      if (errEl) errEl.hidden = true;
      el.querySelectorAll('[data-sync-mode]').forEach(b => b.disabled = true);
      try {
        if (target === 'google') { saveState(); await syncSwitchToGoogle('sbp'); showToast('Synced with Google Drive ✓'); }
        else { await syncSwitchToLocal('sbp'); showToast('Switched to local storage ✓'); }
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
<p><em>${t('help_dash_tip')}</em></p><div style="margin-top:18px;text-align:center"><a href="https://www.youtube.com/results?search_query=personal+budget+planner+tutorial" target="_blank" rel="noopener noreferrer" class="help-video-btn"><svg width="16" height="16" viewBox="0 0 24 24"><path fill="white" d="M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-5.77 0 2.89 2.89 0 0 1 2.89-2.89c.28 0 .54.04.79.1V9.01a6.34 6.34 0 0 0-6.33 6.34 6.34 6.34 0 0 0 12.67 0l-.01-11.7A8.27 8.27 0 0 0 21 5.11V2a4.84 4.84 0 0 1-1.41 4.69z"/></svg> ${t('video_tutorial')}</a></div>`
  },
  transactions: {
    title: () => `📋 ${t('help_tx_modal_title')}`,
    body: () => `<p>${t('help_tx_intro')}</p>
<ul>
  <li><strong>${t('type')}</strong> - ${t('help_tx_type_li')}</li>
  <li><strong>${t('category')}</strong> - ${t('help_tx_category_li')}</li>
  <li><strong>${t('help_tx_edit_h')}</strong> - ${t('help_tx_edit_li')}</li>
</ul>
<p><strong>${t('help_tx_csv_h')}</strong><br><code>Date,Type,Category,Amount,Description</code><br><code>2024-01-15,expense,Food,25.50,Grocery run</code></p><div style="margin-top:18px;text-align:center"><a href="https://www.youtube.com/results?search_query=personal+budget+planner+tutorial" target="_blank" rel="noopener noreferrer" class="help-video-btn"><svg width="16" height="16" viewBox="0 0 24 24"><path fill="white" d="M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-5.77 0 2.89 2.89 0 0 1 2.89-2.89c.28 0 .54.04.79.1V9.01a6.34 6.34 0 0 0-6.33 6.34 6.34 6.34 0 0 0 12.67 0l-.01-11.7A8.27 8.27 0 0 0 21 5.11V2a4.84 4.84 0 0 1-1.41 4.69z"/></svg> ${t('video_tutorial')}</a></div>`
  },
  income: {
    title: () => `💰 ${t('help_inc_modal_title')}`,
    body: () => `<p>${t('help_inc_intro')}</p>
<ul>
  <li><strong>${t('expected')}</strong> - ${t('help_inc_expected_li')}</li>
  <li><strong>${t('actual')}</strong> - ${t('help_inc_actual_li')}</li>
</ul>
<p><em>${t('help_inc_tip')}</em></p><div style="margin-top:18px;text-align:center"><a href="https://www.youtube.com/results?search_query=personal+budget+planner+tutorial" target="_blank" rel="noopener noreferrer" class="help-video-btn"><svg width="16" height="16" viewBox="0 0 24 24"><path fill="white" d="M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-5.77 0 2.89 2.89 0 0 1 2.89-2.89c.28 0 .54.04.79.1V9.01a6.34 6.34 0 0 0-6.33 6.34 6.34 6.34 0 0 0 12.67 0l-.01-11.7A8.27 8.27 0 0 0 21 5.11V2a4.84 4.84 0 0 1-1.41 4.69z"/></svg> ${t('video_tutorial')}</a></div>`
  },
  expenses: {
    title: () => `🛒 ${t('help_exp_modal_title')}`,
    body: () => `<p>${t('help_exp_intro')}</p>
<ul>
  <li><strong>${t('expected')}</strong> - ${t('help_exp_expected_li')}</li>
  <li><strong>${t('actual')}</strong> - ${t('help_exp_actual_li')}</li>
</ul><div style="margin-top:18px;text-align:center"><a href="https://www.youtube.com/results?search_query=personal+budget+planner+tutorial" target="_blank" rel="noopener noreferrer" class="help-video-btn"><svg width="16" height="16" viewBox="0 0 24 24"><path fill="white" d="M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-5.77 0 2.89 2.89 0 0 1 2.89-2.89c.28 0 .54.04.79.1V9.01a6.34 6.34 0 0 0-6.33 6.34 6.34 6.34 0 0 0 12.67 0l-.01-11.7A8.27 8.27 0 0 0 21 5.11V2a4.84 4.84 0 0 1-1.41 4.69z"/></svg> ${t('video_tutorial')}</a></div>`
  },
  bills: {
    title: () => `🧾 ${t('help_bills_modal_title')}`,
    body: () => `<p>${t('help_bills_intro')}</p>
<ul>
  <li><strong>${t('due_date')}</strong> - ${t('help_bills_duedate_li')}</li>
  <li><strong>${t('paid')}</strong> - ${t('help_bills_paid_li')}</li>
  <li><strong>${t('actual')}</strong> - ${t('help_bills_actual_li')}</li>
</ul><div style="margin-top:18px;text-align:center"><a href="https://www.youtube.com/results?search_query=personal+budget+planner+tutorial" target="_blank" rel="noopener noreferrer" class="help-video-btn"><svg width="16" height="16" viewBox="0 0 24 24"><path fill="white" d="M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-5.77 0 2.89 2.89 0 0 1 2.89-2.89c.28 0 .54.04.79.1V9.01a6.34 6.34 0 0 0-6.33 6.34 6.34 6.34 0 0 0 12.67 0l-.01-11.7A8.27 8.27 0 0 0 21 5.11V2a4.84 4.84 0 0 1-1.41 4.69z"/></svg> ${t('video_tutorial')}</a></div>`
  },
  debt: {
    title: () => `💳 ${t('help_debt_modal_title')}`,
    body: () => `<p>${t('help_debt_intro')}</p>
<ul>
  <li><strong>${t('expected')}</strong> - ${t('help_debt_expected_li')}</li>
  <li><strong>${t('due_date')}</strong> - ${t('help_debt_duedate_li')}</li>
  <li><strong>${t('paid')}</strong> - ${t('help_debt_paid_li')}</li>
</ul><div style="margin-top:18px;text-align:center"><a href="https://www.youtube.com/results?search_query=personal+budget+planner+tutorial" target="_blank" rel="noopener noreferrer" class="help-video-btn"><svg width="16" height="16" viewBox="0 0 24 24"><path fill="white" d="M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-5.77 0 2.89 2.89 0 0 1 2.89-2.89c.28 0 .54.04.79.1V9.01a6.34 6.34 0 0 0-6.33 6.34 6.34 6.34 0 0 0 12.67 0l-.01-11.7A8.27 8.27 0 0 0 21 5.11V2a4.84 4.84 0 0 1-1.41 4.69z"/></svg> ${t('video_tutorial')}</a></div>`
  },
  savings: {
    title: () => `🏦 ${t('help_sav_modal_title')}`,
    body: () => `<p>${t('help_sav_intro')}</p>
<ul>
  <li><strong>${t('expected')}</strong> - ${t('help_sav_expected_li')}</li>
  <li><strong>${t('actual')}</strong> - ${t('help_sav_actual_li')}</li>
</ul>
<p><em>${t('help_sav_tip')}</em></p><div style="margin-top:18px;text-align:center"><a href="https://www.youtube.com/results?search_query=personal+budget+planner+tutorial" target="_blank" rel="noopener noreferrer" class="help-video-btn"><svg width="16" height="16" viewBox="0 0 24 24"><path fill="white" d="M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-5.77 0 2.89 2.89 0 0 1 2.89-2.89c.28 0 .54.04.79.1V9.01a6.34 6.34 0 0 0-6.33 6.34 6.34 6.34 0 0 0 12.67 0l-.01-11.7A8.27 8.27 0 0 0 21 5.11V2a4.84 4.84 0 0 1-1.41 4.69z"/></svg> ${t('video_tutorial')}</a></div>`
  },
  settings: {
    title: () => `⚙️ ${t('help_sett_modal_title')}`,
    body:  () => `<p>${t('help_sett_intro')}</p>
<ul>
  <li><strong>${t('currency')}</strong> - ${t('help_sett_currency_li')}</li>
  <li><strong>${t('budget_period')}</strong> - ${t('help_sett_period_li')}</li>
  <li><strong>${t('rollover')}</strong> - ${t('help_sett_rollover_li')}</li>
  <li><strong>${t('appearance')}</strong> - ${t('help_sett_theme_li')}</li>
</ul><div style="margin-top:18px;text-align:center"><a href="https://www.youtube.com/results?search_query=personal+budget+planner+tutorial" target="_blank" rel="noopener noreferrer" class="help-video-btn"><svg width="16" height="16" viewBox="0 0 24 24"><path fill="white" d="M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-5.77 0 2.89 2.89 0 0 1 2.89-2.89c.28 0 .54.04.79.1V9.01a6.34 6.34 0 0 0-6.33 6.34 6.34 6.34 0 0 0 12.67 0l-.01-11.7A8.27 8.27 0 0 0 21 5.11V2a4.84 4.84 0 0 1-1.41 4.69z"/></svg> ${t('video_tutorial')}</a></div>`
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

// ── Toast ─────────────────────────────────────────────────────────────
function showToast(msg) {
  let t = document.getElementById('toast');
  if (!t) { t = document.createElement('div'); t.id = 'toast'; document.body.appendChild(t); }
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
          <button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" data-act="ok" type="button">${esc(confirmText || (alertOnly ? 'OK' : t('save')))}</button>
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
    ['📊','Budget tracking - Income, Expenses, Bills & Savings', true],
    ['📋','Transaction logging with CSV import',                 true],
    ['📈','Cash flow chart - expected vs actual',               true],
    ['🍩','Income & spending donut charts',                     true],
    ['📅','Budget period control with presets',                 true],
    ['🔄','Rollover from previous period',                      true],
    ['💳','Debt payoff calculator (Snowball & Avalanche)',      false],
    ['🏺','Sinking funds tracker with monthly goals',           false],
    ['📅','Smart calendar with all events auto-populated',      false],
    ['🔄','Subscription tracker with category breakdown',       false],
    ['⚡','Pro dashboard with hero stats & 7-day panel',        false],
    ['📥','One-click import from Simple Budget Planner',        false],
  ];

  const makeRow = ([icon, label, inSimple]) =>
    `<tr class="${inSimple?'':'row-pro-only'}">
      <td><div class="feat-cell"><span class="feat-icon">${icon}</span><span class="feat-text">${label}</span></div></td>
      <td class="col-simple">${inSimple?'✅':''}</td>
      <td class="col-ultimate">✅</td>
    </tr>`;

  const coreRows = feats.filter((_,i) => i < 6).map(makeRow).join('');
  const proRows  = feats.filter((_,i) => i >= 6).map(makeRow).join('');

  document.getElementById('modalTitle').textContent = '⚡ Simple vs Ultimate Budget Planner';
  document.getElementById('modalBody').innerHTML = `
    <table class="compare-table">
      <thead>
        <tr>
          <th class="col-feat">Feature</th>
          <th class="col-simple">💰 Simple</th>
          <th class="col-ultimate">⚡ Ultimate</th>
        </tr>
      </thead>
      <tbody>
        <tr class="compare-section-row"><td colspan="3">Core budgeting</td></tr>
        ${coreRows}
        <tr class="compare-section-row"><td colspan="3">Pro features - Ultimate only</td></tr>
        ${proRows}
      </tbody>
    </table>
    <div class="compare-actions">
      <button class="btn btn-ghost btn-sm" id="compareStay" type="button">Stay with Simple</button>
      <button class="btn btn-primary" id="compareUpgrade" type="button">Open Ultimate Budget Planner →</button>
    </div>`;

  document.getElementById('tutorialOverlay').hidden = false;

  document.getElementById('compareStay')?.addEventListener('click', () => {
    if (modal) modal.classList.remove('compare-modal');
    document.getElementById('tutorialOverlay').hidden = true;
    document.getElementById('modalBody').innerHTML = '';
  });
  document.getElementById('compareUpgrade')?.addEventListener('click', () => {
    window.location.href = 'ultimate-budget.html';
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

  // Back to hub
  document.getElementById('backToHub')?.addEventListener('click', () => navigateTo('hub'));

  // Settings gear → Settings tab
  document.getElementById('settingsNavBtn')?.addEventListener('click', () => switchBTab('settings'));

  // Modal close
  document.getElementById('modalClose')?.addEventListener('click', closeModal);
  document.getElementById('tutorialOverlay')?.addEventListener('click', e => {
    if (e.target === e.currentTarget) closeModal();
  });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') { closeModal(); closeLegal(); } });

  // Legal modals
  document.getElementById('legalClose')?.addEventListener('click', closeLegal);
  document.getElementById('legalOverlay')?.addEventListener('click', e => { if (e.target === e.currentTarget) closeLegal(); });
  document.getElementById('footerPrivacy')?.addEventListener('click', () => openLegal('privacy'));
  document.getElementById('footerTerms')?.addEventListener('click', () => openLegal('terms'));
  document.getElementById('footerDisclaimer')?.addEventListener('click', () => openLegal('disclaimer'));

  fkInitUIEnhancers();
  applyAppTitle();
  bindAppTitle('Simple Budget');
}

// ── Review carousel ────────────────────────────────────────────────────
const REVIEWS = [
  {name:'Megan T.',title:'Freelance Graphic Designer & Illustrator',stars:5,tool:'SBP',img:'https://randomuser.me/api/portraits/women/44.jpg',text:'I tried every app out there and they all wanted $10 a month just to see my own spending. Evo Budget was the first tool that actually felt like mine. Paid off $3,200 in credit card debt in five months.'},
  {name:'Daniel K.',title:'Full-Stack Software Engineer at a Startup',stars:5,tool:'UBP',img:'https://randomuser.me/api/portraits/men/32.jpg',text:'The sinking funds feature changed how I save. I set a target for a trip to Japan and the planner calculated exactly how much I needed each month. The automatic transactions did the rest.'},
  {name:'James R.',title:'Senior Account Manager in Advertising',stars:5,tool:'UBP',img:'https://randomuser.me/api/portraits/men/75.jpg',text:'My wife and I used spreadsheets for years but always fell off after a month. Evo Budget is just clean enough that we actually stick with it. We can see our bills, track subscriptions, and it all lives in the browser.'},
  {name:'Priya S.',title:'Recent Business Graduate & Job Seeker',stars:4,tool:'SBP',img:'https://randomuser.me/api/portraits/women/65.jpg',text:'As a recent graduate I needed something dead simple. The Simple planner lets me see income vs. expenses in one screen. I caught a gym membership I forgot to cancel on day one.'},
  {name:'Carlos M.',title:'Independent Restaurant Owner & Operator',stars:5,tool:'UBP',img:'https://randomuser.me/api/portraits/men/46.jpg',text:'I run a small restaurant and the subscription tracker alone saves me from forgetting about services I signed up for months ago. The calendar view is perfect for seeing what is due and when.'},
  {name:'Sarah L.',title:'Registered Nurse Working Night Shifts',stars:5,tool:'SBP',img:'https://randomuser.me/api/portraits/women/17.jpg',text:'I work 12-hour shifts and have zero energy left for complicated finance apps. This one took me two minutes to set up and I have not missed a bill payment since. Exactly what I needed.'},
  {name:'Tom W.',title:'High School History Teacher & Coach',stars:5,tool:'UBP',img:'https://randomuser.me/api/portraits/men/22.jpg',text:'The debt payoff calculator gave me a clear timeline for paying off my student loans. Seeing the numbers update in real time keeps me motivated. Down $8,000 in seven months.'},
  {name:'Aisha N.',title:'Digital Marketing Manager at an Agency',stars:5,tool:'SBP',img:'https://randomuser.me/api/portraits/women/90.jpg',text:'I love that nothing leaves my device. Every other app wanted my bank login and I was never comfortable with that. Evo Budget gave me real budgeting without the privacy trade-off.'},
  {name:'Ryan P.',title:'Licensed Electrician & Small Business Owner',stars:4,tool:'UBP',img:'https://randomuser.me/api/portraits/men/55.jpg',text:'I set up sinking funds for my tools, truck insurance, and license renewals. No more scrambling when a big expense hits. The automatic transactions make it completely hands-off.'},
  {name:'Emily C.',title:'Stay-at-Home Parent Managing Family Finances',stars:5,tool:'SBP',img:'https://randomuser.me/api/portraits/women/33.jpg',text:'With three kids, every dollar matters. The Simple planner helped me find over $400 in monthly spending I did not even realize we had. We are finally putting real money into savings.'},
  {name:'Marco D.',title:'PhD Candidate in Applied Mathematics',stars:5,tool:'SBP',img:'https://randomuser.me/api/portraits/men/86.jpg',text:'I budgeted on paper for years. Evo Budget is basically the digital version of that but with better math. CSV export means I can still pull data into my own spreadsheets when I want to.'},
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

// ── Legal modals ───────────────────────────────────────────────────────
function closeLegal() { const o = document.getElementById('legalOverlay'); if (o) o.hidden = true; }
function openLegal(type) {
  const titles = { privacy: 'Privacy Policy', terms: 'Terms of Use', disclaimer: 'Disclaimer' };
  const bodies = {
    privacy: `<p><strong>Last updated:</strong> July 2026</p>
<p>Evo Budget is designed with your privacy as a core principle.</p>
<p><strong>Data storage.</strong> By default, all financial data you enter into Evo Budget is stored exclusively in your browser's local storage on your device, and Evo Budget does not collect, transmit, or store any personal or financial information on external servers. You may optionally sign in with Google to sync your data across your own devices - when you choose to do this, your data is saved only in a file in your own Google Drive, which Evo Budget cannot access from anyone else's account. This is entirely opt-in and can be turned off at any time from Settings.</p>
<p><strong>No account required.</strong> Evo Budget does not require you to create an account, provide an email address, or share any personally identifiable information to use the product. Signing in with Google is entirely optional and only needed if you want your data synced across devices.</p>
<p><strong>No bank connections.</strong> Evo Budget never asks for or accesses your bank credentials, account numbers, or any third-party financial service logins.</p>
<p><strong>No tracking.</strong> Evo Budget does not use analytics trackers, advertising pixels, or third-party cookies. Your usage is not monitored, profiled, or shared with any external parties.</p>
<p><strong>Data control.</strong> Because your data lives entirely on your device (or, if you opt in, your own Google Drive), you have full control over it at all times. You can export your data via CSV or clear it through your browser settings. Clearing your browser data or switching devices will remove your Evo Budget data unless you have exported a backup or enabled Google sync.</p>
<p><strong>Third-party services.</strong> Evo Budget loads fonts from Google Fonts, which is subject to Google's privacy policy. If you opt in to Google sync, Evo Budget also uses Google Sign-In and the Google Drive API to store your data in your own Drive, subject to Google's privacy policy. No other third-party services are used.</p>
<p><strong>Changes.</strong> If this policy changes, the updated version will be posted on this page with a revised date.</p>`,
    terms: `<p><strong>Last updated:</strong> July 2026</p>
<p>By using Evo Budget, you agree to the following terms.</p>
<p><strong>License.</strong> Evo Budget grants you a personal, non-transferable license to use the software for personal financial planning. The free trial allows limited usage. Purchasing an access code unlocks unlimited usage for one user.</p>
<p><strong>No financial advice.</strong> Evo Budget is a budgeting and organizational tool, not a financial advisor. The calculators, projections, and summaries provided are for informational purposes only and do not constitute financial, tax, investment, or legal advice. Always consult a qualified professional for financial decisions.</p>
<p><strong>Data responsibility.</strong> You are solely responsible for your data. Evo Budget stores data in your browser's local storage and does not create backups on your behalf. Use the CSV export feature to keep backup copies of your financial information.</p>
<p><strong>No warranty.</strong> Evo Budget is provided "as is" without warranty of any kind, express or implied. We do not guarantee that the software will be error-free, uninterrupted, or free of bugs.</p>
<p><strong>Limitation of liability.</strong> Evo Budget and its creators shall not be liable for any direct, indirect, incidental, or consequential damages arising from your use of the software, including but not limited to financial losses, data loss, or decisions made based on information provided by the software.</p>
<p><strong>Refunds.</strong> Due to the digital nature of the product and immediate access upon purchase, all sales are final. We encourage you to use the free trial to evaluate the product before purchasing.</p>
<p><strong>Changes.</strong> We reserve the right to modify these terms at any time. Continued use after changes constitutes acceptance of the updated terms.</p>`,
    disclaimer: `<p><strong>Last updated:</strong> July 2026</p>
<p><strong>Not financial advice.</strong> Evo Budget is a personal budgeting and expense tracking tool. It is not a substitute for professional financial planning, tax advice, or investment guidance. The debt payoff projections, savings calculations, and budget summaries are estimates based on the information you provide and should not be relied upon as precise financial forecasts.</p>
<p><strong>Accuracy of calculations.</strong> While we strive for accuracy in all calculations, Evo Budget does not account for taxes, fees, interest rate changes, inflation, or other factors that may affect your actual financial outcomes. Always verify important financial calculations independently.</p>
<p><strong>User responsibility.</strong> You are solely responsible for the financial decisions you make. Evo Budget is a planning aid, and any actions you take based on the information it provides are at your own discretion and risk.</p>
<p><strong>Testimonials.</strong> User testimonials displayed on this site reflect individual experiences and are not guaranteed outcomes. Your results may vary based on your financial situation, discipline, and other personal factors.</p>
<p><strong>Browser compatibility.</strong> Evo Budget relies on your browser's local storage. Clearing your browser cache or cookies may delete your saved data. We strongly recommend regularly exporting your data using the CSV export feature as a backup.</p>`
  };
  document.getElementById('legalTitle').textContent = titles[type] || '';
  document.getElementById('legalBody').innerHTML = bodies[type] || '';
  document.getElementById('legalOverlay').hidden = false;
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
