import { redirect } from "next/navigation";
import { auth, sessionUser, STALE_SESSION_PATH } from "@/auth";
import { googleConfigured } from "@/lib/env";
import { LoginForm } from "./login-form";

export default async function LoginPage() {
  const user = await sessionUser();
  if (user) redirect("/app/session");
  const session = await auth();
  if (session?.user?.id) redirect(STALE_SESSION_PATH);
  return <LoginForm googleEnabled={googleConfigured()} />;
}
