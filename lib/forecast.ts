/**
 * What a run is likely to cost, worked out before it starts.
 *
 * The rates come from measuring finished runs on this workflow rather than from
 * a price list, so they already include the retries and intermediate calls a
 * per-token calculation would miss. They are constants rather than env vars on
 * purpose: this runs in the browser as the form is typed, where process.env is
 * not available.
 *
 * Observed, for one optimised page:
 *   #571  1 page crawled   DataForSEO $0.040  Claude $0.335  total $0.375
 *   #568  1 page crawled   DataForSEO $0.040  Claude $0.351  total $0.391
 *   #564  10 pages         DataForSEO $0.041  Claude $0.763  total $0.804
 *   #566  every page       DataForSEO $0.190  Claude $0.408  total $0.597
 */

/** The crawl is nearly flat: ten pages cost a tenth of a cent more than one. */
const CRAWL_BASE = 0.04;
const CRAWL_PER_PAGE = 0.0002;

/**
 * The dominant term: Claude writing one page. The spread is genuinely wide —
 * $0.335 for a plain page against $0.763 for a game page, which pulls in extra
 * research and image work — so the range is kept wide rather than averaged into
 * a single number that would understate the expensive case.
 */
const ARTICLE_LOW = 0.33;
const ARTICLE_HIGH = 0.8;

/**
 * Stand-in page count for "every page", used only to say something rather than
 * nothing. Real sites vary far too much for this to be better than an order of
 * magnitude, which is why it is reported as unbounded below.
 */
const ASSUMED_PAGES_WHEN_UNLIMITED = 250;

export type Forecast = {
  low: number;
  high: number;
  /** Pages the estimate assumed would be written. */
  articles: number;
  /** True when the real figure depends on a site size we cannot know yet. */
  unbounded: boolean;
  note: string;
};

export function forecastCost(input: {
  max_crawl_pages: number;
  pages_to_optimise: number;
}): Forecast {
  const crawlUnlimited = input.max_crawl_pages === 0;
  const crawlPages = crawlUnlimited
    ? ASSUMED_PAGES_WHEN_UNLIMITED
    : input.max_crawl_pages;

  // "Every crawled page" ties the article count to the crawl, which is where
  // the bill can run away: unlimited crawl plus unlimited pages is unbounded.
  const optimiseAll = input.pages_to_optimise === 0;
  const articles = optimiseAll ? crawlPages : input.pages_to_optimise;

  const crawl = CRAWL_BASE + CRAWL_PER_PAGE * crawlPages;
  const low = crawl + ARTICLE_LOW * articles;
  const high = crawl + ARTICLE_HIGH * articles;

  const unbounded = crawlUnlimited && optimiseAll;

  let note: string;
  if (unbounded) {
    note =
      `Every crawled page will be written, and the crawl has no limit, so the ` +
      `real cost depends on how big the site turns out to be. The figure below ` +
      `assumes about ${ASSUMED_PAGES_WHEN_UNLIMITED} pages.`;
  } else if (optimiseAll) {
    note = `Writing every one of the ${crawlPages} crawled pages.`;
  } else if (crawlUnlimited) {
    note = `The crawl has no limit, but only ${articles} page${
      articles === 1 ? "" : "s"
    } will be written, which is nearly all of the cost.`;
  } else {
    note = `${crawlPages} page${crawlPages === 1 ? "" : "s"} crawled, ${articles} written.`;
  }

  return { low, high, articles, unbounded, note };
}
