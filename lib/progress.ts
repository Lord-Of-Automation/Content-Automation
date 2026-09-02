/**
 * The workflow reports nothing about its own progress, but the n8n execution
 * record lists every node that has produced data so far. Mapping those node
 * names onto ordered stages gives a real progress bar without touching the
 * workflow at all.
 *
 * Node names must match the workflow exactly. If you rename a node in n8n,
 * rename it here too, otherwise that stage just never lights up.
 */
export type Stage = {
  key: string;
  label: string;
  hint: string;
  nodes: string[];
};

export const STAGES: Stage[] = [
  {
    key: "crawl",
    label: "Crawling the site",
    hint: "DataForSEO OnPage crawl, polled until it reports finished",
    nodes: [
      "OnPage: start crawl",
      "Init crawl",
      "Wait for crawl",
      "OnPage: check status",
      "Crawl finished?",
    ],
  },
  {
    key: "linkgraph",
    label: "Building the link graph",
    hint: "Pages and internal links pulled from the crawl",
    nodes: ["OnPage: get pages", "OnPage: get links", "Build link graph"],
  },
  {
    key: "anchors",
    label: "Finding link-starved pages",
    hint: "Pages with too few inbound links, plus anchor text for them",
    nodes: [
      "Split starved",
      "Fetch starved page",
      "Aggregate starved",
      "Anchor targets (AI)",
      "Parse anchor targets",
      "Map crawl to pages",
      "TEST LIMIT",
    ],
  },
  {
    key: "read",
    label: "Reading the target page",
    hint: "Fetching the page and extracting its keywords",
    nodes: ["Set context", "Fetch target page", "Extract keywords (AI)"],
  },
  {
    key: "classify",
    label: "Classifying the page",
    hint: "Game review, casino review, promo codes, blog or other",
    nodes: ["Identify page type (AI)1", "Classify page type", "Blog page?"],
  },
  {
    key: "keywords",
    label: "Keyword research",
    hint: "DataForSEO keyword ideas, filtered and scored",
    nodes: [
      "Extract seeds",
      "DataForSEO keyword ideas",
      "Keyword registry",
      "Find quick wins",
    ],
  },
  {
    key: "serp",
    label: "Reading the SERP",
    hint: "Live SERP, then fetching the pages that rank",
    nodes: [
      "DataForSEO SERP",
      "Pick competitors",
      "Fetch competitor page",
      "Aggregate competitors",
      "Game page?",
    ],
  },
  {
    key: "game",
    label: "Game research",
    hint: "Slots Launch catalogue and the trusted source page (game pages only)",
    nodes: [
      "Fetch providers",
      "Find provider",
      "Fetch provider games",
      "Match SlotsLaunch game",
      "Trusted sources",
      "Resolve trusted source",
      "Fetch trusted source",
      "Parse trusted source",
      "Extract game facts",
      "Research the game1",
      "Parse game research1",
    ],
  },
  {
    key: "brief",
    label: "Competitor analysis and brief",
    hint: "What the ranking pages cover, plus the house brief from Drive",
    nodes: ["Analyze competitors", "Fetch brief template", "Read brief template"],
  },
  {
    key: "casino",
    label: "Visiting the operator site",
    hint: "Rendering and screenshotting the lobby (casino pages only)",
    nodes: [
      "Official casino list",
      "Match official casino",
      "Official casino found?",
      "Render casino site",
      "Screenshot casino site",
      "Download screenshot",
      "Screenshot to base64",
      "Did the page load?",
      "Page loaded?",
      "Wait, then try again",
      "Render casino site (second try)",
      "Screenshot casino site (second try)",
      "Download screenshot (second try)",
      "Screenshot to base64 (second try)",
      "Digest casino landing page",
      "Upload casino screenshot",
      "Review casino landing page",
      "Parse casino review",
    ],
  },
  {
    key: "draft",
    label: "Writing the draft",
    hint: "The long one. Claude writes the page body",
    nodes: [
      "Game page draft?1",
      "Draft game page (AI)1",
      "Draft page",
      "Parse draft",
    ],
  },
  {
    key: "media",
    label: "Demo and gallery",
    hint: "Slots Launch demo iframe and screenshots from the trusted source",
    nodes: [
      "Insert game demo",
      "Build gallery source URL",
      "Extract gallery images",
      "Has gallery images?",
      "Upload gallery image",
      "Insert image gallery",
    ],
  },
  {
    key: "story",
    label: "Story images",
    hint: "Withdrawal and support screenshots generated with Gemini",
    nodes: [
      "Needs story images?1",
      "Input + Templates",
      "Generate Storyline",
      "Parse Storyline",
      "Split Story Into Images",
      "Select Template",
      "Download Withdrawal Template",
      "Download Support Template",
      "Withdrawal Template to base64",
      "Support Template to base64",
      "Generate Withdrawal Image",
      "Generate Support Image",
      "Extract Withdrawal Image",
      "Extract Support Image",
      "Merge Generated Images",
      "Combine Generated Images",
      "Upload Withdrawal Image to WordPress",
      "Upload Support Image to WordPress",
      "Merge Uploaded Images",
      "Merge Visual Story Into Parsed Content",
      "Append casino review section",
    ],
  },
  {
    key: "meta",
    label: "Meta, links and FAQ schema",
    hint: "Link density enforced, title and description written, FAQ JSON-LD built",
    nodes: [
      "Enforce link density",
      "Build meta",
      "Validate meta",
      "Build FAQ schema1",
      "Content complete?",
    ],
  },
  {
    key: "publish",
    label: "Publishing to WordPress",
    hint: "Resolving the post by slug, then updating it in place",
    nodes: [
      "WP get types",
      "Build slug lookups",
      "WP find by slug",
      "Resolve WP target",
      "Post found?",
      "WP: update in place",
    ],
  },
  {
    key: "log",
    label: "Logging and indexing",
    hint: "Sheets rows written, IndexNow pinged",
    nodes: [
      "Build baseline row",
      "Log to Published",
      "Build registry rows",
      "Add to Registry",
      "IndexNow ping",
      "Build not-updated row",
      "Log skipped",
    ],
  },
];

