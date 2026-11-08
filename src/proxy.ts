import { NextResponse, type NextRequest } from "next/server";
import { redirectWithSession, updateSession } from "@/lib/supabase/proxy";

/**
 * Routing model:
 *   /         signed in -> the member home feed; signed out -> redirected to /welcome
 *   /welcome  the public welcome (landing) page
 *   /home     old address, redirected to / by next.config.ts before this proxy runs
 */

/** Routes that require a signed-in member. Pages re-check on the server as well. */
const PRIVATE_PREFIXES = [
  "/onboarding",
  "/reset-password",
  "/profile",
  "/settings",
  "/search",
  "/network",
  "/notifications",
  "/post",
  "/mfa",
  "/reauth",
  "/suspended",
  "/admin",
  "/communities",
  "/forums",
  "/messages",
  "/mentorship",
  "/careers",
  "/saved",
  "/feedback",
  "/verification",
];
/** Pages only for signed-out visitors. */
const GUEST_ONLY = ["/login", "/signup", "/forgot-password"];

const matches = (pathname: string, prefix: string) =>
  pathname === prefix || pathname.startsWith(`${prefix}/`);

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const session = await updateSession(request);

  // The default page is the member home. Visitors who aren't signed in (or when auth isn't
  // configured at all) get the public welcome page instead.
  if (pathname === "/") {
    if (!session.claims) {
      return redirectWithSession(request, session.response, "/welcome");
    }
    return session.response ?? NextResponse.next();
  }

  const isPrivate = PRIVATE_PREFIXES.some((p) => matches(pathname, p));
  const isGuestOnly = GUEST_ONLY.some((p) => matches(pathname, p));

  if (isPrivate && !session.claims) {
    if (matches(pathname, "/reset-password")) {
      return redirectWithSession(
        request,
        session.response,
        "/forgot-password",
        {
          error: "link_invalid",
        },
      );
    }
    return redirectWithSession(
      request,
      session.response,
      "/login",
      session.configured ? { next: pathname } : { error: "not_configured" },
    );
  }

  if (isGuestOnly && session.claims) {
    return redirectWithSession(request, session.response, "/");
  }

  return session.response ?? NextResponse.next();
}

export const config = {
  matcher: [
    "/",
    "/profile/:path*",
    "/settings/:path*",
    "/search/:path*",
    "/network/:path*",
    "/notifications/:path*",
    "/post/:path*",
    "/mfa/:path*",
    "/reauth/:path*",
    "/suspended/:path*",
    "/admin/:path*",
    "/communities/:path*",
    "/forums/:path*",
    "/messages/:path*",
    "/mentorship/:path*",
    "/careers/:path*",
    "/saved/:path*",
    "/feedback/:path*",
    "/verification/:path*",
    "/onboarding/:path*",
    "/reset-password/:path*",
    "/login",
    "/signup",
    "/forgot-password",
  ],
};
