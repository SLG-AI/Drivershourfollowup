import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import {
  controlerBrutIndice,
  controlerMontantsSalariaux,
  messagesControleBrutIndice,
  messagesControleMontantsSalariaux,
} from "../wp-controle-montants";
import { parseRosterRH, parseSalaryStats } from "../wp-excel-parser";

const stats = (n: number, montant: number | null) =>
  Array.from({ length: n }, () => ({ total_brut: montant, brut_base: montant, cout_total_secu: montant, supplements: 0 }));

describe("controlerMontantsSalariaux (Statistiques rapides)", () => {
  it("détecte un fichier « sans salaire » : colonnes présentes, montants vides partout", () => {
    const r = controlerMontantsSalariaux(stats(1382, 0), true);
    expect(r).toEqual({ sansMontants: true, n: 1382, avecMontants: 0 });
    const [m] = messagesControleMontantsSalariaux(r);
    expect(m).toContain("Fichier « sans salaire »");
    expect(m).toMatch(/vides sur les 1\s382 lignes/); // séparateur de milliers fr-FR (espace fine)
    expect(m).toContain("ni au coût réalisé ni au coefficient de charges");
  });

  it("reste silencieux sur un fichier normal", () => {
    const r = controlerMontantsSalariaux(stats(10, 3200), true);
    expect(r.sansMontants).toBe(false);
    expect(r.avecMontants).toBe(10);
    expect(messagesControleMontantsSalariaux(r)).toEqual([]);
  });

  it("ne dit rien quand les colonnes sont absentes du fichier (autre format)", () => {
    const r = controlerMontantsSalariaux(stats(50, 0), false);
    expect(r.sansMontants).toBe(false);
    expect(messagesControleMontantsSalariaux(r)).toEqual([]);
  });

  it("ne dit rien non plus sur un fichier vide", () => {
    expect(messagesControleMontantsSalariaux(controlerMontantsSalariaux([], true))).toEqual([]);
  });

  it("signale un cas partiel (moins de la moitié des lignes renseignées) sans le confondre avec « sans salaire »", () => {
    const r = controlerMontantsSalariaux([...stats(8, 0), ...stats(2, 2500)], true);
    expect(r.sansMontants).toBe(false);
    const [m] = messagesControleMontantsSalariaux(r);
    expect(m).toContain("8 lignes sur 10 sans montant");
    expect(m).toContain("2 lignes renseignées");
  });

  it("tolère quelques lignes à zéro (sorties en cours de mois) sans message", () => {
    const r = controlerMontantsSalariaux([...stats(7, 2500), ...stats(3, 0)], true);
    expect(messagesControleMontantsSalariaux(r)).toEqual([]);
  });

  it("accepte des montants en chaîne (numeric PostgREST) et retient toute colonne > 0", () => {
    const r = controlerMontantsSalariaux([{ total_brut: "3 200,5" as unknown, supplements: 0 }, { supplements: 12 }], true);
    // "3 200,5" n'est pas un nombre pour Number() : seule la 2e ligne compte
    expect(r.avecMontants).toBe(1);
    expect(r.sansMontants).toBe(false);
  });
});

describe("controlerBrutIndice (roster)", () => {
  const roster = (n: number, brut: number | null) => Array.from({ length: n }, () => ({ brut_indice: brut }));

  it("détecte un roster « without sal »", () => {
    const r = controlerBrutIndice(roster(340, 0), true);
    expect(r).toEqual({ sansSalaire: true, n: 340, avecBrut: 0 });
    const [m] = messagesControleBrutIndice(r);
    expect(m).toContain("Roster sans salaire");
    expect(m).toContain("vide sur les 340 lignes");
    expect(m).toContain("tracé en pointillé");
  });

  it("reste silencieux sur un roster normal et sur une colonne absente", () => {
    expect(messagesControleBrutIndice(controlerBrutIndice(roster(5, 300), true))).toEqual([]);
    expect(messagesControleBrutIndice(controlerBrutIndice(roster(5, 0), false))).toEqual([]);
  });

  it("signale un cas partiel", () => {
    const r = controlerBrutIndice([...roster(9, 0), ...roster(1, 300)], true);
    expect(r.sansSalaire).toBe(false);
    expect(messagesControleBrutIndice(r)[0]).toContain("9 lignes sur 10 sans Brut indice");
  });
});

