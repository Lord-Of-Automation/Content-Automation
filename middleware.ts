import NextAuth from "next-auth";
import { authConfig } from "./auth.config";

// Uses the provider-free config so nothing Node-specific reaches the edge.
export const { auth: middleware } = NextAuth(authConfig);

export const config = {
  // Pages only. /api is deliberately excluded: middleware answers an
  // unauthenticated request with a redirect to /login, and fetch() follows it
  // and hands the caller an HTML page with a 200. The route handlers guard
  // themselves with requireSession() instead, which returns a real 401 the
  // client can act on.
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|.*\\.png$).*)"],
};
