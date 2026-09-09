import { NextResponse } from "next/server";

import { errorResponse, requireSession } from "@/lib/api-guard";
import { credentialsFor, normaliseDomain } from "@/lib/sites";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Does the stored login for a site actually work, and for what?
 *
 * Publishing failed with a 401 from the plugin route while the page lookup
 * succeeded, which narrows it to capabilities rather than a bad password — but
 * only the site can settle that. This asks it directly.
 *
 * Every probe is a read. It used to POST a "permission probe" to the plugin
 * route to see whether the route accepted the login, which answered the
 * question and asked a live site to consider creating a post to do it. Once
 * there is a button for this, somebody will press it twice, and a diagnostic
 * that writes to the site it is diagnosing is the wrong kind of tool. The
 * plugin is now found by asking the site which namespaces it serves, and what
 * the login may do comes from the capabilities the site reports for it.
 *
 * What that gives up is narrow and worth saying: a security plugin blocking
 * the bridge route specifically, while leaving core REST alone, now shows as
 * a working login rather than as a refusal. The reading below says so.
 *
 * The password is never returned; only its length, so a truncated paste is
 * visible without exposing it.
 */
export async function GET(request: Request) {
  const denied = await requireSession();
  if (denied) return denied;

  const url = new URL(request.url);
  const site = url.searchParams.get("site") ?? "";
  const domain = normaliseDomain(site);

  if (!domain) {
    return NextResponse.json(
      { error: "Pass ?site=https://example.com or ?site=example.com" },
      { status: 400 },
    );
  }

  try {
    const creds = await credentialsFor(site);
    if (!creds) {
      return NextResponse.json({
        domain,
        found: false,
        note:
          "No account is stored for this domain, or its secret could not be decrypted. " +
          "A run against this site would write the article and stop before publishing.",
      });
    }

    const auth =
      "Basic " + Buffer.from(`${creds.username}:${creds.password}`).toString("base64");
    const origin = `https://${domain}`;

    const probe = async (
      label: string,
      path: string,
      init: RequestInit & { anonymous?: boolean } = {},
    ): Promise<Record<string, unknown>> => {
      const { anonymous, ...rest } = init;
      try {
        const response = await fetch(`${origin}${path}`, {
          ...rest,
          headers: {
            ...(anonymous ? {} : { authorization: auth }),
            ...(rest.headers ?? {}),
          },
          signal: AbortSignal.timeout(20_000),
          cache: "no-store",
        });
        const text = await response.text();
        let body: any = null;
        try { body = JSON.parse(text); } catch { /* not json */ }
        return {
          label,
          status: response.status,
          ok: response.ok,
          code: body?.code ?? null,
          message: (body?.message ?? body?.error_description ?? text.slice(0, 160)) || null,
          body,
        };
      } catch (error) {
        return {
          label,
          status: null,
          ok: false,
          message: error instanceof Error ? error.message : String(error),
        };
      }
    };

    /*
     * What the platform actually does, asked in that order.
     *
     * The first version leant on /wp/v2/users/me, which was the wrong question
     * and gave a wrong answer on a site that publishes perfectly well. Sites
     * put a plugin in front of the REST API, and those plugins answer for
     * /wp/v2 in their own words: one of ours replies 400 INVALID_USERNAME to a
     * Basic header it does not recognise, having never asked WordPress at all.
     * The login was being called broken on the evidence of a wrapper that
     * publishing never goes near.
     *
     * So three questions, each asked where its answer actually lives.
     */

    // Is the site there, and is the content bridge on it? The index is public
    // and lists every namespace a plugin registers, so this needs no login and
    // cannot be answered wrongly by one.
    const root = await probe("the site's REST index", "/wp-json/");

    /*
     * Does the bridge route exist, and does it guard itself?
     *
     * Asked WITHOUT credentials, deliberately. Unauthenticated the route
     * refuses at its permission check and never reaches the handler, so this
     * cannot write anything: rest_forbidden means the route is there and
     * protected, rest_no_route means it is missing. Sending the login here
     * instead would test more and risk creating a post to do it, and a
     * diagnostic that writes to the site it is diagnosing is the wrong tool.
     */
    const bridgeRoute = await probe("the content bridge", "/wp-json/n8n/v1/content", {
      method: "POST",
      anonymous: true,
      headers: { "content-type": "application/json" },
      body: "{}",
    });

    /*
     * Is the login accepted?
     *
     * A draft page is a read no stranger may make, so WordPress answers 401 to
     * one and 200 to somebody who may edit pages, which is the permission
     * publishing needs. On a site whose REST API is fronted by an auth plugin
     * this answers for the plugin rather than for WordPress, which the reading
     * below says rather than blaming the password for it.
     */
    const drafts = await probe(
      "a signed-in read",
      "/wp-json/wp/v2/pages?status=draft&per_page=1&context=edit",
    );
    const me = await probe("who the login is", "/wp-json/wp/v2/users/me?context=edit");

    const meBody = (me.body ?? {}) as any;
    const caps = meBody.capabilities ?? {};
    const namespaces: string[] = Array.isArray((root.body as any)?.namespaces)
      ? (root.body as any).namespaces.map(String)
      : [];
    const bridge = namespaces.includes("n8n/v1");

    /*
     * Whether something other than WordPress answered.
     *
     * WordPress states an error as {code, message, data:{status}}, where the
     * code is a string like rest_forbidden. A plugin in front of it answers in
     * its own shape, and the ones seen so far carry an error_description and
     * put the HTTP status in the code. Either tells us the reply is a
     * wrapper's opinion of a Basic header, not WordPress's opinion of this
     * login.
     */
    const wrapped = (answer: Record<string, unknown>): boolean => {
      const body = (answer.body ?? {}) as any;
      if (!body || typeof body !== "object") return false;
      if (typeof body.error_description === "string") return true;
      return typeof body.code === "string" && /^[0-9]{3}$/.test(body.code);
    };
    const gatekeeper = wrapped(drafts);

    /*
     * Whether the bridge answered as a route that exists.
     *
     * WordPress replies rest_no_route to a path it does not serve and
     * rest_forbidden to one it serves and will not let a stranger use. Both
     * come back as an error to a stranger, so the code is what separates them.
     */
    const bridgeGuards = bridgeRoute.code === "rest_forbidden" || bridgeRoute.status === 403;
    const bridgeMissing = bridgeRoute.code === "rest_no_route";

    return NextResponse.json({
      domain,
      found: true,
      username: creds.username,
      passwordLength: creds.password.length,
      site: String((root.body as any)?.name ?? "").trim() || null,
      identity: meBody.id
        ? {
            id: meBody.id,
            name: meBody.name,
            roles: meBody.roles ?? [],
            edit_posts: !!caps.edit_posts,
            publish_posts: !!caps.publish_posts,
            edit_others_posts: !!caps.edit_others_posts,
            manage_options: !!caps.manage_options,
          }
        : null,
      bridge,
      gatekeeper,
      namespaces: namespaces.length,
      /*
       * Every probe, with what it answered.
       *
       * The sentence below is a reading of these, and a reading can be wrong,
       * as this one was. Somebody whose own site disagrees with the verdict
       * should be able to see what it was worked out from.
       */
      probes: [root, bridgeRoute, drafts, me].map(({ body, ...rest }) => rest),
      /*
       * One sentence, in the order the failures actually happen.
       *
       * Reachability first, because a site that answers nothing makes every
       * other reading meaningless. Then the bridge, which is what publishing
       * goes through. The login last, and hedged rather than blamed when
       * something other than WordPress answered for it.
       */
      reading: !root.status
        ? `The site could not be reached: ${root.message ?? "no answer"}.`
        : !root.ok
          ? `The site answered ${root.status} at /wp-json/, so its REST API is not reachable. A run cannot publish to it.`
          : bridgeMissing || (!bridge && !bridgeGuards)
            ? "The content bridge plugin is not on this site. A run would write the article and stop before publishing."
            : drafts.ok
              ? "The login works, the content bridge is there, and this user may edit pages. Nothing stands between a run and publishing."
              : gatekeeper
                ? `The content bridge is there and guarding itself, which is what publishing uses. A security plugin answers for the rest of this site's REST API and refused a Basic login with ${drafts.status}${drafts.code ? ` ${drafts.code}` : ""}, so the login could not be confirmed that way. That plugin is not in the publishing path, so this is not evidence of a problem.`
                : drafts.status === 401
                  ? "The login is being rejected. Wrong username, or the application password was regenerated. It can also be a host stripping the Authorization header before WordPress sees it."
                  : drafts.status === 403
                    ? "The login works but may not edit pages, so a run would write the article and fail to publish it."
                    : `A signed-in read answered ${drafts.status}${drafts.code ? ` ${drafts.code}` : ""}, so the login could not be confirmed. The requests below say which.`,
    });
  } catch (error) {
    return errorResponse(error);
  }
}
