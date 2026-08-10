/**
 * MERCHANT TAXONOMY
 *
 * "Other" is where trust goes to die. If a third of someone's spending lands in a bucket
 * called Other, the categorisation is not working and every chart built on it is suspect.
 *
 * Rules are ordered most-specific first. Each returns a category AND a subcategory, so
 * Spend can be drilled into rather than just looked at.
 */

export const TAXONOMY = {
  dining:        { icon:'🍽️', label:'Dining',        subs:['restaurants','delivery','coffee','bars','fast food'] },
  grocery:       { icon:'🛒', label:'Groceries',     subs:['supermarket','warehouse','specialty','convenience'] },
  transport:     { icon:'🚗', label:'Transport',     subs:['rideshare','fuel','parking','transit','tolls','auto service'] },
  travel:        { icon:'✈️', label:'Travel',        subs:['flights','hotels','rental car','cruise','booking sites'] },
  shopping:      { icon:'🛍️', label:'Shopping',      subs:['online','clothing','electronics','home','hobbies','pets'] },
  subscription:  { icon:'🔁', label:'Subscriptions', subs:['streaming','software','news','music','cloud','ai tools'] },
  bills:         { icon:'📄', label:'Bills',         subs:['rent','utilities','phone','internet','insurance'] },
  health:        { icon:'🩺', label:'Health',        subs:['pharmacy','doctor','dental','vision','therapy','supplements'] },
  fitness:       { icon:'🏋️', label:'Fitness',       subs:['gym','studio','equipment','apps'] },
  personal:      { icon:'💈', label:'Personal care', subs:['salon','spa','barber','cosmetics'] },
  entertainment: { icon:'🎟️', label:'Entertainment', subs:['events','cinema','gaming','books'] },
  kids:          { icon:'🧸', label:'Kids',          subs:['childcare','school','toys','activities'] },
  services:      { icon:'🔧', label:'Services',      subs:['cleaning','repairs','shipping','professional','storage'] },
  charity:       { icon:'❤️', label:'Giving',        subs:['donations','religious'] },
  fee:           { icon:'⚠️', label:'Fees',          subs:['bank','atm','foreign','late','interest'] },
  other:         { icon:'❓', label:'Uncategorised', subs:['unknown'] }
};

