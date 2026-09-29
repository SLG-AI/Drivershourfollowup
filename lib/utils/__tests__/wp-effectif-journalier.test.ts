import { describe, expect, it } from "vitest";
import { calculerEffectifJournalier, dateHypothese, estFerie, hypothesesDuScenario, joursEntre, listerJour, tauxMesuresParMois, tauxRepris, tauxScenarioDuMois, type EntreesEffectifJournalier, type PersonneEffectif } from "../wp-effectif-journalier";
import { computeEffectifMoyen } from "../wp-effectif-moyen";

const p = (code: string, x: Partial<PersonneEffectif> = {}): PersonneEffectif => ({
  code_salarie: code, taux_occupation: 100, date_entree: "2020-01-01", date_sortie: null, est_sortie_temporaire: false, ...x,
});

const SANS_TAUX = { cns: 0, mct: 0, inj: 0, conges: 0 };

function entrees(personnes: PersonneEffectif[], x: Partial<EntreesEffectifJournalier> = {}): EntreesEffectifJournalier {
  return {
    debut: "2026-09-01",
    fin: "2026-09-30",
    premierJourProjete: "2026-09-01",
    populationDuMois: () => personnes,
    moisMesures: { cns: new Set(), mct: new Set(), inj: new Set() },
    cnsParSalarieMois: new Map(),
    mctJours: new Set(),
    injustifiees: [],
    tauxDuMois: () => SANS_TAUX,
    ...x,
  };
}

const jour = (r: ReturnType<typeof calculerEffectifJournalier>, date: string) => r.find((j) => j.date === date)!;

describe("calendrier", () => {
  it("jours d'une plage, fériés luxembourgeois, date d'hypothèse bornée au mois", () => {
    expect(joursEntre("2026-02-27", "2026-03-02")).toEqual(["2026-02-27", "2026-02-28", "2026-03-01", "2026-03-02"]);
    expect(estFerie("2026-06-23")).toBe(true);
    expect(estFerie("2026-06-24")).toBe(false);
    expect(dateHypothese(2026, 2, 31)).toBe("2026-02-28");
  });

  it("signale week-ends et fériés sans rien retirer de plus", () => {
    const r = calculerEffectifJournalier(entrees([p("A")], { debut: "2026-08-14", fin: "2026-08-16" }));
    expect(r.map((j) => [j.weekEnd, j.ferie, j.disponibles.tetes])).toEqual([[false, false, 1], [true, true, 1], [true, false, 1]]);
  });
});

describe("présence jour par jour", () => {
  it("entrée et sortie en cours de mois : présent de l'entrée au jour de sortie inclus ; mouvements du jour", () => {
    const r = calculerEffectifJournalier(entrees([p("A", { date_entree: "2026-09-10" }), p("B", { date_sortie: "2026-09-20" })]));
    expect(jour(r, "2026-09-09").sousContrat.tetes).toBe(1);
    expect(jour(r, "2026-09-10").sousContrat.tetes).toBe(2);
    expect(jour(r, "2026-09-10").mouvements.entrees).toBe(1);
    expect(jour(r, "2026-09-20").sousContrat.tetes).toBe(2);
    expect(jour(r, "2026-09-21").sousContrat.tetes).toBe(1);
    expect(jour(r, "2026-09-21").mouvements.sorties).toBe(1);
  });

  it("suspension : ETP retiré ; un congé parental à mi-temps retire 0,5 ETP mais garde la tête ; retour le lendemain de la fin", () => {
    const r = calculerEffectifJournalier(entrees([
      p("A", { est_sortie_temporaire: true, date_sortie: "2026-08-31", date_fin_sortie_temporaire: "2026-09-15" }),
      p("B", { est_sortie_temporaire: true, date_sortie: "2026-08-31", description_motif_sortie: "Congé parental temps partiel 50%" }),
    ]));
    const j5 = jour(r, "2026-09-05");
    expect(j5.sousContrat.tetes).toBe(2);
    expect(j5.suspendus.tetes).toBe(1);
    expect(j5.net.tetes).toBe(1);
    expect(j5.net.etp).toBe(0.5);
    expect(jour(r, "2026-09-16").net.etp).toBe(1.5);
  });

  it("temps partiel : la tête compte 1, l'ETP son taux", () => {
    const r = calculerEffectifJournalier(entrees([p("A", { taux_occupation: 60 })]));
    expect(r[0].net).toEqual({ tetes: 1, etp: 0.6 });
  });
});

