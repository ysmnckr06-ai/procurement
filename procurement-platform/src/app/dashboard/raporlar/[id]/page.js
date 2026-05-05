"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

export default function RaporDetayPage({ params }) {
  const { id } = params;

  const [rapor, setRapor] = useState(null);

  useEffect(() => {
    fetch(`http://127.0.0.1:8000/reports/${id}`)
      .then((res) => res.json())
      .then((data) => {
        if (data.success) {
          setRapor(data.report);
        }
      });
  }, [id]);

  if (!rapor) return <div>Yükleniyor...</div>;

  async function siparisOlustur() {
    const res = await fetch(
      `http://127.0.0.1:8000/reports/${id}/create-order`,
      {
        method: "POST",
      }
    );

    const data = await res.json();

    if (data.success) {
      window.location.href = "/dashboard/siparisler";
    }
  }

  return (
    <div style={{ padding: "32px" }}>
      <h1>{rapor.ad}</h1>

      <p>Tarih: {rapor.tarih}</p>
      <p>Durum: {rapor.durum}</p>

      <h2>Önerilen Firma: {rapor.onerilenFirma}</h2>

      <button onClick={siparisOlustur}>
        Sipariş Oluştur
      </button>

      <br /><br />

      <Link href={`/dashboard/raporlar/${id}/mukayese`}>
        Mukayese Raporu
      </Link>

      <br />

      <Link href={`/dashboard/raporlar/${id}/son-alim`}>
        Son Alım
      </Link>
    </div>
  );
}