/** [regex, category, subcategory] — most specific first. */
const RULES = [
  // fees before everything, they hide inside bank descriptors
  [/overdraft|nsf\b|insufficient fund/i,                        'fee','bank'],
  [/atm.*(fee|surcharge)|surcharge.*atm|non.?network atm/i,     'fee','atm'],
  [/foreign transaction|intl? (txn|transaction) fee|fx fee/i,   'fee','foreign'],
  [/late (fee|payment charge)/i,                                'fee','late'],
  [/interest charge|finance charge|purchase interest/i,         'fee','interest'],
  [/\b(monthly|annual|membership|maintenance|service) fee\b/i,  'fee','bank'],

  // subscriptions
  [/netflix|hulu|disney\+?|hbo|max\.com|paramount|peacock|apple ?tv|showtime|starz|crunchyroll/i,'subscription','streaming'],
  [/spotify|apple ?music|tidal|pandora|siriusxm|soundcloud|amazon music/i,                       'subscription','music'],
  [/adobe|microsoft ?365|office ?365|autodesk|figma|notion|slack|zoom|canva|1password|dashlane|nordvpn|expressvpn/i,'subscription','software'],
  [/openai|anthropic|claude|perplexity|midjourney|github ?copilot|cursor|replit|gemini advanced/i,'subscription','ai tools'],
  [/dropbox|google ?one|icloud|onedrive|backblaze|box\.com/i,                                    'subscription','cloud'],
  [/nytimes|ny times|wsj|wall street|washington post|the athletic|substack|medium|economist|bloomberg/i,'subscription','news'],
  [/audible|kindle unlimited|scribd|masterclass|duolingo|skillshare|coursera|udemy/i,            'subscription','software'],

  // bills
  [/\brent\b|property mgmt|apartment|landlord|leasing/i,                     'bills','rent'],
  [/comcast|xfinity|spectrum|cox comm|centurylink|fios|google fiber|astound/i,'bills','internet'],
  [/verizon|at&t|t-?mobile|mint mobile|visible|us cellular|boost mobile/i,   'bills','phone'],
  [/pg&e|con ?ed|duke energy|national grid|edison|water dept|waste mgmt|sewer|gas company/i,'bills','utilities'],
  [/geico|state farm|progressive|allstate|lemonade|root ins|usaa|aetna|cigna|blue cross|kaiser/i,'bills','insurance'],

  // groceries
  [/whole ?foods|trader ?joe|safeway|kroger|publix|wegmans|albertsons|vons|ralphs|h-?e-?b|giant|stop ?& ?shop|sprouts|fresh market/i,'grocery','supermarket'],
  [/costco|sam.?s club|bj.?s wholesale/i,                                    'grocery','warehouse'],
  [/instacart|amazon fresh|shipt|freshdirect|thrive market|misfits market/i, 'grocery','supermarket'],
  [/7-?eleven|circle k|wawa|sheetz|quiktrip|bodega|corner ?store/i,          'grocery','convenience'],
  [/butcher|fishmonger|farmers ?market|bakery|deli\b/i,                      'grocery','specialty'],

  // dining
  [/doordash|uber ?eats|grubhub|seamless|postmates|caviar|deliveroo|chowNow|toast ?tab/i,'dining','delivery'],
  [/starbucks|dunkin|peet|blue bottle|philz|caribou|coffee|espresso|cafe\b|café/i,        'dining','coffee'],
  [/mcdonald|burger king|wendy|taco bell|chipotle|subway|chick-?fil-?a|popeyes|kfc|five guys|shake shack|in-?n-?out|panera|sweetgreen/i,'dining','fast food'],
  [/\bbar\b|tavern|pub\b|brewery|brewing|winery|cocktail|lounge|distiller/i,              'dining','bars'],
  [/restaurant|grill|kitchen|bistro|trattoria|osteria|sushi|ramen|thai|pizza|steakhouse|taqueria|noodle|bbq|diner/i,'dining','restaurants'],

  // transport
  [/uber(?! ?eats)|lyft|via ride|curb taxi|taxi\b/i,                         'transport','rideshare'],
  [/shell|chevron|exxon|mobil|bp\b|arco|valero|sunoco|citgo|texaco|76 ?station|gas ?station|fuel/i,'transport','fuel'],
  [/parking|spothero|parkmobile|garage|meter/i,                              'transport','parking'],
  [/\bmta\b|bart\b|caltrain|metro ?card|transit|amtrak|septa|cta\b|nj ?transit|clipper/i,'transport','transit'],
  [/fastrak|e-?zpass|toll/i,                                                 'transport','tolls'],
  [/jiffy lube|midas|firestone|discount tire|auto ?zone|o.?reilly|mechanic|car wash|dmv/i,'transport','auto service'],

  // travel
  [/united airl|delta air|american airl|southwest|jetblue|alaska air|spirit air|frontier air|lufthansa|british airways|emirates|\bana\b|japan airlines/i,'travel','flights'],
  [/marriott|hilton|hyatt|ihg|holiday inn|westin|sheraton|four seasons|ritz|motel|hostel|resort/i,'travel','hotels'],
  [/airbnb|vrbo|booking\.com|expedia|kayak|priceline|hotels\.com|travelocity|orbitz|hopper/i,'travel','booking sites'],
  [/hertz|avis|enterprise rent|budget rent|national car|sixt|turo/i,          'travel','rental car'],
  [/royal caribbean|carnival cruise|norwegian cruise|princess cruise|celebrity cruise/i,'travel','cruise'],

  // health
  [/cvs|walgreens|rite ?aid|pharmacy|goodrx|express scripts/i,                'health','pharmacy'],
  [/dental|dentist|orthodont|invisalign/i,                                    'health','dental'],
  [/vision|optometr|lenscrafters|warby|eyeglass|contacts/i,                   'health','vision'],
  [/therapy|therapist|counsel|betterhelp|talkspace|psych/i,                   'health','therapy'],
  [/vitamin|supplement|gnc\b|athletic greens|ritual|seed health/i,            'health','supplements'],
  [/medical|clinic|hospital|physician|urgent care|labcorp|quest diag|doctor|md\b|health ?center/i,'health','doctor'],

  // fitness
  [/equinox|planet fitness|24 ?hour fitness|la fitness|gold.?s gym|crunch fitness|ymca|lifetime fitness|\bgym\b/i,'fitness','gym'],
  [/classpass|soulcycle|barry.?s|orangetheory|f45|pure barre|yoga|pilates|crossfit/i,'fitness','studio'],
  [/peloton|whoop|strava|garmin|fitbit|oura/i,                                'fitness','apps'],

  // personal care
  [/salon|barber|hair|nails|spa\b|massage|waxing|dermatol|sephora|ulta|beauty/i,'personal','salon'],

  // kids
  [/daycare|childcare|preschool|montessori|nanny|babysit|kindercare|bright horizons/i,'kids','childcare'],
  [/school|tuition|pta\b|college|university/i,                                'kids','school'],
  [/toys ?r ?us|lego|american girl|build-?a-?bear|melissa.*doug/i,             'kids','toys'],

  // entertainment
  [/amc theat|regal cinema|cinemark|alamo draft|movie|imax/i,                  'entertainment','cinema'],
  [/ticketmaster|stubhub|seatgeek|eventbrite|live nation|axs\b|vivid seats/i,  'entertainment','events'],
  [/steam ?games|playstation|xbox|nintendo|epic games|riot games|blizzard|roblox/i,'entertainment','gaming'],
  [/barnes ?& ?noble|bookshop|book ?store|half price books/i,                  'entertainment','books'],

  // shopping
  [/amazon|amzn/i,                                                            'shopping','online'],
  [/target|walmart|costco\.com|ebay|etsy|temu|shein|aliexpress|wish\.com/i,    'shopping','online'],
  [/best ?buy|apple ?store|micro ?center|newegg|b&h photo|gamestop/i,          'shopping','electronics'],
  [/nike|adidas|lululemon|zara|h&m|uniqlo|gap\b|old navy|nordstrom|macy|patagonia|north face|rei\b|j\.?crew|banana republic/i,'shopping','clothing'],
  [/ikea|home depot|lowe.?s|wayfair|crate ?& ?barrel|west elm|container store|bed bath/i,'shopping','home'],
  [/petco|petsmart|chewy|vet\b|veterinar/i,                                   'shopping','pets'],
  [/michaels|joann|hobby lobby|guitar center|sweetwater|art supply/i,          'shopping','hobbies'],

  // services
  [/fedex|\bups\b|usps|dhl|shipping|postal/i,                                 'services','shipping'],
  [/handy|taskrabbit|thumbtack|angi\b|cleaning|maid|housekeep/i,              'services','cleaning'],
  [/plumb|electrician|hvac|roofing|handyman|repair/i,                         'services','repairs'],
  [/legal|attorney|lawyer|accountant|\bcpa\b|bookkeep|notary/i,               'services','professional'],
  [/storage|public storage|extra space|u-?haul/i,                             'services','storage'],

  // giving
  [/donation|donate|charity|red cross|unicef|goodwill|salvation army|gofundme|patreon|church|temple|mosque|synagogue|tithe/i,'charity','donations'],

  // ---------------------------------------------------------------------------
  // REAL BANK DESCRIPTORS
  // Statements abbreviate, truncate and prefix. These rules were written against
  // actual descriptor text rather than tidy merchant names, which is why the first
  // version of this file left 96% of a real account uncategorised.
  // ---------------------------------------------------------------------------
  [/prog(ressive)?[ _-]|geico|state ?farm|allstate|nationwide|libertymut|travelers ins|erie ins|amfam|farmers ins|\bins prem\b|insurance/i,'bills','insurance'],
  [/mortgage|mtg\b|escrow|property ?tax|hoa\b|homeowners assoc/i,'bills','rent'],
  [/con ?ed|pseg|pse&g|national grid|dominion|duke ener|xcel|ameren|entergy|nicor|socalgas|水|utility|elec(tric)?\b|water dept|sewer|trash|refuse/i,'bills','utilities'],
  [/vetsource|vca ?animal|banfield|petmed|animal hosp|veterinar|\bvet\b/i,'shopping','pets'],
  [/dr\.? |md\b|\bdds\b|physician|pediatr|derma|ortho|radiolog|anesth|surgery ctr|hlth|health(care)?\b|medical/i,'health','doctor'],
  [/childcare|kindercare|goddard|primrose|daycare|nursery|after ?school|camp\b/i,'kids','childcare'],
  [/sq \*|square \*|tst\*|toast|clover|shopify|stripe charge/i,'shopping','online'],
  [/paypal \*|pp\*|venmo \*/i,'shopping','online'],
  [/amzn mktp|amazon\.com|amazon mktpl|amzn digital|prime video|amazon prime/i,'shopping','online'],
  [/apl\*|apple\.com\/bill|itunes|app ?store/i,'subscription','software'],
  [/googl?e? \*|google ?svcs|youtube ?(premium|tv)/i,'subscription','software'],
  [/wm supercenter|wal-?mart|wm supercntr/i,'shopping','online'],
  [/exxonmobil|speedway|racetrac|caseys|pilot ?travel|loves ?travel|wawa|circle ?k/i,'transport','fuel'],
  [/ez ?pass|nj ?turnpike|port auth|\bpath\b|njt\b|nj ?transit|lirr|metro ?north/i,'transport','transit'],
  [/nyc ?parking|impark|laz ?park|icon ?park/i,'transport','parking'],
  [/liquor|wine ?& ?spirits|total ?wine|bevmo/i,'dining','bars'],
  [/dry ?clean|laundr|tailor|cobbler|alteration/i,'services','cleaning'],
  [/home ?depot|lowes|ace ?hardware|sherwin|menards|tractor ?supply/i,'shopping','home'],
  [/\bacme\b|shoprite|stop ?& ?shop|food ?town|key ?food|c-?town|foodtown|grocery|market\b/i,'grocery','supermarket'],
  [/nail|lash|brow|spa\b|massage envy|great ?clips|supercuts/i,'personal','salon'],
  [/snap ?fitness|anytime ?fitness|blink ?fitness|retro ?fitness|\bgf\*/i,'fitness','gym'],
  [/soccer|baseball|basketball|gymnast|swim ?(school|lesson)|karate|dance ?(studio|academy)|academy|little ?gym|tutor/i,'kids','activities'],
  [/google ?store|microsoft ?store|samsung/i,'shopping','electronics'],
  [/jpmorgan|chase bank|bank of america|wells ?fargo|citibank|pnc bank|td bank|us bank/i,'services','professional']
];

