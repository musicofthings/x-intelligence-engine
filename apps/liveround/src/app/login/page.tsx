import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { googleConfigured } from "@/lib/env";
import { LoginForm } from "./login-form";

export default async function LoginPage() {
  const session = await auth();
  if (session?.user?.id) redirect("/app/session");
  return <LoginForm googleEnabled={googleConfigured()} />;
}
