import type { JwtPayload } from "./middleware/auth.js";

export type AppEnv = {
  Variables: {
    user: JwtPayload;
  };
};
