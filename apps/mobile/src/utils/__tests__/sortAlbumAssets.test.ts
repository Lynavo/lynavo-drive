import type { AlbumAssetDTO } from '@syncflow/contracts';
import { sortAlbumAssetsForDisplay } from '../sortAlbumAssets';

function makeAsset(
  overrides: Partial<AlbumAssetDTO> & Pick<AlbumAssetDTO, 'assetLocalId'>,
): AlbumAssetDTO {
  const { assetLocalId, ...rest } = overrides;

  return {
    assetLocalId,
    filename: `${assetLocalId}.jpg`,
    mediaType: 'image',
    fileSize: 1,
    creationDate: '2026-04-10T00:00:00.000Z',
    thumbnailUri: '',
    isTransferred: false,
    isQueued: false,
    ...rest,
  };
}

describe('sortAlbumAssetsForDisplay', () => {
  it('orders selectable assets before queued and transferred assets', () => {
    const assets = [
      makeAsset({
        assetLocalId: 'transferred',
        isTransferred: true,
        creationDate: '2026-04-10T12:00:00.000Z',
      }),
      makeAsset({
        assetLocalId: 'queued',
        isQueued: true,
        creationDate: '2026-04-10T13:00:00.000Z',
      }),
      makeAsset({
        assetLocalId: 'selectable',
        creationDate: '2026-04-10T11:00:00.000Z',
      }),
    ];

    expect(sortAlbumAssetsForDisplay(assets).map(asset => asset.assetLocalId)).toEqual([
      'selectable',
      'queued',
      'transferred',
    ]);
  });

  it('keeps newer assets first inside the same rank', () => {
    const assets = [
      makeAsset({
        assetLocalId: 'older-selectable',
        creationDate: '2026-04-09T12:00:00.000Z',
      }),
      makeAsset({
        assetLocalId: 'newer-selectable',
        creationDate: '2026-04-10T12:00:00.000Z',
      }),
      makeAsset({
        assetLocalId: 'older-queued',
        isQueued: true,
        creationDate: '2026-04-08T12:00:00.000Z',
      }),
      makeAsset({
        assetLocalId: 'newer-queued',
        isQueued: true,
        creationDate: '2026-04-11T12:00:00.000Z',
      }),
    ];

    expect(sortAlbumAssetsForDisplay(assets).map(asset => asset.assetLocalId)).toEqual([
      'newer-selectable',
      'older-selectable',
      'newer-queued',
      'older-queued',
    ]);
  });
});
