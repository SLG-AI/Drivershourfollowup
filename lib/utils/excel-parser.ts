import * as XLSX from "xlsx";

export interface ParsedMonthData {
  month: number;
  year: number;
  positiveHours: number;
  missingHours: number;
  overtimePay: number;
  counterEnd: number;
}

export interface ParsedDriverRow {
  codeSalarie: string;
  vehicleType: "BUS" | "CAM";
  bufferHours: number;
  months: ParsedMonthData[];
}

export interface SheetParseResult {
  sheetName: string;
  data: ParsedDriverRow[];
  errors: string[];
  warnings: string[];
  detectedPeriod: { periodNumber: number; year: number } | null;
  detectedMonths: number[];
}

export interface ParseResult {
  sheets: SheetParseResult[];
  globalErrors: string[];
}

const FRENCH_MONTH_MAP: Record<string, number> = {
  janvier: 1, janv: 1, jan: 1,
  fevrier: 2, fev: 2, feb: 2, février: 2,
  mars: 3, mar: 3,
  avril: 4, avr: 4, apr: 4,
  mai: 5,
  juin: 6, jun: 6,
  juillet: 7, juil: 7, jul: 7,
  aout: 8, août: 8, aou: 8,
  septembre: 9, sept: 9, sep: 9,
  octobre: 10, oct: 10,
  novembre: 11, nov: 11,
  decembre: 12, dec: 12, décembre: 12,
};

function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

function detectMonthFromHeader(header: string): number | null {
  const normalized = normalizeText(header);
  for (const [key, month] of Object.entries(FRENCH_MONTH_MAP)) {
    const normalizedKey = normalizeText(key);
    // Use word boundary to avoid false positives (e.g., "apr" in "après", "mai" in "mais")
    const regex = new RegExp(`\\b${normalizedKey}\\b`);
    if (regex.test(normalized)) {
      return month;
    }
  }
  return null;
}

function parseNumericValue(value: unknown): number {
  if (value === null || value === undefined || value === "") return 0;
  if (typeof value === "number") return value;
  const str = String(value).replace(",", ".").replace(/[^\d.\-]/g, "");
  const num = parseFloat(str);
  return isNaN(num) ? 0 : num;
}

function parseTimeValue(value: unknown): number {
  if (value === null || value === undefined || value === "") return 0;
  if (typeof value === "number") {
    // Excel stores ALL time values as fractions of a day (1 day = 1.0)
    // e.g., 0.708333 = 17:00h, 1.806250 = 43:21h, -0.522917 = -12:33h
    // Always convert by multiplying by 24 to get hours
    return value * 24;
  }
  const str = String(value).trim();
  // Handle HH:MM format
  const timeMatch = str.match(/^(-?\d+):(\d+)$/);
  if (timeMatch) {
    const hours = parseInt(timeMatch[1]);
    const minutes = parseInt(timeMatch[2]);
    const sign = hours < 0 ? -1 : 1;
    return sign * (Math.abs(hours) + minutes / 60);
  }
  return parseNumericValue(value);
}

interface ColumnMapping {
  codeSalarieCol: number;
  codeIsName: boolean; // true when using "Nom prénom" as fallback for code_salarie
  vehicleTypeCol: number;
  bufferCol: number;
  monthColumns: Map<
    number,
    {
      positiveHoursCol: number | null;
      missingHoursCol: number | null;
      overtimePayCol: number | null;
      counterEndCol: number | null;
    }
  >;
}

