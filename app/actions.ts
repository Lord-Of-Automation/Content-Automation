"use server";

import { AuthError } from "next-auth";
import { signIn, signOut } from "@/auth";

export type LoginState = { error: string | null };

export async function login(
  _prev: LoginState,
  formData: FormData
): Promise<LoginState> {
  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");

  if (!email || !password) {
    return { error: "Enter your email and password." };
  }

  try {
    // On success this throws a redirect, which must reach Next untouched.
    await signIn("credentials", { email, password, redirectTo: "/runs" });
    return { error: null };
  } catch (error) {
    if (error instanceof AuthError) {
      if (error.type === "CredentialsSignin") {
        return { error: "Email or password is not right." };
      }
      // A missing AUTH_USERS or malformed JSON surfaces here.
      return {
        error:
          "Sign in could not be completed. Check that AUTH_SECRET and AUTH_USERS are set.",
      };
    }
    throw error;
  }
}

export async function logout(): Promise<void> {
  await signOut({ redirectTo: "/login" });
}
