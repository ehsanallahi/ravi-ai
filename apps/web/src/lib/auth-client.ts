"use client";

import { twoFactorClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";

/** Browser client for /api/auth. Same origin, so cookies stay HttpOnly and first-party. */
export const authClient = createAuthClient({
  plugins: [twoFactorClient()],
});
