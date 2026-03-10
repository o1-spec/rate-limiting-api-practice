export function buildFixedWindowKey({ scope, identifier, routeKey, window }) {
  if (routeKey) {
    return `rl:fw:${scope}:route:${routeKey}:${identifier}:${window}`;
  }

  return `rl:fw:${scope}:global:${identifier}:${window}`;
}