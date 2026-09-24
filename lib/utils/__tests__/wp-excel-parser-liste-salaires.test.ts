import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { detectFileType, parseSalaryLines, parseWpFile } from "../wp-excel-parser";

function classeur(lignes: unknown[][]): ArrayBuffer {
  const sheet = XLSX.utils.aoa_to_sheet(lignes);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, sheet, "sheet1");
  return XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
}

const BANDEAU = ["Liste des salaires ", "Employeur", "S.L.A.", null, null, null, null, null, "Année", 2026, "De Mois de référence", 8, null, null, " à  mois de référence", 8];
// Même forme que l'export réel : natures entre « Brut base » et « Brut base + natures »,
// colonnes non lues (nom, net, impôts…) présentes pour vérifier qu'elles restent ignorées.
const ENTETES = [
  "Code salarié", "Nom salarié", "Prénom", "Période", "Département", "Centre de coût", "Fonction", "Sal/rnp", "Tâche en %",
  "Brut base", "ABIN - ABSENCE INJUSTIFIEE", "AM1 - Amplitude > 11", "CCT - Complément salaire", "DC - Décompte congé",
  "HSM - Heures sup. majorées ", "PR D - PRIME DEPANNAGE", "PR F - Prime de fonction", "SHD - Supplément sur heures dimanche",
  "SHN - Supplément heures de nuit", "Autres CS", "Brut base + natures", "Total brut",
  "CM Sal. soins", "CM Sal. espèces", "CP Salariale", "Assurance dépendance", "Impôts (CI déduits)", "Net",
  "CHRU - Cheques repas (chauffeurs)", "Solde à virer",
  "CM Patr. soins", "CM Patr. espèces", "CP Patronale", "Assurance accident", "Santé au travail", "Mutualité", "Cot pat autres",
  "Coût natures déduites",
];

function ligne(p: {
  code: string; periode: number; type: string; tache?: number; base: number; abin?: number; am1?: number; cct?: number; dc?: number;
  hsm?: number; prd?: number; prf?: number; shd?: number; shn?: number; autres?: number;
  cmS: number; cmE: number; cp: number; acc: number; sante: number; mut: number; autresPat?: number; cout: number;
}): unknown[] {
  const natures = [p.abin ?? 0, p.am1 ?? 0, p.cct ?? 0, p.dc ?? 0, p.hsm ?? 0, p.prd ?? 0, p.prf ?? 0, p.shd ?? 0, p.shn ?? 0, p.autres ?? 0];
  const total = p.base + natures.reduce((s, v) => s + v, 0);
  return [
    p.code, "Dupont", "Jean", p.periode, "DEP_BB_TL_9.1", "SLA202", "CHAUFFEUR BUS", p.type, p.tache ?? 100,
    p.base, ...natures, p.base, total,
    100, 9, 300, 40, 200, 3000, -58.8, 2900,
    p.cmS, p.cmE, p.cp, p.acc, p.sante, p.mut, p.autresPat ?? 0,
    p.cout,
  ];
}