describe("absences", () => {
  const mesure = { cns: new Set(["2026-09"]), mct: new Set(["2026-09"]), inj: new Set(["2026-09"]) };

  it("mois mesuré : MCT au jour près, injustifiée sur ses jours ouvrés, CNS en fraction du mois", () => {
    const e = entrees([p("A"), p("B"), p("C")], {
      moisMesures: mesure,
      mctJours: new Set(["A|2026-09-08"]),
      injustifiees: [{ code_salarie: "B", debut: "2026-09-11", fin: "2026-09-14" }], // ven → lun
      cnsParSalarieMois: new Map([["C|2026-09", 20]]),
    });
    const r = calculerEffectifJournalier(e);
    expect(jour(r, "2026-09-08").absences.mct.tetes).toBe(1);
    expect(jour(r, "2026-09-09").absences.mct.tetes).toBe(0);
    expect(jour(r, "2026-09-12").absences.inj.tetes).toBe(0); // samedi
    expect(jour(r, "2026-09-14").absences.inj.tetes).toBe(1);
    expect(jour(r, "2026-09-09").absences.cns.etp).toBe(0.2);
    expect(jour(r, "2026-09-08").disponibles.tetes).toBe(1.8);

    const liste = listerJour(e, "2026-09-08");
    expect(liste.find((l) => l.code_salarie === "A")!.motif).toBe("mct");
    expect(liste.find((l) => l.code_salarie === "C")!.motif).toBe("cns_partiel");
  });

  it("mois non mesuré : taux appliqués au net ; congés toujours en taux", () => {
    const personnes = Array.from({ length: 100 }, (_, i) => p(`P${i}`));
    const r = calculerEffectifJournalier(entrees(personnes, { tauxDuMois: () => ({ cns: 6, mct: 3, inj: 1, conges: 10 }) }));
    expect(r[0].absences.cns.tetes).toBe(6);
    expect(r[0].absences.conges.tetes).toBe(10);
    expect(r[0].disponibles.tetes).toBe(80);
    // Personne n'est désigné absent : la liste ne montre que des certitudes
    expect(listerJour(entrees(personnes), "2026-09-01").every((l) => l.motif === "present")).toBe(true);
  });
});

describe("scénario", () => {
  it("arrivée le 15 présente dès le 15, CDD jusqu'à sa fin ; départ après son jour ; sortie temporaire jusqu'à la veille du retour", () => {
    const r = calculerEffectifJournalier(entrees([p("A")], {
      hypotheses: [
        { type: "arrivee", libelle: "Embauche", nbPersonnes: 3, etp: 1, debut: "2026-09-15", fin: "2026-09-25" },
        { type: "depart", libelle: "Départ", nbPersonnes: 1, etp: 0.5, debut: "2026-09-10", fin: null },
        { type: "sortie_temporaire", libelle: "Maternité", nbPersonnes: 1, etp: 1, debut: "2026-09-05", fin: "2026-09-08" },
      ],
    }));
    expect(jour(r, "2026-09-09").sousContrat.tetes).toBe(1);
    expect(jour(r, "2026-09-14").sousContrat.tetes).toBe(0); // A présent, 1 départ hypothétique depuis le 11
    expect(jour(r, "2026-09-15").sousContrat.tetes).toBe(3);
    expect(jour(r, "2026-09-15").mouvements.entrees).toBe(3);
    expect(jour(r, "2026-09-26").sousContrat.tetes).toBe(0);
    expect(jour(r, "2026-09-10").sousContrat.etp).toBe(1);
    expect(jour(r, "2026-09-11").sousContrat.etp).toBe(0.5);
    expect(jour(r, "2026-09-07").suspendus.tetes).toBe(1);
    expect(jour(r, "2026-09-08").suspendus.tetes).toBe(0);
  });

  it("départ issu des données : la date de sortie du salarié est remplacée", () => {
    const r = calculerEffectifJournalier(entrees([p("A"), p("B")], { sortiesScenario: new Map([["A", "2026-09-10"]]) }));
    expect(jour(r, "2026-09-10").sousContrat.tetes).toBe(2);
    expect(jour(r, "2026-09-11").sousContrat.tetes).toBe(1);
  });

  it("turnover : 12 % par an retire 1 % du sous contrat sur un mois, étalé jour par jour et seulement en projection", () => {
    const personnes = Array.from({ length: 100 }, (_, i) => p(`P${i}`));
    const r = calculerEffectifJournalier(entrees(personnes, { premierJourProjete: "2026-09-16", turnoverAnnuel: () => 12 }));
    expect(jour(r, "2026-09-15").turnover.tetes).toBe(0);
    expect(jour(r, "2026-09-30").turnover.tetes).toBeCloseTo(0.5, 1);
    expect(jour(r, "2026-09-30").net.tetes).toBeCloseTo(99.5, 1);
  });
});

