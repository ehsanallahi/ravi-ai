import { AlertCircle, CheckCircle2, Info } from "lucide-react";
import Link from "next/link";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

export interface AiStatusView {
  configured: boolean;
  configError: string | null;
  consentAt: Date | null;
  remainingUsd: number;
  budgetUsd: number;
  monthToDateUsd: number;
}

/** Explains exactly why AI calls are blocked (and what unblocks them). Shows no secrets. */
export function AiStatusBanner({ status, orgSlug }: { status: AiStatusView; orgSlug: string }) {
  if (status.configError) {
    return (
      <Alert variant="destructive">
        <AlertCircle />
        <AlertTitle>AI configuration error</AlertTitle>
        <AlertDescription>{status.configError}</AlertDescription>
      </Alert>
    );
  }
  if (!status.configured) {
    return (
      <Alert>
        <Info />
        <AlertTitle>AI is not configured</AlertTitle>
        <AlertDescription>
          The server has no GEMINI_API_KEY. Add it to the server environment (never to the browser),
          then restart.
        </AlertDescription>
      </Alert>
    );
  }
  if (!status.consentAt) {
    return (
      <Alert>
        <Info />
        <AlertTitle>AI data processing is off for this organization</AlertTitle>
        <AlertDescription>
          An owner must opt in under{" "}
          <Link href={`/o/${orgSlug}/settings`} className="underline">
            Settings
          </Link>{" "}
          before any text is sent to Google Gemini.
        </AlertDescription>
      </Alert>
    );
  }
  if (status.remainingUsd <= 0) {
    return (
      <Alert variant="destructive">
        <AlertCircle />
        <AlertTitle>Monthly AI budget reached</AlertTitle>
        <AlertDescription>
          ${status.monthToDateUsd.toFixed(4)} of ${status.budgetUsd.toFixed(2)} used this month.
        </AlertDescription>
      </Alert>
    );
  }
  return (
    <Alert variant="success">
      <CheckCircle2 />
      <AlertDescription>
        AI ready · ${status.monthToDateUsd.toFixed(4)} of ${status.budgetUsd.toFixed(2)} used this
        month.
      </AlertDescription>
    </Alert>
  );
}
