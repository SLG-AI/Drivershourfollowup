import { describe, it, expect } from "vitest";
import {
  controlerDureesAbsence,
  journeeContractuelle,
  messagesControleDurees,
  partDuMoisPresente,
  tauxContractuel,
  type LigneAbsenceAControler,
  type ReferenceTempsTravail,
} from "../wp-duree-absence";

// Août 2026 : 31 jours calendaires — les proratisations réelles observées
// dans le fichier Statistiques rapides sont des fractions de 31.
const MOIS = 8;
const ANNEE = 2026;

function ref(p: Partial<ReferenceTempsTravail> & { code_salarie: string }): ReferenceTempsTravail {
  return p;
}

describe("partDuMoisPresente", () => {
  it("rend 1 pour un salarié présent tout le mois", () => {
    expect(partDuMoisPresente(ref({ code_salarie: "A" }), MOIS, ANNEE)).toBe(1);
  });

  it("compte les jours à partir de l'entrée, bornes incluses", () => {
    // Entré le 18 août : du 18 au 31 = 14 jours sur 31
    expect(partDuMoisPresente(ref({ code_salarie: "A", date_entree: "2026-08-18" }), MOIS, ANNEE)).toBeCloseTo(14 / 31, 10);
  });

  it("compte les jours jusqu'à la sortie", () => {
    expect(partDuMoisPresente(ref({ code_salarie: "A", date_sortie: "2026-08-09" }), MOIS, ANNEE)).toBeCloseTo(9 / 31, 10);
  });

  it("ignore les dates hors du mois", () => {
    const r = ref({ code_salarie: "A", date_entree: "2019-01-01", date_sortie: "2030-01-01" });
    expect(partDuMoisPresente(r, MOIS, ANNEE)).toBe(1);
  });

  it("rend 0 quand le salarié est sorti avant le mois", () => {
    expect(partDuMoisPresente(ref({ code_salarie: "A", date_sortie: "2026-07-31" }), MOIS, ANNEE)).toBe(0);
  });
});

describe("tauxContractuel : annule la proratisation", () => {
  it("reconstitue 100 % pour un temps plein entré en cours de mois", () => {
    // Cas réel du fichier : tache_pct = 45,16 (= 14/31 x 100) pour un temps plein
    const r = ref({ code_salarie: "A", tache_pct: 45.16, date_entree: "2026-08-18" });
    expect(tauxContractuel(r, MOIS, ANNEE)).toBeCloseTo(100, 1);
    expect(journeeContractuelle(r, MOIS, ANNEE)).toBeCloseTo(8, 2);
  });

  it("laisse un taux inchangé quand le salarié est présent tout le mois", () => {
    const r = ref({ code_salarie: "A", tache_pct: 50 });
    expect(tauxContractuel(r, MOIS, ANNEE)).toBe(50);
    expect(journeeContractuelle(r, MOIS, ANNEE)).toBe(4);
  });

  it("reconstitue un mi-temps entré en cours de mois", () => {
    // Mi-temps présent 14 jours : 50 x 14/31 = 22,58
    const r = ref({ code_salarie: "A", tache_pct: 22.58, date_entree: "2026-08-18" });
    expect(tauxContractuel(r, MOIS, ANNEE)).toBeCloseTo(50, 1);
    expect(journeeContractuelle(r, MOIS, ANNEE)).toBeCloseTo(4, 2);
  });

  it("rend null quand aucune source ne donne de taux", () => {
    expect(tauxContractuel(ref({ code_salarie: "A" }), MOIS, ANNEE)).toBeNull();
    expect(tauxContractuel(ref({ code_salarie: "A", tache_pct: 0 }), MOIS, ANNEE)).toBeNull();
  });

  it("retient le taux du roster quand tache_pct s'est effondré", () => {
    // Cas réel : salarié présent tout le mois mais longuement absent, dont le
    // temps PAYÉ tombe à 9,68 alors que son contrat est à 100 %.
    const r = ref({ code_salarie: "A", taux_occupation: 100, tache_pct: 9.68, date_entree: "2022-07-15" });
    expect(tauxContractuel(r, MOIS, ANNEE)).toBe(100);
  });

  it("retient tache_pct quand le roster de fin de mois a déjà baissé le taux", () => {
    // Cas réel : passage de 80 % à 50 % en cours d'année. La photo d'août dit
    // 50, mais les absences du début valaient encore la journée d'un 80 %.
    const r = ref({ code_salarie: "A", taux_occupation: 50, tache_pct: 76.13 });
    expect(tauxContractuel(r, MOIS, ANNEE)).toBeCloseTo(76.13, 2);
    expect(journeeContractuelle(r, MOIS, ANNEE)).toBeCloseTo(6.09, 2);
  });
});

