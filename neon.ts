import { defineConfig } from "@neon/config/v1";

const optionalProviderKeys = {
  ...(process.env.KAKAO_REST_API_KEY ? { KAKAO_REST_API_KEY: process.env.KAKAO_REST_API_KEY } : {}),
  ...(process.env.GOOGLE_MAPS_API_KEY ? { GOOGLE_MAPS_API_KEY: process.env.GOOGLE_MAPS_API_KEY } : {}),
  ...(process.env.YOUTUBE_API_KEY ? { YOUTUBE_API_KEY: process.env.YOUTUBE_API_KEY } : {}),
};

export default defineConfig({
  auth: true,
  functions: {
    miseapi: {
      name: "mise personal API",
      source: "functions/miseapi/index.ts",
      env: {
        KTO_SERVICE_KEY: process.env.KTO_SERVICE_KEY!,
        ...optionalProviderKeys,
      },
    },
  },
});
