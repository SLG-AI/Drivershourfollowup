import * as XLSX from "xlsx";

// ============================================================
// Shared utilities
// ============================================================

function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

function parseNumeric(value: unknown): number {
  if (value === null || value === undefined || value === "") return 0;
  if (typeof value === "number") return value;
  const str = String(value).replace(",", ".").replace(/[^\d.\-]/g, "");
  const num = parseFloat(str);
  return isNaN(num) ? 0 : num;
}

/** Convert Excel serial date to JS Date */
function excelDateToDate(serial: unknown): Date | null {
  if (!serial) return null;
  const num = typeof serial === "number" ? serial : parseFloat(String(serial));
  if (isNaN(num) || num < 1) return null;
  // Excel epoch: Jan 0, 1900 (with the 1900 leap year bug)
  const utcDays = Math.floor(num - 25569);
  const date = new Date(utcDays * 86400 * 1000);
  return isNaN(date.getTime()) ? null : date;
}

function dateToISO(date: Date | null): string | null {
  if (!date) return null;
  return date.toISOString().split("T")[0];
}

function findHeaderRow(rows: unknown[][], keywords: string[]): { index: number; headers: string[] } | null {
  for (let i = 0; i < Math.min(10, rows.length); i++) {
    const row = rows[i];
    if (!row) continue;
    const strings = row.map((c) => String(c || ""));
    const normalized = strings.map(normalizeText);
    if (keywords.some((kw) => normalized.some((h) => h.includes(kw)))) {
      return { index: i, headers: strings };
    }
  }
  return null;
}

function findCol(headers: string[], ...keywords: string[]): number {
  const normalized = headers.map(normalizeText);
  for (let i = 0; i < normalized.length; i++) {
    if (keywords.every((kw) => normalized[i].includes(kw))) return i;
  }
  // Try partial match (any keyword)
  for (let i = 0; i < normalized.length; i++) {
    if (keywords.some((kw) => normalized[i].includes(kw))) return i;
  }
  return -1;
}

// ============================================================
// Types
// ============================================================

export type WpFileType = "roster_rh" | "salary_stats" | "absences_cns";

export interface WpParseResult {
  fileType: WpFileType;
  data: Record<string, unknown>[];
  rowCount: number;
  errors: string[];
  warnings: string[];
  detectedMonth?: number;
  detectedYear?: number;
}

// ============================================================
// 1. Roster RH parser (SLA_stat_mensuelle)
// ============================================================

export interface RosterRow {
  code_salarie: string;
  code_employeur: string;
  date_entree: string | null;
  date_sortie: string | null;
  type_contrat: string;
  taux_occupation: number;
  brut_indice: number;
  description_fonction: string;
  vehicle_type: string;
  description_equipe: string;
  est_sortie_temporaire: boolean;
  date_debut_sortie_temporaire: string | null;
  date_fin_sortie_temporaire: string | null;
  description_motif_sortie: string;
  brut_taux_occupation: number;
  centre_cout: string;
  code_equipe: string;
  description_service: string;
  description_departement: string;
  description_direction: string;
}

function deriveVehicleType(fonction: string, contrat: string): string {
  const f = normalizeText(fonction);
  const c = normalizeText(contrat);
  // Prioritize fonction over contrat
  if (f.includes("bus")) return "BUS";
  if (f.includes("camionnett") || f.includes("cam")) return "CAM";
  // Fallback to contrat
  if (c.includes("bus")) return "BUS";
  if (c.includes("cam")) return "CAM";
  return "AUTRE";
}

