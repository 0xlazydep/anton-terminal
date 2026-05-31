import {
  pgTable,
  uuid,
  text,
  timestamp,
  boolean,
  jsonb,
  integer,
  customType,
  pgEnum,
  index,
} from "drizzle-orm/pg-core";

const VECTOR_DIM = 1024;

export const vector = customType<{ data: number[]; driverData: string }>({
  dataType() {
    return `vector(${VECTOR_DIM})`;
  },
  toDriver(value: number[]): string {
    return `[${value.join(",")}]`;
  },
  fromDriver(value: string): number[] {
    return value
      .slice(1, -1)
      .split(",")
      .filter((s) => s.length > 0)
      .map(Number);
  },
});

export const lessonSeverityEnum = pgEnum("lesson_severity", [
  "critical",
  "important",
  "note",
]);

export const lessons = pgTable(
  "lessons",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
    category: text("category").notNull(),
    summary: text("summary").notNull(),
    severity: lessonSeverityEnum("severity").notNull(),
    embedding: vector("embedding"),
    tradeIds: uuid("trade_ids").array(),
    source: text("source").default("trade"),
    retired: boolean("retired").default(false),
    retiredReason: text("retired_reason"),
  },
  (t) => ({
    categoryIdx: index("idx_lessons_category").on(t.category),
  }),
);

export const agentIdentity = pgTable("agent_identity", {
  id: integer("id").primaryKey().default(1),
  data: jsonb("data").notNull(),
});

export const userProfile = pgTable("user_profile", {
  userId: text("user_id").primaryKey(),
  data: jsonb("data").notNull(),
});
