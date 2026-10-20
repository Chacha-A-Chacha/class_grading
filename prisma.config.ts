import "dotenv/config";
import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
  // Generation/validation work without secrets. Database commands require this.
  datasource: { url: process.env.DATABASE_URL ?? "" },
});
