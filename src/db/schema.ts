import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

export const widgets = sqliteTable("widgets", {
  id: text("id").primaryKey(),
  type: text("type").notNull(),
  title: text("title"), // null = use the widget definition's default title
  column: integer("column").notNull().default(0),
  order: integer("order").notNull().default(0),
  hidden: integer("hidden", { mode: "boolean" }).notNull().default(false),
  config: text("config", { mode: "json" }).notNull().$type<Record<string, unknown>>(),
  refreshInterval: integer("refresh_interval"), // seconds, null = manual only
});

export const bookmarks = sqliteTable("bookmarks", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  url: text("url").notNull(),
  icon: text("icon"),
  order: integer("order").notNull().default(0),
});

export const prefs = sqliteTable("prefs", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});

export const widgetCache = sqliteTable("widget_cache", {
  widgetId: text("widget_id").primaryKey(),
  payload: text("payload", { mode: "json" }),
  fetchedAt: integer("fetched_at").notNull(),
  status: text("status", { enum: ["ok", "error"] }).notNull(),
  error: text("error"),
});