export function parseRosterRH(buffer: ArrayBuffer): WpParseResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  let workbook: XLSX.WorkBook;
  try {
    workbook = XLSX.read(buffer, { type: "array" });
  } catch {
    return { fileType: "roster_rh", data: [], rowCount: 0, errors: ["Impossible de lire le fichier Excel."], warnings };
  }

  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1 });

  const header = findHeaderRow(rows, ["code salarie", "date d'entree", "date d"]);
  if (!header) {
    return { fileType: "roster_rh", data: [], rowCount: 0, errors: ["En-têtes non détectés. Colonne 'Code salarié' requise."], warnings };
  }

  const h = header.headers;
  const colCode = findCol(h, "code", "salarie");
  const colEmployeur = findCol(h, "code", "employeur");
  const colEntree = findCol(h, "date", "entree");
  const colSortie = findCol(h, "date", "sortie");
  const colContrat = findCol(h, "type", "contrat");
  const colTaux = findCol(h, "taux", "occupation");
  const colBrut = findCol(h, "brut", "indice");
  const colFonction = findCol(h, "description", "fonction");
  const colEquipe = findCol(h, "description", "equipe");
  const colSortieTemp = findCol(h, "est", "sortie", "temporaire");
  const colFinSortieTemp = findCol(h, "date", "fin", "sortie");
  const colDebutSortieTemp = findCol(h, "date", "debut", "sortie");
  const colMotifSortie = findCol(h, "description", "motif");
  const colBrutTaux = findCol(h, "brut", "fonction", "taux");
  const colCentreCout = findCol(h, "centre", "cout");
  const colCodeEquipe = findCol(h, "code", "equipe");
  const colService = findCol(h, "description", "service");
  const colDepartement = findCol(h, "description", "departement");
  const colDirection = findCol(h, "description", "direction");

  if (colCode === -1) {
    return { fileType: "roster_rh", data: [], rowCount: 0, errors: ["Colonne 'Code salarié' non trouvée."], warnings };
  }

  // Try to find brut en fonction du taux more precisely
  const colBrutTauxAlt = h.findIndex((c) => {
    const n = normalizeText(c);
    return n.includes("brut") && n.includes("taux");
  });

  const data: RosterRow[] = [];

  for (let i = header.index + 1; i < rows.length; i++) {
    const row = rows[i] as unknown[];
    if (!row || row.length === 0) continue;

    const codeSalarie = String(row[colCode] || "").trim();
    if (!codeSalarie) continue;

    const fonction = colFonction >= 0 ? String(row[colFonction] || "") : "";
    const contrat = colContrat >= 0 ? String(row[colContrat] || "") : "";

    data.push({
      code_salarie: codeSalarie,
      code_employeur: colEmployeur >= 0 ? String(row[colEmployeur] || "") : "",
      date_entree: dateToISO(excelDateToDate(row[colEntree >= 0 ? colEntree : -1])),
      date_sortie: dateToISO(excelDateToDate(row[colSortie >= 0 ? colSortie : -1])),
      type_contrat: contrat,
      taux_occupation: colTaux >= 0 ? parseNumeric(row[colTaux]) : 100,
      brut_indice: colBrut >= 0 ? parseNumeric(row[colBrut]) : 0,
      description_fonction: fonction,
      vehicle_type: deriveVehicleType(fonction, contrat),
      description_equipe: colEquipe >= 0 ? String(row[colEquipe] || "") : "",
      est_sortie_temporaire: colSortieTemp >= 0 ? String(row[colSortieTemp] || "").toUpperCase() === "O" : false,
      date_debut_sortie_temporaire: colDebutSortieTemp >= 0 ? dateToISO(excelDateToDate(row[colDebutSortieTemp])) : null,
      date_fin_sortie_temporaire: colFinSortieTemp >= 0 ? dateToISO(excelDateToDate(row[colFinSortieTemp])) : null,
      description_motif_sortie: colMotifSortie >= 0 ? String(row[colMotifSortie] || "") : "",
      brut_taux_occupation: (colBrutTauxAlt >= 0 ? parseNumeric(row[colBrutTauxAlt]) : (colBrutTaux >= 0 ? parseNumeric(row[colBrutTaux]) : 0)),
      centre_cout: colCentreCout >= 0 ? String(row[colCentreCout] || "") : "",
      code_equipe: colCodeEquipe >= 0 ? String(row[colCodeEquipe] || "") : "",
      description_service: colService >= 0 ? String(row[colService] || "") : "",
      description_departement: colDepartement >= 0 ? String(row[colDepartement] || "") : "",
      description_direction: colDirection >= 0 ? String(row[colDirection] || "") : "",
    });
  }

  if (data.length === 0) {
    errors.push("Aucun employé trouvé dans le fichier.");
  } else {
    const busCount = data.filter((d) => d.vehicle_type === "BUS").length;
    const camCount = data.filter((d) => d.vehicle_type === "CAM").length;
    const otherCount = data.filter((d) => d.vehicle_type === "AUTRE").length;
    if (otherCount > 0) {
      warnings.push(`${otherCount} employé(s) avec type non identifié (classés comme AUTRE).`);
    }
    warnings.push(`${busCount} BUS, ${camCount} CAM détectés.`);
  }

  return { fileType: "roster_rh", data: data as unknown as Record<string, unknown>[], rowCount: data.length, errors, warnings };
}

