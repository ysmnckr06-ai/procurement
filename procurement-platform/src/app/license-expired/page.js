import { redirect } from "next/navigation";

// Eski bağlantılar için: lisans bitince kullanıcı artık doğrudan abonelik sayfasına gider.
export default function LicenseExpiredPage() {
  redirect("/abonelik");
}