/**
 * USER-TAUGHT RULES
 *
 * No fixed rule list survives the long tail of real merchants. When you tell the app what
 * something is, it remembers — and your answer always beats ours.
 */
export function applyLearned(name, learned) {
  if (!learned) return null;
  const n = String(name ?? '').toLowerCase();
  for (const [pattern, v] of Object.entries(learned)) {
    if (n.includes(pattern)) return { category: v.category, subcategory: v.subcategory ?? 'unknown',
                                      confidence: 1, matched: 'you taught me this' };
  }
  return null;
}

/** Biggest unknown merchants first — the ones worth asking about. */
export function unknownMerchants(txs, limit = 12) {
  const by = {};
  for (const t of txs) {
    if (t.amountCents <= 0) continue;
    const c = categorise(t.merchantName ?? t.merchantId, t.category);
    if (c.category !== 'other') continue;
    const k = t.merchantName ?? t.merchantId;
    (by[k] ??= { name:k, cents:0, count:0 });
    by[k].cents += t.amountCents; by[k].count++;
  }
  return Object.values(by).sort((a,b)=>b.cents-a.cents).slice(0, limit);
}

/** Returns { category, subcategory, confidence, matched }. */
export function categorise(description, plaidCategory) {
  const text = String(description ?? '');
  for (const [re, cat, sub] of RULES) {
    const m = text.match(re);
    if (m) return { category: cat, subcategory: sub, confidence: 0.92, matched: m[0].trim() };
  }
  // fall back to whatever the aggregator said before giving up
  const PLAID_MAP = {
    food_and_drink:'dining', general_merchandise:'shopping', travel:'travel',
    transportation:'transport', rent_and_utilities:'bills', entertainment:'entertainment',
    medical:'health', personal_care:'personal', general_services:'services',
    bank_fees:'fee', loan_payments:'bills', home_improvement:'shopping', government_and_non_profit:'charity'
  };
  const mapped = PLAID_MAP[(plaidCategory ?? '').toLowerCase()];
  if (mapped) return { category: mapped, subcategory: 'unknown', confidence: 0.6, matched: 'aggregator category' };
  return { category: 'other', subcategory: 'unknown', confidence: 0.2, matched: null };
}

