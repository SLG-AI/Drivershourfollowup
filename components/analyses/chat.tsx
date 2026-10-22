"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { ChevronDown, Download, Loader2, MessageSquarePlus, Send, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { etatAnalyse, lancerAnalyse, lienDeck, type AnalyseJob } from "@/app/(authenticated)/analyses/actions";

const ETAPES: Record<string, string> = {
  data_coverage: "Inventaire des données disponibles",
  long_days_by_depot: "Journées longues par dépôt",
  long_days_trend: "Évolution des journées longues",
  extra_days_by_depot: "Jours supplémentaires par dépôt",
  extra_days_trend: "Évolution des jours supplémentaires",
  hours_by_depot: "Heures par dépôt",
  workload_concentration: "Concentration de la charge",
  absenteeism_by_depot: "Absentéisme par dépôt",
  turnover_by_depot: "Départs par dépôt",
  absence_turnover_monthly_trend: "Absentéisme et turnover mois par mois",
  workforce_headcount_trend: "Évolution des effectifs (ETP)",
  workforce_headcount_by_depot: "Effectifs par dépôt",
  workforce_movements: "Entrées, sorties et suspensions",
  submit_deck: "Rédaction et vérification du deck",
};

const LIBELLES_TYPE: Record<string, string> = {
  cover: "couverture",
  section: "intercalaire",
  kpis: "chiffres clés",
  bar_chart: "graphique",
  table: "tableau",
  findings: "constats",
  limits: "limites",
};

const EXEMPLE = "Nous avons plus de plaintes de chauffeurs sur la pénibilité des programmes. Peux-tu analyser les jours supplémentaires de travail et les amplitudes pour étayer cette impression par des chiffres ? Regarde par dépôt et vérifie si la charge se concentre sur certains chauffeurs : la moyenne ne dit pas tout.";

function Etapes({ job }: { job: AnalyseJob }) {
  const vues = [...new Set(job.progress)];
  return (
    <ul className="space-y-1 text-xs text-muted-foreground">
      {vues.map((e) => <li key={e}>✓ {ETAPES[e] ?? e}</li>)}
      {(job.status === "queued" || job.status === "running") && (
        <li className="flex items-center gap-1.5 text-foreground"><Loader2 className="h-3 w-3 animate-spin" />{job.status === "queued" ? "En attente…" : "Analyse en cours… (1 à 3 minutes)"}</li>
      )}
    </ul>
  );
}

