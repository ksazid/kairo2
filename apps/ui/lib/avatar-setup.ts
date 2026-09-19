export const MINIMUM_AVATAR_PHOTOS = 8;
export const MAXIMUM_AVATAR_PHOTOS = 12;

export function addAvatarPhotos(current: number, added: number): number {
  return Math.min(MAXIMUM_AVATAR_PHOTOS, Math.max(0, current) + Math.max(0, added));
}

export function canContinueAvatarSetup(photoCount: number, consented: boolean): boolean {
  return consented && photoCount >= MINIMUM_AVATAR_PHOTOS;
}

export function remainingAvatarPhotos(photoCount: number): number {
  return Math.max(0, MINIMUM_AVATAR_PHOTOS - photoCount);
}
