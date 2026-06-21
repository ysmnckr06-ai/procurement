import { createServerClient } from "@supabase/ssr";
import { NextResponse } from "next/server";
import { isLicenseActive } from "@/lib/license";

export async function proxy(request) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => {
            request.cookies.set(name, value);
          });
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) => {
            response.cookies.set(name, value, options);
          });
        },
      },
    },
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  const { data: license } = await supabase
    .from("user_licenses")
    .select("plan_type, license_status, trial_ends_at, expires_at")
    .eq("user_id", user.id)
    .maybeSingle();

  if (!isLicenseActive(license)) {
    return NextResponse.redirect(new URL("/license-expired", request.url));
  }

  return response;
}

export const config = {
  matcher: ["/dashboard/:path*"],
};
