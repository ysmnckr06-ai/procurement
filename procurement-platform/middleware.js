import { NextResponse } from "next/server";

export function middleware(_request) {
  return NextResponse.next();
}

export const config = {
  matcher: ["/dashboard/:path*", "/login", "/register"],
};
