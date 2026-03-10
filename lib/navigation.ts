import {
  LayoutDashboard,
  Upload,
  Users,
  GitCompareArrows,
  BarChart3,
  Settings,
  Clock,
  UsersRound,
  TrendingUp,
  Target,
  History,
  SlidersHorizontal,
  type LucideIcon,
} from "lucide-react";

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
}

export interface NavModule {
  id: string;
  label: string;
  icon: LucideIcon;
  basePath: string;
  items: NavItem[];
}

export const modules: NavModule[] = [
  {
    id: "heures",
    label: "Suivi des heures",
    icon: Clock,
    basePath: "/heures",
    items: [
      { href: "/heures/dashboard", label: "Tableau de bord", icon: LayoutDashboard },
      { href: "/heures/analytics", label: "Analytique", icon: BarChart3 },
      { href: "/heures/drivers", label: "Conducteurs", icon: Users },
      { href: "/heures/comparison", label: "Comparaison", icon: GitCompareArrows },
      { href: "/heures/import", label: "Importation", icon: Upload },
    ],
  },
  {
    id: "workforce",
    label: "Workforce Planning",
    icon: UsersRound,
    basePath: "/workforce",
    items: [
      { href: "/workforce/dashboard", label: "Tableau de bord", icon: LayoutDashboard },
      { href: "/workforce/scenarios", label: "Scénarios", icon: SlidersHorizontal },
      { href: "/workforce/targets", label: "Besoins cibles", icon: Target },
      { href: "/workforce/history", label: "Analyse historique", icon: History },
      { href: "/workforce/import", label: "Importation", icon: Upload },
    ],
  },
];

export const globalNavItems: NavItem[] = [
  { href: "/settings", label: "Paramètres", icon: Settings },
];

export function getActiveModule(pathname: string): NavModule | undefined {
  return modules.find((m) => pathname.startsWith(m.basePath));
}