const NODE_TO_STAGE = new Map<string, number>();
STAGES.forEach((stage, index) => {
  for (const node of stage.nodes) NODE_TO_STAGE.set(node, index);
});

export type StageState = "done" | "active" | "pending" | "skipped" | "failed";

export type ProgressStage = Stage & {
  state: StageState;
  nodesRun: number;
  /**
   * What this step produced, when the engine recorded it.
   *
   * Only some steps carry one. A step whose result is the article itself has
   * nothing safe to show — the run record holds decisions, never payload — so
   * those simply have no dropdown rather than an empty one.
   */
  output?: unknown;
  /**
   * The step's name as the engine knows it, which is what a pin is keyed by.
   *
   * The same string as `label` today, and deliberately separate: a pin keyed on
   * a display label would break the day one is shortened to fit a column.
   */
  stepName?: string;
  /** True when this step returned a pinned value instead of running. */
  pinned?: boolean;
};

/**
 * The page being written right now, and where it sits in the batch.
 *
 * Null when the run is between pages, finished, or still crawling — a run
 * spends its first several minutes on work that belongs to no single page.
 */
export type CurrentPage = {
  url: string;
  index: number;
  total: number;
};

/** A page this run has already finished and published. */
export type DonePage = {
  url: string;
  postId: number | string | null;
};

export type Progress = {
  stages: ProgressStage[];
  currentLabel: string | null;
  percent: number;
  nodesExecuted: number;
  currentPage: CurrentPage | null;
  /** Oldest first, which is the order they were written in. */
  donePages: DonePage[];
};

/**
 * `executedNodes` is the set of node names present in the execution's runData.
 * `isRunning` decides whether the furthest stage reads as "active" or "done".
 */
export function buildProgress(
  executedNodes: string[],
  isRunning: boolean,
  lastNodeExecuted?: string | null
): Progress {
  const counts = new Map<number, number>();

  for (const name of executedNodes) {
    const index = NODE_TO_STAGE.get(name);
    if (index === undefined) continue;
    counts.set(index, (counts.get(index) ?? 0) + 1);
  }

  // The workflow branches heavily (a blog page skips almost everything, a game
  // page skips the casino visit), so "how far did it get" is the furthest stage
  // touched, not the number of stages completed.
  let furthest = -1;
  for (const index of counts.keys()) {
    if (index > furthest) furthest = index;
  }

  // Prefer the genuinely last node n8n reports, when we can place it.
  const lastIndex =
    lastNodeExecuted != null ? NODE_TO_STAGE.get(lastNodeExecuted) : undefined;
  const activeIndex = lastIndex !== undefined ? lastIndex : furthest;

  const stages: ProgressStage[] = STAGES.map((stage, index) => {
    const nodesRun = counts.get(index) ?? 0;
    let state: StageState;

    if (index > furthest) {
      state = "pending";
    } else if (index === activeIndex && isRunning) {
      state = "active";
    } else if (nodesRun > 0) {
      state = "done";
    } else {
      // Behind the high-water mark but never ran: a branch the page did not take.
      state = "skipped";
    }

    return { ...stage, state, nodesRun };
  });

  const percent =
    furthest < 0 ? 0 : Math.round(((furthest + 1) / STAGES.length) * 100);

  return {
    stages,
    currentLabel: activeIndex >= 0 ? STAGES[activeIndex]?.label ?? null : null,
    percent: isRunning ? Math.min(percent, 99) : percent,
    nodesExecuted: executedNodes.length,
    // n8n's execution data has no equivalent: the workflow never recorded which
    // page it was on, nor which it had finished. Runs on that backend simply do
    // not show either.
    currentPage: null,
    donePages: [],
  };
}
