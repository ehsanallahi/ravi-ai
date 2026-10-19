import { can } from "@ravi/core";
import { CheckCircle2, CircleAlert, Phone } from "lucide-react";
import type { Metadata } from "next";
import { AccessDenied } from "@/components/layout/access-denied";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatDate, formatDateTime } from "@/lib/format";
import { listWhatsAppAccounts } from "@/server/data/whatsapp";
import { getOrganizationSettings, listAuditLog } from "@/server/services/organizations";
import { requireTenant } from "@/server/tenancy/next";
import { getAiRuntime } from "@/server/ai/runtime";
import { getAiStatus } from "@/server/data/ai";
import { AiBudgetForm, AiConsentForm } from "./ai-settings";
import { SettingsForm } from "./settings-form";

export const metadata: Metadata = { title: "Settings" };

export default async function SettingsPage({ params }: { params: Promise<{ orgSlug: string }> }) {
  const { orgSlug } = await params;
  const ctx = await requireTenant(orgSlug);
  if (!can(ctx.role, "settings:manage")) {
    return (
      <>
        <PageHeader title="Settings" />
        <AccessDenied what="manage organization settings" />
      </>
    );
  }

  const [org, accounts, audit, aiStatus] = await Promise.all([
    getOrganizationSettings(ctx),
    listWhatsAppAccounts(ctx),
    can(ctx.role, "audit:read") ? listAuditLog(ctx, 25) : Promise.resolve([]),
    getAiStatus(ctx, getAiRuntime().runtime),
  ]);

  return (
    <>
      <PageHeader
        title="Settings"
        description="Organization configuration and connection status."
      />

      <Card>
        <CardHeader>
          <CardTitle>Organization</CardTitle>
        </CardHeader>
        <CardContent>
          <SettingsForm orgSlug={orgSlug} name={org.name} timezone={org.timezone} slug={org.slug} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Phone className="size-4" /> WhatsApp connection
          </CardTitle>
          <CardDescription>
            Official Cloud API numbers registered to this organization. Access tokens are stored
            encrypted and are never shown here. Live sending is disabled in this phase.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {accounts.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No number connected. Register one with{" "}
              <code className="rounded bg-muted px-1">pnpm --filter @ravi/db account:register</code>{" "}
              (see README).
            </p>
          ) : (
            <ul className="space-y-3">
              {accounts.map((a) => (
                <li
                  key={a.id}
                  className="flex flex-col gap-2 rounded-lg border p-3 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div>
                    <p className="font-medium">{a.displayPhoneNumber ?? "Phone number"}</p>
                    <p className="text-xs text-muted-foreground">
                      Phone number ID {a.phoneNumberId} · WABA {a.wabaId} · added{" "}
                      {formatDate(a.createdAt)}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Badge variant={a.status === "ACTIVE" ? "default" : "outline"}>
                      {a.status === "ACTIVE" ? "Receiving webhooks" : "Disabled"}
                    </Badge>
                    <Badge variant="outline" className="gap-1">
                      {a.hasAccessToken ? (
                        <CheckCircle2 className="size-3" />
                      ) : (
                        <CircleAlert className="size-3" />
                      )}
                      {a.hasAccessToken ? "Token stored (encrypted)" : "No token"}
                    </Badge>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>AI assistant (Google Gemini)</CardTitle>
          <CardDescription>
            {aiStatus.models
              ? `${aiStatus.models.chat} · ${aiStatus.models.embedding} (${aiStatus.models.dimensions} dimensions)`
              : "AI is not configured on this server."}{" "}
            Automatic WhatsApp replies: off.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-2">
            <p className="text-sm font-medium">
              Data processing consent:{" "}
              {aiStatus.usage.consentAt
                ? `enabled ${formatDateTime(aiStatus.usage.consentAt)}`
                : "not given"}
            </p>
            {can(ctx.role, "org:manage") ? (
              <AiConsentForm orgSlug={orgSlug} granted={Boolean(aiStatus.usage.consentAt)} />
            ) : (
              <p className="text-sm text-muted-foreground">Only an owner can change this.</p>
            )}
          </div>
          <div className="space-y-2">
            <p className="text-sm font-medium">
              Usage this month: ${aiStatus.usage.monthToDateUsd.toFixed(4)} of $
              {aiStatus.usage.budgetUsd.toFixed(2)} · {aiStatus.usage.requestsLastHour}/
              {aiStatus.usage.requestsPerHour} requests in the last hour
            </p>
            {can(ctx.role, "org:manage") ? (
              <AiBudgetForm
                orgSlug={orgSlug}
                orgBudget={aiStatus.orgBudgetUsd}
                platformBudget={aiStatus.platformBudgetUsd}
              />
            ) : null}
          </div>
        </CardContent>
      </Card>

      {can(ctx.role, "audit:read") ? (
        <Card className="pb-0">
          <CardHeader>
            <CardTitle>Audit log</CardTitle>
            <CardDescription>The 25 most recent security-relevant actions.</CardDescription>
          </CardHeader>
          {audit.length === 0 ? (
            <CardContent className="pb-5">
              <p className="text-sm text-muted-foreground">No entries yet.</p>
            </CardContent>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Action</TableHead>
                  <TableHead className="hidden sm:table-cell">By</TableHead>
                  <TableHead className="text-right">When</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {audit.map((e) => (
                  <TableRow key={e.id}>
                    <TableCell className="font-mono text-xs">{e.action}</TableCell>
                    <TableCell className="hidden text-muted-foreground sm:table-cell">
                      {e.actor?.name ?? e.actor?.email ?? "System"}
                    </TableCell>
                    <TableCell className="text-right text-muted-foreground">
                      {formatDateTime(e.createdAt)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </Card>
      ) : null}
    </>
  );
}
