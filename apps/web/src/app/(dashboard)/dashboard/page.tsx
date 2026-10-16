import { BookOpen, CheckCircle2, Circle, MessagesSquare, Target, Users } from "lucide-react";
import type { Metadata } from "next";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export const metadata: Metadata = { title: "Overview" };

const STATS = [
  { label: "Open conversations", icon: MessagesSquare },
  { label: "Contacts", icon: Users },
  { label: "Active leads", icon: Target },
  { label: "Knowledge documents", icon: BookOpen },
];

const SETUP_STEPS = [
  {
    title: "Configure environment variables",
    detail: "Copy .env.example to .env and fill in your own values.",
    done: false,
  },
  {
    title: "Apply database migrations",
    detail: "Run pnpm db:migrate:deploy against your PostgreSQL database.",
    done: false,
  },
  {
    title: "Register your WhatsApp number",
    detail: "Use the account:register script with your Cloud API phone number ID.",
    done: false,
  },
  {
    title: "Verify the webhook in Meta",
    detail: "Point the Meta App webhook to /api/webhooks/whatsapp over HTTPS.",
    done: false,
  },
  {
    title: "Add knowledge and enable AI replies",
    detail: "Arrives with the knowledge base UI in Phase 3.",
    done: false,
  },
];

export default function OverviewPage() {
  return (
    <>
      <PageHeader
        title="Overview"
        description="Your WhatsApp support and sales activity at a glance."
      />

      <section
        aria-label="Key metrics"
        className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4"
      >
        {STATS.map(({ label, icon: Icon }) => (
          <Card key={label}>
            <CardHeader className="flex-row items-center justify-between">
              <CardDescription>{label}</CardDescription>
              <Icon className="size-4 text-muted-foreground" aria-hidden />
            </CardHeader>
            <CardContent>
              <p className="text-3xl font-semibold tabular-nums">—</p>
              <p className="mt-1 text-xs text-muted-foreground">Shown after sign-in is enabled</p>
            </CardContent>
          </Card>
        ))}
      </section>

      <Card>
        <CardHeader>
          <CardTitle>Getting started</CardTitle>
          <CardDescription>
            Complete these steps to receive your first WhatsApp message.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ol className="space-y-4">
            {SETUP_STEPS.map((step) => (
              <li key={step.title} className="flex gap-3">
                {step.done ? (
                  <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-primary" aria-label="Done" />
                ) : (
                  <Circle
                    className="mt-0.5 size-5 shrink-0 text-muted-foreground"
                    aria-label="To do"
                  />
                )}
                <div>
                  <p className="text-sm font-medium">{step.title}</p>
                  <p className="text-sm text-muted-foreground">{step.detail}</p>
                </div>
              </li>
            ))}
          </ol>
        </CardContent>
      </Card>
    </>
  );
}
