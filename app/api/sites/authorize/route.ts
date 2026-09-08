import { NextResponse } from "next/server";

import { auth } from "@/auth";
import { record } from "@/lib/audit";
import { errorResponse, requireSession } from "@/lib/api-guard";
import { normaliseDomain, saveSite } from "@/lib/sites";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Where WordPress sends somebody back after they authorise this console.
 *
 * WordPress has a flow for exactly this problem: send a person to
 * wp-admin/authorize-application.php on their own site, they approve by name,
 * and WordPress mints an application password and hands it back. It is the
 * mechanism core added so that integrations stop asking people to copy strings
 * between two admin screens — which, across three hundred applications, is not
 * a thing anybody is going to do.
 *
 * The password arrives as a query parameter, because that is how the flow
 * works. So it is consumed here and the browser is sent straight on to a clean
 * address: a credential in a URL is a credential in browser history, and the
 * shorter that URL lives the better.
 *
 * The site is saved under the domain the console asked about *and* under the
 * one WordPress reports, when they differ. An application with no custom domain
 * answers on its staging address, while WordPress may believe it lives
 * somewhere else entirely; publishing has to find the credential under whichever
 * of the two it was given.
 */
export async function GET(request: Request) {
  const denied = await requireSession();
  if (denied) return denied;

  const session = await auth();
  const actor = session?.user?.name ?? "unknown";

  const url = new URL(request.url);
  const params = url.searchParams;

  /*
   * Where to go afterwards.
   *
   * Checked against the shape of a website id rather than used as given. This
   * address is reachable by anyone who can make the browser follow a link, and
   * a redirect target taken on trust is an open redirect.
   */
  const backRaw = params.get("back") ?? "";
  const back = /^[\w-]{1,64}$/.test(backRaw) ? backRaw : "";
  // Always carrying a query, so appending one more is a "&" in both cases
  // rather than a path with an ampersand in it.
  const home = back ? `/websites/${back}?tab=publish` : "/websites?tab=publish";

  const asked = params.get("asked") ?? "";

  // Declined, or closed. WordPress says so with success=false, or by sending
  // nothing back at all.
  if (params.get("success") === "false" || !params.get("password")) {
    return NextResponse.redirect(new URL(`${home}&connected=declined`, url.origin));
  }

  const login = String(params.get("user_login") ?? "").trim();
  const password = String(params.get("password") ?? "");
  const reported = String(params.get("site_url") ?? "").trim();

  if (!login || !password) {
    return NextResponse.redirect(new URL(`${home}&connected=incomplete`, url.origin));
  }

  try {
    // Both names for the same site, when WordPress does not agree with the host
    // about what the site is called.
    const domains = Array.from(
      new Set(
        [asked, reported]
          .map((value) => normaliseDomain(value))
          .filter((value): value is string => Boolean(value)),
      ),
    );

    if (!domains.length) {
      return NextResponse.redirect(new URL(`${home}&connected=nodomain`, url.origin));
    }

    for (const domain of domains) {
      const result = await saveSite(domain, login, password, actor);
      if (!result.ok) {
        return NextResponse.redirect(
          new URL(`${home}&connected=failed`, url.origin),
        );
      }
    }

    await record(
      actor,
      "site-saved",
      `WordPress authorised this console for ${domains.join(" and ")} (user ${login})`,
    );

    return NextResponse.redirect(
      new URL(`${home}&connected=${encodeURIComponent(domains[0]!)}`, url.origin),
    );
  } catch (error) {
    return errorResponse(error);
  }
}
