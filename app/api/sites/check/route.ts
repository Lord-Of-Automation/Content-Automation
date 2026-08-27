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
    const plugin = await probe("plugin route", "/wp-json/n8n/v1/content", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: 0, title: "permission probe", content: "" }),
    });

    const meBody = (me.body ?? {}) as any;
    const caps = meBody.capabilities ?? {};

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
      probes: [me, types, plugin].map(({ body, ...rest }) => rest),
      reading:
        me.status === 401
          ? "The login itself is being rejected. Wrong username, or the application password was regenerated."
          : plugin.status === 401 || plugin.status === 403
            ? "The login works but the plugin route refuses it. That is a capability or a security plugin, not a bad password."
            : plugin.status === 404
              ? "The plugin route does not exist on this site. The content bridge plugin is missing or inactive."
              : "The login works and the plugin route accepts it.",
    });
  } catch (error) {
    return errorResponse(error);
  }
}
