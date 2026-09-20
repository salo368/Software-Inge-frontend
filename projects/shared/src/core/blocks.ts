/**
 * Base paths of every micro frontend block. They all live behind the same
 * CloudFront domain, so crossing from one block to another is a normal
 * document navigation, not an Angular route.
 */
export const BLOCK_BASE = {
  simulator: '/',
  portal: '/portal/',
  signing: '/sign/',
} as const;

export type BlockName = keyof typeof BLOCK_BASE;

/** Absolute URL of a path inside another block. */
export function blockUrl(block: BlockName, path = ''): string {
  return BLOCK_BASE[block] + path.replace(/^\//, '');
}
