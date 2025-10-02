import ytSearch from 'yt-search';

export async function searchYoutube(artist) {
    const result = await ytSearch(`${artist} song`);
    const videos = result.videos;
    if (!videos || videos.length === 0) return null;
    const random = Math.floor(Math.random() * videos.length);
    return videos[random];
}