/**
 * Mirrors the location_code lookup inside the workflow's "Set context" node.
 * Anything not in this map silently falls back to 2840 (US) in n8n, which is
 * the kind of thing you only notice three runs later, so the UI only offers
 * markets that actually resolve.
 */
export type Market = {
  code: string;
  label: string;
  locationCode: number;
};

export const MARKETS: Market[] = [
  { code: "gb", label: "United Kingdom", locationCode: 2826 },
  { code: "ie", label: "Ireland", locationCode: 2372 },
  { code: "us", label: "United States", locationCode: 2840 },
  { code: "ca", label: "Canada", locationCode: 2124 },
  { code: "au", label: "Australia", locationCode: 2036 },
  { code: "nz", label: "New Zealand", locationCode: 2554 },
  { code: "de", label: "Germany", locationCode: 2276 },
  { code: "at", label: "Austria", locationCode: 2040 },
  { code: "ch", label: "Switzerland", locationCode: 2756 },
  { code: "fr", label: "France", locationCode: 2250 },
  { code: "es", label: "Spain", locationCode: 2724 },
  { code: "it", label: "Italy", locationCode: 2380 },
  { code: "pt", label: "Portugal", locationCode: 2620 },
  { code: "nl", label: "Netherlands", locationCode: 2528 },
  { code: "be", label: "Belgium", locationCode: 2056 },
  { code: "pl", label: "Poland", locationCode: 2616 },
  { code: "cz", label: "Czechia", locationCode: 2203 },
  { code: "se", label: "Sweden", locationCode: 2752 },
  { code: "no", label: "Norway", locationCode: 2578 },
  { code: "dk", label: "Denmark", locationCode: 2208 },
  { code: "fi", label: "Finland", locationCode: 2246 },
  { code: "gr", label: "Greece", locationCode: 2300 },
  { code: "hu", label: "Hungary", locationCode: 2348 },
  { code: "ro", label: "Romania", locationCode: 2642 },
  { code: "tr", label: "Turkey", locationCode: 2792 },
  { code: "ru", label: "Russia", locationCode: 2643 },
  { code: "ua", label: "Ukraine", locationCode: 2804 },
  { code: "ge", label: "Georgia", locationCode: 2268 },
  { code: "br", label: "Brazil", locationCode: 2076 },
  { code: "mx", label: "Mexico", locationCode: 2484 },
  { code: "ar", label: "Argentina", locationCode: 2032 },
  { code: "cl", label: "Chile", locationCode: 2152 },
  { code: "za", label: "South Africa", locationCode: 2710 },
  { code: "in", label: "India", locationCode: 2356 },
  { code: "th", label: "Thailand", locationCode: 2764 },
  { code: "jp", label: "Japan", locationCode: 2392 },
  { code: "kr", label: "South Korea", locationCode: 2410 },
];

export const MARKET_CODES = new Set(MARKETS.map((m) => m.code));

/** DataForSEO language codes the workflow passes straight through. */
export const LANGUAGES: { code: string; label: string }[] = [
  { code: "en", label: "English" },
  { code: "de", label: "German" },
  { code: "fr", label: "French" },
  { code: "es", label: "Spanish" },
  { code: "it", label: "Italian" },
  { code: "pt", label: "Portuguese" },
  { code: "nl", label: "Dutch" },
  { code: "sv", label: "Swedish" },
  { code: "no", label: "Norwegian" },
  { code: "da", label: "Danish" },
  { code: "fi", label: "Finnish" },
  { code: "pl", label: "Polish" },
  { code: "cs", label: "Czech" },
  { code: "el", label: "Greek" },
  { code: "hu", label: "Hungarian" },
  { code: "ro", label: "Romanian" },
  { code: "tr", label: "Turkish" },
  { code: "ru", label: "Russian" },
  { code: "uk", label: "Ukrainian" },
  { code: "ka", label: "Georgian" },
  { code: "ja", label: "Japanese" },
  { code: "ko", label: "Korean" },
  { code: "th", label: "Thai" },
];

export const LANGUAGE_CODES = new Set(LANGUAGES.map((l) => l.code));

/** Sensible language for a market, used to auto-pair the two dropdowns. */
export const MARKET_DEFAULT_LANGUAGE: Record<string, string> = {
  gb: "en", ie: "en", us: "en", ca: "en", au: "en", nz: "en", in: "en", za: "en",
  de: "de", at: "de", ch: "de",
  fr: "fr", be: "nl", nl: "nl",
  es: "es", mx: "es", ar: "es", cl: "es",
  it: "it", pt: "pt", br: "pt",
  pl: "pl", cz: "cs", se: "sv", no: "no", dk: "da", fi: "fi",
  gr: "el", hu: "hu", ro: "ro", tr: "tr",
  ru: "ru", ua: "uk", ge: "ka",
  th: "th", jp: "ja", kr: "ko",
};
