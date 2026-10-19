import type { EmailMessage } from "./index";

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function layout(title: string, bodyHtml: string): string {
  return `<!doctype html><html><body style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;background:#f6f8f7;padding:24px;color:#1b2420">
<div style="max-width:520px;margin:0 auto;background:#fff;border:1px solid #e3e8e5;border-radius:12px;padding:28px">
<p style="font-weight:600;margin:0 0 16px">Ravi AI</p>
<h1 style="font-size:18px;margin:0 0 12px">${escapeHtml(title)}</h1>
${bodyHtml}
<p style="font-size:12px;color:#6b7570;margin-top:24px">If you did not expect this email, you can ignore it.</p>
</div></body></html>`;
}

function button(url: string, label: string): string {
  return `<p style="margin:20px 0"><a href="${escapeHtml(url)}" style="background:#1f8a5b;color:#fff;padding:10px 16px;border-radius:8px;text-decoration:none;display:inline-block">${escapeHtml(label)}</a></p>
<p style="font-size:12px;color:#6b7570;word-break:break-all">Or open this link: ${escapeHtml(url)}</p>`;
}

export function verifyEmailMessage(to: string, url: string): EmailMessage {
  return {
    kind: "verify-email",
    to,
    subject: "Verify your email for Ravi AI",
    text: `Confirm your email address to finish setting up your Ravi AI account:\n\n${url}\n\nThis link expires in 1 hour.`,
    html: layout(
      "Verify your email",
      `<p>Confirm your email address to finish setting up your Ravi AI account. This link expires in 1 hour.</p>${button(url, "Verify email")}`,
    ),
  };
}

export function resetPasswordMessage(to: string, url: string): EmailMessage {
  return {
    kind: "reset-password",
    to,
    subject: "Reset your Ravi AI password",
    text: `Someone requested a password reset for your Ravi AI account. If it was you, open:\n\n${url}\n\nThis link expires in 1 hour.`,
    html: layout(
      "Reset your password",
      `<p>Someone requested a password reset for your Ravi AI account. If it was you, use the button below. The link expires in 1 hour.</p>${button(url, "Choose a new password")}`,
    ),
  };
}

export function passwordChangedMessage(to: string): EmailMessage {
  return {
    kind: "password-changed",
    to,
    subject: "Your Ravi AI password was changed",
    text: "Your Ravi AI password was just changed and your other sessions were signed out. If this wasn't you, reset your password immediately and contact your organization owner.",
    html: layout(
      "Your password was changed",
      "<p>Your Ravi AI password was just changed and your other sessions were signed out. If this wasn't you, reset your password immediately and contact your organization owner.</p>",
    ),
  };
}

export function invitationMessage(input: {
  to: string;
  url: string;
  organizationName: string;
  inviterName: string;
  role: string;
}): EmailMessage {
  const { to, url, organizationName, inviterName, role } = input;
  return {
    kind: "invitation",
    to,
    subject: `You're invited to ${organizationName} on Ravi AI`,
    text: `${inviterName} invited you to join ${organizationName} on Ravi AI as ${role}.\n\nAccept the invitation:\n${url}\n\nThis invitation expires in 7 days and can only be used with this email address.`,
    html: layout(
      `Join ${organizationName}`,
      `<p>${escapeHtml(inviterName)} invited you to join <strong>${escapeHtml(organizationName)}</strong> on Ravi AI as <strong>${escapeHtml(role)}</strong>.</p>${button(url, "Accept invitation")}<p style="font-size:13px">This invitation expires in 7 days and can only be used with this email address.</p>`,
    ),
  };
}
