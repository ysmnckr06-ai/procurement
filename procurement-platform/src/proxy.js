import { createServerClient } from "@supabase/ssr";
import { NextResponse } from "next/server";
import { isLicenseActive } from "@/lib/license";
import { getAccountUser } from "@/lib/accountCore";

const LICENSE_HEADER = "x-corvian-verified-license";

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
  } = await getAccountUser(supabase);

  if (!user) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  const { data: license, error: licenseError } = await supabase
    .from("user_licenses")
    .select("plan_type, license_status, trial_ends_at, expires_at")
    .eq("user_id", user.id)
    .maybeSingle();

  // Lisans okunamazsa veya kayıt yoksa erişim verilmez (fail-closed).
  if (licenseError || !isLicenseActive(license)) {
    return NextResponse.redirect(new URL("/abonelik", request.url));
  }

  // Doğrulanan lisans panel düzenine istek başlığıyla aktarılır; düzen aynı
  // kontrolü (oturum + lisans, veritabanına 2 gidiş) ikinci kez yapmaz.
  // Başlık burada her istekte üzerine yazıldığı için dışarıdan taklit edilemez.
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set(LICENSE_HEADER, encodeURIComponent(JSON.stringify(license)));
  const forwarded = NextResponse.next({ request: { headers: requestHeaders } });
  response.cookies.getAll().forEach((cookie) => forwarded.cookies.set(cookie));
  return forwarded;
}

export const config = {
  matcher: ["/dashboard/:path*"],
};
