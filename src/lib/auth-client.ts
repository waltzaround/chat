import { createAuthClient } from "better-auth/react";
import { inferAdditionalFields } from "better-auth/client/plugins";

export const authClient = createAuthClient({
  baseURL: `${window.location.origin}/api/auth`,
  plugins: [
    inferAdditionalFields({
      user: {
        username: { type: "string", required: false },
        bio: { type: "string", required: false },
        status: { type: "string", required: false },
        avatarKey: { type: "string", required: false },
      },
    }),
  ],
});

export type SocialProvider = "github" | "google";