// ============================================================
// 2. Salary Stats parser (StatRapides)
// ============================================================

export interface SalaryStatsRow {
  code_salarie: string;
  nom: string;
  prenom: string;
  mois: number;
  annee: number;
  departement: string;
  fonction: string;
  date_entree: string | null;
  date_sortie: string | null;
  tache_pct: number;
  hrs_base: number;
  hrs_supp: number;
  hrs_chomage: number;
  etp: number;
  supplements: number;
  total_brut: number;
  brut_base: number;
  cout_total_secu: number;
}

export function parseSalaryStats(buffer: ArrayBuffer): WpParseResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  let workbook: XLSX.WorkBook;
  try {
    workbook = XLSX.read(buffer, { type: "array" });
  } catch {
    return { fileType: "salary_stats", data: [], rowCount: 0, errors: ["Impossible de lire le fichier Excel."], warnings };
  }

  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1 });

  // Detect year and month from the metadata row (row 0 typically)
  let detectedYear: number | undefined;
  let detectedMonth: number | undefined;

  // Row 0 often has: ["Statistiques rapides", "Employeur", "S.L.A.", "Année", 2026, "De Mois de référence", 2, ...]
  const metaRow = rows[0] as unknown[];
  if (metaRow) {
    for (let i = 0; i < metaRow.length; i++) {
      const val = String(metaRow[i] || "");
      if (normalizeText(val).includes("annee") && i + 1 < metaRow.length) {
        const y = parseNumeric(metaRow[i + 1]);
        if (y > 2000) detectedYear = y;
      }
      if (normalizeText(val).includes("mois") && normalizeText(val).includes("reference") && i + 1 < metaRow.length) {
        const m = parseNumeric(metaRow[i + 1]);
        if (m >= 1 && m <= 12) detectedMonth = m;
      }
    }
  }

  const header = findHeaderRow(rows, ["code salarie", "nom salarie"]);
  if (!header) {
    return { fileType: "salary_stats", data: [], rowCount: 0, errors: ["En-têtes non détectés."], warnings, detectedYear, detectedMonth };
  }

  const h = header.headers;
  const colCode = findCol(h, "code", "salarie");
  const colNom = findCol(h, "nom", "salarie");
  const colPrenom = findCol(h, "prenom");
  const colPeriode = findCol(h, "periode");
  const colMois = findCol(h, "m.", "ref");
  const colDept = findCol(h, "departement");
  const colFonction = findCol(h, "fonction");
  const colEntree = findCol(h, "date", "entree");
  const colSortie = findCol(h, "date", "sortie");
  const colTache = findCol(h, "tache");
  const colHrsBase = findCol(h, "hrs", "base");
  const colHrsSupp = findCol(h, "hrs", "supp");
  const colHrsChomage = findCol(h, "hrs", "chomage");
  const colEtp = findCol(h, "etp");
  const colSupplements = findCol(h, "supplements");
  const colTotalBrut = findCol(h, "total", "brut");
  const colBrutBase = findCol(h, "brut", "base");
  const colTotalSecu = findCol(h, "total", "secu");

  if (colCode === -1) {
    return { fileType: "salary_stats", data: [], rowCount: 0, errors: ["Colonne 'Code salarié' non trouvée."], warnings, detectedYear, detectedMonth };
  }

  const currentYear = new Date().getFullYear();
  const data: SalaryStatsRow[] = [];

  for (let i = header.index + 1; i < rows.length; i++) {
    const row = rows[i] as unknown[];
    if (!row || row.length === 0) continue;

    const codeSalarie = String(row[colCode] || "").trim();
    if (!codeSalarie) continue;

    const mois = colMois >= 0 ? parseNumeric(row[colMois]) : (detectedMonth || 1);
    const annee = detectedYear || currentYear;

    data.push({
      code_salarie: codeSalarie,
      nom: colNom >= 0 ? String(row[colNom] || "") : "",
      prenom: colPrenom >= 0 ? String(row[colPrenom] || "") : "",
      mois,
      annee,
      departement: colDept >= 0 ? String(row[colDept] || "") : "",
      fonction: colFonction >= 0 ? String(row[colFonction] || "") : "",
      date_entree: dateToISO(excelDateToDate(row[colEntree >= 0 ? colEntree : -1])),
      date_sortie: dateToISO(excelDateToDate(row[colSortie >= 0 ? colSortie : -1])),
      tache_pct: colTache >= 0 ? parseNumeric(row[colTache]) : 100,
      hrs_base: colHrsBase >= 0 ? parseNumeric(row[colHrsBase]) : 0,
      hrs_supp: colHrsSupp >= 0 ? parseNumeric(row[colHrsSupp]) : 0,
      hrs_chomage: colHrsChomage >= 0 ? parseNumeric(row[colHrsChomage]) : 0,
      etp: colEtp >= 0 ? parseNumeric(row[colEtp]) : 0,
      supplements: colSupplements >= 0 ? parseNumeric(row[colSupplements]) : 0,
      total_brut: colTotalBrut >= 0 ? parseNumeric(row[colTotalBrut]) : 0,
      brut_base: colBrutBase >= 0 ? parseNumeric(row[colBrutBase]) : 0,
      cout_total_secu: colTotalSecu >= 0 ? parseNumeric(row[colTotalSecu]) : 0,
    });
  }

  if (data.length === 0) {
    errors.push("Aucune donnée salariale trouvée.");
  }

  return { fileType: "salary_stats", data: data as unknown as Record<string, unknown>[], rowCount: data.length, errors, warnings, detectedMonth, detectedYear };
}

