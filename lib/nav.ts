/**
 * The pages, as a type.
 *
 * Both the top bar and the profile menu need to know which one you are on, and
 * the list lived in each of them separately. Adding Overview meant adding it
 * twice, and the compiler only objected because one of them passes the value
 * to the other. Once is enough.
 */
export type Section =
  | "home"
  | "runs"
  | "loop"
  | "logs"
  | "domains"
  | "generator"
  | "websites"
  | "apps"
  | "performance"
  | "accounts"
  | "keys";
