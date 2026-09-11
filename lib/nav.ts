/**
 * The pages, as a type.
 *
 * Both the top bar and the profile menu need to know which one you are on, and
 * the list lived in each of them separately, so adding a page meant adding it
 * twice and the compiler only noticed because one of them passes the value to
 * the other. Once is enough.
 */
export type Section =
  | "runs"
  | "loop"
  | "logs"
  | "domains"
  | "generator"
  | "mailing"
  | "check"
  | "websites"
  | "apps"
  | "performance"
  | "accounts"
  | "keys"
  | "design"
  | "prompts";
