import { type CustomPolicyDefinition, isSafeRegex } from '@quill/shared/config';
import { WordMatcher } from '../matcher/word-matcher.js';
import type { Severity } from '../wordlist/types.js';
import { type FoundUrl, hostMatches } from './text.js';
import type { CompiledPolicy, DetectorContext, MessageInput, Violation } from './types.js';

/** Prepares a stored policy for fast evaluation (build once, cache per server). */
export function compilePolicy(id: number, name: string, definition: CustomPolicyDefinition): CompiledPolicy {
  const policy: CompiledPolicy = { id, name, definition };
  const trigger = definition.trigger;
  if (trigger.type === 'keywords') {
    policy.matcher = new WordMatcher(
      trigger.keywords.map((term, i) => ({
        id: `policy:${id}:${i}`,
        term,
        category: 'custom' as const,
        severity: definition.severity as Severity,
        match: trigger.match,
        lang: 'multi',
      })),
    );
  } else if (trigger.type === 'regex' && isSafeRegex(trigger.pattern)) {
    policy.regex = new RegExp(trigger.pattern, 'iu');
  }
  return policy;
}

function triggered(
  policy: CompiledPolicy,
  input: MessageInput,
  urls: readonly FoundUrl[],
  ctx: DetectorContext,
) {
  const trigger = policy.definition.trigger;
  switch (trigger.type) {
    case 'keywords': {
      const hits = policy.matcher?.match(ctx.normalized) ?? [];
      return hits.length > 0 ? hits.map((h) => h.evidence) : null;
    }
    case 'regex': {
      const text = [input.content, ...input.extraText].join('\n');
      const m = policy.regex?.exec(text) ?? policy.regex?.exec(ctx.normalized.display);
      return m ? [m[0].slice(0, 100)] : null;
    }
    case 'domains': {
      const hits = urls.filter((u) => trigger.domains.some((d) => hostMatches(u.host, d)));
      return hits.length > 0 ? hits.map((u) => u.host) : null;
    }
    case 'attachments': {
      const exts = trigger.extensions.map((e) => e.toLowerCase().replace(/^\./, ''));
      const hits = input.attachments.filter((a) =>
        exts.includes(a.name.split('.').pop()?.toLowerCase() ?? ''),
      );
      return hits.length > 0 ? hits.map((a) => a.name) : null;
    }
    case 'mentions': {
      const count = input.mentions.users + input.mentions.roles;
      return count > trigger.max ? [`${count} mentions`] : null;
    }
    case 'length':
      return input.content.length > trigger.max ? [`${input.content.length} characters`] : null;
  }
}

/** Custom server policies. Each policy fires at most once per message. */
export function evaluatePolicies(
  input: MessageInput,
  urls: readonly FoundUrl[],
  ctx: DetectorContext,
): Violation[] {
  const out: Violation[] = [];
  for (const policy of ctx.policies) {
    const def = policy.definition;
    if (def.channelIds.length > 0 && !def.channelIds.includes(input.channelId)) continue;
    if (def.exemptRoleIds.some((r) => ctx.memberRoleIds.includes(r))) continue;
    const evidence = triggered(policy, input, urls, ctx);
    if (!evidence) continue;
    out.push({
      detector: 'policy',
      category: `policy:${policy.name}`,
      severity: def.severity as Severity,
      reason: def.reason,
      evidence: evidence.slice(0, 5),
      flags: [],
      policyId: policy.id,
      policyAction: def.action,
      policyDelete: def.deleteMessage,
    });
  }
  return out;
}
