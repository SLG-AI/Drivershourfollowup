import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { FRENCH_MONTHS_SHORT } from "@/lib/constants";
import { POSTES_VARIABLES, type ProjectionVariable } from "@/lib/utils/wp-variable-attendu";

interface Props {
  projection: ProjectionVariable;
  /** Coefficient de charges appliqué pour passer du brut au coût employeur. */
  coef: number;
  perimetreFiltre: boolean;
}

const k = (n: number) => `${Math.round(n / 1000).toLocaleString("fr-FR")} k€`;

/**
 * Variable lié au planning, mois par mois : réalisé des mois payés, attendu
 * des suivants (wp-variable-attendu.ts). Les colonnes estimées sont grisées ;
 * leur total porte sa fourchette et, en pied, ce qui les déclenche.
 */
export function VariableAttendu({ projection, coef, perimetreFiltre }: Props) {
  const { mois, hypotheses, annee, dernierMoisPaie } = projection;
  if (mois.length === 0) return null;
  const estimes = mois.filter((m) => m.estime);
  const cellule = (estime: boolean) => (estime ? "bg-muted/60 italic text-muted-foreground" : "");

  return (
    <Card id="variable-attendu">
      <CardHeader>
        <CardTitle className="text-base">Variable lié au planning — réalisé et attendu {annee}</CardTitle>
        <CardDescription>
          Dimanches, fériés, nuits, amplitudes, dépannages, heures supplémentaires et primes de 6e jour{perimetreFiltre ? ", sur le périmètre filtré" : ""}.
          Chaque nature est payée le mois suivant l&apos;événement qui la déclenche : le réalisé vient de la Liste des salaires
          {dernierMoisPaie ? ` (jusqu'à ${FRENCH_MONTHS_SHORT[dernierMoisPaie]})` : ""}, l&apos;attendu (en gris) est recalculé à chaque import de paie.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-xs">Brut</TableHead>
                {mois.map((m) => (
                  <TableHead key={m.mois} className={`text-xs text-right ${cellule(m.estime)}`}>
                    {FRENCH_MONTHS_SHORT[m.mois]}{m.estime ? " (att.)" : ""}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {POSTES_VARIABLES.map((p) => (
                <TableRow key={p.id}>
                  <TableCell className="text-sm">{p.libelle}</TableCell>
                  {mois.map((m) => {
                    const c = m.postes[p.id];
                    const fourchette = m.estime && c.bas != null && c.haut != null && Math.round(c.haut / 1000) !== Math.round(c.bas / 1000);
                    return (
                      <TableCell
                        key={m.mois}
                        className={`text-sm text-right tabular-nums ${cellule(m.estime)}`}
                        title={fourchette ? `${k(c.bas!)} à ${k(c.haut!)}` : undefined}
                      >
                        {Math.abs(c.montant) < 500 ? "—" : k(c.montant)}
                      </TableCell>
                    );
                  })}
                </TableRow>
              ))}
              <TableRow className="font-medium">
                <TableCell className="text-sm">Total brut</TableCell>
                {mois.map((m) => (
                  <TableCell key={m.mois} className={`text-sm text-right tabular-nums ${cellule(m.estime)}`}>
                    <div>{k(m.total)}</div>
                    {m.estime && <div className="text-[11px] font-normal">{k(m.bas)}–{k(m.haut)}</div>}
                  </TableCell>
                ))}
              </TableRow>
              <TableRow>
                <TableCell className="text-sm">Coût employeur <span className="text-xs text-muted-foreground">(× {coef.toLocaleString("fr-FR", { maximumFractionDigits: 3 })})</span></TableCell>
                {mois.map((m) => (
                  <TableCell key={m.mois} className={`text-sm text-right tabular-nums ${cellule(m.estime)}`}>{k(m.total * coef)}</TableCell>
                ))}
              </TableRow>
            </TableBody>
          </Table>
        </div>

        {estimes.length > 0 && (
          <div className="grid gap-4 text-xs md:grid-cols-2">
            <div>
              <p className="mb-1 font-semibold uppercase tracking-wide text-muted-foreground">Déclencheurs des mois attendus</p>
              <ul className="space-y-0.5">
                {estimes.map((m) => (
                  <li key={m.mois}>
                    <span className="font-medium">{FRENCH_MONTHS_SHORT[m.mois]}</span> : {m.declencheurs.join(" ; ")}
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-muted-foreground">
                Attendu {estimes.length > 1 ? `de ${FRENCH_MONTHS_SHORT[estimes[0].mois]} à ${FRENCH_MONTHS_SHORT[estimes[estimes.length - 1].mois]}` : `en ${FRENCH_MONTHS_SHORT[estimes[0].mois]}`} :{" "}
                <span className="font-medium text-foreground">{k(estimes.reduce((s, m) => s + m.total, 0))}</span> brut,{" "}
                <span className="font-medium text-foreground">{k(estimes.reduce((s, m) => s + m.total, 0) * coef)}</span> chargés. Survoler une cellule grisée pour sa fourchette.
              </p>
            </div>
            <div>
              <p className="mb-1 font-semibold uppercase tracking-wide text-muted-foreground">Hypothèses</p>
              <ul className="space-y-0.5 text-muted-foreground">
                {POSTES_VARIABLES.map((p) => (
                  <li key={p.id}><span className="font-medium text-foreground">{p.libelle}</span> : {hypotheses[p.id]}</li>
                ))}
              </ul>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