// ------------------------------------------------------------
// Branchement dans les parseurs : le contrôle part du fichier réel.
// ------------------------------------------------------------

function classeur(lignes: unknown[][]): ArrayBuffer {
  const sheet = XLSX.utils.aoa_to_sheet(lignes);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, sheet, "sheet1");
  return XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
}

describe("parseSalaryStats — contrôle des montants", () => {
  const BANDEAU = ["Statistiques rapides", "Employeur", "S.L.A.", "Année", 2026, "De Mois de référence", 8];
  const ENTETES = ["Code salarié", "Nom salarié", "Prénom", "M. réf", "Hrs base", "ETP", "Suppléments", "Total brut", "Brut base", "Total SECU"];

  it("signale un export « sans salaire » dans `controles`, sans bloquer l'import", () => {
    const r = parseSalaryStats(classeur([
      BANDEAU,
      ENTETES,
      ["SLA 0001", "NOM A", "P", 8, 173, 1, null, null, null, null],
      ["SLA 0002", "NOM B", "P", 8, 173, 1, null, null, null, null],
      ["Total", null, null, null, 346, 2, null, null, null, null],
    ]));
    expect(r.errors).toEqual([]);
    expect(r.rowCount).toBe(2);
    expect(r.controles).toHaveLength(1);
    expect(r.controles?.[0]).toContain("Fichier « sans salaire »");
    expect(r.controles?.[0]).toContain("sur les 2 lignes");
    // Pas de doublon dans les avertissements informatifs.
    expect(r.warnings.some((w) => w.includes("sans salaire"))).toBe(false);
  });

  it("reste silencieux sur un export avec montants", () => {
    const r = parseSalaryStats(classeur([
      BANDEAU,
      ENTETES,
      ["SLA 0001", "NOM A", "P", 8, 173, 1, 120, 3400, 3280, 4200],
    ]));
    expect(r.controles).toEqual([]);
  });

  it("ne dit rien quand le fichier n'a pas de colonnes de montants", () => {
    const r = parseSalaryStats(classeur([
      BANDEAU,
      ["Code salarié", "Nom salarié", "Prénom", "M. réf", "Hrs base", "ETP"],
      ["SLA 0001", "NOM A", "P", 8, 173, 1],
    ]));
    expect(r.controles).toEqual([]);
  });
});

describe("parseRosterRH — contrôle du Brut indice", () => {
  const ENTETES = ["Code salarié", "Code employeur", "Date d'entrée", "Date de sortie", "Type contrat", "Taux occupation", "Brut indice", "Description fonction"];

  it("signale un roster « without sal »", () => {
    const r = parseRosterRH(classeur([
      ENTETES,
      ["SLA 0001", "SLA", 45000, null, "CDI", 100, null, "Chauffeur bus"],
      ["SLA 0002", "SLA", 45000, null, "CDI", 100, null, "Chauffeur bus"],
    ]));
    expect(r.errors).toEqual([]);
    expect(r.controles?.[0]).toContain("Roster sans salaire");
    expect(r.controles?.[0]).toContain("vide sur les 2 lignes");
  });

  it("reste silencieux avec un Brut indice renseigné, et sans la colonne", () => {
    const avec = parseRosterRH(classeur([
      ENTETES,
      ["SLA 0001", "SLA", 45000, null, "CDI", 100, 312.5, "Chauffeur bus"],
    ]));
    expect(avec.controles).toEqual([]);
    const sansColonne = parseRosterRH(classeur([
      ["Code salarié", "Code employeur", "Date d'entrée", "Date de sortie", "Type contrat", "Description fonction"],
      ["SLA 0001", "SLA", 45000, null, "CDI", "Chauffeur bus"],
    ]));
    expect(sansColonne.controles).toEqual([]);
  });
});
