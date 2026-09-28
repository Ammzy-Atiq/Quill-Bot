import {
  AuditLogEvent,
  Collection,
  type Guild,
  type GuildAuditLogsEntry,
  PermissionFlagsBits,
} from 'discord.js';
import { describe, expect, it } from 'vitest';
import { hasDangerous, mapAuditEntry } from '../src/modules/antinuke/mapping.js';
import { channelFromChanges, oldValues, roleFromChanges } from '../src/modules/antinuke/revert.js';
import { describeTarget } from '../src/modules/antinuke/service.js';
import type { EventRecord } from '../src/modules/antinuke/types.js';

const role = (id: string, permissions: bigint) => ({ id, permissions: { bitfield: permissions } });
const guild = {
  id: '1',
  roles: {
    cache: new Collection([
      ['10', role('10', PermissionFlagsBits.BanMembers)],
      ['11', role('11', PermissionFlagsBits.SendMessages)],
    ]),
  },
} as unknown as Guild;

const entry = (
  action: AuditLogEvent,
  changes: Array<{ key: string; old?: unknown; new?: unknown }>,
  targetId = '99',
) => ({ action, changes, targetId, executorId: '5', extra: null }) as unknown as GuildAuditLogsEntry;

describe('mapAuditEntry', () => {
  it('channel deletion is dangerous only for protected channels', () => {
    expect(mapAuditEntry(entry(AuditLogEvent.ChannelDelete, []), guild, [])).toEqual({
      action: 'channel_delete',
      dangerous: false,
      targetId: '99',
    });
    expect(mapAuditEntry(entry(AuditLogEvent.ChannelDelete, []), guild, ['99'])?.dangerous).toBe(true);
  });

  it('role edits are dangerous only when they GAIN dangerous permissions', () => {
    const gain = [{ key: 'permissions', old: '0', new: String(PermissionFlagsBits.Administrator) }];
    const loss = [{ key: 'permissions', old: String(PermissionFlagsBits.Administrator), new: '0' }];
    expect(mapAuditEntry(entry(AuditLogEvent.RoleUpdate, gain), guild, [])).toMatchObject({
      action: 'role_update',
      dangerous: true,
    });
    expect(mapAuditEntry(entry(AuditLogEvent.RoleUpdate, loss), guild, [])?.dangerous).toBe(false);
  });

  it('member role grants only count when a dangerous role is added', () => {
    const dangerous = [{ key: '$add', new: [{ id: '10', name: 'Mods' }] }];
    const harmless = [{ key: '$add', new: [{ id: '11', name: 'Members' }] }];
    expect(mapAuditEntry(entry(AuditLogEvent.MemberRoleUpdate, dangerous), guild, [])).toMatchObject({
      action: 'member_role_update',
      dangerous: true,
    });
    expect(mapAuditEntry(entry(AuditLogEvent.MemberRoleUpdate, harmless), guild, [])).toBeNull();
  });

  it('member updates only matter for timeouts', () => {
    const timeout = [{ key: 'communication_disabled_until', new: new Date().toISOString() }];
    expect(mapAuditEntry(entry(AuditLogEvent.MemberUpdate, timeout), guild, [])?.action).toBe(
      'member_timeout',
    );
    expect(
      mapAuditEntry(entry(AuditLogEvent.MemberUpdate, [{ key: 'nick', new: 'x' }]), guild, []),
    ).toBeNull();
  });

  it('bot integrations are covered by BotAdd, other integrations are protected', () => {
    expect(
      mapAuditEntry(entry(AuditLogEvent.IntegrationCreate, [{ key: 'type', new: 'discord' }]), guild, []),
    ).toBeNull();
    expect(
      mapAuditEntry(entry(AuditLogEvent.IntegrationCreate, [{ key: 'type', new: 'twitch' }]), guild, [])
        ?.action,
    ).toBe('integration_create');
  });

  it('guild updates: vanity theft and security downgrades', () => {
    expect(
      mapAuditEntry(
        entry(AuditLogEvent.GuildUpdate, [{ key: 'vanity_url_code', old: 'a', new: 'b' }]),
        guild,
        [],
      )?.action,
    ).toBe('vanity_update');
    expect(
      mapAuditEntry(
        entry(AuditLogEvent.GuildUpdate, [{ key: 'verification_level', old: 3, new: 0 }]),
        guild,
        [],
      ),
    ).toMatchObject({
      action: 'guild_update',
      dangerous: true,
    });
  });

  it('overwrites granting dangerous permissions are dangerous channel updates', () => {
    const changes = [{ key: 'allow', new: String(PermissionFlagsBits.ManageRoles) }];
    expect(mapAuditEntry(entry(AuditLogEvent.ChannelOverwriteCreate, changes), guild, [])).toMatchObject({
      action: 'channel_update',
      dangerous: true,
    });
  });

  it('ignores events anti-nuke does not protect', () => {
    expect(mapAuditEntry(entry(AuditLogEvent.MessageDelete, []), guild, [])).toBeNull();
  });

  it('hasDangerous', () => {
    expect(hasDangerous(PermissionFlagsBits.Administrator)).toBe(true);
    expect(hasDangerous(String(PermissionFlagsBits.SendMessages))).toBe(false);
    expect(hasDangerous(null)).toBe(false);
  });
});

describe('revert helpers', () => {
  it('oldValues keeps unset old values as null', () => {
    expect(
      oldValues([
        { key: 'topic', new: 'spam' },
        { key: 'name', old: 'general', new: 'nuked' },
      ]),
    ).toEqual({
      topic: null,
      name: 'general',
    });
  });

  it('rebuilds deleted channels and roles from audit data', () => {
    const channel = channelFromChanges('7', [
      { key: 'name', old: 'rules' },
      { key: 'type', old: 0 },
      { key: 'nsfw', old: false },
      { key: 'permission_overwrites', old: [{ id: '1', type: 0, allow: '0', deny: '1024' }] },
    ]);
    expect(channel).toMatchObject({
      id: '7',
      name: 'rules',
      type: 0,
      overwrites: [{ id: '1', type: 0, deny: '1024' }],
    });
    expect(channelFromChanges('7', [{ key: 'name', old: 'x' }])).toBeNull();
    expect(
      roleFromChanges('8', [
        { key: 'name', old: 'Mods' },
        { key: 'permissions', old: '8' },
      ]),
    ).toMatchObject({
      name: 'Mods',
      permissions: '8',
    });
  });

  it('describes targets for the incident timeline', () => {
    const base: EventRecord = {
      action: 'channel_delete',
      actorId: '5',
      targetId: '7',
      at: 0,
      auditAction: null,
      changes: [{ key: 'name', old: 'general' }],
      overwrite: null,
      message: null,
      dangerous: false,
      reverted: false,
    };
    expect(describeTarget(base)).toBe('#general');
    expect(describeTarget({ ...base, action: 'ban' })).toBe('<@7>');
    expect(describeTarget({ ...base, action: 'role_update' })).toBe('<@&7>');
  });
});
