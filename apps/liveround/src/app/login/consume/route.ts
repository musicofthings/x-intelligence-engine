import { signIn } from "@/auth";
import { NextResponse } from "next/server";

async function consume(origin: string, token: string | null, email: string) {
  if (!token) return NextResponse.redirect(new URL("/login", origin));
  await signIn("magic", {
    token,
    email,
    redirectTo: "/app/session",
  });
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  return consume(url.origin, url.searchParams.get("token"), url.searchParams.get("email") ?? "");
}

export async function POST(req: Request) {
  const url = new URL(req.url);
  const form = await req.formData().catch(() => null);
  const token = form ? String(form.get("token") ?? "") : "";
  const email = form ? String(form.get("email") ?? "") : "";
  return consume(url.origin, token || null, email);
}
