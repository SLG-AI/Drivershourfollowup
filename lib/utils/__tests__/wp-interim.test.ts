import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { detectFileType, parseInterimCosts, parseRosterRH } from "../wp-excel-parser";
import { estInterim, lireFiltresWorkforce } from "../wp-filtres";
import { agregerInterimParCostCenter, controlerRattachement, heuresTempsPleinDuMois } from "../wp-interim";

// Format de l'export « Coûts » de SLG Intérim (src/lib/domain/costs-export.ts).
const ENTETES = [
  "periode", "agence", "n_interne", "code_salarie", "numero_ratio", "interimaire", "population", "composante",
  "libelle", "quantite", "unite", "montant_avant_coefficient", "coefficient", "montant_facturable", "perimetre",
];

function ligne(periode: string, code: string, composante: string, quantite: number, facturable: number, perimetre = "complet") {
  return [periode, "Agence A", 1, code, 4711, "NOM FICTIF; Prénom", "bus", composante, "Libellé", quantite, "h", facturable / 1.5, 1.5, facturable, perimetre];
}

function csv(lignes: unknown[][]): ArrayBuffer {
  const esc = (v: unknown) => {
    const s = v === null || v === undefined ? "" : String(v);
    return /[;"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const texte = `﻿${lignes.map((l) => l.map(esc).join(";")).join("\r\n")}\r\n`;
  return new TextEncoder().encode(texte).buffer as ArrayBuffer;
}

function classeur(lignes: unknown[][]): ArrayBuffer {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(lignes), "Coûts");
  return XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
}

describe("parseInterimCosts", () => {
  const lignes = [
    ENTETES,
    ligne("2026-09", "SLA 9001", "base", 160, 4000),
    ligne("2026-09", "SLA 9001", "overtime", 8, 60),
    ligne("2026-10", "SLA 9002", "amplitude_11", 2, 15),
  ];

  for (const [format, fichier] of [["CSV « ; » avec BOM", csv(lignes)], ["XLSX", classeur(lignes)]] as const) {
    it(`lit l'export ${format}, plusieurs mois, sans jamais garder le nom`, () => {
      expect(detectFileType(fichier)).toBe("interim_couts");
      const r = parseInterimCosts(fichier);
      expect(r.errors).toEqual([]);
      expect(r.rowCount).toBe(3);
      expect(r.data[0]).toEqual({
        code_salarie: "SLA 9001", mois: 9, annee: 2026, agence: "Agence A", population: "bus", composante: "base",
        quantite: 160, unite: "h", montant_avant_coefficient: 4000 / 1.5, coefficient: 1.5, montant_facturable: 4000,
      });
      expect(r.data.map((d) => [d.mois, d.annee])).toEqual([[9, 2026], [9, 2026], [10, 2026]]);
      expect(JSON.stringify(r.data)).not.toMatch(/FICTIF|Prénom|4711/);
      expect(r.detectedMonth).toBeUndefined();
    });
  }

  it("refuse un export filtré", () => {
    const r = parseInterimCosts(csv([ENTETES, ligne("2026-09", "SLA 9001", "base", 10, 100, "filtre")]));
    expect(r.data).toEqual([]);
    expect(r.errors[0]).toMatch(/filtré/);
  });

  it("refuse un ancien export sans colonne perimetre", () => {
    const r = parseInterimCosts(csv([ENTETES.slice(0, -1), ligne("2026-09", "SLA 9001", "base", 10, 100).slice(0, -1)]));
    expect(r.errors[0]).toMatch(/perimetre/);
  });

  it("détecte le mois quand le fichier n'en couvre qu'un", () => {
    const r = parseInterimCosts(csv([ENTETES, ligne("2026-09", "SLA 9001", "base", 10, 100)]));
    expect([r.detectedMonth, r.detectedYear]).toEqual([9, 2026]);
  });
});

describe("roster : intérimaires écartés des effectifs", () => {
  it("estInterim reconnaît le préfixe, pas CDI/CDD", () => {
    expect(estInterim("INT CHAUFF. BUS")).toBe(true);
    expect(estInterim("int")).toBe(true);
    expect(estInterim("CDI CHAUFF. BUS")).toBe(false);
    expect(estInterim("")).toBe(false);
    expect(estInterim(null)).toBe(false);
  });

  it("parseRosterRH range les intérimaires à part, sans nom", () => {
    const fichier = classeur([
      ["Code salarié", "Nom", "Code employeur", "Type contrat", "Description fonction", "Centre de coût", "Description service", "Date d'entrée"],
      ["SLA 0001", "NOM A", "SLA", "CDI CHAUFF. BUS", "Chauffeur bus", "CC1", "Dépôt 1", null],
      ["SLA 9001", "NOM B", "SLA", "INT CHAUFF. BUS", "Chauffeur bus", "CC1", "Dépôt 1", null],
      ["SLA 9002", "NOM C", "SLA", "INT CHAUFF. CAM", "Chauffeur cam", "CC2", "Dépôt 2", null],
    ]);
    const r = parseRosterRH(fichier);
    expect(r.data.map((d) => d.code_salarie)).toEqual(["SLA 0001"]);
    expect(r.interimRoster?.map((d) => [d.code_salarie, d.centre_cout, d.description_service])).toEqual([
      ["SLA 9001", "CC1", "Dépôt 1"],
      ["SLA 9002", "CC2", "Dépôt 2"],
    ]);
    expect(JSON.stringify(r.interimRoster)).not.toMatch(/NOM/);
  });
});

describe("controlerRattachement", () => {
  const couts = [
    { code_salarie: "SLA 9001", mois: 9, annee: 2026 },
    { code_salarie: "SLA 9002", mois: 9, annee: 2026 },
    { code_salarie: "SLA 0001", mois: 9, annee: 2026 },
  ];
  it("ne dit rien quand tout est rattaché", () => {
    expect(controlerRattachement(couts.slice(0, 1), [{ code_salarie: "SLA 9001", mois: 9, annee: 2026 }], [])).toEqual([]);
  });
  it("liste les codes absents et les collisions avec un salarié, par mois", () => {
    const m = controlerRattachement(couts, [{ code_salarie: "SLA 9001", mois: 9, annee: 2026 }], [{ code_salarie: "SLA 0001", mois: 9, annee: 2026 }]);
    expect(m).toHaveLength(2);
    expect(m[0]).toMatch(/1 code\(s\) absent\(s\) du roster intérim de 09\/2026 : SLA 9002/);
    expect(m[1]).toMatch(/comme salarié.*SLA 0001/);
  });
  it("le roster d'un autre mois ne compte pas", () => {
    expect(controlerRattachement(couts.slice(0, 1), [{ code_salarie: "SLA 9001", mois: 8, annee: 2026 }], [])).toHaveLength(1);
  });
});

describe("agregerInterimParCostCenter", () => {
  const couts = [
    { code_salarie: "SLA 9001", mois: 9, annee: 2026, composante: "base", quantite: 168, montant_facturable: 4200 },
    { code_salarie: "SLA 9001", mois: 9, annee: 2026, composante: "overtime", quantite: 8, montant_facturable: 50 },
    { code_salarie: "SLA 9002", mois: 9, annee: 2026, composante: "base", quantite: 84, montant_facturable: 2000 },
    { code_salarie: "SLA 9003", mois: 9, annee: 2026, composante: "base", quantite: 10, montant_facturable: 250 },
    { code_salarie: "SLA 9001", mois: 10, annee: 2026, composante: "base", quantite: 100, montant_facturable: 9999 },
  ];
  const roster = [
    { code_salarie: "SLA 9001", mois: 9, annee: 2026, centre_cout: "CC1", description_service: "Dépôt 1" },
    { code_salarie: "SLA 9002", mois: 9, annee: 2026, centre_cout: "CC2", description_service: "Dépôt 2" },
  ];

  it("septembre 2026 : 22 jours ouvrés, soit 176 h", () => {
    expect(heuresTempsPleinDuMois(2026, 9)).toBe(176);
  });

  it("agrège par cost center ; heures = base seule ; ETP en jours ouvrés", () => {
    const r = agregerInterimParCostCenter(couts, roster, 2026, 9);
    expect(r.map((l) => [l.centre_cout, l.montant, l.heures, l.etp, l.intervenants])).toEqual([
      ["CC1", 4250, 168, 0.95, 1],
      ["CC2", 2000, 84, 0.48, 1],
      ["(non rattaché)", 250, 10, 0.06, 1],
    ]);
    expect(r[0].composantes).toEqual({ base: { quantite: 168, montant: 4200 }, overtime: { quantite: 8, montant: 50 } });
  });

  it("applique les filtres de l'en-tête et écarte le non rattaché sous filtre", () => {
    const filtres = lireFiltresWorkforce({ depots: "Dépôt 2" });
    expect(agregerInterimParCostCenter(couts, roster, 2026, 9, filtres).map((l) => l.centre_cout)).toEqual(["CC2"]);
  });
});
