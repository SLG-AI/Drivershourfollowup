import { describe, expect, it } from "vitest";
import {
  computeRosterMovements,
  rangEffectif,
  reclassifierSortiesTemporaires,
  soldeEtp,
  type MovementEmployee,
} from "../wp-movements";

function emp(code: string, extra: Partial<MovementEmployee> = {}): MovementEmployee {
  return { code_salarie: code, est_sortie_temporaire: false, ...extra };
}

const codes = (items: { code_salarie: string }[]) => items.map((i) => i.code_salarie);

describe("rangEffectif", () => {
  it("prend le mois de la date, sauf le dernier jour du mois qui bascule au suivant", () => {
    expect(rangEffectif("2026-08-14")).toBe(2026 * 12 + 8);
    expect(rangEffectif("2026-07-31")).toBe(2026 * 12 + 8);
    expect(rangEffectif("2026-12-31")).toBe(2027 * 12 + 1);
    expect(rangEffectif("2026-02-28")).toBe(2026 * 12 + 3);
    expect(rangEffectif(null)).toBeNull();
    expect(rangEffectif("")).toBeNull();
  });
});

describe("computeRosterMovements", () => {
  it("compte les apparus comme nouveaux engagés, datés de leur entrée", () => {
    const prev = [emp("A")];
    const curr = [emp("A"), emp("B", { date_entree: "2026-08-03" })];
    const m = computeRosterMovements(prev, curr, 8, 2026);
    expect(codes(m.nouveaux)).toEqual(["B"]);
    expect(m.nouveaux[0].date).toBe("2026-08-03");
    expect(m.sortiesDefinitives).toEqual([]);
  });

  it("compte un disparu avec sortie dans le mois comme sortie définitive", () => {
    const prev = [emp("A"), emp("B", { date_sortie: "2026-08-14", description_motif_sortie: "Licenciement" })];
    const curr = [emp("A")];
    const m = computeRosterMovements(prev, curr, 8, 2026);
    expect(codes(m.sortiesDefinitives)).toEqual(["B"]);
    expect(m.sortiesDefinitives[0].motif).toBe("Licenciement");
    expect(m.disparusSansDate).toEqual([]);
  });

  it("rattache une sortie du dernier jour du mois précédent au mois affiché", () => {
    const prev = [emp("B", { date_sortie: "2026-07-31" })];
    const m = computeRosterMovements(prev, [], 8, 2026);
    expect(codes(m.sortiesDefinitives)).toEqual(["B"]);
  });

  it("compte un disparu en sortie temporaire comme sortie définitive quand sa date de sortie tombe dans le mois", () => {
    const prev = [emp("B", { date_sortie: "2026-08-17", est_sortie_temporaire: true, description_motif_sortie: "Conge Parental TP" })];
    const m = computeRosterMovements(prev, [], 8, 2026);
    expect(codes(m.sortiesDefinitives)).toEqual(["B"]);
  });

  it("signale un disparu sans date de sortie, ou avec une date future, comme anomalie", () => {
    const prev = [
      emp("A"),
      emp("B", { date_sortie: "2026-09-15", description_motif_sortie: "Fin de mission" }),
      emp("C", { date_sortie: null }),
    ];
    const m = computeRosterMovements(prev, [], 8, 2026);
    expect(codes(m.disparusSansDate).sort()).toEqual(["A", "B", "C"]);
    expect(m.sortiesDefinitives).toEqual([]);
    expect(m.disparusSansDate.find((i) => i.code_salarie === "B")?.date).toBe("2026-09-15");
  });

  it("date un disparu de sa sortie constatée ailleurs, même si le roster ne connaissait qu'une date prévue", () => {
    const prev = [
      emp("A", { date_sortie: "2026-09-15", description_motif_sortie: "Fin de mission" }),
      emp("B", { date_sortie: null }),
      emp("C", { date_sortie: "2026-10-15", description_motif_sortie: "Fin de mission" }),
    ];
    const constatees = new Map([
      ["A", { date: "2026-08-23", motif: "Licenciement" }],
      ["B", { date: "2026-07-31" }], // effet en août
      ["C", { date: "2026-09-05" }], // constatée mais postérieure au mois : reste une anomalie
    ]);
    const m = computeRosterMovements(prev, [], 8, 2026, constatees);
    expect(m.sortiesDefinitives.map((i) => [i.code_salarie, i.date])).toEqual([
      ["B", "2026-07-31"],
      ["A", "2026-08-23"],
    ]);
    // le motif constaté prime sur celui du roster
    expect(m.sortiesDefinitives[1].motif).toBe("Licenciement");
    expect(codes(m.disparusSansDate)).toEqual(["C"]);
  });

  it("ignore un disparu dont la sortie est effective un mois antérieur (déjà comptée), même constatée ailleurs", () => {
    const prev = [emp("B", { date_sortie: "2026-07-14" })];
    const m = computeRosterMovements(prev, [], 8, 2026, new Map([["B", { date: "2026-07-14" }]]));
    expect(m.sortiesDefinitives).toEqual([]);
    expect(m.disparusSansDate).toEqual([]);
  });

  it("compte un présent dont la sortie tombe avant la fin du mois, mais pas celui du dernier jour", () => {
    const curr = [
      emp("A", { date_sortie: "2026-08-20" }),
      emp("B", { date_sortie: "2026-08-31" }),
    ];
    const m = computeRosterMovements(curr, curr, 8, 2026);
    expect(codes(m.sortiesDefinitives)).toEqual(["A"]);
    // B sera compté en septembre, quand il disparaîtra
    expect(codes(computeRosterMovements(curr, [], 9, 2026).sortiesDefinitives)).toEqual(["B"]);
  });

  it("compte un passage en sortie temporaire sur la date de début, une seule fois", () => {
    const e = emp("A", {
      est_sortie_temporaire: true,
      date_debut_sortie_temporaire: "2026-08-01",
      date_fin_sortie_temporaire: "2027-07-31",
      description_motif_sortie: "Conge Parental TP",
    });
    const prevSansFlag = emp("A");
    expect(codes(computeRosterMovements([prevSansFlag], [e], 8, 2026).sortiesTemporaires)).toEqual(["A"]);
    expect(computeRosterMovements([e], [e], 9, 2026).sortiesTemporaires).toEqual([]);
    expect(computeRosterMovements([prevSansFlag], [e], 8, 2026).sortiesDefinitives).toEqual([]);
  });

  it("ne compte pas comme sortie définitive un présent en sortie temporaire dont la date de sortie tombe dans le mois", () => {
    const e = emp("A", {
      date_sortie: "2026-08-09",
      est_sortie_temporaire: true,
      date_debut_sortie_temporaire: "2026-08-10",
      date_fin_sortie_temporaire: "2027-02-09",
    });
    const m = computeRosterMovements([emp("A")], [e], 8, 2026);
    expect(m.sortiesDefinitives).toEqual([]);
    expect(codes(m.sortiesTemporaires)).toEqual(["A"]);
  });

  it("détecte un retour depuis la photo précédente quand l'export du mois a effacé les dates", () => {
    const prev = emp("A", {
      est_sortie_temporaire: true,
      date_debut_sortie_temporaire: "2026-02-01",
      date_fin_sortie_temporaire: "2026-07-31",
      description_motif_sortie: "Conge Parental TP",
    });
    const curr = emp("A");
    const m = computeRosterMovements([prev], [curr], 8, 2026);
    expect(codes(m.retours)).toEqual(["A"]);
    expect(m.retours[0].date).toBe("2026-07-31");
    expect(m.retours[0].motif).toBe("Conge Parental TP");
  });

  it("reporte un retour daté du dernier jour du mois affiché au mois suivant", () => {
    const e = emp("A", {
      est_sortie_temporaire: true,
      date_debut_sortie_temporaire: "2026-03-01",
      date_fin_sortie_temporaire: "2026-08-31",
    });
    expect(computeRosterMovements([e], [e], 8, 2026).retours).toEqual([]);
    expect(codes(computeRosterMovements([e], [emp("A")], 9, 2026).retours)).toEqual(["A"]);
  });

  it("ignore un drapeau temporaire sans dates (bruit de l'export)", () => {
    const m = computeRosterMovements(
      [emp("A", { est_sortie_temporaire: true })],
      [emp("A")],
      8,
      2026
    );
    expect(m.retours).toEqual([]);
    expect(m.sortiesTemporaires).toEqual([]);
  });

  it("détecte un changement de temps de travail entre les deux photos, baisses d'abord", () => {
    const prev = [
      emp("A", { taux_occupation: 100 }),
      emp("B", { taux_occupation: 50 }),
      emp("C", { taux_occupation: 80 }),
      emp("D", { taux_occupation: null }),
    ];
    const curr = [
      emp("A", { taux_occupation: 50 }),
      emp("B", { taux_occupation: 100 }),
      emp("C", { taux_occupation: 80 }),
      emp("D", { taux_occupation: 100 }), // null vaut 100 : pas un changement
    ];
    const m = computeRosterMovements(prev, curr, 8, 2026);
    expect(m.changementsTemps.map((i) => [i.code_salarie, i.tauxAvant, i.tauxApres, i.deltaEtp])).toEqual([
      ["A", 100, 50, -0.5],
      ["B", 50, 100, 0.5],
    ]);
    expect(m.nouveaux).toEqual([]);
    expect(m.sortiesDefinitives).toEqual([]);
  });

  it("calcule le solde sous contrat : nouveaux − sorties + changements de temps", () => {
    const prev = [
      emp("A", { taux_occupation: 100 }),
      emp("S", { taux_occupation: 50, date_sortie: "2026-08-10" }),
    ];
    const curr = [
      emp("A", { taux_occupation: 80 }),
      emp("N", { taux_occupation: 100, date_entree: "2026-08-01" }),
    ];
    const m = computeRosterMovements(prev, curr, 8, 2026);
    // +1 (N) − 0.5 (S) − 0.2 (A)
    expect(soldeEtp(m)).toEqual({ sousContrat: 0.3, net: 0.3 });
  });

  it("ne fait pas peser sur le solde net la sortie d'un salarié déjà en suspension de contrat", () => {
    // En suspension fin juillet (congé parental jusqu'au 31/07), parti définitivement en août :
    // il quitte l'effectif sous contrat (−1) mais ne comptait déjà plus dans le net (0).
    const prev = [
      emp("P", {
        est_sortie_temporaire: true,
        date_debut_sortie_temporaire: "2026-02-01",
        date_fin_sortie_temporaire: "2026-07-31",
        description_motif_sortie: "Conge Parental TP",
      }),
      emp("A"),
    ];
    const m = computeRosterMovements(prev, [emp("A")], 8, 2026, new Map([["P", { date: "2026-08-12" }]]));
    expect(m.sortiesDefinitives.map((i) => [i.code_salarie, i.etpSuspenduAvant])).toEqual([["P", 1]]);
    expect(m.retours).toEqual([]);
    expect(soldeEtp(m)).toEqual({ sousContrat: -1, net: 0 });
  });

  it("ne retire que la fraction suspendue pour un congé parental à temps partiel", () => {
    const partiel = emp("T", {
      est_sortie_temporaire: true,
      date_debut_sortie_temporaire: "2026-08-01",
      date_fin_sortie_temporaire: "2027-07-31",
      description_motif_sortie: "Conge Parental Temps Partiel",
      taux_occupation: 100,
    });
    const m = computeRosterMovements([emp("T")], [partiel], 8, 2026);
    expect(m.sortiesTemporaires.map((i) => [i.code_salarie, i.etp])).toEqual([["T", 0.5]]);
    expect(soldeEtp(m)).toEqual({ sousContrat: 0, net: -0.5 });

    // Sorti définitivement le mois suivant : seule la moitié était déjà hors du net.
    const suite = computeRosterMovements([partiel], [], 9, 2026, new Map([["T", { date: "2026-09-10" }]]));
    expect(suite.sortiesDefinitives[0].etpSuspenduAvant).toBe(0.5);
    expect(soldeEtp(suite)).toEqual({ sousContrat: -1, net: -0.5 });
  });

  it("rapproche le solde net des retours et des suspensions", () => {
    const suspendu = emp("T", {
      est_sortie_temporaire: true,
      date_debut_sortie_temporaire: "2026-08-01",
      date_fin_sortie_temporaire: "2027-07-31",
      description_motif_sortie: "Conge Parental TP",
    });
    const revenu = emp("R", {
      est_sortie_temporaire: true,
      date_debut_sortie_temporaire: "2026-01-01",
      date_fin_sortie_temporaire: "2026-07-31",
      description_motif_sortie: "Conge Parental TP",
    });
    const m = computeRosterMovements([emp("T"), revenu], [suspendu, emp("R")], 8, 2026);
    expect(soldeEtp(m)).toEqual({ sousContrat: 0, net: 0 });
    expect(codes(m.sortiesTemporaires)).toEqual(["T"]);
    expect(codes(m.retours)).toEqual(["R"]);
  });

  it("trie chaque catégorie par date", () => {
    const curr = [
      emp("B", { date_entree: "2026-08-20" }),
      emp("A", { date_entree: "2026-08-02" }),
    ];
    expect(codes(computeRosterMovements([], curr, 8, 2026).nouveaux)).toEqual(["A", "B"]);
  });
});

describe("reclassifierSortiesTemporaires", () => {
  it("retire le drapeau d'un motif non structurel avec heures maladie, et le pose sur un congé structurel daté", () => {
    const rows = [
      { code_salarie: "A", est_sortie_temporaire: true, date_sortie: null, description_motif_sortie: "Maladie" },
      { code_salarie: "B", est_sortie_temporaire: true, date_sortie: null, description_motif_sortie: "Conge Parental TP" },
      { code_salarie: "C", est_sortie_temporaire: false, date_sortie: "2026-10-01", description_motif_sortie: "Congé de maternité" },
    ];
    reclassifierSortiesTemporaires(rows, new Set(["A", "B"]));
    expect(rows.map((r) => r.est_sortie_temporaire)).toEqual([false, true, true]);
  });
});
