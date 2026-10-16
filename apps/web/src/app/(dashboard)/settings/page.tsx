import type { Metadata } from "next";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export const metadata: Metadata = { title: "Settings" };

const SECTIONS = [
  {
    title: "WhatsApp connection",
    description:
      "Connect a WhatsApp Business phone number through the official Cloud API. For now, use the account:register script (see README).",
    status: "CLI only",
  },
  {
    title: "AI assistant",
    description:
      "AI auto-replies are off by default. They need AI_AUTO_REPLY_ENABLED, a configured provider, and the organization-level switch.",
    status: "Off by default",
  },
  {
    title: "Team and roles",
    description: "Invite teammates as Owner, Admin, Agent or Viewer.",
    status: "Phase 2",
  },
];

export default function SettingsPage() {
  return (
    <>
      <PageHeader title="Settings" description="Organization configuration." />
      <div className="grid gap-4 md:grid-cols-2">
        {SECTIONS.map((s) => (
          <Card key={s.title}>
            <CardHeader>
              <div className="flex items-center justify-between gap-2">
                <CardTitle>{s.title}</CardTitle>
                <Badge variant="secondary">{s.status}</Badge>
              </div>
              <CardDescription>{s.description}</CardDescription>
            </CardHeader>
            <CardContent />
          </Card>
        ))}
      </div>
    </>
  );
}