describe("controlerDureesAbsence", () => {
  const refs = new Map<string, Map<string, ReferenceTempsTravail>>([
    [
      `${ANNEE}-${MOIS}`,
      new Map<string, ReferenceTempsTravail>([
        ["PLEIN", ref({ code_salarie: "PLEIN", tache_pct: 100 })],
        ["MITEMPS", ref({ code_salarie: "MITEMPS", tache_pct: 50 })],
        ["QUATREVINGT", ref({ code_salarie: "QUATREVINGT", tache_pct: 80 })],
        // Temps plein entré le 18 : proratisé à 45,16 dans le fichier
        ["ARRIVE", ref({ code_salarie: "ARRIVE", tache_pct: 45.16, date_entree: "2026-08-18" })],
      ]),
    ],
  ]);

  const ligne = (code: string, duree: number): LigneAbsenceAControler => ({
    code_salarie: code,
    duree_hrs: duree,
    date_absence: "2026-08-20",
    mois: MOIS,
    annee: ANNEE,
  });

  it("laisse passer les journées conformes", () => {
    const r = controlerDureesAbsence(
      [ligne("PLEIN", 8), ligne("MITEMPS", 4), ligne("QUATREVINGT", 6.4)],
      refs
    );
    expect(r.controlees).toBe(3);
    expect(r.anomalies).toHaveLength(0);
  });

  it("signale une journée à 8 h posée sur un mi-temps (ligne journalière)", () => {
    // Sans date_debut/date_fin, la ligne vaut UN jour : 8 h au lieu de 4 h.
    const r = controlerDureesAbsence([ligne("MITEMPS", 8)], refs);
    expect(r.anomalies).toHaveLength(1);
    expect(r.anomalies[0].duree).toBe(8);
    expect(r.anomalies[0].journee).toBe(4);
    expect(r.anomalies[0].taux).toBe(50);
  });

  it("NE signale PAS une période de plusieurs jours dont la durée est cohérente", () => {
    // Du mardi 18 au jeudi 20 août 2026 = 3 jours ouvrés x 8 h = 24 h.
    // Sans la prise en compte de la période, ces 24 h passaient pour un
    // dépassement de la journée de 8 h : c'était un faux positif.
    const r = controlerDureesAbsence(
      [{ code_salarie: "PLEIN", duree_hrs: 24, date_debut: "2026-08-18", date_fin: "2026-08-20", mois: MOIS, annee: ANNEE }],
      refs
    );
    expect(r.controlees).toBe(1);
    expect(r.anomalies).toHaveLength(0);
  });

  it("NE signale PAS une période de 2 jours à 8 h pour un mi-temps", () => {
    // 2 jours ouvrés x 4 h = 8 h : cohérent, même si 8 h « ressemble » à une
    // journée pleine.
    const r = controlerDureesAbsence(
      [{ code_salarie: "MITEMPS", duree_hrs: 8, date_debut: "2026-08-18", date_fin: "2026-08-19", mois: MOIS, annee: ANNEE }],
      refs
    );
    expect(r.anomalies).toHaveLength(0);
  });

  it("signale une période dont la durée dépasse ses jours ouvrés", () => {
    // Du dimanche 30 au lundi 31 août : 1 seul jour ouvré, mais 16 h déclarées.
    const r = controlerDureesAbsence(
      [{ code_salarie: "PLEIN", duree_hrs: 16, date_debut: "2026-08-30", date_fin: "2026-08-31", mois: MOIS, annee: ANNEE }],
      refs
    );
    expect(r.anomalies).toHaveLength(1);
    expect(r.anomalies[0].jours).toBe(1);
    expect(r.anomalies[0].attendu).toBe(8);
  });

  it("signale une ligne datée sur une période sans aucun jour ouvré", () => {
    // Samedi 1er et dimanche 2 août : aucun jour ouvré, mais 8 h déclarées.
    const r = controlerDureesAbsence(
      [{ code_salarie: "PLEIN", duree_hrs: 8, date_debut: "2026-08-01", date_fin: "2026-08-02", mois: MOIS, annee: ANNEE }],
      refs
    );
    expect(r.anomalies).toHaveLength(1);
    expect(r.anomalies[0].jours).toBe(0);
    expect(r.anomalies[0].attendu).toBe(0);
  });

  it("NE signale PAS la journée normale d'un temps plein entré en cours de mois", () => {
    // Sans dé-proratisation, sa journée attendue serait 3,6 h et ses 8 h
    // passeraient pour une anomalie : c'est le faux positif à éviter.
    const r = controlerDureesAbsence([ligne("ARRIVE", 8)], refs);
    expect(r.controlees).toBe(1);
    expect(r.anomalies).toHaveLength(0);
  });

  it("tolère un léger dépassement sans le signaler", () => {
    // 10 % de marge : un taux reconstitué à 93,6 au lieu de 100 ne doit pas
    // faire sonner l'alarme à chaque journée de 8 h.
    const refsFlou = new Map([
      [`${ANNEE}-${MOIS}`, new Map([["FLOU", ref({ code_salarie: "FLOU", tache_pct: 93.6 })]])],
    ]);
    const r = controlerDureesAbsence([ligne("FLOU", 8)], refsFlou);
    expect(r.anomalies).toHaveLength(0);
  });

  it("compte à part les lignes sans référence, sans les signaler", () => {
    const r = controlerDureesAbsence([ligne("INCONNU", 99)], refs);
    expect(r.controlees).toBe(0);
    expect(r.sansReference).toBe(1);
    expect(r.anomalies).toHaveLength(0);
  });

  it("n'utilise pas la référence d'un autre mois", () => {
    const autreMois: LigneAbsenceAControler = { ...ligne("MITEMPS", 8), mois: 7 };
    const r = controlerDureesAbsence([autreMois], refs);
    expect(r.sansReference).toBe(1);
    expect(r.anomalies).toHaveLength(0);
  });

  it("classe les anomalies du dépassement le plus fort au plus faible", () => {
    const r = controlerDureesAbsence([ligne("MITEMPS", 8), ligne("PLEIN", 40)], refs);
    expect(r.anomalies.map((a) => a.duree)).toEqual([40, 8]); // x5 puis x2
  });
});

describe("messagesControleDurees", () => {
  it("ne dit rien quand tout est conforme", () => {
    expect(messagesControleDurees({ controlees: 10, sansReference: 0, anomalies: [] })).toEqual([]);
  });

  it("énonce le nombre d'anomalies et quelques exemples", () => {
    const msg = messagesControleDurees({
      controlees: 10,
      sansReference: 0,
      anomalies: [
        { code_salarie: "X1", date_absence: null, duree: 8, journee: 4, jours: 1, attendu: 4, taux: 50 },
        { code_salarie: "X2", date_absence: null, duree: 8, journee: 4.4, jours: 1, attendu: 4.4, taux: 55 },
      ],
    });
    expect(msg).toHaveLength(1);
    expect(msg[0]).toContain("2 lignes");
    expect(msg[0]).toContain("X1 8,0 h au lieu de 4,0 h pour 1 jour");
    expect(msg[0]).toContain("roster et Statistiques rapides");
  });

  it("invite à importer les statistiques salariales quand rien n'a pu être contrôlé", () => {
    const msg = messagesControleDurees({ controlees: 0, sansReference: 5, anomalies: [] });
    expect(msg).toHaveLength(1);
    expect(msg[0]).toContain("Statistiques rapides");
  });
});
