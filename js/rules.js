// Rules you may want to edit. Everything here is matched in your browser only.

// Category groups used across all cards.
export const GROUPS = {
  'Food and drink': ['Groceries', 'Restaurants', 'Other food and drink', 'Coffee', 'Bars and nightlife', 'Takeout and delivery'],
  'Health and personal care': ['Medical', 'Other health', 'Beauty', 'Fitness'],
  'Pets': ['Pets'],
  'Travel': ['Flights', 'Other travel', 'Hotels', 'Car rental'],
  'Getting around': ['Gas, parking, and tolls', 'Taxis and rideshares', 'Public transit', 'Maintenance', 'Other transportation', 'Auto insurance'],
  'Bills and home': ['Internet and phone', "Home and renter's insurance", 'Other bills', 'Subscriptions', 'Utilities', 'Home and auto', 'Taxes', 'Moving', 'Card fees and interest'],
  'Shopping and services': ['Clothing', 'Other shopping', 'Amazon', 'Entertainment', 'Services'],
};
export const GROUP_OF = Object.fromEntries(Object.entries(GROUPS).flatMap(([g, cs]) => cs.map((c) => [c, g])));

// Amex Aeroplan (CAD) has no categories in its export: merchants are sorted by these patterns, first match wins.
export const AMEX_RULES = [
  [/^(AMAZON\.CA PRIME|AD FREE FOR PRIMEVIDEO|MICROSOFT|APPLE\.COM|PLAYSTATION|SQSP|HIGGSFIELD|SEMRUSH)/, 'Subscriptions'],
  [/^(AMAZON|AMZN)/, 'Amazon'],
  [/^(ICBC|BELAIR)/, 'Auto insurance'],
  [/^(UHAUL|U-HAUL|INTERLANE)/, 'Moving'],
  [/^(CONDOR|AIRCANADA|AIR CANADA|PORTER|VUELING|RYANAIR)/, 'Flights'],
  [/^(AIRBNB|AGODA|WWW\.HOTELCASA|MILL VILLAGE|TONIC HOTEL)/, 'Hotels'],
  [/^(SIXT|PRICELN\*EUROPCAR|3CPAYMENT\*EUROPCAR)/, 'Car rental'],
  [/^(TRAINLINE|PRIORITY PASS|BCF)/, 'Other travel'],
  [/^BOLT/, 'Taxis and rideshares'],
  [/^(SHELL|YVR PARKING|IMPARK|PAYBYPHONE|CITY OF VAN|ZIPBY|PARKWHIZ|DOMINION|VILLAGE OF LIONS BAY)/, 'Gas, parking, and tolls'],
  [/^(TESLA|TESLOID|WAVE - \*THE RIM GUY)/, 'Maintenance'],
  [/^(X-FOIL|ABELL PEST)/, 'Home and auto'],
  [/^ROVER/, 'Pets'],
  [/^FORMULA FIG/, 'Other health'],
  [/^(SP SPERRY|ADIDAS|UNIQLO|LULULEMON|WILLFUL|SP HAVNBY)/, 'Clothing'],
  [/^MOO INC/, 'Other shopping'],
  [/^DOORDASHLCBO/, 'Bars and nightlife'],
  [/^DOORDASH/, 'Takeout and delivery'],
  [/^(IC\* INSTACART|INSTACART)/, 'Groceries'],
  [/^STARBUCKS/, 'Coffee'],
  [/^(TST-|THE SHED|MOMOTARO|HOT ONTO)/, 'Restaurants'],
  [/^SEA TO SKY/, 'Entertainment'],
  [/^(MEMBERSHIP FEE|INTEREST)/, 'Card fees and interest'],
];

// Delta SkyMiles (USD) merchants.
export const DELTA_RULES = [
  [/^(MANIFEST LEGAL|PAYPAL \*HAMILTONLAW|UPWORK)/, 'Services'],
  [/(MARRIOTT|HOTEL AMOUR|MOXY|THOMPSON SEATTLE|PARADISE VILLAGE|LE PRINCE DE GALLES|VIO\.COM|PRICELINE)/, 'Hotels'],
  [/^(CONDOR|AIRCANADA|AEROMEXICO|VOLARIS)/, 'Flights'],
  [/^(HERTZ|ROAME)/, 'Car rental'],
  [/^(Interest Charge|RENEWAL MEMBERSHIP)/i, 'Card fees and interest'],
  [/^(GRAMMARLY|ANTHROPIC|CLAUDE\.AI|OPENAI|KINDLE)/, 'Subscriptions'],
  [/(BIRKENSTOCK|^NORDSTROM)/, 'Clothing'],
  [/(MACLY|SCENTWEDGE|SHOPXERO|SLATE|AIRWALX)/, 'Other shopping'],
  [/BOEINGFUTURE/, 'Entertainment'],
  [/WHOLEFDS/, 'Groceries'],
  [/SEAPINE BREW/, 'Bars and nightlife'],
  [/(JOE'S FINE CO|CRUISIN COFFE|GO GO ESPRESS|RISE AND GRIND|STARBUCKS)/, 'Coffee'],
  [/(DENNY'S|YARD HOUSE|TST\* NORDSTRO|TST\* TAQUERIA|CHISPITA|KRISPY KREME|ONTO ALVARO)/, 'Restaurants'],
];

// Wealthsimple chequing: business names worth keeping on a row (people's names are dropped).
export const WS_BUSINESS = {
  'Amex aeroplan': 'Amex Aeroplan', 'NEO MC': 'Neo Mastercard', 'Tesla Motors Canada ULC': 'Tesla Motors Canada',
  'Quest trade Margin': 'Questrade', 'Quest Trade Aggressive': 'Questrade', 'Toronto Police Service': 'Toronto Police Service',
  '10649589 CANADA INC.': '10649589 Canada Inc.', '14536347 CANADA INC.': '14536347 Canada Inc.',
};

// RBC chequing: housing amounts as you described them.
export const HOUSING = {
  homeRentText: 'RESIDENTIAL RENT ROYAL LEPAGE',   // rent for your home
  condoFeeText: 'FOREST HILL RES',                 // condo maintenance fee
  houseRentCheque: 3600,                           // each Logan house rent cheque ($7,200 a month)
  condoRentCheque: 2900,                           // condo rent cheque
  condoMortgage: 2590.75,                          // the other MORTGAGE PAYMENT is the Logan house
  depositText: 'MANDER REAL ESTATE',               // deposit on your rental home
};

// One-off threshold used by the filter and the run rates.
export const ONE_OFF = 500;

// Default USD to CAD rate when a Delta month has no CAD-priced charge to read a rate from.
export const DEFAULT_FX = 1.39;
