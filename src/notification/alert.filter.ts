/**
 * Per-chat alert filtering ("mute") rules, shared by the Telegram sender and
 * the /alerts menu.
 *
 * The menu mutes one exact variant - color + storage of one model - stored as
 * kind "variant", value "iPhone Duo::Night Sky::256GB". So muting
 * Night Sky 256GB never touches Star White 256GB.
 *
 * Older kinds are still honoured for safety (a migration converts them):
 * "model" mutes a whole model; "color" / "storage" mute that value for one
 * model ("iPhone Duo::2TB") or, unscoped ("2TB"), for every model.
 */
export type MuteKind = 'model' | 'color' | 'storage' | 'variant';

export const MUTE_KINDS: readonly MuteKind[] = ['model', 'color', 'storage', 'variant'];

export type Mutes = Record<MuteKind, ReadonlySet<string>>;

export interface FilterableItem {
  model?: string;
  /// Canonical English color ("Night Sky").
  color?: string;
  colorTh?: string;
  storage: string;
}

export const emptyMutes = (): Mutes => ({
  model: new Set(),
  color: new Set(),
  storage: new Set(),
  variant: new Set(),
});

export const hasAnyMute = (mutes: Mutes): boolean =>
  MUTE_KINDS.some((kind) => mutes[kind].size > 0);

/// Stored value for a color / storage that applies to one model only.
export const scopedValue = (model: string, value: string): string => `${model}::${value}`;

/// Stored value for one exact variant: "iPhone Duo::Night Sky::256GB".
export const variantValue = (model: string, color: string, storage: string): string =>
  `${model}::${color}::${storage}`;

const hasValue = (set: ReadonlySet<string>, model: string | undefined, value: string): boolean =>
  set.has(value) || (model !== undefined && set.has(scopedValue(model, value)));

export const isMuted = (mutes: Mutes, item: FilterableItem): boolean => {
  const color = item.color ?? item.colorTh ?? '';
  return (
    (item.model !== undefined && mutes.model.has(item.model)) ||
    (item.model !== undefined && mutes.variant.has(variantValue(item.model, color, item.storage))) ||
    hasValue(mutes.color, item.model, color) ||
    hasValue(mutes.storage, item.model, item.storage)
  );
};
