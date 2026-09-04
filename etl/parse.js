export function parseCatalogPage(page, fromOffset) {
  const songs = []
  const tracks = []

  page.forEach((raw, i) => {
    songs.push({
      songId: raw.songId,
      artistId: raw.artistId ?? 0,
      artist: raw.artist ?? '',
      title: raw.title ?? '',
      hasChords: raw.hasChords ? 1 : 0,
      catalogRank: fromOffset + i,
    })

    ;(raw.tracks ?? []).forEach((t, trackIndex) => {
      tracks.push({
        songId: raw.songId,
        trackIndex,
        instrumentId: t.instrumentId ?? null,
        instrument: t.instrument ?? 'Unknown',
        name: t.name ?? null,
        difficulty: Number.isInteger(t.difficulty) ? t.difficulty : null,
        views: t.views ?? null,
        tuning: Array.isArray(t.tuning) ? JSON.stringify(t.tuning) : null,
      })
    })
  })

  return { songs, tracks }
}
