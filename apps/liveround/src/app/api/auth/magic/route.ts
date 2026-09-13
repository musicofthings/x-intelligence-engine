import { NextResponse } from "next/server";
import { putMagic } from "@/lib/db/store";
import { appUrl, env } from "@/lib/env";
import { newId } from "@/lib/utils";

export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as { email?: string } | null;
  const email = body?.email?.trim().toLowerCase() ?? "";
  if (!email.includes("@")) {
    return NextResponse.json({ error: "Enter a valid email." }, { status: 400 });
  }
  const token = newId("mag");
  await putMagic(token, email, Date.now() + 15 * 60_000);
  const consume = new URL("/login/consume", appUrl());
  consume.searchParams.set("token", token);
  consume.searchParams.set("email", email);
  const previewUrl = consume.toString();

  if (env.resendKey) {
    await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        authorization: `Bearer ${env.resendKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        from: env.resendFrom,
        to: email,
        subject: "Your LiveRound sign-in link",
        text: `Sit down when you're ready.\n\n${previewUrl}\n\nThis link expires in 15 minutes.`,
      }),
    });
    return NextResponse.json({ ok: true, emailed: true });
  }

  return NextResponse.json({
    ok: true,
    emailed: false,
    previewUrl: env.allowDevLogin ? previewUrl : undefined,
    message: env.allowDevLogin
      ? "Email isn't configured. Use the preview link (development only)."
      : "Email delivery isn't configured. Set RESEND_API_KEY.",
  });
}
