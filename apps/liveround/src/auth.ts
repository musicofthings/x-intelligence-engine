import NextAuth, { type NextAuthConfig } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import Google from "next-auth/providers/google";
import { appUrl, authSecret, env } from "@/lib/env";
import { consumeMagic, ensureUser, getUserById } from "@/lib/db/store";
import type { UserRecord } from "@/lib/types";
import { redirect } from "next/navigation";

const providers: NextAuthConfig["providers"] = [];

if (env.googleClientId && env.googleClientSecret) {
  providers.push(
    Google({
      clientId: env.googleClientId,
      clientSecret: env.googleClientSecret,
    }),
  );
}

providers.push(
  Credentials({
    id: "magic",
    name: "Email link",
    credentials: {
      email: { label: "Email", type: "email" },
      token: { label: "Token", type: "text" },
    },
    async authorize(credentials) {
      const token = String(credentials?.token ?? "");
      const emailHint = String(credentials?.email ?? "").trim().toLowerCase();
      const email = (await consumeMagic(token)) ?? (env.allowDevLogin && emailHint.includes("@") ? emailHint : null);
      if (!email) return null;
      const user = await ensureUser(email);
      return { id: user.id, email: user.email, name: user.name };
    },
  }),
);

export const { handlers, auth, signIn, signOut } = NextAuth({
  secret: authSecret(),
  trustHost: true,
  session: { strategy: "jwt" },
  pages: { signIn: "/login" },
  providers,
  callbacks: {
    async jwt({ token, user }) {
      if (user?.id) token.sub = user.id;
      if (user?.email) token.email = user.email;
      return token;
    },
    async session({ session, token }) {
      if (session.user && token.sub) {
        session.user.id = token.sub;
        session.user.email = token.email ?? session.user.email;
      }
      return session;
    },
  },
});

export async function requireUserId(): Promise<string> {
  const user = await sessionUser();
  if (!user) throw new Error("UNAUTHENTICATED");
  return user.id;
}

/** JWT session whose user still exists in the store. Null if signed out or orphaned. */
export async function sessionUser(): Promise<UserRecord | null> {
  const session = await auth();
  const id = session?.user?.id;
  if (!id) return null;
  return getUserById(id);
}

/** Route that may modify cookies and clear an Auth.js JWT with no store row. */
export const STALE_SESSION_PATH = "/api/auth/stale";

/**
 * For Server Components. Redirects instead of calling signOut (cookies cannot
 * be modified during RSC render).
 */
export async function requirePageUser(): Promise<UserRecord> {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const user = await getUserById(session.user.id);
  if (!user) redirect(STALE_SESSION_PATH);
  return user;
}

export { appUrl };
