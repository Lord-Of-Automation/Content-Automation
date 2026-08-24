"use server";

import { AuthError } from "next-auth";
import { signIn, signOut } from "@/auth";
import { auth } from "@/auth";
import { record } from "@/lib/audit";

export type LoginState = { error: string | null };

export async function login(
  _prev: LoginState,
  formData: FormData
): Promise<LoginState> {
  const username = String(formData.get("username") ?? "");
  const password = String(formData.get("password") ?? "");

  if (!username || !password) {
    return { error: "Enter your username and password." };
  }

  try {
    // On success this throws a redirect, which must reach Next untouched.
    await signIn("credentials", { username, password, redirectTo: "/runs" });
    return { error: null };
  } catch (error) {
    if (error instanceof AuthError) {
      if (error.type === "CredentialsSignin") {
        return { error: "Username or password is not right." };
      }
      // Auth.js wraps anything thrown inside authorize() as CallbackRouteError
      // and hides the real message, which makes a misconfigured deployment
      // undiagnosable from the browser. Dig the original out and show it: these
      // messages name the offending env var and contain no secret values.
      const cause = (error as { cause?: { err?: unknown } }).cause?.err;
      const reason =
        cause instanceof Error && cause.message ? cause.message : error.type;

      return {
        error:
          "Sign in could not be completed. " +
          reason +
          " (check AUTH_SECRET and AUTH_USERS in the environment)",
      };
    }
    throw error;
  }
}

export async function logout(): Promise<void> {
  // Read the session before it is destroyed, otherwise there is no actor.
  const session = await auth();
  await record(session?.user?.name ?? "unknown", "sign-out", "Signed out.");
  await signOut({ redirectTo: "/login" });
}
