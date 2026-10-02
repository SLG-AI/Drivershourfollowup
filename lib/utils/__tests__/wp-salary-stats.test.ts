import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { parseSalaryStats } from "../wp-excel-parser";
import { preparerStatsSalariales } from "../wp-salary-import";

const META = ["Statistiques rapides", "Employeur", "S.L.A.", "Année", 2026, "De Mois de référence", 8, " à  mois de référence", 8];
const HEADER = ["Code salarié", "Nom salarié", "Prénom", "Période", "M. réf", "Département", "Fonction", "Date d'entrée", "Date de sortie", "Tâche en %", "Hrs base DECSAL", "Hrs supp. DECSAL", "Hrs chômage DECSAL", "ETP", "Suppléments", "Total brut", "Brut base", "Total SECU"];

function classeur(lignes: unknown[][]): ArrayBuffer {
  const sheet = XLSX.utils.aoa_to_sheet([META, HEADER, ...lignes]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, sheet, "Feuil1");
  const buf = XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
  return buf;
}

function salarie(code: string, mois: unknown, brut = 3000): unknown[] {
  return [code, "NOM", "Prenom", "2026-08", mois, "Exploitation", "Chauffeur", null, null, 100, 173, 0, 0, 1, 0, brut, brut, brut * 1.14];
}

describe("parseSalaryStats — ligne Total en fin de fichier", () => {
  it("ignore la ligne « Total » et le signale, sans casser les autres lignes", () => {
    const r = parseSalaryStats(classeur([
      salarie("1001", 8),
      salarie("1002", 8),
      ["Total", null, null, null, null, null, null, null, null, null, 346, 0, 0, 2, 0, 6000, 6000, 6840],
    ]));

    expect(r.errors).toEqual([]);
    expect(r.rowCount).toBe(2);
    expect(r.data.map((d) => d.code_salarie)).toEqual(["1001", "1002"]);
    expect(r.data.every((d) => d.mois === 8 && d.annee === 2026)).toBe(true);
    expect(r.warnings).toContain("1 ligne de total ignorée.");
  });

  it("remet à 0 un mois vide ou hors plage et prévient que le mois choisi sera appliqué", () => {
    const r = parseSalaryStats(classeur([
      salarie("1001", 8),
      salarie("1002", null),
      salarie("1003", 13),
    ]));

    expect(r.rowCount).toBe(3);
    expect(r.data.map((d) => d.mois)).toEqual([8, 0, 0]);
    expect(r.warnings).toContain("2 lignes sans mois de référence valide : le mois choisi à l'écran leur sera appliqué.");
  });
});

describe("preparerStatsSalariales — repli sur la période choisie", () => {
  const data = [
    { code_salarie: "1001", mois: 8, annee: 2026 },
    { code_salarie: "1002", mois: 0, annee: 2026 },
    { code_salarie: "1003", mois: 0, annee: 0 },
  ];

  it("applique le mois et l'année choisis aux lignes qui n'en ont pas", () => {
    const { lignes, ecartees, periode } = preparerStatsSalariales(data, "imp-1", 8, 2026);
    expect(ecartees).toBe(0);
    expect(lignes.map((l) => [l.mois, l.annee, l.import_id])).toEqual([[8, 2026, "imp-1"], [8, 2026, "imp-1"], [8, 2026, "imp-1"]]);
    expect(periode).toEqual({ mois: 8, annee: 2026 });
  });

  it("ne remplace pas un mois valide lu dans le fichier", () => {
    const { lignes } = preparerStatsSalariales(data, "imp-1", 7, 2026);
    expect(lignes[0].mois).toBe(8);
    expect(lignes[1].mois).toBe(7);
  });

  it("écarte les lignes toujours sans période, au lieu de faire échouer l'insertion", () => {
    const { lignes, ecartees, periode } = preparerStatsSalariales(data, "imp-1", undefined, undefined);
    expect(lignes.map((l) => l.code_salarie)).toEqual(["1001"]);
    expect(ecartees).toBe(2);
    expect(periode).toEqual({ mois: 8, annee: 2026 });
  });

  it("ne renvoie aucune période quand rien n'est retenu", () => {
    expect(preparerStatsSalariales([{ mois: 0, annee: 0 }], "imp-1")).toEqual({ lignes: [], ecartees: 1, periode: null });
  });
});

describe("en-têtes avec cellules vides", () => {
  it("ne plante pas quand la ligne d'en-têtes contient un trou", () => {
    const meta = [...META];
    const header: unknown[] = [...HEADER];
    header[3] = null; // « Période » vide ⇒ tableau à trous côté sheet_to_json
    const sheet = XLSX.utils.aoa_to_sheet([meta, header, salarie("1001", 8)]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, sheet, "Feuil1");
    const buf = XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;

    const r = parseSalaryStats(buf);
    expect(r.errors).toEqual([]);
    expect(r.rowCount).toBe(1);
    expect(r.data[0].mois).toBe(8);
  });
});

import { preparerLignesPaie } from "../wp-salary-import";

describe("preparerLignesPaie — une période par ligne, toutes les périodes rendues", () => {
  it("garde le mois de chaque ligne, applique le repli aux lignes sans période, rend chaque période présente une fois", () => {
    const data = [
      { code_salarie: "A", mois: 7, annee: 2026, total_brut: 1 },
      { code_salarie: "B", mois: 8, annee: 2026, total_brut: 1 },
      { code_salarie: "C", mois: 8, annee: 2026, total_brut: 1 },
      { code_salarie: "D", mois: 0, annee: 2026, total_brut: 1 },
      { code_salarie: "E", mois: 0, annee: 0, total_brut: 1 },
    ];
    const { lignes, ecartees, periodes } = preparerLignesPaie(data, "imp-9", 8, 2026);
    expect(lignes).toHaveLength(5);
    expect(ecartees).toBe(0);
    expect(lignes.map((l) => l.mois)).toEqual([7, 8, 8, 8, 8]);
    expect(lignes.every((l) => l.import_id === "imp-9")).toBe(true);
    expect(periodes).toEqual([{ mois: 7, annee: 2026 }, { mois: 8, annee: 2026 }]);
  });

  it("écarte les lignes sans période ni repli", () => {
    const { lignes, ecartees, periodes } = preparerLignesPaie([{ code_salarie: "A", mois: 0, annee: 0 }], "imp-9");
    expect(lignes).toEqual([]);
    expect(ecartees).toBe(1);
    expect(periodes).toEqual([]);
  });
});
