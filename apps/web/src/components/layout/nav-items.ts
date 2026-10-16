import {
  BookOpen,
  LayoutDashboard,
  type LucideIcon,
  MessagesSquare,
  Settings,
  Target,
  Users,
} from "lucide-react";

export interface NavItem {
  title: string;
  href: string;
  icon: LucideIcon;
}

export const NAV_ITEMS: NavItem[] = [
  { title: "Overview", href: "/dashboard", icon: LayoutDashboard },
  { title: "Conversations", href: "/conversations", icon: MessagesSquare },
  { title: "Contacts", href: "/contacts", icon: Users },
  { title: "Leads", href: "/leads", icon: Target },
  { title: "Knowledge base", href: "/knowledge", icon: BookOpen },
  { title: "Settings", href: "/settings", icon: Settings },
];
