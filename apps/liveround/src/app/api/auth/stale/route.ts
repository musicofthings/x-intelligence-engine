import { NextResponse } from "next/server";
import { auth, signOut } from "@/auth";
import { getUserById } from "@/lib/db/store";
import { appUrl } from "@/lib/env";

/**
 * Auth.js JWTs can outlive the in-memory user (dev restart). Sign-out must
 * happen in a Route Handler — Server Components cannot modify cookies.
 */
export async function GET() {
  const session = await auth();
  const id = session?.user?.id;
  if (id && (await getUserById(id))) {
    return NextResponse.redirect(new URL("/app/session", appUrl()));
  }
  await signOut({ redirectTo: "/login" });
}