// ============================================================
// 3. Absences CNS parser (Maladies CNS)
// ============================================================

export interface AbsenceRow {
  code_salarie: string;
  equipe: string;
  mois: number;
  annee: number;
  val_maladie: number;
  hrs_maladie: number;
  jours_maladie: number;
  val_accident: number;
  hrs_accident: number;
  val_raisons_familiales: number;
  hrs_raisons_familiales: number;
  val_conge_accompagnement: number;
  hrs_conge_accompagnement: number;
  val_maternite: number;
  hrs_maternite: number;
  jours_maternite: number;
  val_accueil: number;
  hrs_accueil: number;
  jours_accueil: number;
  pct_absenteisme: number;
  heures_theoriques: number;
}

export function parseAbsencesCNS(buffer: ArrayBuffer): WpParseResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  let workbook: XLSX.WorkBook;
  try {
    workbook = XLSX.read(buffer, { type: "array" });
  } catch {
    return { fileType: "absences_cns", data: [], rowCount: 0, errors: ["Impossible de lire le fichier Excel."], warnings };
  }

  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1 });

  // Try to detect month from metadata rows (before header)
  let detectedMonthFromMeta: number | undefined;
  for (let i = 0; i < Math.min(rows.length, 10); i++) {
    const metaRow = rows[i] as unknown[];
    if (!metaRow) continue;
    for (let j = 0; j < metaRow.length; j++) {
      const val = normalizeText(String(metaRow[j] || ""));
      if ((val.includes("mois") && val.includes("reference")) || val.includes("periode")) {
        if (j + 1 < metaRow.length) {
          const m = parseNumeric(metaRow[j + 1]);
          if (m >= 1 && m <= 12) detectedMonthFromMeta = m;
        }
      }
    }
  }

  const header = findHeaderRow(rows, ["code salarie", "maladie", "absenteisme"]);
  if (!header) {
    return { fileType: "absences_cns", data: [], rowCount: 0, errors: ["En-têtes non détectés."], warnings };
  }

  const h = header.headers;
  const colCode = findCol(h, "code", "salarie");
  const colEquipe = findCol(h, "equipe");
  const colMois = findCol(h, "mois");

  // Maladie columns
  const colValMaladie = h.findIndex((c) => normalizeText(c).includes("val") && normalizeText(c).includes("maladie"));
  const colHrsMaladie = h.findIndex((c) => normalizeText(c).includes("hrs") && normalizeText(c).includes("maladie"));
  const colJoursMaladie = h.findIndex((c) => normalizeText(c).includes("jours") && normalizeText(c).includes("maladie"));

  // Accident columns
  const colValAccident = h.findIndex((c) => normalizeText(c).includes("val") && normalizeText(c).includes("accident"));
  const colHrsAccident = h.findIndex((c) => normalizeText(c).includes("hrs") && normalizeText(c).includes("accident"));

  // Raisons familiales
  const colValRaisFam = h.findIndex((c) => normalizeText(c).includes("val") && normalizeText(c).includes("fam"));
  const colHrsRaisFam = h.findIndex((c) => normalizeText(c).includes("hrs") && normalizeText(c).includes("fam"));

  // Congé accompagnement
  const colValAccomp = h.findIndex((c) => normalizeText(c).includes("val") && normalizeText(c).includes("accompagnement"));
  const colHrsAccomp = h.findIndex((c) => normalizeText(c).includes("hrs") && normalizeText(c).includes("accompagnement"));

  // Maternité
  const colValMaternite = h.findIndex((c) => normalizeText(c).includes("val") && normalizeText(c).includes("maternite"));
  const colHrsMaternite = h.findIndex((c) => normalizeText(c).includes("hrs") && normalizeText(c).includes("maternite"));
  const colJoursMaternite = h.findIndex((c) => normalizeText(c).includes("jours") && normalizeText(c).includes("maternite"));

  // Accueil
  const colValAccueil = h.findIndex((c) => normalizeText(c).includes("val") && normalizeText(c).includes("accueil"));
  const colHrsAccueil = h.findIndex((c) => normalizeText(c).includes("hrs") && normalizeText(c).includes("accueil"));
  const colJoursAccueil = h.findIndex((c) => {
    const n = normalizeText(c);
    return (n.includes("jrs") || n.includes("jours")) && n.includes("accueil");
  });

  // % Absentéisme & heures théoriques
  const colPctAbs = h.findIndex((c) => normalizeText(c).includes("absenteisme"));
  const colHrsTheo = h.findIndex((c) => normalizeText(c).includes("heures") && normalizeText(c).includes("theorique"));

  if (colCode === -1) {
    return { fileType: "absences_cns", data: [], rowCount: 0, errors: ["Colonne 'Code salarié' non trouvée."], warnings };
  }

  const currentYear = new Date().getFullYear();
  const data: AbsenceRow[] = [];

  for (let i = header.index + 1; i < rows.length; i++) {
    const row = rows[i] as unknown[];
    if (!row || row.length === 0) continue;

    const codeSalarie = String(row[colCode] || "").trim();
    if (!codeSalarie) continue;

    const mois = colMois >= 0 ? parseNumeric(row[colMois]) : (detectedMonthFromMeta || 0);

    data.push({
      code_salarie: codeSalarie,
      equipe: colEquipe >= 0 ? String(row[colEquipe] || "") : "",
      mois,
      annee: currentYear,
      val_maladie: colValMaladie >= 0 ? parseNumeric(row[colValMaladie]) : 0,
      hrs_maladie: colHrsMaladie >= 0 ? parseNumeric(row[colHrsMaladie]) : 0,
      jours_maladie: colJoursMaladie >= 0 ? parseNumeric(row[colJoursMaladie]) : 0,
      val_accident: colValAccident >= 0 ? parseNumeric(row[colValAccident]) : 0,
      hrs_accident: colHrsAccident >= 0 ? parseNumeric(row[colHrsAccident]) : 0,
      val_raisons_familiales: colValRaisFam >= 0 ? parseNumeric(row[colValRaisFam]) : 0,
      hrs_raisons_familiales: colHrsRaisFam >= 0 ? parseNumeric(row[colHrsRaisFam]) : 0,
      val_conge_accompagnement: colValAccomp >= 0 ? parseNumeric(row[colValAccomp]) : 0,
      hrs_conge_accompagnement: colHrsAccomp >= 0 ? parseNumeric(row[colHrsAccomp]) : 0,
      val_maternite: colValMaternite >= 0 ? parseNumeric(row[colValMaternite]) : 0,
      hrs_maternite: colHrsMaternite >= 0 ? parseNumeric(row[colHrsMaternite]) : 0,
      jours_maternite: colJoursMaternite >= 0 ? parseNumeric(row[colJoursMaternite]) : 0,
      val_accueil: colValAccueil >= 0 ? parseNumeric(row[colValAccueil]) : 0,
      hrs_accueil: colHrsAccueil >= 0 ? parseNumeric(row[colHrsAccueil]) : 0,
      jours_accueil: colJoursAccueil >= 0 ? parseNumeric(row[colJoursAccueil]) : 0,
      pct_absenteisme: colPctAbs >= 0 ? parseNumeric(row[colPctAbs]) : 0,
      heures_theoriques: colHrsTheo >= 0 ? parseNumeric(row[colHrsTheo]) : 0,
    });
  }

  if (data.length === 0) {
    errors.push("Aucune donnée d'absence trouvée.");
  }

  // Detect month from data
  const months = [...new Set(data.map((d) => d.mois).filter((m) => m > 0))];
  const detectedMonth = months.length === 1 ? months[0] : undefined;

  return { fileType: "absences_cns", data: data as unknown as Record<string, unknown>[], rowCount: data.length, errors, warnings, detectedMonth };
}

