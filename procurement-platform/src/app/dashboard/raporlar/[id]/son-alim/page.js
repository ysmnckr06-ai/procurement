import { redirect } from "next/navigation";

export default async function RemovedLastPurchasePage({ params }) {
  const { id } = await params;
  redirect(`/dashboard/raporlar/${id}`);
}
