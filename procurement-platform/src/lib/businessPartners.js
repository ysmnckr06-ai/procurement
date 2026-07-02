export const partnerTypes = [
  "Müşteri",
  "Tedarikçi",
  "Taşeron",
  "Nakliye",
  "Hizmet Sağlayıcı",
  "Diğer",
];

const COMPANY_SUFFIXES = new Set([
  "as",
  "aş",
  "anonim",
  "ltd",
  "limited",
  "sti",
  "şti",
  "sirketi",
  "şirketi",
  "tic",
  "ticaret",
  "san",
  "sanayi",
  "ve",
  "co",
  "corp",
  "inc",
  "llc",
]);

function stripTurkishMarks(value) {
  return String(value || "")
    .replaceAll("İ", "i")
    .replaceAll("I", "i")
    .replaceAll("ı", "i")
    .replaceAll("Ğ", "g")
    .replaceAll("ğ", "g")
    .replaceAll("Ü", "u")
    .replaceAll("ü", "u")
    .replaceAll("Ş", "s")
    .replaceAll("ş", "s")
    .replaceAll("Ö", "o")
    .replaceAll("ö", "o")
    .replaceAll("Ç", "c")
    .replaceAll("ç", "c");
}

export function normalizePartnerName(value) {
  return String(value || "")
    .trim()
    .replace(/\s+/g, " ")
    .toLocaleLowerCase("tr-TR");
}