function detectColumns(headers: string[]): ColumnMapping | null {
  let codeSalarieCol = -1;
  let vehicleTypeCol = -1;
  let bufferCol = -1;
  let regularizationCol = -1;
  const monthColumns = new Map<
    number,
    {
      positiveHoursCol: number | null;
      missingHoursCol: number | null;
      overtimePayCol: number | null;
      counterEndCol: number | null;
    }
  >();

  for (let i = 0; i < headers.length; i++) {
    const h = normalizeText(headers[i] || "");
    if (h.includes("code") && h.includes("salarie")) {
      codeSalarieCol = i;
    } else if (
      (h.includes("bus") && h.includes("cam")) ||
      h.includes("fonction")
    ) {
      vehicleTypeCol = i;
    } else if (
      h === "10%" || h === "10 %" || h.includes("buffer") || h.includes("10%") || h === "0.1"
    ) {
      // Only take the first buffer column (repeats for each month group)
      if (bufferCol === -1) bufferCol = i;
    } else if (h.includes("regularisation") || h.includes("regul")) {
      // "Régularisation Q1/Q2/Q3" — period-end balance, no month in header
      if (regularizationCol === -1) regularizationCol = i;
    } else {
      const month = detectMonthFromHeader(headers[i] || "");
      if (month !== null) {
        if (!monthColumns.has(month)) {
          monthColumns.set(month, {
            positiveHoursCol: null,
            missingHoursCol: null,
            overtimePayCol: null,
            counterEndCol: null,
          });
        }
        const entry = monthColumns.get(month)!;
        if (h.includes("pos") || h.includes("excedent") || h.includes("supp")) {
          if (entry.positiveHoursCol === null) {
            entry.positiveHoursCol = i;
          } else if (entry.missingHoursCol === null) {
            // Duplicate "pos" column (likely a typo in the Excel) → treat as missing hours
            entry.missingHoursCol = i;
          }
        } else if (h.includes("manq") || h.includes("deficit") || h.includes("neg")) {
          if (entry.missingHoursCol === null) entry.missingHoursCol = i;
        } else if (h.includes("montant") || h.includes("payer")) {
          if (entry.overtimePayCol === null) entry.overtimePayCol = i;
        } else if (h.includes("compteur") || h.includes("cumul")) {
          if (entry.counterEndCol === null) entry.counterEndCol = i;
        }
      }
    }
  }

  // Assign regularization column to the last month's counterEndCol
  if (regularizationCol >= 0 && monthColumns.size > 0) {
    const lastMonth = Math.max(...monthColumns.keys());
    const lastEntry = monthColumns.get(lastMonth)!;
    if (lastEntry.counterEndCol === null) {
      lastEntry.counterEndCol = regularizationCol;
    }
  }

  // Fallback: if no "Code salarié" found, try "Nom prénom" or "Nom" as identifier
  let codeIsName = false;
  if (codeSalarieCol === -1) {
    for (let i = 0; i < headers.length; i++) {
      const h = normalizeText(headers[i] || "");
      if (h.includes("nom") && (h.includes("prenom") || h.includes("prénom"))) {
        codeSalarieCol = i;
        codeIsName = true;
        break;
      }
    }
    // Still not found
    if (codeSalarieCol === -1) return null;
  }

  // Fallback: if no vehicle type column found by header, try column after code+name
  if (vehicleTypeCol === -1 && headers.length > codeSalarieCol + 1) {
    // Try the next column that isn't already assigned
    const candidateCol = codeIsName ? codeSalarieCol + 1 : 2;
    if (candidateCol < headers.length) vehicleTypeCol = candidateCol;
  }

  return { codeSalarieCol, codeIsName, vehicleTypeCol, bufferCol, monthColumns };
}

function detectPeriodFromMonths(
  months: number[]
): { periodNumber: number; year: number } | null {
  if (months.length === 0) return null;
  const sorted = [...months].sort((a, b) => a - b);
  const min = sorted[0];

  let periodNumber: number;
  if (min >= 1 && min <= 4) periodNumber = 1;
  else if (min >= 5 && min <= 8) periodNumber = 2;
  else periodNumber = 3;

  return { periodNumber, year: new Date().getFullYear() };
}

/** Try to detect period number from sheet name (e.g. "P1 24", "P2 2025", "Période 3") */
function detectPeriodFromSheetName(name: string): { periodNumber: number; year: number | null } | null {
  const normalized = normalizeText(name);
  // Match "p1", "p2", "p3", "periode 1", "periode n3", "periode n°3", etc.
  const match = normalized.match(/p(?:eriode)?\s*(?:n\s*[°o]?\s*)?([123])/);
  if (match) {
    const periodNumber = parseInt(match[1]);
    // Try to detect 4-digit year (e.g. "2024")
    const year4Match = name.match(/(20\d{2})/);
    if (year4Match) {
      return { periodNumber, year: parseInt(year4Match[1]) };
    }
    // Try to detect 2-digit year (e.g. "24" in "P1 24")
    const year2Match = name.match(/\b(\d{2})\b/);
    if (year2Match) {
      const shortYear = parseInt(year2Match[1]);
      // Reasonable range: 20-99 → 2020-2099
      if (shortYear >= 20 && shortYear <= 99) {
        return { periodNumber, year: 2000 + shortYear };
      }
    }
    return { periodNumber, year: null };
  }
  return null;
}

