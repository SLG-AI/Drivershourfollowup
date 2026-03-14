"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Plus, SlidersHorizontal, Trash2, ArrowRight } from "lucide-react";
import { createScenario, deleteScenario } from "./actions";
import { toast } from "sonner";
import Link from "next/link";

interface Scenario {
  id: string;
  name: string;
  description: string | null;
  projected_turnover_rate: number;
  is_default: boolean;
  created_at: string;
}

export function ScenarioListClient({ scenarios }: { scenarios: Scenario[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);

  const handleCreate = async () => {
    if (!name.trim()) {
      toast.error("Nom requis");
      return;
    }

    setCreating(true);
    try {
      // Create with default monthly params (0% absenteeism, 0 arrivals per month)
      const defaultMonthlyParams = Array.from({ length: 12 }, (_, i) => ({
        mois: i + 1,
        projected_absenteeism_rate: 0,
        planned_arrivals: 0,
        planned_arrivals_bus: 0,
        planned_arrivals_cam: 0,
      }));

      const result = await createScenario({
        name: name.trim(),
        description: description.trim(),
        projected_turnover_rate: 0,
        monthly_params: defaultMonthlyParams,
      });

      toast.success("Scénario créé");
      setOpen(false);
      setName("");
      setDescription("");
      router.push(`/workforce/scenarios/${result.id}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Erreur");
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async (id: string) => {
    setDeleting(id);
    try {
      await deleteScenario(id);
      toast.success("Scénario supprimé");
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Erreur");
    } finally {
      setDeleting(null);
    }
  };

  return (
    <>
      <div className="flex justify-end">
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="mr-2 h-4 w-4" />
              Nouveau scénario
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Créer un scénario</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 pt-2">
              <div className="space-y-2">
                <Label>Nom</Label>
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Ex: Scénario optimiste"
                />
              </div>
              <div className="space-y-2">
                <Label>Description (optionnelle)</Label>
                <Input
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Ex: Recrutements prévus au Q2"
                />
              </div>
              <Button onClick={handleCreate} disabled={creating} className="w-full">
                {creating ? "Création..." : "Créer et configurer"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {scenarios.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center py-12">
            <SlidersHorizontal className="mb-4 h-12 w-12 text-muted-foreground" />
            <p className="text-lg font-medium">Aucun scénario</p>
            <p className="mt-2 text-sm text-muted-foreground">
              Créez votre premier scénario pour projeter les effectifs.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {scenarios.map((s) => (
            <Card key={s.id} className="hover:border-primary/50 transition-colors">
              <CardHeader>
                <div className="flex items-start justify-between">
                  <div>
                    <CardTitle className="text-base flex items-center gap-2">
                      {s.name}
                      {s.is_default && <Badge variant="secondary" className="text-xs">Défaut</Badge>}
                    </CardTitle>
                    {s.description && (
                      <CardDescription className="mt-1">{s.description}</CardDescription>
                    )}
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-muted-foreground hover:text-red-600"
                    onClick={() => handleDelete(s.id)}
                    disabled={deleting === s.id}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                <div className="flex items-center justify-between">
                  <div className="space-y-1">
                    <p className="text-xs text-muted-foreground">Turnover projeté</p>
                    <p className="text-sm font-medium">{Number(s.projected_turnover_rate).toFixed(1)}%</p>
                  </div>
                  <div className="space-y-1 text-right">
                    <p className="text-xs text-muted-foreground">Créé le</p>
                    <p className="text-sm">
                      {new Date(s.created_at).toLocaleDateString("fr-FR", {
                        day: "2-digit",
                        month: "short",
                      })}
                    </p>
                  </div>
                </div>
                <Button asChild variant="outline" className="mt-4 w-full" size="sm">
                  <Link href={`/workforce/scenarios/${s.id}`}>
                    Configurer
                    <ArrowRight className="ml-2 h-4 w-4" />
                  </Link>
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}
