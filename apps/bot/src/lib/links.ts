import { ButtonBuilder, ButtonStyle, OAuth2Scopes, PermissionFlagsBits } from 'discord.js';
import type { App } from '../app.js';

/**
 * QUILL asks for Administrator: anti-nuke must be able to restore any permission
 * overwrite, recreate channels/roles and act on every member below its role.
 */
export const INVITE_PERMISSIONS = PermissionFlagsBits.Administrator;

export function inviteUrl(app: App): string {
  return app.client.generateInvite({
    scopes: [OAuth2Scopes.Bot, OAuth2Scopes.ApplicationsCommands],
    permissions: INVITE_PERMISSIONS,
  });
}

export function linkButtons(app: App): ButtonBuilder[] {
  const buttons = [
    new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel('Website').setURL(app.env.WEBSITE_URL),
    new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel('Invite QUILL').setURL(inviteUrl(app)),
  ];
  if (app.env.SUPPORT_SERVER_URL) {
    buttons.push(
      new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel('Support').setURL(app.env.SUPPORT_SERVER_URL),
    );
  }
  return buttons;
}