/** One category decision for every surface. Raw importer/Plaid categories are fallback
 * evidence, never separate vocabularies that let Shop and Spend disagree. */
export function effectiveCategory(t, learned=null) {
  let c=applyLearned(t.merchantName??t.merchantId,learned)
    ?? categorise(t.merchantName??t.merchantId,t.plaidCategory??t.category);
  if(c.category==='other'&&t.category&&TAXONOMY[t.category]&&t.category!=='other')
    c={category:t.category,subcategory:'unknown',confidence:.5,matched:'source category'};
  return c;
}

export function normalizeTransactions(txs, learned=null) {
  return txs.map(t=>{
    const c=effectiveCategory(t,learned);
    return c.category===t.category?t:{...t,category:c.category,subcategory:c.subcategory};
  });
}

/** Everything Spend needs to render a drill-down, in one pass. */
export function categoriseAll(txs, learned = null) {
  const cats = {};
  for (const t of txs) {
    if (t.amountCents <= 0) continue;
    // Always run the merchant rules — they are far more specific than whatever the
    // importer guessed. The old category is only a fallback when nothing matches.
    // Order matters: our specific rules first, then whatever the aggregator said,
    // and only then "other". Dumping straight to "other" is what made this useless.
    let c = effectiveCategory(t,learned);
    if (c.category === 'other' && t.plaidCategory) {
      const g = categorise('', t.plaidCategory);
      if (g.category !== 'other') c = g;
    }
    const C = (cats[c.category] ??= { cents:0, count:0, subs:{}, merchants:{} });
    C.cents += t.amountCents; C.count++;
    const S = (C.subs[c.subcategory] ??= { cents:0, count:0 });
    S.cents += t.amountCents; S.count++;
    const name = t.merchantName ?? t.merchantId;
    const M = (C.merchants[name] ??= { cents:0, count:0, sub:c.subcategory });
    M.cents += t.amountCents; M.count++;
  }
  const total = Object.values(cats).reduce((a,c)=>a+c.cents,0) || 1;
  return Object.entries(cats)
    .map(([key,c]) => ({
      key, ...TAXONOMY[key] ?? TAXONOMY.other,
      cents:c.cents, count:c.count, share:+(c.cents/total*100).toFixed(1),
      subs: Object.entries(c.subs).map(([k,v])=>({ key:k, ...v })).sort((a,b)=>b.cents-a.cents),
      merchants: Object.entries(c.merchants).map(([k,v])=>({ name:k, ...v })).sort((a,b)=>b.cents-a.cents).slice(0,25)
    }))
    .sort((a,b)=>b.cents-a.cents);
}
