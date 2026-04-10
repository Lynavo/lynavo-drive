import type { AlbumAssetDTO } from '@syncflow/contracts';

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
  return [...assets].sort((left, right) => {
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
