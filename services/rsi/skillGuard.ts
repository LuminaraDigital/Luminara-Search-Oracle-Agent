/**
 * Safety scan for a SKILL.md body before it can go live.
 *
 * The checks (prompt injection, embedded secrets, shell pipes, turning the
 * gate off) are inspired by Nous Research hermes-agent tools/skills_guard.py
 * (MIT). This file is original Luminara code and does not copy that source.
 * https://github.com/NousResearch/hermes-agent
 */

export interface SkillGuardFinding {
  id: string;
  detail: string;
}

export interface SkillGuardResult {
  ok: boolean;
  findings: SkillGuardFinding[];
}

const BLOCKS: Array<{ id: string; re: RegExp; detail: string }> = [
  {
    id: 'prompt-injection',
    re: /ignore (all |any )?(previous|prior|above) instructions/i,
    detail: 'Tells the agent to ignore prior instructions.',
  },
  {
    id: 'jailbreak',
    re: /\b(jailbreak|do anything now)\b/i,
    detail: 'Jailbreak phrasing.',
  },
  {
    id: 'disable-safety',
    re: /disable (the )?(safety|evals|guard)|skip (the )?(safety scan|evals|eval gate)/i,
    detail: 'Tries to turn off the safety scan or eval gate.',
  },
  {
    id: 'secret',
    re: /\b(sk-[a-zA-Z0-9]{8,}|AKIA[0-9A-Z]{16}|-----BEGIN [A-Z ]*PRIVATE KEY-----)\b/,
    detail: 'Embedded secret or private key.',
  },
  {
    id: 'pipe-shell',
    re: /\b(curl|wget)\b[^|\n]{0,120}\|\s*(sh|bash)\b/i,
    detail: 'Pipes a download into a shell.',
  },
  {
    id: 'exfil',
    re: /send (the )?(secrets|api keys|credentials|tokens) to/i,
    detail: 'Asks to send credentials somewhere else.',
  },
];

export function scanSkillBody(body: string): SkillGuardResult {
  const text = String(body || '');
  const findings: SkillGuardFinding[] = [];
  if (!text.trim()) {
    findings.push({ id: 'empty', detail: 'Skill body is empty.' });
  }
  if (text.length > 8000) {
    findings.push({ id: 'too-long', detail: 'Skill body exceeds 8000 characters.' });
  }
  for (const block of BLOCKS) {
    if (block.re.test(text)) findings.push({ id: block.id, detail: block.detail });
  }
  return { ok: findings.length === 0, findings };
}
