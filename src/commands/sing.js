import { joinVoiceChannel, createAudioPlayer, createAudioResource, AudioPlayerStatus, VoiceConnectionStatus, entersState } from '@discordjs/voice';
import ytdl from 'ytdl-core';
import { searchYoutube } from '../utils/youtube.js';

export async function handleSingCommand(message, artist) {
    if (!message.member.voice.channel) {
        await message.reply('⚠️ 你需要先进入语音频道');
        return;
    }

    const video = await searchYoutube(artist);
    if (!video) {
        await message.reply('😢 没找到该歌手的歌曲');
        return;
    }

    const stream = ytdl(video.url, { filter: 'audioonly' });
    const resource = createAudioResource(stream);
    const player = createAudioPlayer();

    const connection = joinVoiceChannel({
        channelId: message.member.voice.channel.id,
        guildId: message.guild.id,
        adapterCreator: message.guild.voiceAdapterCreator
    });

    player.play(resource);
    connection.subscribe(player);

    await message.reply(`🎶 播放: **${video.title}**\n🔗 ${video.url}`);

    player.on(AudioPlayerStatus.Idle, () => {
        connection.destroy();
    });

    player.on('error', error => {
        console.error('播放出错:', error);
        message.reply('播放失败了 💥');
        connection.destroy();
    });

    await entersState(connection, VoiceConnectionStatus.Ready, 30_000);
}