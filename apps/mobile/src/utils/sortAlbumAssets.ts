import type { AlbumAssetDTO } from '@lynavo-drive/contracts';

function getSortRank(asset: AlbumAssetDTO): number {
  if (asset.isTransferred) {
    return 2;
  }

  if (asset.isQueued) {
    return 1;
  }

  return 0;
}

function getCreationTimestamp(creationDate: string): number {
  const timestamp = Date.parse(creationDate);
  return Number.isFinite(timestamp) ? timestamp : 0;
}

export function sortAlbumAssetsForDisplay(
  assets: AlbumAssetDTO[],
): AlbumAssetDTO[] {
  // Deduplicate by assetLocalId — pagination overlap or refresh can
  // introduce duplicates, which causes React key collisions in FlatList.
  const seen = new Set<string>();
  const unique = assets.filter(a => {
    if (seen.has(a.assetLocalId)) return false;
    seen.add(a.assetLocalId);
    return true;
  });

  return unique.sort((left, right) => {
    const rankDelta = getSortRank(left) - getSortRank(right);
    if (rankDelta !== 0) {
      return rankDelta;
    }

    const timeDelta =
      getCreationTimestamp(right.creationDate) -
      getCreationTimestamp(left.creationDate);
    if (timeDelta !== 0) {
      return timeDelta;
    }

    return left.assetLocalId.localeCompare(right.assetLocalId);
  });
}
