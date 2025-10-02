import ytSearch from 'yt-search';

export async function searchYoutube(artist) {
    const result = await ytSearch(`${artist} song`);
    const videos = result.videos.filter(v => v.url);
    if (!videos || videos.length === 0) return null;
    const random = Math.floor(Math.random() * videos.length);
    const video = videos[random];

    console.log("Picked video:", video);

    return {
        title: video.title,
        url: video.url // 确保这里返回 url
    };
}