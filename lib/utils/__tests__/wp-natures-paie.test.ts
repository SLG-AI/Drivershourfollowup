import { describe, expect, it } from "vitest";
import {
  FAMILLES,
  NATURES,
  decomposerParFamille,
  decomposerParMois,
  decomposerParNature,
  natureDepuisEntete,
  sommeNatures,
  ventilerPar,
} from "../wp-natures-paie";

describe("natureDepuisEntete — reconnaissance par le code avant le tiret", () => {
  it("reconnaît un en-tête normalisé par son code, quel que soit le libellé", () => {
    expect(natureDepuisEntete("shn - supplement heures de nuit")?.cle).toBe("nat_shn");
    expect(natureDepuisEntete("shn - libelle change")?.cle).toBe("nat_shn");
    expect(natureDepuisEntete("hfm - heures feries majorees (100%+100%)")?.cle).toBe("nat_hfm");
  });

  it("ne confond ni PR D et PR F, ni AM1 et AM2, ni un code contenu dans un autre", () => {
    expect(natureDepuisEntete("pr d - prime depannage")?.cle).toBe("nat_pr_d");
    expect(natureDepuisEntete("pr f - prime de fonction")?.cle).toBe("nat_pr_f");
    expect(natureDepuisEntete("am1 - amplitude > 11")?.cle).toBe("nat_am1");
    expect(natureDepuisEntete("am2 - amplitudes > 12")?.cle).toBe("nat_am2");
    expect(natureDepuisEntete("prim - prime")?.cle).toBe("nat_prim");
    expect(natureDepuisEntete("prr - prime repos")?.cle).toBe("nat_prr");
  });

  it("CCT et P001 sont une seule nature : le complément de salaire", () => {
    expect(natureDepuisEntete("cct - complement salaire")?.cle).toBe("nat_cct");
    expect(natureDepuisEntete("p001 - complement salaire")?.cle).toBe("nat_cct");
  });

  it("reconnaît « Autres CS » par son libellé exact et rend null pour l'inconnu", () => {
    expect(natureDepuisEntete("autres cs")?.cle).toBe("nat_autres_cs");
    expect(natureDepuisEntete("xyz - nature nouvelle")).toBeNull();
    expect(natureDepuisEntete("total brut")).toBeNull();
    expect(natureDepuisEntete("")).toBeNull();
  });

  it("chaque nature déclarée appartient à une famille déclarée, et les clés sont uniques", () => {
    const ids = new Set(FAMILLES.map((f) => f.id));
    NATURES.forEach((n) => expect(ids.has(n.famille)).toBe(true));
    expect(new Set(NATURES.map((n) => n.cle)).size).toBe(NATURES.length);
  });
});

describe("decomposerParFamille — le classement arbitré", () => {
  const ligne = {
    brut_base: 4000,
    nat_cct: 310, nat_smg: 20, nat_pr_f: 100, // structurel
    nat_shn: 50, nat_shd: 80, nat_am1: 30, nat_am2: 20, nat_hsm: 40, nat_hfm: 10, nat_pr_d: 60, nat_perm: 5, // planning
    nat_prim: 200, nat_aj: 50, nat_prr: 0, // primes
    nat_abin: -120, nat_cgtp: -30, // régularisations
    nat_dc: 900, // soldes
    nat_all: 250, nat_autres_cs: 70, nat_e002: 0, // avantages
  };

  it("somme chaque famille, le brut de base en structurel", () => {
    const f = decomposerParFamille([ligne]);
    expect(f.structurel).toBe(4000 + 310 + 20 + 100);
    expect(f.planning).toBe(50 + 80 + 30 + 20 + 40 + 10 + 60 + 5);
    expect(f.primes).toBe(250);
    expect(f.regularisations).toBe(-150);
    expect(f.soldes).toBe(900);
    expect(f.avantages).toBe(320);
  });

  it("brut de base + Σ natures = total brut du fichier (identité de la Liste des salaires)", () => {
    const f = decomposerParFamille([ligne]);
    const total = Object.values(f).reduce((s, v) => s + v, 0);
    expect(total).toBeCloseTo(4000 + sommeNatures(ligne), 6);
  });

  it("une nature absente de la ligne vaut 0, une valeur illisible aussi", () => {
    expect(decomposerParFamille([{ brut_base: "3000", nat_shn: "abc" }]).structurel).toBe(3000);
    expect(decomposerParNature([{ nat_shn: 12 }]).get("nat_shn")).toBe(12);
    expect(decomposerParNature([{ nat_shn: 12 }]).get("nat_shd")).toBe(0);
  });
});

describe("decomposerParMois / ventilerPar", () => {
  const lignes = [
    { code_salarie: "A", mois: 7, annee: 2026, fonction: "CHAUFFEUR BUS", brut_base: 4000, nat_shn: 100, total_brut: 4100 },
    { code_salarie: "B", mois: 8, annee: 2026, fonction: "CHAUFFEUR BUS", brut_base: 4000, nat_shn: 200, total_brut: 4200 },
    { code_salarie: "C", mois: 8, annee: 2026, fonction: "EMPLOYE DE BUREAU", brut_base: 3000, total_brut: 3000 },
    { code_salarie: "C", mois: 8, annee: 2026, type_remuneration: "non_periodique", fonction: "EMPLOYE DE BUREAU", brut_base: 0, nat_dc: 500, total_brut: 500 },
    { code_salarie: "D", mois: 8, annee: 2025, brut_base: 9999, total_brut: 9999 },
  ];

  it("regroupe par mois de l'année demandée, dans l'ordre, périmètre optionnel", () => {
    const tous = decomposerParMois(lignes, 2026);
    expect(tous.map((m) => m.mois)).toEqual([7, 8]);
    expect(tous[1].brut).toBe(4200 + 3000 + 500);
    expect(tous[1].familles.soldes).toBe(500);
    expect(tous[1].n).toBe(3);
    const perimetre = decomposerParMois(lignes, 2026, new Set(["B"]));
    expect(perimetre).toHaveLength(1);
    expect(perimetre[0].brut).toBe(4200);
  });

  it("ventile selon une clé, trie par brut décroissant, regroupe les sans-clé et calcule la part planning", () => {
    const duMois = lignes.filter((l) => l.mois === 8 && l.annee === 2026);
    const v = ventilerPar(duMois, (l) => l.fonction);
    expect(v.map((x) => x.cle)).toEqual(["CHAUFFEUR BUS", "EMPLOYE DE BUREAU"]);
    expect(v[0].partPlanning).toBeCloseTo((200 / 4200) * 100, 6);
    expect(v[1].familles.soldes).toBe(500);
    const sansCle = ventilerPar(duMois, () => null, "(nulle part)");
    expect(sansCle).toHaveLength(1);
    expect(sansCle[0].cle).toBe("(nulle part)");
    expect(sansCle[0].partPlanning).toBeCloseTo((200 / 7700) * 100, 6);
  });
});
