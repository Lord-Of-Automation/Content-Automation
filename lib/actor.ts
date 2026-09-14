import { auth } from "@/auth";
import { adminUser, hasFullAccess } from "./permissions";

// Re-exported because "who is in charge" is a question people come to this
// file with. It is defined beside the store that can also answer it, so the
// two cannot drift apart.
export { adminUser };

/**
 * Who is signed in, for everything that keeps data per person.
 *
 * This console is the half with a login on it, so it is the half that knows
 * who somebody is. The engine is reached with one shared token and cannot
 * work it out for itself — it takes this console's word, on every call, and
 * filters what it hands back accordingly.
 *
 * Read here rather than passed down from each route. There are around thirty
 * routes that reach the engine and a rule every one of them has to remember is
 * a rule that will be forgotten in one of them; forgetting it here would mean
 * a request signed as nobody, which sees nothing, rather than a request signed
 * as the wrong person.
 */
export async function currentUser(): Promise<string> {
  const session = await auth();
  return String(session?.user?.name ?? "").trim().toLowerCase();
}

/** Whether whoever is signed in sees everybody's work rather than their own. */
export async function isAdmin(): Promise<boolean> {
  return hasFullAccess(await currentUser());
}

/**
 * The headers every engine call carries.
 *
 * One place, so the name the engine is told is the name this console decided
 * and not something a route assembled on its own.
 *
 * Two things are said, not one: who this is, and whether they see everything.
 * The second has to be said here because it is not a fact about the engine —
 * full access is granted on the accounts page, which is this side, and the
 * engine has no session, no account list and no way to look it up. It takes
 * this console's word for who somebody is already; this is the same word about
 * the same person, sent the same way.
 */
export async function signedAs(): Promise<Record<string, string>> {
  const who = await currentUser();
  const headers: Record<string, string> = { "x-user": who };
  if (await hasFullAccess(who)) headers["x-admin"] = "1";
  return headers;
}

/**
 * Who is looking, and whether they see everybody's work.
 *
 * The pair almost every per-person question needs, fetched together because
 * asking for one without the other is how a filter ends up ignoring full
 * access.
 */
export async function viewer(): Promise<{ name: string; admin: boolean }> {
  const name = await currentUser();
  return { name, admin: await hasFullAccess(name) };
}
