import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { detectFileType, parseMouvements } from "../wp-excel-parser";

const BANDEAU = ["Statistiques rapides", "Employeur", "S.L.A.", null, "Année", 2026, "De Mois de référence", 7, " à  mois de référence", 7];
const ENTETES_MENSUEL = ["Employeur", "Code", "Nom", "Equipe", "Date entrée", "Date sortie", "Motif sortie", "Nb entrées", "Nb sorties", "Nb sorties temp"];
const ENTETES_ANNUEL = ["Code", "Employeur", "Nom", "Equipe", "Date entrée", "Date sortie", "Motif sortie", "Nb entrées", "Nb sorties", "Nb sorties temp", "Sortie Y/N"];

function classeur(lignes: unknown[][]): ArrayBuffer {
  const sheet = XLSX.utils.aoa_to_sheet(lignes);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, sheet, "sheet1");
  return XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
}

/** Numéro de série Excel d'une date ISO. */
function serie(iso: string): number {
  return Math.round((Date.parse(iso) - Date.UTC(1899, 11, 30)) / 86400000);
}

describe("parseMouvements — export mensuel avec bandeau et ligne Total", () => {
  const fichier = classeur([
    BANDEAU,
    ENTETES_MENSUEL,
    ["SLA", "SLA 0001", "NOM A", "DEP_BB_TL_9.1", null, "31.07.2026", "Licenciement", null, 1, null],
    ["SLA", "SLA 0002", "NOM B", "DEP_BB_TL_9.1", "01.07.2026", null, null, 1, null, null],
    ["SLA", "SLA 0003", "NOM C", "DEP_KO_TL_30.1", null, serie("2026-07-14"), "Demission", null, 1, null],
    ["SLA", "SLA 0004", "NOM D", "DEP_AL_TL_5.1", null, "25.07.2026", "Conge Parental TP", null, null, 1],
    ["Total SLA", null, "S.L.A.", null, null, null, null, 1, 2, 1],
  ]);

  it("est reconnu automatiquement, avant les statistiques salariales", () => {
    expect(detectFileType(fichier)).toBe("mouvements");
  });

  it("type chaque ligne, lit les dates texte et numériques, ignore le total et détecte la période", () => {
    const r = parseMouvements(fichier);
    expect(r.errors).toEqual([]);
    expect(r.rowCount).toBe(4);
    expect(r.data.map((d) => [d.code_salarie, d.type, d.date_entree, d.date_sortie, d.motif_sortie, d.mois, d.annee])).toEqual([
      ["SLA 0001", "sortie", null, "2026-07-31", "Licenciement", 7, 2026],
      ["SLA 0002", "entree", "2026-07-01", null, "", 7, 2026],
      ["SLA 0003", "sortie", null, "2026-07-14", "Demission", 7, 2026],
      ["SLA 0004", "sortie_temporaire", null, "2026-07-25", "Conge Parental TP", 7, 2026],
    ]);
    expect(r.detectedMonth).toBe(7);
    expect(r.detectedYear).toBe(2026);
    expect(r.warnings).toContain("1 ligne de total ignorée.");
    expect(r.warnings).toContain("1 entrée(s), 2 sortie(s), 1 sortie(s) temporaire(s) détectées.");
  });
});

describe("parseMouvements — export annuel sans bandeau", () => {
  it("rattache chaque ligne au mois de sa date et ne prétend pas à un mois unique", () => {
    const r = parseMouvements(classeur([
      ENTETES_ANNUEL,
      ["SLA 0085", "SLA", "NOM", "DEP_BB_TL_9.1", null, serie("2026-04-30"), "Pension de vieillesse", null, 1, null, "Oui"],
      ["SLA 0171", "SLA", "NOM", "DEP_BB_TL_20.1", null, serie("2026-09-24"), "Conge Parental TP", null, null, 1, null],
      ["SLA 2500", "SLA", "NOM", "CCC_TC", serie("2026-07-13"), null, null, 1, null, null, null],
      ["SLA 2501", "SLA", "NOM", "CCC_TC", null, null, null, null, null, null, null],
    ]));
    expect(r.errors).toEqual([]);
    expect(r.data.map((d) => [d.code_salarie, d.type, d.mois])).toEqual([
      ["SLA 0085", "sortie", 4],
      ["SLA 0171", "sortie_temporaire", 9],
      ["SLA 2500", "entree", 7],
    ]);
    expect(r.detectedMonth).toBeUndefined();
    expect(r.warnings).toContain("1 ligne(s) sans type de mouvement ni date : écartée(s).");
    expect(r.warnings.some((w) => w.includes("2026-04, 2026-07, 2026-09"))).toBe(true);
  });

  it("utilise le mois du bandeau pour une ligne typée sans date", () => {
    const r = parseMouvements(classeur([
      BANDEAU,
      ENTETES_MENSUEL,
      ["SLA", "SLA 0009", "NOM", "OPS", null, null, "Demission", null, 1, null],
    ]));
    expect(r.data.map((d) => [d.type, d.mois, d.annee, d.date_sortie])).toEqual([["sortie", 7, 2026, null]]);
  });
});
