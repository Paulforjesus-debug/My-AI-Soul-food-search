import { defineConfig } from "@neon/config/v1";

export default defineConfig({
  auth: true,
  functions: {
    miseapi: {
      name: "mise personal API",
      source: "functions/miseapi/index.ts",
      env: {
        KTO_SERVICE_KEY: process.env.KTO_SERVICE_KEY!,
      },
    },
  },
});
