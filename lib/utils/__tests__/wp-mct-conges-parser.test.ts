import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { parseAbsencesMCT, type CongeRow } from "../wp-excel-parser";

const ENTETES = ["Nº", "Date", "Heure", "Code salarié", "Nom salarié", "Equipe", "Prestation", "Motif absence", "Descriptif prestation", "Durée (hrs)", "Durée (jrs)", "Code abrégé", "N° document", "Avec justificatif", "A charge CNS"];

function classeur(lignes: unknown[][]): ArrayBuffer {
  const sheet = XLSX.utils.aoa_to_sheet([ENTETES, ...lignes]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, sheet, "sheet1");
  return XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
}

/** Numéro de série Excel d'une date JJ.MM.AAAA (l'export MCT date en série). */
function serie(jjmmaaaa: string): number {
  const [j, m, a] = jjmmaaaa.split(".").map(Number);
  return Math.round((Date.UTC(a, m - 1, j) - Date.UTC(1899, 11, 30)) / 86400000);
}

function ligne(code: string, prestation: string, date: string, heures: number, cns = "N"): unknown[] {
  return [1, serie(date), "", code, "NOM", "DEP_BB_TL_9.1", prestation, "motif libre", "", heures, 1, "", "", "N", cns];
}

describe("parseAbsencesMCT — congés et télétravail", () => {
  const res = parseAbsencesMCT(classeur([
    ligne("SLA 0001", "CMALAD", "03.08.2026", 8),
    ligne("SLA 0002", "ACCIDE", "04.08.2026", 8),
    ligne("SLA 0003", "CONGES", "05.08.2026", 8),
    ligne("SLA 0003", "CONGES", "06.08.2026", 4),
    ligne("SLA 0004", "RECUP", "07.08.2026", 6),
    ligne("SLA 0005", "CGDEC", "10.08.2026", 8),
    ligne("SLA 0006", "CDEMEN", "11.08.2026", 8),
    ligne("SLA 0007", "CNOCES", "12.08.2026", 8),
    ligne("SLA 0008", "TT", "13.08.2026", 8),
    ligne("SLA 0009", "CMALAD", "14.08.2026", 8, "O"),
  ]));

  it("ne garde que les vraies absences dans data", () => {
    expect(res.data.map((d) => d.prestation)).toEqual(["CMALAD", "ACCIDE"]);
  });

  it("range CONGES en congés et CDEMEN/CGDEC/CNOCES/RECUP en extraordinaires", () => {
    const parCode = Object.fromEntries((res.conges ?? []).map((c: CongeRow) => [c.prestation, c.categorie]));
    expect(parCode).toEqual({ CONGES: "conges", RECUP: "extraordinaire", CGDEC: "extraordinaire", CDEMEN: "extraordinaire", CNOCES: "extraordinaire" });
    expect(res.conges).toHaveLength(6);
    expect(res.conges?.[1]).toMatchObject({ code_salarie: "SLA 0003", date_conge: "2026-08-06", duree_hrs: 4, mois: 8, annee: 2026 });
  });

  it("ne conserve jamais le motif libre", () => {
    expect(JSON.stringify(res.conges)).not.toContain("motif libre");
  });

  it("ignore le télétravail et ne signale plus ces codes comme inconnus", () => {
    expect(JSON.stringify(res.data)).not.toContain("TT");
    expect(res.warnings.some((w) => w.includes("télétravail"))).toBe(true);
    expect(res.warnings.some((w) => w.includes("non reconnu"))).toBe(false);
    expect(res.detectedMonth).toBe(8);
    expect(res.detectedYear).toBe(2026);
  });
});

describe("moisCongesComplets", () => {
  it("ne retient que le drapeau de l'import le plus récent du mois", async () => {
    const { moisCongesComplets } = await import("../wp-conges");
    const complets = moisCongesComplets([
      { mois: 8, annee: 2026, imported_at: "2026-09-10T08:00:00Z", conges_chauffeurs_inclus: false },
      { mois: 8, annee: 2026, imported_at: "2026-10-09T08:00:00Z", conges_chauffeurs_inclus: true },
      { mois: 9, annee: 2026, imported_at: "2026-10-01T08:00:00Z", conges_chauffeurs_inclus: true },
      { mois: 9, annee: 2026, imported_at: "2026-10-08T08:00:00Z", conges_chauffeurs_inclus: false },
      { mois: 7, annee: 2025, imported_at: "2026-10-08T08:00:00Z", conges_chauffeurs_inclus: true },
    ], 2026);
    expect([...complets]).toEqual([8]);
  });
});