describe("cohérence avec les vues mensuelles", () => {
  it("la moyenne des jours d'un mois retrouve computeEffectifMoyen (sous contrat et net, en ETP)", () => {
    const personnes = [
      p("A", { date_entree: "2026-09-10" }),
      p("B", { date_sortie: "2026-09-20", taux_occupation: 80 }),
      p("C", { est_sortie_temporaire: true, date_sortie: "2026-08-31", date_fin_sortie_temporaire: "2026-09-15" }),
      p("D", { taux_occupation: 50 }),
    ];
    const r = calculerEffectifJournalier(entrees(personnes));
    const moyenne = (f: (j: (typeof r)[number]) => number) => r.reduce((s, j) => s + f(j), 0) / r.length;
    const ref = computeEffectifMoyen(personnes, [], 9, 2026);
    expect(moyenne((j) => j.sousContrat.etp)).toBeCloseTo(ref.brut, 1);
    expect(moyenne((j) => j.net.etp)).toBeCloseTo(ref.net, 1);
  });
});

describe("taux des mois non mesurés", () => {
  it("mesure par mois, puis reprend le même mois de l'an passé, sinon la moyenne des 3 derniers mois mesurés", () => {
    const personnes = Array.from({ length: 10 }, (_, i) => p(`P${i}`));
    const e = entrees(personnes, {
      debut: "2025-09-01", fin: "2025-09-30",
      moisMesures: { cns: new Set(["2025-09"]), mct: new Set(), inj: new Set() },
      cnsParSalarieMois: new Map([["P0|2025-09", 50]]), // 0,5 ETP sur 10 ⇒ 5 %
    });
    const mesures = tauxMesuresParMois(calculerEffectifJournalier(e), e.moisMesures);
    expect(mesures.get("2025-09")!.cns).toBeCloseTo(5, 6);
    expect(mesures.get("2025-09")!.mct).toBeUndefined();
    expect(tauxRepris(mesures, "cns", 2026, 9)).toBeCloseTo(5, 6);

    const serie = new Map([["2026-05", { cns: 4 }], ["2026-06", { cns: 6 }], ["2026-07", { cns: 5 }], ["2026-08", { cns: 7 }]]);
    expect(tauxRepris(serie, "cns", 2026, 10)).toBeCloseTo(6, 6);
    expect(tauxRepris(new Map(), "mct", 2026, 10)).toBe(0);
  });

  it("taux de scénario : ligne globale du mois, sinon moyenne des cost centers", () => {
    const lignes = [
      { mois: 9, centre_cout: null, projected_leave_rate: 12 },
      { mois: 10, centre_cout: "SLA202", projected_leave_rate: 6 },
      { mois: 10, centre_cout: "SLA210", projected_leave_rate: 10 },
    ];
    expect(tauxScenarioDuMois(lignes, "projected_leave_rate", 9)).toBe(12);
    expect(tauxScenarioDuMois(lignes, "projected_leave_rate", 10)).toBe(8);
    expect(tauxScenarioDuMois(lignes, "projected_leave_rate", 11)).toBeNull();
  });
});

describe("hypothesesDuScenario", () => {
  const filtres = { fonctions: [], cc: [], depots: ["Bertrange"], contrats: [], employee: null };

  it("filtre sur les attributs portés, date au jour, CDD borné à sa fin, départ réel en date de sortie", () => {
    const { hypotheses, sortiesScenario } = hypothesesDuScenario({
      arrivees: [
        { nb_personnes: 2, taux_occupation: 100, depot: "Bertrange", type_contrat: "CDD", start_day: 15, start_month: 10, start_year: 2026, end_day: null, end_month: 12, end_year: 2026 },
        { nb_personnes: 5, depot: "Mersch", type_contrat: "CDI", start_day: 1, start_month: 10, start_year: 2026 },
      ],
      sortiesTemporaires: [],
      departs: [
        { is_from_data: true, code_salarie: "A", departure_type: "turnover", departure_day: 12, departure_month: 11, departure_year: 2026 },
        { is_from_data: true, code_salarie: "HORS", departure_type: "turnover", departure_day: 12, departure_month: 11, departure_year: 2026 },
      ],
    }, filtres, new Set(["A"]));
    expect(hypotheses).toHaveLength(1);
    expect(hypotheses[0]).toMatchObject({ type: "arrivee", nbPersonnes: 2, debut: "2026-10-15", fin: "2026-12-31" });
    expect([...sortiesScenario]).toEqual([["A", "2026-11-12"]]);
  });

  it("un filtre salarié écarte toute hypothèse anonyme", () => {
    const { hypotheses } = hypothesesDuScenario({
      arrivees: [{ nb_personnes: 1, depot: "Bertrange", start_day: 1, start_month: 10, start_year: 2026 }], sortiesTemporaires: [], departs: [],
    }, { ...filtres, employee: "A" }, new Set());
    expect(hypotheses).toHaveLength(0);
  });
});
