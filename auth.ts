import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";

import { authConfig } from "./auth.config";
import { findUser } from "./lib/users";
import { record } from "./lib/audit";

export const { handlers, signIn, signOut, auth } = NextAuth({
  ...authConfig,
  providers: [
    Credentials({
      credentials: {
        username: { label: "Username", type: "text" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        const username =
          typeof credentials?.username === "string" ? credentials.username : "";
        const password =
          typeof credentials?.password === "string" ? credentials.password : "";

        if (!username || !password) return null;

        const user = findUser(username);

        // Compare against a structurally valid throwaway hash when the user is
        // unknown, so an unknown email and a wrong password cost the same time
        // and cannot be told apart by timing.
        const hash =
          user?.passwordHash ??
          "$2a$12$C6UzMDM.H6dfI/f/IKcEe.SDIzZAhLQyBnMEvpJfnPpjxYcSGDXvS";

        let ok = false;
        try {
          ok = await bcrypt.compare(password, hash);
        } catch {
          ok = false;
        }

        if (!user || !ok) {
          record(username, "sign-in-failed", "Wrong username or password.");
          return null;
        }


        record(user.username, "sign-in", "Signed in.");
        // The username is the identity the app displays and audits. There is
        // no email address in the user list any more, so none is carried.
        return { id: user.username, name: user.username };
      },
    }),
  ],
});
