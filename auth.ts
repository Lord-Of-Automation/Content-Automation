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
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        const email =
          typeof credentials?.email === "string" ? credentials.email : "";
        const password =
          typeof credentials?.password === "string" ? credentials.password : "";

        if (!email || !password) return null;

        const user = findUser(email);

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
          record(email, "sign-in-failed", "Wrong email or password.");
          return null;
        }


        record(user.email, "sign-in", "Signed in.");
        return { id: user.email, email: user.email, name: user.name };
      },
    }),
  ],
});
