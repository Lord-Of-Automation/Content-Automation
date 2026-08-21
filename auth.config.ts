import type { NextAuthConfig } from "next-auth";

/**
 * Edge-safe half of the auth setup. This is what middleware imports, so it must
 * not pull in bcrypt or anything else with Node built-ins. The Credentials
 * provider itself lives in auth.ts, which only ever runs in the Node runtime.
 */
export const authConfig = {
  pages: {
    signIn: "/login",
  },
  session: {
    strategy: "jwt",
    maxAge: 60 * 60 * 12, // 12 hours
  },
  trustHost: true,
  providers: [],
  callbacks: {
    authorized({ auth, request }) {
      const signedIn = Boolean(auth?.user);
      const { pathname } = request.nextUrl;

      if (pathname.startsWith("/login")) {
        if (signedIn) {
          return Response.redirect(new URL("/runs", request.nextUrl));
        }
        return true;
      }

      return signedIn;
    },
    jwt({ token, user }) {
      if (user) {
        token.name = user.name ?? token.name;
        token.email = user.email ?? token.email;
      }
      return token;
    },
    session({ session, token }) {
      if (session.user) {
        if (typeof token.email === "string") session.user.email = token.email;
        if (typeof token.name === "string") session.user.name = token.name;
      }
      return session;
    },
  },
} satisfies NextAuthConfig;
