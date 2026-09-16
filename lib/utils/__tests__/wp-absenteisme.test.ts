import { describe, expect, it } from "vitest";
import { indexerPhotos } from "../roster-photos";
import { analyserAbsenteisme, compterEpisodes, compterEpisodesMois, type LignePhotoAbsence } from "../wp-absenteisme";
import { getWorkableHoursInMonth } from "../wp-calculations";

describe("compterEpisodes / compterEpisodesMois", () => {
  it("regroupe les jours proches, un week-end ne coupe pas, un trou de 4 jours oui", () => {
    expect(compterEpisodes(["2026-03-02", "2026-03-03", "2026-03-06", "2026-03-09", "2026-03-16"])).toBe(2);
    expect(compterEpisodes(["2026-03-02", "2026-03-02"])).toBe(1);
    expect(compterEpisodes([])).toBe(0);
  });
  it("compte les suites de mois", () => {
    expect(compterEpisodesMois([1, 2, 3, 5, 9, 10])).toBe(3);
    expect(compterEpisodesMois([])).toBe(0);
  });
});

const ligne = (code: string, mois: number, extra: Partial<LignePhotoAbsence> = {}): LignePhotoAbsence => ({
  code_salarie: code, mois, annee: 2026, date_entree: "2020-01-01", date_sortie: null, est_sortie_temporaire: false,
  description_motif_sortie: "", taux_occupation: 100, description_service: "Depot A", nom_salarie: `Nom ${code}`, ...extra,
});
const cns = (code: string, mois: number, pct: number, jours = 0) => ({ code_salarie: code, mois, annee: 2026, pct_absenteisme: pct, hrs_maladie: jours * 8, jours_maladie: jours });
const mct = (code: string, date: string, hrs = 8) => ({ code_salarie: code, date_absence: date, duree_hrs: hrs, mois: Number(date.slice(5, 7)), annee: 2026 });

describe("analyserAbsenteisme", () => {
  const photos = indexerPhotos([
    ligne("A", 1), ligne("B", 1, { description_service: "Depot B" }), ligne("S", 1, { est_sortie_temporaire: true, description_motif_sortie: "Congé parental" }),
    ligne("A", 2), ligne("B", 2, { description_service: "Depot B" }),
  ]);
  const workable = getWorkableHoursInMonth(2026, 1);
  const r = analyserAbsenteisme(2026, [1, 2, 3], photos, [cns("A", 1, 50), cns("Z", 1, 100)], [mct("B", "2026-01-05"), mct("B", "2026-01-12", 4), mct("B", "2026-01-11")], []);

  it("ne retient que les mois avec données, dénominateur = ETP disponible (suspension exclue)", () => {
    expect(r.moisAvecDonnees).toEqual([1]);
    expect(r.netEtpMoyen).toBe(2); // A + B, S suspendu
  });

  it("CNS rattachée aux actifs, MCT hors week-end sur les heures travaillables", () => {
    // A : 50 % de 1 ETP = 0,5 ; Z hors photo ignoré
    expect(r.taux.cns).toBe(25);
    // B : 8 + 4 h (le 11/01/2026 est un dimanche, écarté) / heures travaillables, sur 2 ETP
    expect(r.taux.mct).toBe(Math.round(((12 / workable) / 2) * 1000) / 10);
    expect(r.taux.global).toBe(Math.round((r.taux.cns + r.taux.mct) * 10) / 10);
  });

  it("ventile par dépôt, petits dépôts non classables", () => {
    const a = r.parDepot.find((d) => d.depot === "Depot A")!;
    const b = r.parDepot.find((d) => d.depot === "Depot B")!;
    expect(a).toMatchObject({ netEtpMoyen: 1, cns: 50, mct: 0, classable: false });
    expect(b.heuresMct).toBe(12);
    expect(b.cns).toBe(0);
  });

  it("Bradford = épisodes² × jours, sortis signalés", () => {
    const p = indexerPhotos([ligne("A", 1), ligne("B", 1), ligne("A", 2)]); // B absent de la dernière photo
    const res = analyserAbsenteisme(2026, [1, 2], p, [cns("A", 1, 100, 10), cns("A", 2, 100, 5)],
      [mct("B", "2026-01-05"), mct("B", "2026-01-06"), mct("B", "2026-01-20"), mct("B", "2026-02-02")], []);
    const a = res.bradford.find((b) => b.code_salarie === "A")!;
    const b = res.bradford.find((b) => b.code_salarie === "B")!;
    expect(a).toMatchObject({ episodes: 1, jours: 15, joursCns: 15, score: 15, parti: false, nom: "Nom A" });
    expect(b).toMatchObject({ episodes: 3, jours: 4, score: 36, parti: true });
    expect(res.bradford[0].code_salarie).toBe("B");
  });
});
