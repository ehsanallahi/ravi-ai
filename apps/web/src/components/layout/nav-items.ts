import {
  BookOpen,
  LayoutDashboard,
  type LucideIcon,
  MessagesSquare,
  Settings,
  Sparkles,
  Target,
  UserCog,
  Users,
} from "lucide-react";

export interface NavItem {
  title: string;
  /** Path relative to /o/[orgSlug]. */
  segment: string;
  icon: LucideIcon;
}

export const NAV_ITEMS: NavItem[] = [
  { title: "Overview", segment: "", icon: LayoutDashboard },
  { title: "Conversations", segment: "/conversations", icon: MessagesSquare },
  { title: "Contacts", segment: "/contacts", icon: Users },
  { title: "Leads", segment: "/leads", icon: Target },
  { title: "Knowledge base", segment: "/knowledge", icon: BookOpen },
  { title: "AI playground", segment: "/ai", icon: Sparkles },
  { title: "Team", segment: "/team", icon: UserCog },
  { title: "Settings", segment: "/settings", icon: Settings },
];
