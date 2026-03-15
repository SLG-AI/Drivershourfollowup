"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Plus, Target, Trash2, ArrowRight, Copy } from "lucide-react";
import { createTargetScenario, deleteTargetScenario, duplicateTargetScenario } from "./actions";
import { toast } from "sonner";
import Link from "next/link";

interface Scenario {
  id: string;
  name: string;
  description: string | null;
  created_at: string;
}

export function TargetScenarioListClient({ scenarios }: { scenarios: Scenario[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [duplicating, setDuplicating] = useState<string | null>(null);

  const handleCreate = async () => {
    if (!name.trim()) {
      toast.error("Nom requis");
      return;
    }
    setCreating(true);
    try {
      const result = await createTargetScenario({
        name: name.trim(),
        description: description.trim(),
      });
      toast.success("Scénario de besoins créé");
      setOpen(false);
      setName("");
      setDescription("");
      router.push(`/workforce/targets/${result.id}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Erreur");
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async (id: string) => {
    setDeleting(id);
    try {
      await deleteTargetScenario(id);
      toast.success("Scénario supprimé");
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Erreur");
    } finally {
      setDeleting(null);
    }
  };

  const handleDuplicate = async (id: string) => {
    setDuplicating(id);
    try {
      const result = await duplicateTargetScenario(id);
      toast.success("Scénario dupliqué");
      router.push(`/workforce/targets/${result.id}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Erreur");
    } finally {
      setDuplicating(null);
    }
  };

  return (
    <>
      <div className="flex justify-end">
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="mr-2 h-4 w-4" />
              Nouveau scénario de besoins
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Créer un scénario de besoins</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 pt-2">
              <div className="space-y-2">
                <Label>Nom</Label>
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Ex: Besoins été 2026"
                />
              </div>
              <div className="space-y-2">
                <Label>Description (optionnelle)</Label>
                <Input
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Ex: Besoins renforcés pour la saison estivale"
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
            <Target className="mb-4 h-12 w-12 text-muted-foreground" />
            <p className="text-lg font-medium">Aucun scénario de besoins</p>
            <p className="mt-2 text-sm text-muted-foreground">
              Créez votre premier scénario pour définir les besoins cibles.
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
                    <CardTitle className="text-base">{s.name}</CardTitle>
                    {s.description && (
                      <CardDescription className="mt-1">{s.description}</CardDescription>
                    )}
                  </div>
                  <div className="flex gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-muted-foreground hover:text-primary"
                      onClick={() => handleDuplicate(s.id)}
                      disabled={duplicating === s.id}
                      title="Dupliquer"
                    >
                      <Copy className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-muted-foreground hover:text-red-600"
                      onClick={() => handleDelete(s.id)}
                      disabled={deleting === s.id}
                      title="Supprimer"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <div className="flex items-center justify-between">
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
                  <Link href={`/workforce/targets/${s.id}`}>
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
