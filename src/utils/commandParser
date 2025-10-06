const COMMAND_PATTERN = /^([!\/])([\p{L}\p{N}_-]+)(?:\s+([\s\S]+))?$/u;

export function parseCommand(content) {
  if (typeof content !== 'string') return null;
  const trimmed = content.trim();
  if (!trimmed) return null;

  const match = trimmed.match(COMMAND_PATTERN);
  if (!match) return null;

  return {
    prefix: match[1],
    name: match[2].toLowerCase(),
    args: match[3]?.trim() ?? '',
  };
}

export function isCommand(content) {
  return Boolean(parseCommand(content));
}