export function canonicalPartnerName(value) {
  return stripTurkishMarks(value)
    .toLowerCase()
    .replace(/[.,;:()/"'’`´]/g, " ")
    .replace(/&/g, " ve ")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .filter((part) => part && !COMPANY_SUFFIXES.has(part))
    .join(" ");
}

function normalizePhone(value) {
  return String(value || "")
    .replace(/\D/g, "")
    .replace(/^90/, "");
}

function normalizeEmail(value) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

export function normalizeTaxNumber(value) {
  return String(value || "").replace(/\D/g, "");
}

export function findPartnerByTaxNumber(
  partners,
  taxNumber,
  { excludeId = "" } = {},
) {
  const normalizedTax = normalizeTaxNumber(taxNumber);
  if (!normalizedTax) return null;

  return (
    (partners || [])
      .map(normalizePartnerRecord)
      .find(
        (partner) =>
          partner.id !== excludeId &&
          normalizeTaxNumber(partner.tax_number || partner.tax_no) ===
            normalizedTax,
      ) || null
  );
}

export function duplicateTaxNumberMessage(partner) {
  const partnerName = partner?.name ? ` (${partner.name})` : "";
  return `Bu vergi numarasıyla kayıtlı bir firma var${partnerName}. Aynı vergi numarasıyla ikinci firma kaydedilemez.`;
}

function levenshtein(a, b) {
  const left = String(a || "");
  const right = String(b || "");
  if (left === right) return 0;
  if (!left) return right.length;
  if (!right) return left.length;

  const previous = Array.from(
    { length: right.length + 1 },
    (_, index) => index,
  );
  const current = Array.from({ length: right.length + 1 }, () => 0);

  for (let i = 1; i <= left.length; i += 1) {
    current[0] = i;
    for (let j = 1; j <= right.length; j += 1) {
      const cost = left[i - 1] === right[j - 1] ? 0 : 1;
      current[j] = Math.min(
        current[j - 1] + 1,
        previous[j] + 1,
        previous[j - 1] + cost,
      );
    }
    for (let j = 0; j <= right.length; j += 1) previous[j] = current[j];
  }

  return previous[right.length];
}

function similarity(left, right) {
  const a = canonicalPartnerName(left);
  const b = canonicalPartnerName(right);
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (a.includes(b) || b.includes(a)) {
    const shortLength = Math.min(a.length, b.length);
    const longLength = Math.max(a.length, b.length);
    if (shortLength >= 4) return 0.93;
    return shortLength / longLength >= 0.55 ? 0.94 : 0.82;
  }
  const distance = levenshtein(a, b);
  return 1 - distance / Math.max(a.length, b.length);
}

export function normalizePartnerRecord(partner = {}) {
  return {
    ...partner,
    partner_type: partner.partner_type || partner.category || "Tedarikçi",
    contact_person:
      partner.contact_person || partner.contact_name || partner.contact || "",
    tax_number: partner.tax_number || partner.tax_no || partner.taxNo || "",
    normalized_name:
      partner.normalized_name || normalizePartnerName(partner.name),
    canonical_name: canonicalPartnerName(partner.name),
  };
}

export function partnerMatchScore(candidate, input) {
  const partner = normalizePartnerRecord(candidate);
  const inputTax = normalizeTaxNumber(input.taxNumber);
  const partnerTax = normalizeTaxNumber(partner.tax_number || partner.tax_no);
  if (inputTax && partnerTax && inputTax === partnerTax) return 1;

  const inputEmail = normalizeEmail(input.email);
  const partnerEmail = normalizeEmail(partner.email);
  if (inputEmail && partnerEmail && inputEmail === partnerEmail) return 0.98;

  const inputPhone = normalizePhone(input.phone);
  const partnerPhone = normalizePhone(partner.phone);
  if (inputPhone && partnerPhone && inputPhone === partnerPhone) return 0.97;

  const inputName = normalizePartnerName(input.name);
  const partnerName = normalizePartnerName(partner.name);
  if (inputName && partnerName && inputName === partnerName) return 0.96;

  return similarity(partner.name, input.name);
}

export function findPartnerMatches(
  partners,
  input,
  { threshold = 0.65, limit = 5 } = {},
) {
  return (partners || [])
    .map((partner) => ({
      partner: normalizePartnerRecord(partner),
      score: partnerMatchScore(partner, input || {}),
    }))
    .filter((match) => match.score >= threshold)
    .sort((left, right) => right.score - left.score)
    .slice(0, limit)
    .map((match) => ({
      ...match,
      type: match.score >= 0.96 ? "exact" : "probable",
    }));
}

export function findBestPartnerMatch(partners, input, threshold = 0.9) {
  let best = null;
  let bestScore = 0;

  for (const partner of partners || []) {
    const score = partnerMatchScore(partner, input);
    if (score > bestScore) {
      best = partner;
      bestScore = score;
    }
  }

  return best && bestScore >= threshold
    ? { partner: normalizePartnerRecord(best), score: bestScore }
    : null;
}

export async function findOrCreateBusinessPartner(
  supabase,
  userId,
  {
    name,
    partnerType = "Tedarikçi",
    taxNumber = "",
    email = "",
    phone = "",
    contactPerson = "",
    city = "",
    address = "",
    notes = "",
    allowCreate = true,
    forceCreate = false,
    allowProbableMatch = false,
    rejectDuplicateTax = false,
  } = {},
) {
  const cleanName = String(name || "")
    .trim()
    .replace(/\s+/g, " ");
  if (!supabase || !userId || !cleanName) return null;
  const cleanTaxNumber = normalizeTaxNumber(taxNumber);

  const { data: partners, error: lookupError } = await supabase
    .from("suppliers")
    .select("*")
    .eq("user_id", userId);

  if (lookupError) console.error("İş ortağı arama hatası:", lookupError);

  const duplicateTaxPartner = findPartnerByTaxNumber(
    partners || [],
    cleanTaxNumber,
  );
  if (rejectDuplicateTax && duplicateTaxPartner) {
    const error = new Error(duplicateTaxNumberMessage(duplicateTaxPartner));
    error.code = "DUPLICATE_TAX_NUMBER";
    error.partner = duplicateTaxPartner;
    throw error;
  }

  const match = forceCreate
    ? null
    : findBestPartnerMatch(
        partners || [],
        {
          name: cleanName,
          taxNumber,
          email,
          phone,
        },
        allowProbableMatch ? 0.9 : 0.96,
      );

  if (match?.partner) {
    const existing = match.partner;
    const patch = {};
    if (!existing.partner_type) patch.partner_type = partnerType;
    if (!existing.normalized_name)
      patch.normalized_name = normalizePartnerName(existing.name);
    if (contactPerson && !existing.contact_person && !existing.contact_name)
      patch.contact_person = contactPerson;
    if (cleanTaxNumber && !existing.tax_number && !existing.tax_no)
      patch.tax_number = cleanTaxNumber;
    if (email && !existing.email) patch.email = email;
    if (phone && !existing.phone) patch.phone = phone;
    if (city && !existing.city) patch.city = city;
    if (address && !existing.address) patch.address = address;

    if (Object.keys(patch).length > 0) {
      await supabase
        .from("suppliers")
        .update({ ...patch, updated_at: new Date().toISOString() })
        .eq("id", existing.id)
        .eq("user_id", userId);
    }

    return normalizePartnerRecord({ ...existing, ...patch });
  }

  if (!allowCreate) {
    return null;
  }

  const payload = {
    user_id: userId,
    name: cleanName,
    partner_type: partnerType,
    normalized_name: normalizePartnerName(cleanName),
    category: partnerType,
    status: "Aktif",
    contact_person: contactPerson,
    contact_name: contactPerson,
    tax_number: cleanTaxNumber,
    tax_no: cleanTaxNumber,
    email,
    phone,
    city,
    address,
    notes,
    score: 80,
  };

  const { data, error } = await supabase
    .from("suppliers")
    .insert(payload)
    .select("*")
    .single();

  if (error) {
    console.error("İş ortağı oluşturma hatası:", error);
    return null;
  }

  return normalizePartnerRecord(data);
}

async function updatePartnerReferences(supabase, userId, duplicate, master) {
  const oldNames = [duplicate.name, duplicate.normalized_name].filter(Boolean);
  const tables = [
    {
      table: "projects",
      idColumn: "customer_partner_id",
      nameColumn: "customer_partner_name",
    },
    { table: "orders", idColumn: "partner_id", nameColumn: "partner_name" },
    { table: "reports", idColumn: "partner_id", nameColumn: "partner_name" },
    {
      table: "order_receipts",
      idColumn: "partner_id",
      nameColumn: "partner_name",
    },
    {
      table: "order_payments",
      idColumn: "partner_id",
      nameColumn: "partner_name",
    },
    {
      table: "stock_movements",
      idColumn: "partner_id",
      nameColumn: "partner_name",
    },
  ];

  for (const item of tables) {
    const idUpdate = await supabase
      .from(item.table)
      .update({ [item.idColumn]: master.id, [item.nameColumn]: master.name })
      .eq("user_id", userId)
      .eq(item.idColumn, duplicate.id);

    if (idUpdate.error)
      console.error(
        `${item.table} iş ortağı id güncellenemedi:`,
        idUpdate.error,
      );

    for (const oldName of oldNames) {
      const nameUpdate = await supabase
        .from(item.table)
        .update({ [item.idColumn]: master.id, [item.nameColumn]: master.name })
        .eq("user_id", userId)
        .eq(item.nameColumn, oldName);

      if (nameUpdate.error)
        console.error(
          `${item.table} iş ortağı adı güncellenemedi:`,
          nameUpdate.error,
        );
    }
  }
}

export async function deduplicateBusinessPartners(
  supabase,
  userId,
  partners = [],
) {
  const activePartners = (partners || []).map(normalizePartnerRecord);
  const groups = [];

  for (const partner of activePartners) {
    if (!partner.id || partner.status === "Pasif") continue;

    const group = groups.find((existingGroup) =>
      existingGroup.some((existing) => {
        if (partner.partner_type !== existing.partner_type) return false;
        return (
          partnerMatchScore(existing, {
            name: partner.name,
            taxNumber: partner.tax_number,
            email: partner.email,
            phone: partner.phone,
          }) >= 0.9
        );
      }),
    );

    if (group) group.push(partner);
    else groups.push([partner]);
  }

  let duplicateCount = 0;

  for (const group of groups.filter((items) => items.length > 1)) {
    const sorted = [...group].sort(
      (a, b) =>
        new Date(a.created_at || 0).getTime() -
        new Date(b.created_at || 0).getTime(),
    );
    const master = sorted[0];
    const duplicates = sorted.slice(1);

    for (const duplicate of duplicates) {
      await updatePartnerReferences(supabase, userId, duplicate, master);
      const { error } = await supabase
        .from("suppliers")
        .update({
          status: "Pasif",
          notes: [
            duplicate.notes,
            `Mükerrer kayıt: ${master.name} kartına bağlandı.`,
          ]
            .filter(Boolean)
            .join("\n"),
          updated_at: new Date().toISOString(),
        })
        .eq("id", duplicate.id)
        .eq("user_id", userId);

      if (error) console.error("Mükerrer iş ortağı pasife alınamadı:", error);
      else duplicateCount += 1;
    }
  }

  return { duplicateCount };
}

export async function backfillProjectCustomerPartners(
  supabase,
  userId,
  projects = [],
  partners = [],
) {
  const customerProjects = (projects || []).filter((project) => {
    const customerName = String(
      project.customer_partner_name || project.customer_name || "",
    ).trim();
    return customerName.length > 0;
  });
  const uniqueCustomers = new Map();

  customerProjects.forEach((project) => {
    const customerName = String(
      project.customer_partner_name || project.customer_name || "",
    )
      .trim()
      .replace(/\s+/g, " ");
    const key = canonicalPartnerName(customerName);
    if (!uniqueCustomers.has(key)) uniqueCustomers.set(key, customerName);
  });

  let createdCustomers = 0;
  let existingCustomers = 0;
  const partnerByCustomerKey = new Map();

  for (const [key, customerName] of uniqueCustomers.entries()) {
    const match = findBestPartnerMatch(partners, { name: customerName }, 0.9);
    let partner = match?.partner || null;

    if (partner) {
      existingCustomers += 1;
      const patch = {};
      if (partner.partner_type !== "Müşteri") patch.partner_type = "Müşteri";
      if (!partner.normalized_name)
        patch.normalized_name = normalizePartnerName(partner.name);
      if (Object.keys(patch).length > 0) {
        const { data: updatedPartner, error } = await supabase
          .from("suppliers")
          .update({
            ...patch,
            category: "Müşteri",
            updated_at: new Date().toISOString(),
          })
          .eq("id", partner.id)
          .eq("user_id", userId)
          .select("*")
          .single();

        if (error) console.error("Müşteri iş ortağı güncellenemedi:", error);
        else partner = normalizePartnerRecord(updatedPartner);
      }
    } else {
      partner = await findOrCreateBusinessPartner(supabase, userId, {
        name: customerName,
        allowCreate: false,
        partnerType: "Müşteri",
        allowProbableMatch: true,
      });
      if (partner) createdCustomers += 1;
    }

    if (partner?.id) partnerByCustomerKey.set(key, partner);
  }

  const projectsToUpdate = customerProjects.filter((project) => {
    const key = canonicalPartnerName(
      project.customer_partner_name || project.customer_name,
    );
    const partner = partnerByCustomerKey.get(key);
    return partner?.id && project.customer_partner_id !== partner.id;
  });

  for (const project of projectsToUpdate) {
    const key = canonicalPartnerName(
      project.customer_partner_name || project.customer_name,
    );
    const partner = partnerByCustomerKey.get(key);
    const { error } = await supabase
      .from("projects")
      .update({
        customer_partner_id: partner.id,
        customer_partner_name: partner.name,
        updated_at: new Date().toISOString(),
      })
      .eq("id", project.id)
      .eq("user_id", userId);

    if (error) console.error("Proje müşteri iş ortağına bağlanamadı:", error);
  }

  const summary = {
    totalCustomers: uniqueCustomers.size,
    createdCustomers,
    existingCustomers,
    linkedProjects: projectsToUpdate.length,
  };

  return summary;
}
