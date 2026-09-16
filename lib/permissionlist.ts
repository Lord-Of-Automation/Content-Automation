/**
 * What each account is allowed to do, as a list.
 *
 * Only the list and the words for it. The store that remembers who has what
 * reads a file and reaches for the session, neither of which a browser can
 * do — and the page needs the list, so the two live apart rather than the
 * page dragging a filesystem into the bundle.
 *
 * Not a general role system. These are the things this platform actually does,
 * one permission per thing, because a permission that does not map onto a page
 * or a button is one nobody can reason about — "editor" tells you nothing
 * about whether somebody can spend money on a domain.
 *
 * Three of them are separated out from the page they live on, and those three
 * are the point of the whole file: buying a domain spends money, sending a
 * campaign reaches real people, and the keys are every credential the business
 * has. Somebody can reasonably be trusted with the Domains page and not with
 * the card attached to it.
 */

/**
 * The permission that is not like the others.
 *
 * Every other one answers "may they use this page". This one answers "whose
 * work do they see", and that is a different question — it is the only thing
 * here that crosses from one account into another, so it is named rather than
 * left as a string for three files to spell differently.
 *
 * Holding it means holding all of them. There is no sense in an account that
 * can read everybody's mail but not open the mail page.
 */
export const FULL_ACCESS = "admin";

export interface Permission {
  id: string;
  label: string;
  /** What it actually allows, in the terms somebody granting it thinks in. */
  note: string;
  group: string;
  /** Whether granting it should give somebody pause. */
  weighty?: boolean;
}

export const PERMISSIONS: Permission[] = [
  {
    id: "runs",
    label: "Runs",
    group: "Writing",
    note: "Start runs and watch them. Every run costs money at the model, so this is the permission that spends.",
  },
  {
    id: "loops",
    label: "Loops",
    group: "Writing",
    note: "Create runs that start themselves on a schedule. A loop keeps spending after whoever made it has gone home.",
  },
  {
    id: "prompts",
    label: "Prompts",
    group: "Writing",
    note: "Attach an instruction to a site, which every run for that site then follows.",
  },
  /*
   * Its own permission rather than part of Runs, and left out of the default
   * set below. A page type is a new set of instructions the engine has not
   * been run with before, and whoever may define one decides what gets
   * written and published under it — somebody trusted with the Runs page has
   * not necessarily been trusted with that.
   */
  {
    id: "custom",
    label: "Custom page types",
    group: "Writing",
    weighty: true,
    note: "Create page types and run the engine with them. Every run costs money at the model.",
  },
  {
    id: "websites",
    label: "AI Websites",
    group: "Writing",
    note: "Build whole sites and edit the pages this platform has written.",
  },

  {
    id: "domains",
    label: "Domains",
    group: "Domains",
    note: "See the domain list, check availability and generate names.",
  },
  {
    id: "domains.buy",
    label: "Buy domains",
    group: "Domains",
    weighty: true,
    note: "Register a domain, charged to the payment method on the registrar account. There is no undo and no approval step.",
  },
  {
    id: "domains.dns",
    label: "Change DNS",
    group: "Domains",
    weighty: true,
    note: "Edit name servers and records. A wrong record takes a live site off the internet.",
  },

  {
    id: "mailing",
    label: "Backlink Mailing",
    group: "Outreach",
    note: "Read the conversations this platform started and reply to publishers.",
  },
  {
    id: "mailing.send",
    label: "Send campaigns",
    group: "Outreach",
    weighty: true,
    note: "Write articles and email them to publishers. An email that has reached somebody cannot be taken back.",
  },

  {
    id: "hosting",
    label: "Hosting",
    group: "Infrastructure",
    note: "See the applications and servers on the hosting accounts, and clear caches.",
  },
  {
    id: "hosting.modify",
    label: "Modify hosting",
    group: "Infrastructure",
    weighty: true,
    note: "Change a site's domain, clone it, or delete it. Deleting an application is permanent.",
  },
  {
    id: "performance",
    label: "Search Console",
    group: "Infrastructure",
    note: "See clicks, impressions and positions for the properties this account can read.",
  },

  {
    id: "keys",
    label: "Keys and providers",
    group: "Administration",
    weighty: true,
    note: "Read which credentials are set and replace them. Anybody with this can point the platform at their own accounts.",
  },
  {
    id: "accounts",
    label: "Accounts",
    group: "Administration",
    weighty: true,
    note: "Add people and change what they are allowed to do, including their own.",
  },
  {
    id: "logs",
    label: "Activity log",
    group: "Administration",
    note: "See who did what, and what the platform has spent.",
  },
  {
    id: FULL_ACCESS,
    label: "Full access",
    group: "Administration",
    weighty: true,
    note:
      "Everything above, plus every other person's work: their runs, their " +
      "conversations, their hosted sites. This is the one permission that " +
      "reaches outside its own account, and the only way to see the work from " +
      "before accounts were separated. Grant it to a partner, not to staff.",
  },
];

export const EVERY_PERMISSION = PERMISSIONS.map((one) => one.id);

/**
 * What somebody gets before anybody has decided.
 *
 * The work, and none of the money or the keys. A new account can write, see
 * the domains and read the mail; it cannot buy a domain, send a campaign,
 * delete a hosted site, touch a credential or change what anybody is allowed
 * to do.
 *
 * Erring towards useful rather than towards empty, because the alternative is
 * an account that can do nothing at all and a person who assumes the platform
 * is broken. Everything left out of this list is something that spends money,
 * reaches a stranger, or cannot be undone.
 */
export const DEFAULT_PERMISSIONS = [
  "runs",
  "loops",
  "prompts",
  "websites",
  "domains",
  "mailing",
  "hosting",
  "performance",
  "logs",
];


function tidy(user: string): string {
  return String(user ?? "").trim().toLowerCase();
}
/**
 * The word for a set of permissions, for the badge beside a name.
 *
 * Three, because a badge with more than about three values stops being read.
 *
 * The admin is passed in rather than read from the environment, because this
 * runs in a browser and there is no environment there. The page already has
 * the name: it arrived with the accounts.
 * What it is really saying is how much damage this account could do, which is
 * the question somebody scanning the list is asking.
 */
export function roleOf(
  user: string,
  granted: string[],
  admin: string,
): { label: string; tone: string } {
  // Named in the environment or given it here. The badge does not distinguish
  // them because the account cannot either: both see everything.
  if (tidy(user) === tidy(admin)) return { label: "Admin", tone: "admin" };
  if (granted.includes(FULL_ACCESS)) return { label: "Admin", tone: "admin" };
  if (!granted.length) return { label: "No access", tone: "none" };

  const heavy = PERMISSIONS.filter((one) => one.weighty).map((one) => one.id);
  if (heavy.some((one) => granted.includes(one))) return { label: "Full access", tone: "full" };

  return { label: "Limited", tone: "limited" };
}
