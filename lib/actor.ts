import { auth } from "@/auth";

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

/**
 * The account that sees everything, named in the environment.
 *
 * The same name the engine is given, and it has to be the same name or the two
 * halves disagree about who the admin is. It exists for support, for knowing
 * what the platform spends, and for the duller reason that the data written
 * before any of this existed has no owner and somebody must still be able to
 * reach it.
 */
export function adminUser(): string {
  return String(process.env.ADMIN_USER ?? "").trim().toLowerCase();
}

export async function isAdmin(): Promise<boolean> {
  const admin = adminUser();
  return !!admin && (await currentUser()) === admin;
}

/**
 * The header every engine call carries.
 *
 * One place, so the name the engine is told is the name this console decided
 * and not something a route assembled on its own.
 */
export async function signedAs(): Promise<Record<string, string>> {
  return { "x-user": await currentUser() };
}
