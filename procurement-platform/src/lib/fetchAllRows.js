// Supabase (PostgREST) bir sorguda en fazla 1000 satır döndürür; .limit(5000)
// bu sınırı aşmaz. Stok kartı, hareket veya proje kalemi 1000'i geçen firmalarda
// listeler ve toplamlar sessizce eksik kalıyordu. Bu yardımcı sorguyu sayfalayıp
// tüm satırları toplar.
//
// Kullanım: await fetchAllRows(() => supabase.from("products").select("*").eq("user_id", id).order("id"))
const PAGE_SIZE = 1000;
const MAX_PAGES = 100;

export async function fetchAllRows(buildQuery) {
  const rows = [];
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const from = page * PAGE_SIZE;
    const { data, error } = await buildQuery().range(from, from + PAGE_SIZE - 1);
    if (error) return { data: page === 0 ? null : rows, error };
    rows.push(...(data || []));
    if (!data || data.length < PAGE_SIZE) break;
  }
  return { data: rows, error: null };
}