function Reponse({ job }: { job: AnalyseJob }) {
  const [telechargement, demarrer] = useTransition();
  const [erreur, setErreur] = useState<string | null>(null);
  const telecharger = () => demarrer(async () => {
    try {
      setErreur(null);
      window.location.href = await lienDeck(job.id);
    } catch (e) {
      setErreur(e instanceof Error ? e.message : String(e));
    }
  });
  return (
    <div className="space-y-3">
      <Etapes job={job} />
      {job.status === "done" && (
        <>
          {job.summary && <p className="whitespace-pre-line text-sm">{job.summary}</p>}
          {job.plan && (
            <details className="group rounded-md border px-3 py-2 text-sm" open={job.version > 1}>
              <summary className="flex cursor-pointer list-none items-center gap-1 text-xs font-medium text-muted-foreground">
                <ChevronDown className="h-3.5 w-3.5 transition-transform group-open:rotate-180" />
                Plan du deck — {job.plan.length} slides (citez « slide 3 : … » pour une retouche)
              </summary>
              <ol className="mt-2 space-y-0.5 text-xs">
                {job.plan.map((p, i) => (
                  <li key={i}><span className="inline-block w-6 text-muted-foreground">{i + 1}.</span>{p.titre.toUpperCase()} <span className="text-muted-foreground">· {LIBELLES_TYPE[p.type] ?? p.type}</span></li>
                ))}
              </ol>
            </details>
          )}
          <div className="flex flex-wrap items-center gap-3">
            <Button size="sm" onClick={telecharger} disabled={telechargement}>
              {telechargement ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Download className="mr-2 h-4 w-4" />}
              {job.deck_title ?? "Télécharger le deck"} — v{job.version} (.pptx)
            </Button>
            {job.usage?.coutUsd != null && <span className="text-xs text-muted-foreground">Coût de l&apos;analyse ≈ {job.usage.coutUsd.toLocaleString("fr-FR", { minimumFractionDigits: 2 })} $</span>}
          </div>
          {erreur && <p className="text-xs text-red-600">{erreur}</p>}
        </>
      )}
      {job.status === "error" && <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-900">L&apos;analyse a échoué : {job.error}</p>}
    </div>
  );
}

export function ChatAnalyses({ initiales }: { initiales: AnalyseJob[] }) {
  const [jobs, setJobs] = useState<AnalyseJob[]>(initiales);
  const [fil, setFil] = useState<string | null>(initiales[0]?.thread_id ?? null);
  const [question, setQuestion] = useState("");
  const [envoi, demarrer] = useTransition();
  const [erreur, setErreur] = useState<string | null>(null);

  const fils = useMemo(() => {
    const parFil = new Map<string, AnalyseJob[]>();
    for (const j of [...jobs].reverse()) parFil.set(j.thread_id, [...(parFil.get(j.thread_id) ?? []), j]);
    return [...parFil.entries()].reverse();
  }, [jobs]);
  const filCourant = fil ? fils.find(([id]) => id === fil)?.[1] ?? [] : [];
  const enCours = jobs.filter((j) => j.status === "queued" || j.status === "running");
  const dernierDeck = [...filCourant].reverse().find((j) => j.status === "done" && j.plan);

  // Suivi des analyses en cours, toutes les 3 s
  useEffect(() => {
    if (enCours.length === 0) return;
    const t = setInterval(async () => {
      const majs = await Promise.all(enCours.map((j) => etatAnalyse(j.id)));
      setJobs((prev) => prev.map((j) => majs.find((m) => m?.id === j.id) ?? j));
    }, 3000);
    return () => clearInterval(t);
  }, [enCours.map((j) => `${j.id}:${j.status}`).join(",")]); // eslint-disable-line react-hooks/exhaustive-deps

  const envoyer = () => demarrer(async () => {
    try {
      setErreur(null);
      const job = await lancerAnalyse({ question, threadId: fil ?? undefined });
      setJobs((prev) => [job, ...prev]);
      setFil(job.thread_id);
      setQuestion("");
    } catch (e) {
      setErreur(e instanceof Error ? e.message : String(e));
    }
  });

  return (
    <div className="grid gap-6 lg:grid-cols-[240px_1fr]">
      <div className="space-y-2">
        <Button variant="outline" size="sm" className="w-full justify-start" onClick={() => setFil(null)}>
          <MessageSquarePlus className="mr-2 h-4 w-4" />Nouvelle analyse
        </Button>
        {fils.map(([id, js]) => (
          <button
            key={id}
            onClick={() => setFil(id)}
            className={`w-full rounded-md px-3 py-2 text-left text-sm hover:bg-accent ${id === fil ? "bg-accent font-medium" : ""}`}
          >
            <span className="line-clamp-2">{js[0].question}</span>
            <span className="text-xs text-muted-foreground">{new Date(js[0].created_at).toLocaleDateString("fr-FR")} · {js.length} échange{js.length > 1 ? "s" : ""}</span>
          </button>
        ))}
      </div>

      <div className="space-y-4">
        {filCourant.length === 0 && (
          <Card>
            <CardContent className="space-y-3 pt-6 text-sm">
              <p className="font-medium">Que voulez-vous analyser ?</p>
              <p className="text-muted-foreground">
                L&apos;IA choisit parmi des indicateurs calculés par l&apos;application (journées longues, jours supplémentaires, heures, concentration de la charge, absentéisme, départs, par dépôt), puis rédige un deck. Chaque chiffre du deck est vérifié contre ces calculs.
              </p>
              <p className="flex items-start gap-2 text-xs text-muted-foreground">
                <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />
                Seuls des agrégats sont transmis à l&apos;IA : aucun nom, aucun matricule, aucun groupe de moins de 3 personnes.
              </p>
              <Button variant="link" size="sm" className="h-auto p-0" onClick={() => setQuestion(EXEMPLE)}>Utiliser l&apos;exemple « pénibilité des programmes »</Button>
            </CardContent>
          </Card>
        )}

        {filCourant.map((job, i) => {
          // Version visée : celle du dernier deck réussi avant ce message, plus un (la base n'attribue la version qu'à la fin)
          const avant = filCourant.slice(0, i).reverse().find((j) => j.status === "done" && j.plan);
          const version = job.status === "done" ? job.version : avant ? avant.version + 1 : 1;
          return (
          <div key={job.id} className="space-y-2">
            <div className="ml-auto max-w-[85%] rounded-lg bg-primary px-4 py-2 text-sm text-primary-foreground">
              {version > 1 && <span className="mr-2 rounded bg-primary-foreground/20 px-1.5 py-0.5 text-[10px] font-semibold uppercase">Retouche → v{version}</span>}
              {job.question}
            </div>
            <Card className="max-w-[85%]"><CardContent className="pt-4"><Reponse job={job} /></CardContent></Card>
          </div>
          );
        })}

        <div className="space-y-2">
          <textarea
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && question.trim()) envoyer(); }}
            rows={4}
            placeholder={dernierDeck ? `Vos commentaires sur la v${dernierDeck.version} — ex. « slide 4 : mets Allerborn en avant dans le commentaire », « supprime la slide 6 », « ajoute l'absentéisme par dépôt »…` : "Votre question…"}
            className="w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          />
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground">⌘ + Entrée pour envoyer · {dernierDeck ? "retouche : environ 0,05 à 0,20 $, 20 à 60 s" : "nouvelle analyse : environ 0,30 à 0,75 $, 1 à 3 min"}</span>
            <Button onClick={envoyer} disabled={envoi || question.trim().length < 3}>
              {envoi ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}Analyser
            </Button>
          </div>
          {erreur && <p className="text-sm text-red-600">{erreur}</p>}
        </div>
      </div>
    </div>
  );
}
