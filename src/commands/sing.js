import { joinVoiceChannel, createAudioPlayer, createAudioResource, AudioPlayerStatus, entersState, VoiceConnectionStatus } from '@discordjs/voice';
import { searchYoutube } from '../utils/youtube.js';
import * as playdl from 'play-dl';

export async function handleSingCommand(message, artist) {
    const channel = message.member.voice.channel;
    if (!channel) {
        await message.reply('❌ 你需要先加入语音频道');
        return;
    }

    const video = await searchYoutube(artist);
    if (!video) {
        await message.reply('😢 找不到这位歌手的歌曲');
        return;
    }

    const stream = await playdl.stream(video.url);

    const resource = createAudioResource(stream.stream, {
        inputType: stream.type
    });

    const player = createAudioPlayer();

    const connection = joinVoiceChannel({
        channelId: channel.id,
        guildId: message.guild.id,
        adapterCreator: message.guild.voiceAdapterCreator
    });

    connection.subscribe(player);
    player.play(resource);

    player.on(AudioPlayerStatus.Idle, () => {
        connection.destroy();
    });

    player.on('error', error => {
        console.error('播放出错:', error);
        if (connection.state.status !== VoiceConnectionStatus.Destroyed) {
            connection.destroy();
        }
    });

    await entersState(connection, VoiceConnectionStatus.Ready, 30_000);
    await message.reply(`🎶 正在播放: **${video.title}**\n🔗 ${video.url}`);
}