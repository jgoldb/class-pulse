import { defineConfig } from "@neon/config/v1";

export default defineConfig({
  preview: {
    buckets: {
      uploads: { access: "private" },
      assets: { access: "private" },
      content: { access: "public_read" },
    },
  },
});
