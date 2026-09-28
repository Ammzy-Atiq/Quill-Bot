import { ButtonBuilder, ButtonStyle, type ContainerBuilder } from 'discord.js';
import { Card } from './card.js';
import { E } from './emojis.js';

export const successCard = (title: string, body?: string) =>
  Card.create().header({ title, emoji: E.check, level: 3 }).text(body).build();

export const errorCard = (title: string, body?: string) =>
  Card.create().header({ title, emoji: E.cross, level: 3 }).text(body).build();

export const warningCard = (title: string, body?: string) =>
  Card.create().header({ title, emoji: E.warn, level: 3 }).text(body).build();

export const infoCard = (title: string, body?: string) =>
  Card.create().header({ title, emoji: E.info, level: 3 }).text(body).build();

export interface ConfirmOptions {
  title: string;
  body: string;
  confirmId: string;
  cancelId: string;
  confirmLabel?: string;
  danger?: boolean;
}

/** Two-button confirmation (use `lockedId` ids so only the invoker can answer). */
export function confirmCard(options: ConfirmOptions): ContainerBuilder {
  return Card.create()
    .header({ title: options.title, emoji: options.danger ? E.warn : E.info, level: 3 })
    .text(options.body)
    .buttons(
      new ButtonBuilder()
        .setCustomId(options.confirmId)
        .setLabel(options.confirmLabel ?? 'Confirm')
        .setStyle(options.danger ? ButtonStyle.Danger : ButtonStyle.Success),
      new ButtonBuilder().setCustomId(options.cancelId).setLabel('Cancel').setStyle(ButtonStyle.Secondary),
    )
    .build();
}
