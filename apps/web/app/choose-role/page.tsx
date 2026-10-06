import { redirect } from "next/navigation";

/** Older links pointed here. The role picker lives at /signup. */
export default function ChooseRoleRedirect() {
  redirect("/signup");
}