function parseSheet(
  sheet: XLSX.WorkSheet,
  sheetName: string,
  defaultYear: number
): SheetParseResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const data: ParsedDriverRow[] = [];

  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1 });

  if (rows.length < 2) {
    return { sheetName, data: [], errors: ["La feuille ne contient pas assez de données."], warnings: [], detectedPeriod: null, detectedMonths: [] };
  }

  // Find header row - look for "Code" in first few rows
  let headerRowIndex = 0;
  let headers: string[] = [];
  for (let i = 0; i < Math.min(10, rows.length); i++) {
    const row = rows[i] as unknown[];
    if (!row) continue;
    const rowStrings = row.map((c) => String(c || ""));
    // Look for header row by "code" or "nom" (some sheets use "Nom prénom" instead of "Code salarié")
    if (rowStrings.some((h) => {
      const n = normalizeText(h);
      return n.includes("code") || (n.includes("nom") && n.includes("prenom"));
    })) {
      headerRowIndex = i;
      headers = rowStrings;
      break;
    }
  }

  if (headers.length === 0) {
    headers = (rows[0] as unknown[]).map((c) => String(c || ""));
  }

  // Always detect period from sheet name (even if column detection fails)
  const sheetNamePeriod = detectPeriodFromSheetName(sheetName);

  const mapping = detectColumns(headers);
  if (!mapping) {
    return {
      sheetName,
      data: [],
      errors: ["Impossible de détecter la colonne 'Code salarié' ou 'Nom prénom'."],
      warnings: [],
      detectedPeriod: sheetNamePeriod
        ? { periodNumber: sheetNamePeriod.periodNumber, year: sheetNamePeriod.year || defaultYear }
        : null,
      detectedMonths: [],
    };
  }

  if (mapping.codeIsName) {
    warnings.push("Colonne 'Code salarié' non trouvée — utilisation de 'Nom prénom' comme identifiant.");
  }

  const detectedMonths = Array.from(mapping.monthColumns.keys()).sort((a, b) => a - b);
  // Sans colonne mensuelle, la feuille n'est pas un tableau d'heures (ex. « Centre de coûts ») :
  // l'importer viderait la période qui lui serait attribuée par défaut.
  if (detectedMonths.length === 0) {
    errors.push("Aucune colonne mensuelle détectée.");
  }

  // Detect period: prefer month-based detection (more reliable than sheet name)
  // but use year from sheet name (more reliable than default year)
  const monthPeriod = detectPeriodFromMonths(detectedMonths);
  const detectedPeriod = monthPeriod
    ? { periodNumber: monthPeriod.periodNumber, year: sheetNamePeriod?.year || monthPeriod.year }
    : sheetNamePeriod
    ? { periodNumber: sheetNamePeriod.periodNumber, year: sheetNamePeriod.year || defaultYear }
    : null;

  const year = detectedPeriod?.year || defaultYear;

  // Parse data rows
  for (let i = headerRowIndex + 1; i < rows.length; i++) {
    const row = rows[i] as unknown[];
    if (!row || row.length === 0) continue;

    const codeSalarie = String(row[mapping.codeSalarieCol] || "").trim();
    if (!codeSalarie) continue;

    let vehicleType: "BUS" | "CAM" = "BUS";
    if (mapping.vehicleTypeCol >= 0) {
      const vt = normalizeText(String(row[mapping.vehicleTypeCol] || ""));
      if (vt.includes("cam") || vt.includes("van")) vehicleType = "CAM";
    }

    const bufferHours = mapping.bufferCol >= 0 ? parseTimeValue(row[mapping.bufferCol]) : 17;

    const months: ParsedMonthData[] = [];
    for (const [month, cols] of mapping.monthColumns) {
      const positiveHours = cols.positiveHoursCol !== null ? parseTimeValue(row[cols.positiveHoursCol]) : 0;
      const missingHours = cols.missingHoursCol !== null ? parseTimeValue(row[cols.missingHoursCol]) : 0;
      const overtimePay = cols.overtimePayCol !== null ? parseTimeValue(row[cols.overtimePayCol]) : 0;
      const counterEnd = cols.counterEndCol !== null ? parseTimeValue(row[cols.counterEndCol]) : 0;

      months.push({
        month,
        year,
        positiveHours,
        missingHours,
        overtimePay,
        counterEnd,
      });
    }

    data.push({ codeSalarie, vehicleType, bufferHours, months });
  }

  if (data.length === 0) {
    errors.push("Aucun chauffeur trouvé dans cette feuille.");
  }

  return { sheetName, data, errors, warnings, detectedPeriod, detectedMonths };
}

export function parseExcelFile(buffer: ArrayBuffer): ParseResult {
  let workbook: XLSX.WorkBook;
  try {
    workbook = XLSX.read(buffer, { type: "array" });
  } catch {
    return { sheets: [], globalErrors: ["Impossible de lire le fichier Excel."] };
  }

  if (workbook.SheetNames.length === 0) {
    return { sheets: [], globalErrors: ["Le fichier ne contient aucune feuille."] };
  }

  const defaultYear = new Date().getFullYear();
  const sheets: SheetParseResult[] = [];

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    const result = parseSheet(sheet, sheetName, defaultYear);
    // Only include sheets that have data or valid structure (skip empty/irrelevant sheets)
    if (result.data.length > 0 || result.errors.length > 0) {
      sheets.push(result);
    }
  }

  if (sheets.length === 0) {
    return { sheets: [], globalErrors: ["Aucune feuille avec des données de chauffeurs détectée."] };
  }

  return { sheets, globalErrors: [] };
}
