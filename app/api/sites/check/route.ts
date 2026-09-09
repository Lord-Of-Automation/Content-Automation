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
      init: RequestInit = {},
    ): Promise<Record<string, unknown>> => {
      try {
        const response = await fetch(`${origin}${path}`, {
          ...init,
          headers: { authorization: auth, ...(init.headers ?? {}) },
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
          message: (body?.message ?? text.slice(0, 160)) || null,
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

    const me = await probe("who am I", "/wp-json/wp/v2/users/me?context=edit");
    const types = await probe("core REST", "/wp-json/wp/v2/types");
    // Every namespace the site serves. The content bridge registers n8n/v1,
    // so its presence here is the plugin being installed and active, asked
    // for without writing anything.
    const root = await probe("the REST index", "/wp-json/");

    const meBody = (me.body ?? {}) as any;
    const caps = meBody.capabilities ?? {};
    const namespaces: string[] = Array.isArray((root.body as any)?.namespaces)
      ? (root.body as any).namespaces.map(String)
      : [];
    const bridge = namespaces.includes("n8n/v1");

    return NextResponse.json({
      domain,
      found: true,
      username: creds.username,
      passwordLength: creds.password.length,
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
      namespaces: namespaces.length,
      probes: [me, types, root].map(({ body, ...rest }) => rest),
      /*
       * One sentence, in the order the failures actually happen.
       *
       * Reachability first, because a site that answers nothing makes every
       * other reading meaningless. Then the login, then whether the plugin
       * that does the publishing is even there, then whether this login is
       * allowed to publish once it is.
       */
      reading: !me.status
        ? `The site could not be reached: ${me.message ?? "no answer"}.`
        : me.status === 401 || me.status === 403
          ? "The login itself is being rejected. Wrong username, or the application password was regenerated."
          : !me.ok
            ? `The site answered ${me.status} to a signed-in request, so the login could not be confirmed.`
            : !bridge
              ? "The login works, but the content bridge plugin is not on this site. A run would write the article and stop before publishing."
              : !caps.publish_posts
                ? "The login works and the plugin is there, but this user may not publish. A run would create drafts at best."
                : "The login works, the plugin is there, and this user may publish.",
    });
  } catch (error) {
    return errorResponse(error);
  }
}
