/**
 * Analyses IA : une question en langage naturel → un deck PowerPoint en
 * anglais à la charte SLG (lib/analyses). Réservé au rôle « analyste ».
 */

import { estAnalyste, listerAnalyses } from "./actions";
import { ChatAnalyses } from "@/components/analyses/chat";

export default async function AnalysesPage() {
  if (!(await estAnalyste())) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold">Analyses IA</h1>
          <p className="text-muted-foreground">Questions en langage naturel, réponse en PowerPoint.</p>
        </div>
        <div className="rounded-lg border border-dashed p-12 text-center">
          <p className="text-lg font-medium">Accès réservé</p>
          <p className="mt-2 text-sm text-muted-foreground">
            Cette fonctionnalité compare les dépôts et la répartition de la charge entre chauffeurs : elle est réservée aux personnes habilitées (rôle « analyste »).
          </p>
        </div>
      </div>
    );
  }
  const analyses = await listerAnalyses();
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Analyses IA</h1>
        <p className="text-muted-foreground">
          Posez une question sur la charge des chauffeurs ou le Workforce Planning (effectifs, coûts, scénarios, cibles) ; l&apos;analyse est livrée en PowerPoint, en anglais, à la charte SLG.
        </p>
      </div>
      <ChatAnalyses initiales={analyses} />
    </div>
  );
}