// ============================================================
// Auto-detect file type
// ============================================================

export function detectFileType(buffer: ArrayBuffer): WpFileType | null {
  let workbook: XLSX.WorkBook;
  try {
    workbook = XLSX.read(buffer, { type: "array" });
  } catch {
    return null;
  }

  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, range: 0 });

  // Check first 5 rows for distinguishing keywords
  const allText = rows
    .slice(0, 5)
    .flat()
    .map((c) => normalizeText(String(c || "")))
    .join(" ");

  if (allText.includes("statistiques rapides") || allText.includes("hrs base decsal") || allText.includes("etat du salaire")) {
    return "salary_stats";
  }
  if (allText.includes("maladie") || allText.includes("absenteisme") || allText.includes("maternite")) {
    return "absences_cns";
  }
  if (allText.includes("sortie temporaire") || allText.includes("motif de sortie") || allText.includes("type contrat")) {
    return "roster_rh";
  }

  return null;
}

export function parseWpFile(buffer: ArrayBuffer, fileType: WpFileType): WpParseResult {
  switch (fileType) {
    case "roster_rh":
      return parseRosterRH(buffer);
    case "salary_stats":
      return parseSalaryStats(buffer);
    case "absences_cns":
      return parseAbsencesCNS(buffer);
  }
}