describe("parseSalaryLines — Liste des salaires", () => {
  const salaire = ligne({ code: "SLA 0001", periode: 8, type: "Salaire", base: 4000, am1: 30, cct: 300, prd: 80, shd: 200, shn: 50, cmS: 120, cmE: 11, cp: 370, acc: 28, sante: 6, mut: 115, cout: 4660 + 650 });
  const np = ligne({ code: "SLA 0001", periode: 13, type: "Rémun. np", tache: 0, base: 0, dc: 900, cmS: 25, cmE: 2, cp: 72, acc: 6, sante: 1, mut: 21, cout: 900 + 127 });
  const manager = ligne({ code: "SLA 0002", periode: 8, type: "Salaire", base: 6000, autres: 250, cmS: 170, cmE: 15, cp: 500, acc: 40, sante: 8, mut: 160, cout: 6250 + 893 - 250 });
  const total = ["Total général", null, null, null, null, null, null, null, 200, 10000];

  it("lit le bandeau, le brut par nature, les charges patronales et le coût de la paie ; ignore le net, les impôts et la ligne de total", () => {
    const r = parseSalaryLines(classeur([BANDEAU, ENTETES, salaire, manager, total]));
    expect(r.errors).toEqual([]);
    expect(r.detectedYear).toBe(2026);
    expect(r.detectedMonth).toBe(8);
    expect(r.rowCount).toBe(2);
    expect(r.warnings.some((w) => w.includes("1 ligne de total ignorée"))).toBe(true);

    const l = r.data[0] as Record<string, unknown>;
    expect(l.code_salarie).toBe("SLA 0001");
    expect(l.mois).toBe(8);
    expect(l.annee).toBe(2026);
    expect(l.type_remuneration).toBe("salaire");
    expect(l.centre_cout).toBe("SLA202");
    expect(l.fonction).toBe("CHAUFFEUR BUS");
    expect(l.tache_pct).toBe(100);
    expect(l.brut_base).toBe(4000);
    expect(l.nat_am1).toBe(30);
    expect(l.nat_cct).toBe(300);
    expect(l.nat_pr_d).toBe(80);
    expect(l.nat_shd).toBe(200);
    expect(l.nat_shn).toBe(50);
    expect(l.nat_abin).toBe(0);
    expect(l.nat_pr_f).toBe(0);
    expect(l.total_brut).toBe(4660);
    expect(l.cm_patronale).toBe(131);
    expect(l.charges_patronales).toBe(120 + 11 + 370 + 28 + 6 + 115);
    expect(l.cout_employeur).toBe(5310);
    expect(l.avantages_nature).toBe(0);
    // Colonnes exclues par décision utilisateur
    for (const k of ["nom", "prenom", "net", "impots", "cm_salariale", "cp_salariale", "departement", "solde"]) {
      expect(k in l).toBe(false);
    }
  });

  it("conserve les avantages en nature retirés du coût par la paie", () => {
    const r = parseSalaryLines(classeur([BANDEAU, ENTETES, manager]));
    const l = r.data[0] as Record<string, unknown>;
    expect(l.nat_autres_cs).toBe(250);
    expect(l.total_brut).toBe(6250);
    expect(l.cout_employeur).toBe(6893);
    expect(l.avantages_nature).toBe(250);
    expect(r.controles).toEqual([]);
  });

  it("rattache la ligne « Rémun. np » (période 13) au mois de l'export, marquée non périodique", () => {
    const r = parseSalaryLines(classeur([BANDEAU, ENTETES, salaire, np]));
    expect(r.rowCount).toBe(2);
    const l = r.data[1] as Record<string, unknown>;
    expect(l.type_remuneration).toBe("non_periodique");
    expect(l.mois).toBe(8);
    expect(l.nat_dc).toBe(900);
    expect(l.total_brut).toBe(900);
    expect(l.cout_employeur).toBe(1027);
    expect(r.warnings.some((w) => w.includes("Rémun. np"))).toBe(true);
  });

  it("signale une nature inconnue et l'écart brut qu'elle provoque, sans la lire dans une autre colonne", () => {
    const entetes = [...ENTETES];
    entetes.splice(10, 0, "XYZ - Nature nouvelle");
    const l = [...salaire];
    l.splice(10, 0, 77);
    l[entetes.indexOf("Total brut")] = 4660 + 77; // le fichier compte la nature inconnue dans son total, pas nous : l'écart est de 77
    const r = parseSalaryLines(classeur([BANDEAU, entetes, l]));
    const d = r.data[0] as Record<string, unknown>;
    expect(d.nat_abin).toBe(0);
    expect(d.total_brut).toBe(4737);
    expect(r.warnings.some((w) => w.includes("XYZ - Nature nouvelle"))).toBe(true);
    expect(r.controles?.some((c) => c.includes("brut de base + natures ≠ total brut"))).toBe(true);
  });

  it("lit la période PAR LIGNE : un fichier multi-mois est signalé et chaque ligne garde son mois", () => {
    const juillet = ligne({ code: "SLA 0003", periode: 7, type: "Salaire", base: 4000, cmS: 120, cmE: 11, cp: 370, acc: 28, sante: 6, mut: 115, cout: 4650 });
    const r = parseSalaryLines(classeur([BANDEAU, ENTETES, juillet, salaire]));
    expect((r.data[0] as Record<string, unknown>).mois).toBe(7);
    expect((r.data[1] as Record<string, unknown>).mois).toBe(8);
    expect(r.warnings.some((w) => w.includes("multi-mois"))).toBe(true);
  });

  it("refuse un fichier sans « Brut base » / « Total brut », sans repli sur une autre colonne", () => {
    const r = parseSalaryLines(classeur([BANDEAU, ["Code salarié", "Brut", "Total"], ["SLA 0001", 1, 2]]));
    expect(r.errors[0]).toContain("Brut base");
    expect(r.data).toEqual([]);
  });

  it("est détecté par son bandeau et aiguillé par parseWpFile", () => {
    const buf = classeur([BANDEAU, ENTETES, salaire]);
    expect(detectFileType(buf)).toBe("salary_lines");
    expect(parseWpFile(buf, "salary_lines").fileType).toBe("salary_lines");
  });
});
