import { timestamp, varchar } from 'drizzle-orm/pg-core';

/** Discord snowflakes are stored as strings (up to 20 digits). */
export const snowflake = (name: string) => varchar(name, { length: 20 });

export const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
export const updatedAt = () =>
  timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());
