-- Statistiques rapides : rattachement et détail des cotisations.
--
-- POURQUOI. L'import ne gardait que quatre montants, dont « Total SECU » que
-- la page Coûts prenait pour le coût employeur. Sur le premier fichier avec
-- montants (août 2026), cette colonne vaut 27,6 % du brut : c'est le total
-- des cotisations salariales ET patronales. Le coût employeur réel est
-- Total brut + charges patronales, dont le détail figure dans le fichier.
-- Le centre de coût y figure aussi, ce qui évite la jointure sur le roster.
-- Le net, les impôts et les crédits d'impôt ne sont pas importés (décision
-- utilisateur du 22/09/2026), pas plus que les avantages en nature.

ALTER TABLE wp_salary_stats
  ADD COLUMN IF NOT EXISTS centre_cout TEXT,
  ADD COLUMN IF NOT EXISTS carriere TEXT,
  ADD COLUMN IF NOT EXISTS regime TEXT,
  ADD COLUMN IF NOT EXISTS cm_salariale NUMERIC DEFAULT 0,
  ADD COLUMN IF NOT EXISTS cp_salariale NUMERIC DEFAULT 0,
  ADD COLUMN IF NOT EXISTS cot_sal_autres NUMERIC DEFAULT 0,
  ADD COLUMN IF NOT EXISTS assurance_dependance NUMERIC DEFAULT 0,
  ADD COLUMN IF NOT EXISTS cm_patronale NUMERIC DEFAULT 0,
  ADD COLUMN IF NOT EXISTS cp_patronale NUMERIC DEFAULT 0,
  ADD COLUMN IF NOT EXISTS assurance_accident NUMERIC DEFAULT 0,
  ADD COLUMN IF NOT EXISTS allocation_familiale NUMERIC DEFAULT 0,
  ADD COLUMN IF NOT EXISTS sante_travail NUMERIC DEFAULT 0,
  ADD COLUMN IF NOT EXISTS mutualite NUMERIC DEFAULT 0,
  ADD COLUMN IF NOT EXISTS cot_pat_autres NUMERIC DEFAULT 0,
  ADD COLUMN IF NOT EXISTS charges_patronales NUMERIC DEFAULT 0;

COMMENT ON COLUMN wp_salary_stats.cout_total_secu IS 'Colonne « Total SECU » du fichier : total des cotisations salariales et patronales — PAS le coût employeur.';
COMMENT ON COLUMN wp_salary_stats.charges_patronales IS 'Somme des cotisations patronales (CM, CP, assurance accident, allocation familiale, santé au travail, mutualité, autres), calculée à l''import. Coût employeur = total_brut + charges_patronales.';
COMMENT ON COLUMN wp_salary_stats.centre_cout IS 'Centre de coût tel que le fichier de paie le porte.';

CREATE INDEX IF NOT EXISTS idx_wp_salary_centre_cout ON wp_salary_stats(centre_cout);
