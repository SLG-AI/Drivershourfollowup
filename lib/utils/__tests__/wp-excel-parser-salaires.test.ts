import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { parseSalaryStats } from "../wp-excel-parser";

function classeur(lignes: unknown[][]): ArrayBuffer {
  const sheet = XLSX.utils.aoa_to_sheet(lignes);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, sheet, "sheet1");
  return XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
}

describe("parseSalaryStats — rattachement et cotisations", () => {
  const BANDEAU = ["Statistiques rapides", "Employeur", "S.L.A.", "Année", 2026, "De Mois de référence", 8];
  const ENTETES = [
    "Code salarié", "Nom salarié", "Prénom", "M. réf", "Centre de coût", "Carrière", "Régime", "Hrs base", "ETP",
    "Suppléments", "Total brut", "Brut base", "CM Salariale", "CP Salariale", "Cot sal autres", "Assurance dépendance",
    "Net", "Impôts", "CM Patronale", "CP Patronale", "Assurance accident", "Allocation familiale", "Santé au travail",
    "Mutualité", "Cot pat autres", "Total SECU",
  ];

  it("lit le centre de coût et somme les cotisations patronales, sans lire le net ni les impôts", () => {
    const r = parseSalaryStats(classeur([
      BANDEAU,
      ENTETES,
      ["SLA 0001", "X", "Y", 8, "SLA202", "C1", "R1", 168, 1, 100, 4100, 4000, 320, 125, 10, 57, 3200, 400, 320, 125, 30, 70, 6, 60, 4, 1127],
    ]));
    const l = r.data[0] as Record<string, unknown>;
    expect(l.centre_cout).toBe("SLA202");
    expect(l.carriere).toBe("C1");
    expect(l.regime).toBe("R1");
    expect(l.cm_patronale).toBe(320);
    expect(l.charges_patronales).toBe(320 + 125 + 30 + 70 + 6 + 60 + 4); // 615
    expect(l.cout_total_secu).toBe(1127);
    expect("net" in l).toBe(false);
    expect("impots" in l).toBe(false);
  });

  it("vaut 0 quand les colonnes de cotisations sont absentes, sans repli sur une autre colonne", () => {
    const r = parseSalaryStats(classeur([
      BANDEAU,
      ["Code salarié", "M. réf", "ETP", "Total brut", "Brut base", "Total SECU", "Cot sal autres"],
      ["SLA 0001", 8, 1, 4100, 4000, 1127, 10],
    ]));
    const l = r.data[0] as Record<string, unknown>;
    expect(l.charges_patronales).toBe(0);
    expect(l.cot_pat_autres).toBe(0); // « Cot sal autres » ne doit pas être pris pour « Cot pat autres »
    expect(l.cot_sal_autres).toBe(10);
    expect(l.centre_cout).toBe("");
  });
});
