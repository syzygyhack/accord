import type { JwtPayload } from "./middleware/auth.js";

export type AppEnv = {
  Variables: {
    user: JwtPayload;
  };
};

export interface UserProfile {
  account: string;
  displayName?: string;
  bio?: string;
  avatar?: string;  // URL path to uploaded avatar
  status?: string;
  updatedAt: number;
}
