// Supabase Storage'daki tüm dosyaları indirir (yedek için).
// Kullanım: node dosyalari-indir.mjs <liste.tsv> <hedef-klasör>
// liste.tsv: "bucket<TAB>yol" satırları (veritabanındaki storage.objects'ten).
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

const [listPath, targetDir] = process.argv.slice(2);
const baseUrl = String(process.env.SUPABASE_URL || "").replace(/\/$/, "");
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!baseUrl || !key) {
  console.error("SUPABASE_URL ve SUPABASE_SERVICE_ROLE_KEY gerekli.");
  process.exit(1);
}

const rows = (await readFile(listPath, "utf8")).split("\n").filter(Boolean).map((line) => line.split("\t"));
let ok = 0;
const failed = [];
const queue = [...rows];
async function worker() {
  while (queue.length) {
    const [bucket, name] = queue.shift();
    const url = `${baseUrl}/storage/v1/object/${encodeURIComponent(bucket)}/${name.split("/").map(encodeURIComponent).join("/")}`;
    try {
      const response = await fetch(url, { headers: { Authorization: `Bearer ${key}`, apikey: key } });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const file = join(targetDir, bucket, name);
      await mkdir(dirname(file), { recursive: true });
      await writeFile(file, Buffer.from(await response.arrayBuffer()));
      ok += 1;
    } catch (error) {
      failed.push(`${bucket}/${name}: ${error.message}`);
    }
  }
}
await Promise.all(Array.from({ length: 6 }, worker));
console.log(`${ok}/${rows.length} dosya indirildi.`);
if (failed.length) {
  console.log(failed.slice(0, 20).join("\n"));
  process.exit(1);
}
