import NextAuth, { type NextAuthConfig } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import Google from "next-auth/providers/google";
import { appUrl, authSecret, env } from "@/lib/env";
import { consumeMagic, ensureUser } from "@/lib/db/store";

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
  const session = await auth();
  const id = session?.user?.id;
  if (!id) throw new Error("UNAUTHENTICATED");
  return id;
}

export { appUrl };
