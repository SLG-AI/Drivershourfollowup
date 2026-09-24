"use client";

import { useState } from "react";
import Link from "next/link";
import { ChevronDown, ChevronRight } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { formatEuros } from "@/lib/utils/format";

/**
 * Une case de la carte « Paie réalisée ». Quand elle a un détail, la case
 * entière est un bouton qui ouvre un popover : sections repliables (famille →
 * natures), montant et part du brut en regard. Une case sans détail reste un
 * simple bloc, sans chevron : le chevron signale ce qui s'ouvre.
 */
export interface DetailLigne {
  libelle: string;
  montant: number;
  /** Part du total brut, en % (absente si sans objet). */
  part?: number | null;
}

export interface DetailSection {
  titre: string;
  montant?: number;
  part?: number | null;
  /** Ouverte au premier affichage. */
  ouvert?: boolean;
  lignes: DetailLigne[];
}

export interface DetailCase {
  sousTitre?: string;
  sections: DetailSection[];
  note?: string;
  lien?: { href: string; libelle: string };
}

interface Props {
  libelle: string;
  valeur: number;
  /** Petite ligne sous la valeur (coefficient réel, hors soldes…). */
  note?: string;
  detail?: DetailCase | null;
  /** Grande case (coût employeur, écart) : valeur plus grosse, deux colonnes. */
  grande?: boolean;
  accent?: boolean;
  /** Signe explicite (« + » / « − ») devant la valeur, pour l'écart. */
  signe?: boolean;
}

const euros = (n: number) => (n < 0 ? `−${formatEuros(Math.abs(n))}` : formatEuros(n));
const eurosSignes = (n: number) => (n >= 0 ? `+${formatEuros(n)}` : `−${formatEuros(Math.abs(n))}`);
const pct = (p: number | null | undefined) =>
  p == null ? null : `${p < 0 ? "−" : ""}${Math.abs(p).toLocaleString("fr-FR", { maximumFractionDigits: 1 })} %`;

function Section({ s }: { s: DetailSection }) {
  const [ouvert, setOuvert] = useState(s.ouvert ?? false);
  const Chevron = ouvert ? ChevronDown : ChevronRight;
  return (
    <div>
      <button
        type="button"
        onClick={() => setOuvert((o) => !o)}
        className="flex w-full items-center gap-1 rounded px-1 py-1 text-left text-sm hover:bg-muted"
        aria-expanded={ouvert}
      >
        <Chevron className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <span className="flex-1 font-medium">{s.titre}</span>
        {s.montant != null && <span className="tabular-nums font-medium">{euros(s.montant)}</span>}
        {pct(s.part) && <span className="w-14 text-right text-xs tabular-nums text-muted-foreground">{pct(s.part)}</span>}
      </button>
      {ouvert && (
        <ul className="mb-1 ml-5 space-y-0.5">
          {s.lignes.map((l) => (
            <li key={l.libelle} className="flex items-center gap-1 px-1 text-sm">
              <span className="flex-1 text-muted-foreground">{l.libelle}</span>
              <span className="tabular-nums">{euros(l.montant)}</span>
              {pct(l.part) && <span className="w-14 text-right text-xs tabular-nums text-muted-foreground">{pct(l.part)}</span>}
            </li>
          ))}
          {s.lignes.length === 0 && <li className="px-1 text-xs text-muted-foreground">Rien ce mois.</li>}
        </ul>
      )}
    </div>
  );
}

export function PaieCase({ libelle, valeur, note, detail, grande, accent, signe }: Props) {
  const classes = [
    "rounded-md border px-3 py-2 text-left",
    grande ? "md:col-span-2" : "",
    accent ? "border-slate-400 bg-slate-50" : "",
  ].join(" ");
  const valeurTexte = signe ? eurosSignes(valeur) : euros(valeur);

  const contenu = (
    <>
      <div className="flex items-start justify-between gap-2">
        <div className="text-xs text-muted-foreground">{libelle}</div>
        {detail && <ChevronDown className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground/70" aria-hidden />}
      </div>
      <div className={grande ? "text-lg font-semibold" : "font-medium"}>{valeurTexte}</div>
      {note && <div className="text-xs text-muted-foreground">{note}</div>}
    </>
  );

  if (!detail) return <div className={classes}>{contenu}</div>;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button type="button" className={`${classes} w-full transition-colors hover:border-primary/60 hover:bg-muted/40 data-[state=open]:border-primary`} title={`Détail : ${libelle}`}>
          {contenu}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[26rem] max-w-[calc(100vw-2rem)] p-3">
        <div className="mb-2 border-b pb-2">
          <div className="text-xs text-muted-foreground">{libelle}</div>
          <div className="text-base font-semibold">{valeurTexte}</div>
          {detail.sousTitre && <div className="text-xs text-muted-foreground">{detail.sousTitre}</div>}
        </div>
        <div className="max-h-[60vh] space-y-0.5 overflow-y-auto">
          {detail.sections.map((s) => (
            <Section key={s.titre} s={s} />
          ))}
        </div>
        {(detail.note || detail.lien) && (
          <div className="mt-2 border-t pt-2 text-xs text-muted-foreground">
            {detail.note && <p>{detail.note}</p>}
            {detail.lien && (
              <Link href={detail.lien.href} className="mt-1 inline-block font-medium text-primary hover:underline">
                {detail.lien.libelle} ↓
              </Link>
            )}
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
